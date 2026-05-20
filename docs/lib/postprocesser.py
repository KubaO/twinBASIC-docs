"""PDF metadata writer.

Python port of docs/lib/postprocesser.mjs setMetadata. See
PYTHON-PORT-PLAN.md Phase 4.

Two public functions:

- gather_meta(page) -- async wrapper around a browser-side scrape of
  <title>, <html lang>, and <meta name="..."> tags. Same shape as the
  Node driver's inline page.evaluate.

- set_metadata(reader, writer, meta) -- writes /Info entries on a
  pypdf PdfWriter, with the same defaulting rules as the original:
  Creator gets `" + Paged.js"` appended to whatever Chromium emitted,
  Producer is inherited from Chromium (the Node version's Producer
  ended up as pdf-lib's own banner because pdf-lib clobbered it; the
  Python version keeps Chromium's `Skia/PDF mXX` -- arguably more
  correct).
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from pypdf import PdfReader, PdfWriter
from pypdf._utils import format_iso8824_date
from pypdf.generic import NameObject, TextStringObject


# ---- gather_meta -------------------------------------------------------

# Browser-side scrape. Copied verbatim from render-book.mjs:191-201 --
# do NOT translate to Python; this body runs in Chromium via
# page.evaluate(). Returns a flat dict: title, lang, plus one key per
# <meta name="..."> tag.
_GATHER_META_JS = """
() => {
    const m = {};
    const t = document.querySelector('title');
    if (t) m.title = t.textContent.trim();
    const lang = document.querySelector('html').getAttribute('lang');
    if (lang) m.lang = lang;
    for (const tag of document.querySelectorAll('meta')) {
        if (tag.name) m[tag.name] = tag.content;
    }
    return m;
}
"""


async def gather_meta(page: Any) -> dict:
    """Collect <title>, <html lang>, and <meta> tags from the rendered page.

    Returns a dict ready to feed into set_metadata. Always present:
    nothing -- every field is optional and defaulted downstream.
    """
    return await page.evaluate(_GATHER_META_JS)


# ---- set_metadata ------------------------------------------------------


def _pdf_date(d: datetime) -> str:
    """Format a datetime as a PDF date string per PDF 1.7 §7.9.4.

    Delegates to pypdf's own format_iso8824_date so the output matches
    pypdf's parsing conventions exactly. Naive datetimes get no offset;
    aware ones get `+HH'mm'` (or `-HH'mm'`). For our pipeline the
    creation/mod dates default to datetime.now(timezone.utc), so the
    on-disk form is `D:YYYYMMDDHHmmSS+00'00'`.
    """
    return format_iso8824_date(d)


def set_metadata(reader: PdfReader, writer: PdfWriter, meta: dict) -> None:
    """Write /Info entries and /Lang on a pypdf PdfWriter.

    Mirrors the defaulting in docs/lib/postprocesser.mjs setMetadata:
    keywords split on commas, creationDate defaults to now, modDate is
    always overwritten with now, Creator gets `" + Paged.js"` appended
    to whatever Chromium emitted, Producer is inherited from Chromium.

    `meta` is the dict returned by gather_meta(): title/lang/etc. The
    caller may also pre-set creator / producer / creationDate /
    keywords (as a list or comma-string); the defaulting only fires
    for missing entries.
    """
    # Normalize keywords: comma-string -> list, missing -> [].
    keywords = meta.get("keywords")
    if isinstance(keywords, str):
        keywords = keywords.split(",")
    elif keywords is None:
        keywords = []

    # Dates. creationDate defaults to now; modDate is always now.
    creation_date = meta.get("creationDate")
    if not isinstance(creation_date, datetime):
        creation_date = datetime.now(timezone.utc)
    mod_date = datetime.now(timezone.utc)

    # Creator / Producer: inherit from the reader's existing metadata.
    # reader.metadata is a DocumentInformation; .creator / .producer
    # return the existing string or None. Chromium populates these
    # before we ever touch the PDF.
    creator = meta.get("creator")
    if not creator:
        existing_creator = reader.metadata.creator if reader.metadata else None
        creator = f"{existing_creator} + Paged.js" if existing_creator else "Paged.js"

    producer = meta.get("producer")
    if not producer:
        existing_producer = reader.metadata.producer if reader.metadata else None
        if existing_producer:
            producer = existing_producer

    # Assemble the /Info dict. add_metadata wraps each value in
    # create_string_object(str(value)), so pre-formatted PDF date
    # strings round-trip cleanly.
    info: dict[str, Any] = {}
    if meta.get("title"):
        info["/Title"] = meta["title"]
    if meta.get("subject"):
        info["/Subject"] = meta["subject"]
    if meta.get("author"):
        info["/Author"] = meta["author"]
    if keywords:
        info["/Keywords"] = " ".join(keywords)
    if creator:
        info["/Creator"] = creator
    if producer:
        info["/Producer"] = producer
    info["/CreationDate"] = _pdf_date(creation_date)
    info["/ModDate"] = _pdf_date(mod_date)
    writer.add_metadata(info)

    # /Lang lives on the document catalog, not /Info. pdf-lib's
    # setLanguage does the same thing -- this is the Python equivalent.
    if meta.get("lang"):
        writer._root_object[NameObject("/Lang")] = TextStringObject(meta["lang"])
