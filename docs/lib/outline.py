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
"""

from __future__ import annotations

import html
import re
from typing import Any

from pypdf.generic import (
    DictionaryObject,
    IndirectObject,
    NameObject,
    NumberObject,
    TextStringObject,
)


# ---- parse_outline -----------------------------------------------------

# Copied verbatim from docs/lib/outline.mjs:34-95 (the body inside
# page.evaluate). This runs in the browser via page.evaluate; do NOT
# translate it to Python. Playwright auto-serializes the `tags` arg
# and auto-decodes the returned JSON.
_PARSE_OUTLINE_JS = """
(tags) => {
    const tagsToProcess = [];
    for (const node of document.querySelectorAll(tags.join(","))) {
      tagsToProcess.push(node);
    }
    tagsToProcess.reverse();

    const root = {children: [], depth: -1};
    let currentOutlineNode = root;

    const linkHolder = document.createElement("div");
    const body = document.querySelector("body");
    linkHolder.style.display = "none";
    body.insertBefore(linkHolder, body.firstChild);

    while (tagsToProcess.length > 0) {
      const tag = tagsToProcess.pop();
      const orderDepth = tags.indexOf(tag.tagName.toLowerCase());
      const dest = encodeURIComponent(tag.id).replace(/%/g, "#25");

      // Add to link holder to register a destination
      const hiddenLink = document.createElement("a");
      hiddenLink.href = "#"+dest;
      linkHolder.appendChild(hiddenLink);

      if (orderDepth < currentOutlineNode.depth) {
        currentOutlineNode = currentOutlineNode.parent;
        tagsToProcess.push(tag);
      } else {
        const newNode = {
          title: tag.innerText.trim(),
          // encode section ID until https://bugs.chromium.org/p/chromium/issues/detail?id=985254 is fixed
          destination: dest,
          children: [],
          depth: orderDepth,
        };
        if (orderDepth == currentOutlineNode.depth) {
          if (currentOutlineNode.parent) {
            newNode.parent = currentOutlineNode.parent;
            currentOutlineNode.parent.children.push(newNode);
          } else {
            newNode.parent = currentOutlineNode;
            currentOutlineNode.children.push(newNode);
          }
          currentOutlineNode = newNode;
        } else if (orderDepth > currentOutlineNode.depth) {
          newNode.parent = currentOutlineNode;
          currentOutlineNode.children.push(newNode);
          currentOutlineNode = newNode;
        }
      }
    }

    const stripParentProperty = (node) => {
      node.parent = undefined;
      for (const child of node.children) {
        stripParentProperty(child);
      }
    };
    stripParentProperty(root);
    return root.children;
}
"""


async def parse_outline(page: Any, tags: list[str]) -> list[dict]:
    """Walk the browser-side DOM and return a nested outline tree.

    Runs page.evaluate() with a JS body that mirrors the original
    pagedjs-cli parseOutline. The result is a list of dicts with
    {title, destination, children}.
    """
    return await page.evaluate(_PARSE_OUTLINE_JS, tags)


# ---- set_outline -------------------------------------------------------

_SANITIZE_XML_RX = re.compile(r"<[^>]+>")


def _sanitize(s: str) -> str:
    """Strip XML/HTML tags and decode entities. Mirrors outline.mjs:24-31."""
    if "<" in s:
        s = _SANITIZE_XML_RX.sub("", s)
    return html.unescape(s)


# PDF Name #XX-escape decoder. PDF 1.7 7.3.5 allows any byte in a Name to
# be encoded as "#" + two hex digits. The PdfWriter we use writes raw
# strings verbatim and only escapes `#` itself on serialization, so we
# must pre-decode #XX escapes here to mirror pdf-lib's behavior -- which
# is what the Chromium-emitted /Dests catalog expects.
#
# parseOutline deliberately encodes the destination as
# encodeURIComponent(id).replace(/%/g, "#25"), counting on the PDF Name
# layer to decode #25 back to %. Chrome itself does this when writing
# /Dests from the hidden <a href="#..."> links: the dict key it emits is
# already %-form (e.g. "Form%20Designer"), so our /Dest references must
# resolve to that form too.
_NAME_ESCAPE_RX = re.compile(r"#([0-9a-fA-F]{2})")


def _decode_pdf_name(s: str) -> str:
    """Decode PDF Name #XX hex escapes per PDF 1.7 7.3.5."""
    return _NAME_ESCAPE_RX.sub(lambda m: chr(int(m.group(1), 16)), s)


