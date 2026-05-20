"""Phase 3.1 spike: confirm pypdf preserves /Dest name references.

PYTHON-PORT-PLAN.md, step 3.1. The port assumes that a hand-built
outline DictionaryObject whose /Dest is a NameObject (e.g.
NameObject('/foo')) survives PdfReader -> PdfWriter(clone_from=reader)
-> write() without pypdf rewriting it as an explicit [page /XYZ x y z]
destination array. If pypdf "helpfully" resolves the name on write,
the whole outline plan breaks and we'd need pikepdf.

This script:
  1. Builds a 2-page in-memory base PDF (the "Chromium raw PDF" stand-in).
  2. Re-reads it via PdfReader and clones into a fresh PdfWriter -- the
     exact path the production driver uses on Chromium's output.
  3. Installs a /Dests catalog entry mapping `/foo` to page 0.
  4. Hand-builds an outline /Outlines tree whose single item has
     /Dest = NameObject('/foo').
  5. Writes the result to disk.
  6. Re-reads the file from disk.
  7. Asserts (a) /Outlines is present on the catalog, (b) the outline
     item's /Dest is still a NameObject('/foo') (NOT an array), and
     (c) the /Dests catalog still resolves `/foo` to page 0.

The visual click-through (does Acrobat/Chrome navigate when you
click the outline entry?) is a human step -- this script writes
spike_out.pdf for that purpose.

Usage:
    python docs/lib/spike_dest.py [output.pdf]
"""

from __future__ import annotations

import io
import sys
from pathlib import Path

from pypdf import PdfReader, PdfWriter
from pypdf.generic import (
    ArrayObject,
    DictionaryObject,
    NameObject,
    NumberObject,
    TextStringObject,
)


def make_base_pdf() -> bytes:
    """Stand-in for the Chromium raw PDF: 2 blank pages, no outline."""
    w = PdfWriter()
    w.add_blank_page(width=612, height=792)
    w.add_blank_page(width=612, height=792)
    buf = io.BytesIO()
    w.write(buf)
    return buf.getvalue()


def build_pdf(out_path: Path) -> None:
    """Mirror the production flow: clone from a reader, add outline, write."""
    raw = make_base_pdf()
    reader = PdfReader(io.BytesIO(raw))
    writer = PdfWriter(clone_from=reader)

    # /Dests catalog entry: a name `/foo` resolving to page 0 at /XYZ.
    # Per PDF 1.7 7.11.4, /Dests in the catalog is a name tree (or dict
    # in older PDFs). The simplest form is a /Dests dict in the catalog
    # whose keys are names and values are destination arrays. Chrome
    # uses this exact shape -- a /Dests dict directly on the catalog.
    page1_ref = writer.pages[0].indirect_reference
    dest_array = ArrayObject([
        page1_ref,
        NameObject("/XYZ"),
        NumberObject(0),
        NumberObject(792),
        NumberObject(0),
    ])

    dests = DictionaryObject()
    dests[NameObject("/foo")] = dest_array
    dests_ref = writer._add_object(dests)
    writer._root_object[NameObject("/Dests")] = dests_ref

    # Outline item with /Dest = NameObject('/foo').
    # We pre-allocate the item dict so /Outlines /First can reference it.
    item = DictionaryObject()
    item_ref = writer._add_object(item)

    outline_root = DictionaryObject()
    outline_root_ref = writer._add_object(outline_root)

    # Fill the placeholder item now that we have its parent ref.
    item[NameObject("/Title")] = TextStringObject("Spike Heading")
    item[NameObject("/Dest")] = NameObject("/foo")
    item[NameObject("/Parent")] = outline_root_ref

    outline_root[NameObject("/Type")] = NameObject("/Outlines")
    outline_root[NameObject("/First")] = item_ref
    outline_root[NameObject("/Last")] = item_ref
    outline_root[NameObject("/Count")] = NumberObject(1)

    writer._root_object[NameObject("/Outlines")] = outline_root_ref

    with open(out_path, "wb") as f:
        writer.write(f)


def verify_pdf(in_path: Path) -> None:
    """Re-read the file and assert /Dest is still a NameObject."""
    reader = PdfReader(str(in_path))
    root = reader.trailer["/Root"]

    # Locate /Outlines.
    assert "/Outlines" in root, "/Outlines not present on catalog"
    outlines = root["/Outlines"]
    print(f"  /Outlines /Count: {outlines.get('/Count')}")
    assert outlines.get("/Count") == 1, f"expected /Count == 1, got {outlines.get('/Count')!r}"

    first = outlines["/First"]
    print(f"  /Outlines /First type: {type(first).__name__}")
    print(f"  /First /Title: {first.get('/Title')!r}")

    dest = first["/Dest"]
    print(f"  /First /Dest: {dest!r}  (type: {type(dest).__name__})")

    # Critical assertion: /Dest must still be a NameObject, NOT an array.
    if isinstance(dest, ArrayObject):
        raise SystemExit(
            "FAIL: pypdf rewrote /Dest from NameObject into an explicit array. "
            "The port plan needs to switch from pypdf to pikepdf."
        )
    if not isinstance(dest, NameObject):
        raise SystemExit(
            f"FAIL: /Dest is neither NameObject nor ArrayObject -- got {type(dest).__name__}"
        )
    if str(dest) != "/foo":
        raise SystemExit(f"FAIL: /Dest value changed: got {str(dest)!r}, expected '/foo'")

    # Confirm /Dests catalog still has the entry.
    assert "/Dests" in root, "/Dests catalog entry was dropped"
    dests = root["/Dests"]
    print(f"  /Dests keys: {list(dests.keys())}")
    assert "/foo" in dests, "/foo entry missing from /Dests"

    foo_dest = dests["/foo"]
    print(f"  /Dests['/foo']: {foo_dest!r}")
    assert isinstance(foo_dest, ArrayObject), "/Dests['/foo'] should be an array"
    assert len(foo_dest) >= 2, "/Dests['/foo'] should have page+fit at least"

    print()
    print("PASS: /Dest survived as NameObject('/foo') through round-trip.")
    print("PASS: /Dests catalog still resolves /foo to a page destination.")
    print()
    print(f"Open {in_path} in a viewer and click the 'Spike Heading' outline")
    print("entry to confirm it navigates to page 1. (Human verification step.)")


def main() -> int:
    out_path = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("spike_out.pdf")
    out_path = out_path.resolve()

    print(f"writing test PDF -> {out_path}")
    build_pdf(out_path)
    print(f"reading test PDF -> {out_path}")
    print()
    verify_pdf(out_path)
    return 0


if __name__ == "__main__":
    sys.exit(main())
