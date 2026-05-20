"""PDF outline (bookmark tree) construction.

Python port of docs/lib/outline.mjs. See PYTHON-PORT-PLAN.md Phase 3.

Two public functions:

- parse_outline(page, tags) -- async wrapper around a browser-side DOM
  walk. The body is a JavaScript string passed to page.evaluate(); it
  mirrors the original Node implementation verbatim. Returns a nested
  outline tree of {title, destination, children}.

- set_outline(writer, outline) -- builds a /Outlines dict tree on a
  pypdf PdfWriter, using NameObject destinations that resolve via
  Chromium's /Dests catalog.

Bodies are stubs in Phase 1; Phase 3 implements them.
"""

from __future__ import annotations

from typing import Any


async def parse_outline(page: Any, tags: list[str]) -> list[dict]:
    """Walk the browser-side DOM and return a nested outline tree.

    Runs page.evaluate() with a JS body that mirrors the original
    pagedjs-cli parseOutline. The result is a list of dicts with
    {title, destination, children}.

    Phase 3 implements the JS string + evaluate call.
    """
    raise NotImplementedError("Phase 3 implements parse_outline.")


def set_outline(writer: Any, outline: list[dict]) -> None:
    """Attach a /Outlines tree to a pypdf PdfWriter.

    Builds DictionaryObjects with /Title, /Dest (NameObject),
    /Parent, /Prev, /Next, /First, /Last, /Count; attaches the root
    via writer._root_object[NameObject('/Outlines')].

    Phase 3 implements the tree walk + ref allocation.
    """
    raise NotImplementedError("Phase 3 implements set_outline.")
