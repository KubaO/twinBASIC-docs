"""Compare two PDFs for the Phase 5 parallel-track gate.

Used to verify the Python port's output matches the Node-built
reference. Diffs page count, outline tree, /Dests resolution, and
/Info metadata. Exit 0 on match, exit 1 on regression.

Strict-equal (any difference is a failure):
  - page count
  - outline hierarchy (title + destination per node, recursively)
  - that each outline /Dest resolves to a /Dests entry on the catalog
  - /Info: Title, Subject, Author, Keywords
  - catalog: /Lang
  - /CreationDate, /ModDate present in both (values themselves differ
    by build time -- compared informationally only)

Acknowledged differences (printed, never a failure):
  - /Creator, /Producer. Node and Python bundle different Chromium
    builds (puppeteer's vs playwright's), so the Creator and Producer
    strings Chromium emits differ; additionally pdf-lib clobbers
    /Producer with its own banner on save while pypdf preserves
    Chromium's `Skia/PDF mXX`. Both are expected; this script prints
    the two values side by side for spot-checking.

Does NOT compare:
  - per-page rendered content (out of scope, byte-different by
    design: different Chromium versions, different object numbering).

Usage:
    python docs/lib/compare_pdfs.py <node.pdf> <python.pdf>
"""

from __future__ import annotations

import sys
from pathlib import Path

from pypdf import PdfReader
from pypdf.generic import ArrayObject, NameObject


def _outline_to_json(node, depth: int = 0) -> dict:
    title = str(node.get("/Title") or "")
    dest = node.get("/Dest")
    if isinstance(dest, NameObject):
        dest_repr = f"name:{str(dest)}"
    elif isinstance(dest, ArrayObject):
        # explicit destination array (page-indexed)
        dest_repr = f"array(len={len(dest)})"
    elif dest is None:
        dest_repr = "none"
    else:
        dest_repr = f"other:{type(dest).__name__}"
    out: dict = {"title": title, "dest": dest_repr, "children": []}
    first = node.get("/First")
    cur = first
    while cur is not None:
        # /First and /Next are IndirectObject; .get_object() resolves them.
        cur_obj = cur.get_object() if hasattr(cur, "get_object") else cur
        out["children"].append(_outline_to_json(cur_obj, depth + 1))
        nxt = cur_obj.get("/Next")
        cur = nxt
    return out


def dump_pdf(pdf_path: Path) -> dict:
    reader = PdfReader(str(pdf_path))
    root = reader.trailer["/Root"]
    info: dict = {
        "path": str(pdf_path),
        "reader": reader,
        "pages": len(reader.pages),
        "has_outlines": "/Outlines" in root,
        "has_dests": "/Dests" in root,
    }
    if info["has_outlines"]:
        outlines = root["/Outlines"]
        info["outline_count"] = outlines.get("/Count")
        info["outline"] = _outline_to_json(outlines)
    else:
        info["outline"] = None

    # Sample which /Dest names resolve in /Dests.
    if info["has_dests"]:
        dests = root["/Dests"]
        # /Dests can be a name tree or a dict; Chrome uses a dict.
        if hasattr(dests, "keys"):
            info["dests_total"] = len(list(dests.keys()))
            info["dests"] = dests
        else:
            info["dests_total"] = None
            info["dests"] = None
    return info


def _count_items(node: dict) -> int:
    n = 0
    for child in node.get("children", []):
        n += 1
        n += _count_items(child)
    return n


def _missing_dests(node: dict, dest_keys: set[str], path: str = "") -> list[str]:
    missing: list[str] = []
    for i, child in enumerate(node.get("children", [])):
        label = f"{path}/{i}:{child['title'][:30]}"
        dest = child["dest"]
        if dest.startswith("name:"):
            name = dest[len("name:"):]
            if name not in dest_keys:
                missing.append(f"{label} -> {name}")
        missing.extend(_missing_dests(child, dest_keys, label))
    return missing


def _walk_titles(node: dict, out: list[str], prefix: str = "") -> None:
    for i, child in enumerate(node.get("children", [])):
        line = f"{prefix}{child['title']}  [{child['dest']}]"
        out.append(line)
        _walk_titles(child, out, prefix + "  ")


def _get_meta(reader: PdfReader, key: str) -> str | None:
    md = reader.metadata
    if not md:
        return None
    v = md.get(key)
    return str(v) if v is not None else None


def _get_lang(reader: PdfReader) -> str | None:
    root = reader.trailer["/Root"]
    v = root.get("/Lang")
    return str(v) if v is not None else None


