"""Compare /Outlines trees between two PDFs.

Used to verify the Python port's outline (Phase 3) matches the
Node-built reference. Dumps a normalized JSON tree from each PDF and
diffs them. Exit 0 on match, exit 1 on mismatch.

Compares:
  - page count
  - outline hierarchy (title + destination per node, recursively)
  - that each outline /Dest resolves to a /Dests entry on the catalog

Does NOT compare:
  - per-page rendered content (out of scope, byte-different by design)
  - PDF metadata (Phase 4 verifies that separately)

Usage:
    python docs/lib/compare_outlines.py <node.pdf> <python.pdf>
"""

from __future__ import annotations

import json
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


def dump_outline(pdf_path: Path) -> dict:
    reader = PdfReader(str(pdf_path))
    root = reader.trailer["/Root"]
    info: dict = {
        "path": str(pdf_path),
        "pages": len(reader.pages),
        "has_outlines": "/Outlines" in root,
        "has_dests": "/Dests" in root,
    }
    if not info["has_outlines"]:
        info["outline"] = None
        return info
    outlines = root["/Outlines"]
    info["outline_count"] = outlines.get("/Count")
    info["outline"] = _outline_to_json(outlines)

    # Sample which /Dest names resolve in /Dests.
    if info["has_dests"]:
        dests = root["/Dests"]
        # /Dests can be a name tree or a dict; Chrome uses a dict.
        if hasattr(dests, "keys"):
            info["dests_total"] = len(list(dests.keys()))
        else:
            info["dests_total"] = None
        info["dests"] = dests
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


def main() -> int:
    if len(sys.argv) != 3:
        print(__doc__)
        return 2
    a_path = Path(sys.argv[1])
    b_path = Path(sys.argv[2])
    a = dump_outline(a_path)
    b = dump_outline(b_path)

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
