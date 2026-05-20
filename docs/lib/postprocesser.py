"""PDF metadata writer.

Python port of docs/lib/postprocesser.mjs setMetadata. See
PYTHON-PORT-PLAN.md Phase 4. Phase 1 ships the stub only.
"""

from __future__ import annotations

from typing import Any


def set_metadata(reader: Any, writer: Any, meta: dict) -> None:
    """Write /Info entries on a pypdf PdfWriter.

    Reads existing Creator/Producer from `reader` (PdfReader),
    defaults Creator to '<existing> + Paged.js' and Producer to the
    inherited value, then calls writer.add_metadata({...}). Also
    sets /Lang on the catalog if meta['lang'] is provided.

    Phase 4 implements the body.
    """
    raise NotImplementedError("Phase 4 implements set_metadata.")
