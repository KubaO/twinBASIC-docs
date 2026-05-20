"""Render an HTML book to PDF via paged.js + headless Chromium + pypdf.

Python port of docs/render-book.mjs. See PYTHON-PORT-PLAN.md for the
full porting plan. This module ships the production driver invoked
by docs/pybook.bat (added in Phase 5).

Phase 3 status: Playwright browser driver + pypdf process phase with
outline attached. Metadata setter (Phase 4) is still pending.

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
import io
import re
import sys
import time
from pathlib import Path

from playwright.async_api import async_playwright
from pypdf import PdfReader, PdfWriter

from docs.lib.outline import parse_outline, set_outline


PAGED_SCRIPT_PATH = Path(__file__).parent / "lib" / "paged.browser.js"
PROGRESS_SCRIPT_PATH = Path(__file__).parent / "lib" / "progress-handler.js"


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


def _fmt_ms(seconds: float) -> str:
    return f"{seconds:.1f}s"


# JS body for triggering paged.js's per-page render. Wraps
# PagedPolyfill.preview() in a try/catch that unwraps the undecorated
# ProgressEvent paged.js throws on fetch failures so the message
# includes the offending URL. Copied verbatim from render-book.mjs:162-176.
_PREVIEW_JS = """
async () => {
    if (!window.PagedPolyfill) {
        throw new Error('paged.js bundle did not expose window.PagedPolyfill');
    }
    try {
        await window.PagedPolyfill.preview();
    } catch (err) {
        const e = err && err.target
            ? new Error(`${err.type || 'event'} on ${err.target.tagName || '?'}: ${err.target.src || err.target.href || ''}`)
            : err;
        throw e;
    }
}
"""


async def render(args: argparse.Namespace) -> None:
    """Async driver: Playwright + paged.js + (later) pypdf round-trip."""

    input_path = Path(args.input).resolve()
    output_path = Path(args.output).resolve()

    if not input_path.exists():
        print(f"input not found: {input_path}", file=sys.stderr)
        sys.exit(1)
    for p in (PAGED_SCRIPT_PATH, PROGRESS_SCRIPT_PATH):
        if not p.exists():
            print(f"required file not found: {p}", file=sys.stderr)
            sys.exit(1)
    additional_scripts = [Path(s).resolve() for s in args.additional_script]
    for p in additional_scripts:
        if not p.exists():
            print(f"additional script not found: {p}", file=sys.stderr)
            sys.exit(1)

    t0 = time.monotonic()

    async with async_playwright() as pw:
        # --allow-file-access-from-files is critical: without it paged.js's
        # stylesheet fetch() rejects with ProgressEvent under file://.
        browser = await pw.chromium.launch(
            headless=True,
            args=[
                "--no-sandbox",
                "--disable-dev-shm-usage",
                "--allow-file-access-from-files",
            ],
        )
        try:
            page = await browser.new_page()
            page.set_default_timeout(args.timeout)
            page.on("pageerror", lambda err: print(f"[page error] {err.message}", file=sys.stderr))

            def _on_requestfailed(req):
                print(f"[request failed] {req.url} {req.failure}", file=sys.stderr)
            page.on("requestfailed", _on_requestfailed)

            # Live progress. Render and generate both write a per-phase
            # status to stdout: a `\r`-overwritten line on a TTY, or sparser
            # line-per-N output when stdout is piped (CI / log files).
            # clear_progress() wipes the live line before the next phase's
            # summary is printed.
            is_tty = sys.stdout.isatty()
            progress_state = {"len": 0}

            def clear_progress() -> None:
                if is_tty and progress_state["len"] > 0:
                    sys.stdout.write("\r" + " " * progress_state["len"] + "\r")
                    sys.stdout.flush()
                    progress_state["len"] = 0

            # Render phase: progress-handler.js (loaded via add_script_tag
            # below) emits `[render-progress] page=N elapsed=Ns` from
            # afterPageLayout.
            _progress_rx = re.compile(r"page=(\d+)\s+elapsed=([\d.]+)")

            def _on_console(msg) -> None:
                t = msg.text
                if not t.startswith("[render-progress]"):
                    return
                m = _progress_rx.search(t)
                if not m:
                    return
                line = f"rendering: {m.group(1)} pages ({m.group(2)}s)"
                if is_tty:
                    padded = line.ljust(progress_state["len"])
                    sys.stdout.write("\r" + padded)
                    sys.stdout.flush()
                    progress_state["len"] = len(line)
                elif int(m.group(1)) % 100 == 0:
                    sys.stdout.write(line + "\n")
                    sys.stdout.flush()
            page.on("console", _on_console)

            outline_tags = [t.strip() for t in args.outline_tags.split(",") if t.strip()]

            await page.emulate_media(media="print")
            await page.goto(input_path.as_uri(), wait_until="load")
            await page.evaluate(
                "() => { window.PagedConfig = window.PagedConfig || {};"
                " window.PagedConfig.auto = false; }"
            )

            await page.add_script_tag(path=str(PAGED_SCRIPT_PATH))
            await page.add_script_tag(path=str(PROGRESS_SCRIPT_PATH))
            for s in additional_scripts:
                await page.add_script_tag(path=str(s))

            # Render -- paged.js per-page layout.
            t_render = time.monotonic()
            await page.evaluate(_PREVIEW_JS)
            await page.wait_for_selector(".pagedjs_pages")
            page_count = await page.evaluate(
                "() => document.querySelectorAll('.pagedjs_pages > .pagedjs_page').length"
            )
            clear_progress()
            print(f"render:   {_fmt_ms(time.monotonic() - t_render)}  ({page_count} pages)")

            # Generate -- outline walk, then Chromium DOM->PDF.
            #
            # parse_outline walks the DOM and also injects a hidden link
            # holder div whose <a href="#id"> entries make Chrome populate
            # /Dests in the emitted PDF. Must run before page.pdf().
            #
            # page.pdf() returns a single buffer with no progress signal:
            # on the Chromium we ship with, the PDF writer buffers the
            # whole document internally and dumps it at the very end. A
            # 500 ms wall-clock heartbeat keeps an elapsed counter visible
            # during the wait so the terminal doesn't look hung.
            t_generate = time.monotonic()
            outline = await parse_outline(page, outline_tags)

            async def _heartbeat() -> None:
                try:
                    while True:
                        elapsed = time.monotonic() - t_generate
                        line = f"generating: {elapsed:.1f}s"
                        padded = line.ljust(progress_state["len"])
                        sys.stdout.write("\r" + padded)
                        sys.stdout.flush()
                        progress_state["len"] = len(line)
                        await asyncio.sleep(0.5)
                except asyncio.CancelledError:
                    pass

            hb = asyncio.create_task(_heartbeat()) if is_tty else None
            try:
                # Playwright wants margin values as strings with units
                # ("0", "1cm"), not numbers. Puppeteer accepted both.
                raw_pdf = await page.pdf(
                    print_background=True,
                    display_header_footer=False,
                    prefer_css_page_size=True,
                    margin={"top": "0", "right": "0", "bottom": "0", "left": "0"},
                )
            finally:
                if hb is not None:
                    hb.cancel()
                    try:
                        await hb
                    except asyncio.CancelledError:
                        pass
                clear_progress()
            print(
                f"generate: {_fmt_ms(time.monotonic() - t_generate)}"
                f"  (raw {len(raw_pdf) / 1024 / 1024:.1f} MB)"
            )

            # Process -- pypdf round-trip with the outline attached.
            # Phase 4 will add set_metadata between the clone and write.
            t_process = time.monotonic()
            reader = PdfReader(io.BytesIO(raw_pdf))
            writer = PdfWriter(clone_from=reader)
            set_outline(writer, outline)
            with open(output_path, "wb") as f:
                writer.write(f)
            final_size = output_path.stat().st_size
            print(f"process:  {_fmt_ms(time.monotonic() - t_process)}")
            print(
                f"saved:    {output_path}"
                f"  ({final_size / 1024 / 1024:.1f} MB)"
            )
            print(f"total:    {_fmt_ms(time.monotonic() - t0)}")
        finally:
            await browser.close()


def main() -> None:
    """Sync entry point. Wraps the async render in asyncio.run."""
    asyncio.run(render(parse_args()))


if __name__ == "__main__":
    main()