def _count_children(layer: list[dict]) -> int:
    """Recursive sum of nodes in a layer. Mirrors outline.mjs:106-113."""
    count = 0
    for item in layer:
        count += 1
        count += _count_children(item["children"])
    return count


def _assign_refs(layer: list[dict], writer: Any, parent_ref: IndirectObject) -> None:
    """Pre-allocate an IndirectObject for every outline item.

    Walks the tree and attaches `ref` (IndirectObject for this item)
    and `parent_ref` (IndirectObject for the parent) to each dict.
    Each item's dict is a placeholder DictionaryObject; _build_outline_dicts
    fills it in afterwards. Mirrors outline.mjs:98-104.
    """
    for item in layer:
        placeholder = DictionaryObject()
        item["ref"] = writer._add_object(placeholder)
        item["placeholder"] = placeholder
        item["parent_ref"] = parent_ref
        _assign_refs(item["children"], writer, item["ref"])


def _build_outline_dicts(layer: list[dict]) -> None:
    """Fill each pre-allocated dict with /Title, /Dest, /Parent, and the
    sibling/child links. Mirrors outline.mjs:115-141.
    """
    for i, item in enumerate(layer):
        prev_item = layer[i - 1] if i > 0 else None
        next_item = layer[i + 1] if i + 1 < len(layer) else None

        d = item["placeholder"]
        d[NameObject("/Title")] = TextStringObject(_sanitize(item["title"]))
        # /Dest as a NameObject -- Chrome populates /Dests via the hidden
        # <a href="#id"> link trick in parseOutline; this is a name
        # reference into that catalog. The JS encodes the id as
        # encodeURIComponent(id).replace(/%/g, "#25") expecting the PDF
        # Name layer to decode #XX -> char; pypdf doesn't, so we do it.
        d[NameObject("/Dest")] = NameObject("/" + _decode_pdf_name(item["destination"]))
        d[NameObject("/Parent")] = item["parent_ref"]
        if prev_item is not None:
            d[NameObject("/Prev")] = prev_item["ref"]
        if next_item is not None:
            d[NameObject("/Next")] = next_item["ref"]
        if item["children"]:
            d[NameObject("/First")] = item["children"][0]["ref"]
            d[NameObject("/Last")] = item["children"][-1]["ref"]
            d[NameObject("/Count")] = NumberObject(_count_children(item["children"]))

        _build_outline_dicts(item["children"])


def set_outline(writer: Any, outline: list[dict]) -> None:
    """Attach a /Outlines tree to a pypdf PdfWriter.

    Builds DictionaryObjects with /Title, /Dest (NameObject),
    /Parent, /Prev, /Next, /First, /Last, /Count; attaches the root
    via writer._root_object[NameObject('/Outlines')].

    `outline` is the list of dicts returned by parse_outline: each item
    has {title, destination, children}.
    """
    if not outline:
        return

    # Pre-allocate the root ref so children can list it as /Parent.
    root_placeholder = DictionaryObject()
    root_ref = writer._add_object(root_placeholder)

    _assign_refs(outline, writer, root_ref)
    _build_outline_dicts(outline)

    root_placeholder[NameObject("/Type")] = NameObject("/Outlines")
    root_placeholder[NameObject("/First")] = outline[0]["ref"]
    root_placeholder[NameObject("/Last")] = outline[-1]["ref"]
    root_placeholder[NameObject("/Count")] = NumberObject(_count_children(outline))

    writer._root_object[NameObject("/Outlines")] = root_ref