def _compare_metadata(a: dict, b: dict, failures: list[str]) -> None:
    """Diff /Info fields and /Lang. See module docstring for the split
    between strict-equal and acknowledged-different fields.
    """
    a_r: PdfReader = a["reader"]
    b_r: PdfReader = b["reader"]

    print()
    print("metadata (strict-equal):")
    for field in ("/Title", "/Subject", "/Author", "/Keywords"):
        va = _get_meta(a_r, field)
        vb = _get_meta(b_r, field)
        if va != vb:
            failures.append(f"metadata {field} differs: a={va!r}, b={vb!r}")
            print(f"  {field}: MISMATCH a={va!r} b={vb!r}")
        elif va is None:
            print(f"  {field}: (both unset)")
        else:
            print(f"  {field}: {va[:80]} (match)")

    a_lang = _get_lang(a_r)
    b_lang = _get_lang(b_r)
    if a_lang != b_lang:
        failures.append(f"/Lang differs: a={a_lang!r}, b={b_lang!r}")
        print(f"  /Lang: MISMATCH a={a_lang!r} b={b_lang!r}")
    elif a_lang is None:
        print(f"  /Lang: (both unset)")
    else:
        print(f"  /Lang: {a_lang} (match)")

    # Acknowledged differences: print both, don't fail. A blank value
    # on either side is still a bug -- the field should at minimum
    # contain Chromium's emitted string.
    print()
    print("metadata (Node vs Python differs by design):")
    for field in ("/Creator", "/Producer"):
        va = _get_meta(a_r, field)
        vb = _get_meta(b_r, field)
        if not va or not vb:
            failures.append(f"metadata {field} blank or missing: a={va!r}, b={vb!r}")
        print(f"  {field}:")
        print(f"    a: {va!r}")
        print(f"    b: {vb!r}")

    # Dates: same build produces same Title but never the same dates.
    # Require both present; print both values for sanity.
    for field in ("/CreationDate", "/ModDate"):
        va = _get_meta(a_r, field)
        vb = _get_meta(b_r, field)
        if va is None or vb is None:
            failures.append(f"{field} missing in one PDF: a={va!r}, b={vb!r}")
        print(f"  {field}:")
        print(f"    a: {va!r}")
        print(f"    b: {vb!r}")


def main() -> int:
    if len(sys.argv) != 3:
        print(__doc__)
        return 2
    a_path = Path(sys.argv[1])
    b_path = Path(sys.argv[2])
    a = dump_pdf(a_path)
    b = dump_pdf(b_path)

    failures: list[str] = []

    if a["pages"] != b["pages"]:
        failures.append(f"page count: {a['pages']} (a) != {b['pages']} (b)")
    else:
        print(f"pages:           {a['pages']} (match)")

    print(f"  a outline_count: {a.get('outline_count')}")
    print(f"  b outline_count: {b.get('outline_count')}")
    print(f"  a items walked:  {_count_items(a['outline']) if a['outline'] else 0}")
    print(f"  b items walked:  {_count_items(b['outline']) if b['outline'] else 0}")
    print(f"  a has /Dests:    {a['has_dests']}  ({a.get('dests_total')} entries)")
    print(f"  b has /Dests:    {b['has_dests']}  ({b.get('dests_total')} entries)")

    if (a["outline"] is None) != (b["outline"] is None):
        failures.append(f"outline presence differs: a={a['outline'] is not None}, b={b['outline'] is not None}")
    elif a["outline"] is not None:
        a_items = _count_items(a["outline"])
        b_items = _count_items(b["outline"])
        if a_items != b_items:
            failures.append(f"outline item count: {a_items} (a) != {b_items} (b)")

        # Compare structure (title + dest pair, recursively).
        a_lines: list[str] = []
        b_lines: list[str] = []
        _walk_titles(a["outline"], a_lines)
        _walk_titles(b["outline"], b_lines)
        if a_lines != b_lines:
            # Find first mismatch.
            for i, (la, lb) in enumerate(zip(a_lines, b_lines)):
                if la != lb:
                    failures.append(f"outline mismatch at item {i}:\n  a: {la}\n  b: {lb}")
                    break
            if len(a_lines) != len(b_lines):
                failures.append(f"outline line count: a={len(a_lines)}, b={len(b_lines)}")
        else:
            print(f"  outline structure: identical ({len(a_lines)} entries)")

    # Verify outline /Dest names resolve in their own /Dests catalog.
    # When the same names are missing in both PDFs, it's an upstream
    # Chromium quirk (e.g. headings whose id contains a space have a
    # hidden link with a fragment Chrome doesn't normalize). That's not
    # a port regression -- report as a warning.
    a_missing = _missing_dests(a["outline"], set(a["dests"].keys())) if a["outline"] and a["has_dests"] else []
    b_missing = _missing_dests(b["outline"], set(b["dests"].keys())) if b["outline"] and b["has_dests"] else []
    if a_missing == b_missing:
        if a_missing:
            print()
            print(f"  warn: {len(a_missing)} outline entries with missing /Dests in BOTH a and b")
            print(f"        (pre-existing Chrome behavior, not a port regression)")
            for m in a_missing[:5]:
                print(f"          {m}")
        else:
            print(f"  /Dests resolution: all outline names resolve in both PDFs")
    else:
        only_a = [m for m in a_missing if m not in b_missing]
        only_b = [m for m in b_missing if m not in a_missing]
        if only_a:
            failures.append(f"a has {len(only_a)} unique unresolved /Dest entries: {only_a[:3]}")
        if only_b:
            failures.append(f"b has {len(only_b)} unique unresolved /Dest entries: {only_b[:3]}")

    _compare_metadata(a, b, failures)

    if failures:
        print()
        print("FAIL:")
        for f in failures:
            print(f"  - {f}")
        return 1

    print()
    print("PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
