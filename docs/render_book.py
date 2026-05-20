"""Render an HTML book to PDF via paged.js + headless Chromium + pypdf.

Python port of docs/render-book.mjs. See PYTHON-PORT-PLAN.md for the
full porting plan. This module ships the production driver invoked
by docs/pybook.bat (added in Phase 5).

Phase 1 status: argparse skeleton only. The async render driver
(Phase 2), outline porter (Phase 3), and metadata setter (Phase 4)
are filled in by subsequent phases.

Usage:
    python docs/render_book.py <input.html> -o <output.pdf>
                               [--outline-tags h1,h2,...] [-t <timeout-ms>]
                               [--additional-script <path>]...

Matches the CLI surface of docs/render-book.mjs:
    --outline-tags    : headings to include in the PDF outline.
                        Defaults to h1,h2,h3,h4 if omitted.
    -t / --timeout    : per-operation Playwright timeout in ms. 0
                        disables. Default 0 (the 1638-page book
                        takes ~100 s; we have no untrusted input).
    --additional-script
                      : extra in-page script to inject after the
                        paged.js bundle. Repeatable. Used by
                        pybook.bat to inject ../perf/detach-pages.js.
"""

from __future__ import annotations

import argparse
import asyncio


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        prog="render_book.py",
        description="Render an HTML book to PDF via paged.js + Chromium + pypdf.",
    )
    p.add_argument("input", help="Input HTML file (e.g. _site-pdf/book.html).")
    p.add_argument(
        "-o", "--output",
        required=True,
        help="Output PDF path.",
    )
    p.add_argument(
        "--outline-tags",
        default="h1,h2,h3,h4",
        help="Comma-separated heading tags to include in the PDF outline. Default: h1,h2,h3,h4.",
    )
    p.add_argument(
        "-t", "--timeout",
        type=int,
        default=0,
        help="Per-operation Playwright timeout in ms. 0 disables (default).",
    )
    p.add_argument(
        "--additional-script",
        action="append",
        default=[],
        help="Extra in-page script path to inject after paged.js. Repeatable.",
    )
    return p.parse_args()


async def render(args: argparse.Namespace) -> None:
    """Async driver: Playwright + paged.js + pypdf round-trip.

    Body filled in across Phase 2 (browser driver), Phase 3 (outline),
    Phase 4 (metadata), and Phase 5 (process + write).
    """
    raise NotImplementedError("Phase 2 onward implements the render pipeline.")


def main() -> None:
    """Sync entry point. Wraps the async render in asyncio.run."""
    asyncio.run(render(parse_args()))


if __name__ == "__main__":
    main()
