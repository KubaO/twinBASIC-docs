# Python Port Plan: paged.js Driver

Port the Node.js-based PDF rendering pipeline (`docs/render-book.mjs` and
its helpers) to Python. Production driver only — the profiling harness in
`perf/` stays in Node.

## Motivation

Ecosystem alignment. The rest of the toolchain we expect to grow around
the docs (downstream symbol extraction, content checks, deploy glue) is
easier to keep in Python than to keep adding Node modules for. The book
PDF build is the largest single Node-only piece left in the docs flow;
moving it removes the Node dependency from anything that doesn't already
need it.

Performance is not a motivation. Both pdf-lib (current) and pypdf
(proposed) are interpreter-bound; we don't expect the port to be
meaningfully faster. The Chromium-bound phases (`render`, `page.pdf`)
are unchanged regardless of host language.

## Scope

**In scope:**

- `docs/render-book.mjs` (252 lines) — production driver invoked by
  `docs/book.bat`.
- `docs/lib/outline.mjs` (181 lines) — `parseOutline` (browser-side DOM
  walk) + `setOutline` (PDF outline tree builder).
- `docs/lib/postprocesser.mjs` (97 lines) — `setMetadata`.
- `docs/lib/progress-handler.js` (25 lines) — browser-side; **stays as
  JS**, injected via `add_script_tag`.
- `docs/lib/paged.browser.js` — vendored paged.js bundle; **stays as
  JS**, injected as today.
- `docs/pybook.bat` — **new** entry point that runs the Python driver
  alongside the existing Node `book.bat`. Until the cutover in Phase 6
  the two scripts coexist: `book.bat` produces `_pdf/book.pdf` (Node,
  the production output), `pybook.bat` produces `_pdf/book-py.pdf`
  (Python, the port under development). This makes A/B comparison
  trivial at any point during development and removes any risk of
  breaking the production build while the port is in flight.

**Out of scope:**

- `perf/incremental-pdf.mjs` and the rest of `perf/`. The incremental
  writer is not used by production (see [perf/README.md](perf/README.md)
  and the `--incremental` flag in [perf/measure.mjs:299-304](perf/measure.mjs:299)
  — only the profiling harness invokes it). It would be the hardest piece
  to port and we'd get nothing for it.
- pagedjs-cli or any of its replacements. We already shed that
  dependency; the port preserves that.
- The Jekyll/Ruby `_plugins/pdfify.rb` stage that produces
  `_site-pdf/book.html`. That's upstream of the driver and unchanged.

## Tooling decisions

### Browser control: Playwright (Python)

`puppeteer` → `playwright` (Microsoft's official fork, maintained by the
team that built puppeteer originally at Google). Python bindings are
first-class.

Rejected: `pyppeteer`. Unmaintained since 2022; no Python 3.12 wheels.

### PDF manipulation: pypdf

`pdf-lib` → `pypdf`. Pure-Python, no native dependency, MIT-licensed,
active maintenance.

Rejected:

- **pikepdf**. Faster (libqpdf binding) but a C extension complicates
  Windows installs and CI provisioning. Speed isn't a goal and the
  surface we use is small enough that pypdf's pure-Python cost is
  acceptable.
- **reportlab**. Generation-focused; clumsy for "edit an existing PDF."

### Python version: 3.11+

Async support in Playwright assumes a modern asyncio. 3.11 is shipping
in most current Linux distros and on Windows installers.

### Dependency management

Add a `pyproject.toml` (PEP 621) at the repo root. It pins the two
runtime deps and declares a setuptools build backend so
`pip install -e .` discovers `docs/` cleanly:

```toml
[build-system]
requires = ["setuptools>=61"]
build-backend = "setuptools.build_meta"

[project]
name = "tbasic-docs-render"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = [
    "playwright>=1.47",
    "pypdf>=5.0",
]

[project.scripts]
render-book = "docs.render_book:main"

[tool.setuptools.packages.find]
include = ["docs*"]
namespaces = false
```

The `[tool.setuptools.packages.find]` block restricts setuptools'
auto-discovery to `docs/` (and `docs/lib/`) so it doesn't try to
package `scripts/`, `experiments/`, etc. The `[project.scripts]`
entry registers a `render-book` console script via the editable
install — the same callable that `python docs/render_book.py` runs,
just with the venv's `Scripts/` directory on PATH.

Post-install, contributors run `playwright install chromium` once to
pull the matching Chromium build — same shape as
`npm install puppeteer` today.

## File-by-file mapping

| Current (Node)                          | New (Python)                    | Notes |
|-----------------------------------------|---------------------------------|-------|
| [docs/render-book.mjs](docs/render-book.mjs) | `docs/render_book.py`           | Main driver. Argparse instead of hand-rolled flag loop. |
| [docs/lib/outline.mjs](docs/lib/outline.mjs) `parseOutline` | `docs/lib/outline.py` `parse_outline` | DOM-walk body stays as a JS string passed to `page.evaluate()` — same as today. |
| [docs/lib/outline.mjs](docs/lib/outline.mjs) `setOutline` | `docs/lib/outline.py` `set_outline` | Builds `DictionaryObject` tree via pypdf primitives instead of pdf-lib `PDFDict`. |
| [docs/lib/postprocesser.mjs](docs/lib/postprocesser.mjs) `setMetadata` | `docs/lib/postprocesser.py` `set_metadata` | pypdf `writer.add_metadata({...})` — much shorter than the JS. |
| [docs/lib/progress-handler.js](docs/lib/progress-handler.js) | unchanged | Runs in the browser; nothing to port. |
| [docs/lib/paged.browser.js](docs/lib/paged.browser.js) | unchanged | Vendored asset. |
| [docs/book.bat](docs/book.bat) | **unchanged through Phase 5**, then replaced in Phase 6 | New `docs/pybook.bat` runs alongside it during the port. |
| n/a | `docs/pybook.bat` (new) | Created in Phase 5. Calls `python docs/render_book.py ... -o _pdf/book-py.pdf` so its output sits next to the Node output for comparison. |
| [docs/package.json](docs/package.json) | **unchanged through Phase 5**, stripped or deleted in Phase 6 | Only happens at cutover, after the Python port is confirmed working. |
| n/a | `pyproject.toml` (new) | Created in Phase 1 at the repo root. Declares build-system, deps, the `render-book` console-script entry, and restricts setuptools to `docs*` package discovery. |
| n/a | `docs/__init__.py`, `docs/lib/__init__.py` (new) | Both empty. Created in Phase 1. Needed so `docs` and `docs.lib` are importable packages — without `docs/__init__.py` the `render-book` console-script entry (`docs.render_book:main`) can't resolve. |

## API translation reference

### Puppeteer → Playwright (Python, async)

| Puppeteer (current) | Playwright Python |
|---------------------|-------------------|
| `puppeteer.launch({ headless: true, args: [...] })` | `await p.chromium.launch(headless=True, args=[...])` |
| `browser.newPage()` | `await browser.new_page()` |
| `page.setDefaultTimeout(0)` | `page.set_default_timeout(0)` |
| `page.emulateMediaType('print')` | `await page.emulate_media(media='print')` |
| `page.goto(url, { waitUntil: 'load' })` | `await page.goto(url, wait_until='load')` |
| `page.addScriptTag({ path })` | `await page.add_script_tag(path=path)` |
| `page.evaluate(fn, arg)` | `await page.evaluate(js_string, arg)` (no fn introspection in Python; pass JS as a string) |
| `page.waitForSelector('.x')` | `await page.wait_for_selector('.x')` |
| `page.pdf({ printBackground: true, preferCSSPageSize: true, margin })` | `await page.pdf(print_background=True, prefer_css_page_size=True, margin={...})` |
| `page.on('console', cb)` | `page.on('console', cb)` |
| `page.on('pageerror', cb)` | `page.on('pageerror', cb)` |
| `page.on('requestfailed', cb)` | `page.on('requestfailed', cb)` |

**Watch-outs:**

- `page.evaluate` in Playwright Python takes a **JavaScript string**, not
  a Python function. The body of [outline.mjs:34-95](docs/lib/outline.mjs:34)
  (the `parseOutline` browser-side walk) is copied into a triple-quoted
  string verbatim. This is the same restriction pyppeteer had.
- Playwright auto-adds **fewer** launch args than puppeteer 22+. The
  `--export-tagged-pdf` and `--generate-pdf-document-outline` flags
  puppeteer added automatically need to be passed explicitly **if** we
  ever want them. Production doesn't (we use our own outline), so the
  args list stays minimal.
- The `--allow-file-access-from-files` flag stays critical. Without it
  paged.js's stylesheet `fetch()` rejects under `file://`. Same as today.

### pdf-lib → pypdf

| pdf-lib (current) | pypdf |
|-------------------|-------|
| `PDFDocument.load(bytes, { parseSpeed: Fastest })` | `PdfReader(BytesIO(bytes))` |
| `new PDFDocument()` / `pdfDoc.save()` | `PdfWriter(clone_from=reader)` / `writer.write(buf)` |
| `pdfDoc.setTitle/setAuthor/...` | `writer.add_metadata({"/Title": ..., "/Author": ...})` |
| `PDFDict.fromMapWithContext(map, ctx)` | `DictionaryObject({ NameObject("/K"): v, ... })` |
| `PDFName.of("Foo")` | `NameObject("/Foo")` |
| `PDFHexString.fromText(s)` | `TextStringObject(s)` |
| `PDFNumber.of(n)` | `NumberObject(n)` |
| `context.nextRef()` / `context.assign(ref, obj)` | `writer._add_object(obj)` returns an `IndirectObject` |
| `pdfDoc.catalog.set(PDFName.of("Outlines"), ref)` | `writer._root_object[NameObject("/Outlines")] = ref` |

**Watch-outs:**

- pypdf's high-level `add_outline_item(title, page_number, ...)` takes a
  page index, **not** a named destination. The current code uses named
  destinations (Chrome populates `/Dests` via the hidden `<a href="#id">`
  link trick in [outline.mjs:44-57](docs/lib/outline.mjs:44)). The port
  must build outline items as `DictionaryObject`s with `/Dest` set to a
  `NameObject("/" + destination)` — a name reference into Chrome's
  `/Dests` catalog. This mirrors what [outline.mjs:120-124](docs/lib/outline.mjs:120)
  does today.
- pypdf metadata dates need PDF date-string format
  (`D:YYYYMMDDHHmmSSZ`). Helper: format from `datetime.datetime` ourselves
  — it's a one-liner.
- The current `setMetadata` reads existing Creator/Producer from the
  in-memory PDF and appends `" + Paged.js"` to Creator. In pypdf:
  `reader.metadata.creator` returns the existing value as a string;
  concatenation works the same way.

## Implementation phases

Ordered so each step is independently verifiable. Tasks are
numbered `<phase>.<step>` for easy reference in commits / PR descriptions
(e.g. "implements 3.4-3.7").

### Phase 1: Scaffolding

**1.1** Confirm `python --version` ≥ 3.11 on the development machine.
Document the minimum version in the plan if it shifts.

**1.2** Create `pyproject.toml` at repo root with the content shown
in the "Dependency management" section above. The `[build-system]`
and `[tool.setuptools.packages.find]` blocks are not optional:
without them `pip install -e .` fails because setuptools'
auto-discovery can't pick a single top-level package out of the
repo's layout (`docs/`, `scripts/`, `experiments/`, ...).

**1.3** Recommended on Windows: create a `.venv/` at the worktree
root (`python -m venv .venv`). Add `.venv/`, `__pycache__/`, and
`*.egg-info/` to `.gitignore` if they aren't already there — a
fresh `pip install -e .` produces an `*.egg-info/` at the repo
root. System Python is fine on CI; venv keeps the dev box clean.

**1.4** Install dependencies:

```cmd
pip install -e .
playwright install chromium
```

`playwright install chromium` downloads ~170 MB to
`%USERPROFILE%\AppData\Local\ms-playwright\` on Windows. Same idea as
puppeteer's first-run download today.

**1.5** Create `docs/render_book.py` with an argparse skeleton mirroring
the current CLI surface from
[render-book.mjs:42-63](docs/render-book.mjs:42):

```python
def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser()
    p.add_argument("input")
    p.add_argument("-o", "--output", required=True)
    p.add_argument("--outline-tags", default="h1,h2,h3,h4")
    p.add_argument("-t", "--timeout", type=int, default=0)
    p.add_argument("--additional-script", action="append", default=[])
    return p.parse_args()
```

Also stub an `async def render(args)` (the actual driver, body filled
in Phase 2+) and a sync `def main()` that wraps
`asyncio.run(render(parse_args()))`. Both are needed: Playwright's API
is async, but `book.bat` calls a single command. `main` is what the
`render-book` console-script entry resolves to.

**1.6** Create `docs/__init__.py` (empty), `docs/lib/__init__.py`
(empty), `docs/lib/outline.py`, and `docs/lib/postprocesser.py`. The
two non-empty `.py` files get stub function signatures and
docstrings — no bodies yet. `docs/__init__.py` is required so the
`render-book` console-script entry (`docs.render_book:main`)
resolves.

**1.7** Smoke test:

```cmd
python docs/render_book.py --help
python -c "import playwright; import pypdf; print('ok')"
```

**Phase 1 done when:** the script prints help, both deps import, and
Chromium is downloaded.

### Phase 2: Browser driver (3-5 hours)

**2.1** Set up the async main shell. Mirror the structure of
[render-book.mjs:95-110](docs/render-book.mjs:95):

```python
async def render(args) -> None:
    async with async_playwright() as p:
        browser = await p.chromium.launch(
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
            # ... wire event listeners, navigate, render, etc.
        finally:
            await browser.close()
```

**2.2** Wire the error-event listeners from
[render-book.mjs:113-117](docs/render-book.mjs:113):

- `page.on("pageerror", lambda err: print(f"[page error] {err}", file=sys.stderr))`
- `page.on("requestfailed", lambda req: print(f"[request failed] {req.url} {req.failure}", file=sys.stderr))`

**2.3** Build the progress-display state machine from
[render-book.mjs:122-145](docs/render-book.mjs:122):

- `is_tty = sys.stdout.isatty()`
- `progress_line_len` — a mutable holder (e.g. `[0]` or a small class)
  because closures over int rebinding don't work in Python the way they
  do in JS.
- `clear_progress()` — write `\r` + spaces + `\r` when TTY.
- Console handler: filter `[render-progress] page=N elapsed=N` lines,
  format `rendering: N pages (Ns)`, write with `\r` on TTY or
  line-per-100-pages on pipe.

**2.4** Navigate + script injection. Mirror
[render-book.mjs:147-158](docs/render-book.mjs:147):

```python
await page.emulate_media(media="print")
await page.goto(Path(args.input).resolve().as_uri(), wait_until="load")
await page.evaluate(
    "() => { window.PagedConfig = window.PagedConfig || {}; "
    "window.PagedConfig.auto = false; }"
)
await page.add_script_tag(path=str(PAGED_SCRIPT_PATH))
await page.add_script_tag(path=str(PROGRESS_SCRIPT_PATH))
for s in args.additional_script:
    await page.add_script_tag(path=str(Path(s).resolve()))
```

The `pathToFileURL` equivalent is `pathlib.Path(...).as_uri()`.

**2.5** Trigger the paged.js render. Mirror
[render-book.mjs:161-178](docs/render-book.mjs:161). Wrap
`PagedPolyfill.preview()` in a JS try/catch that unwraps `ProgressEvent`
errors into readable messages — same body as today, copied verbatim
into a Python string.

**2.6** After `waitForSelector(".pagedjs_pages")`, pull the page count
via `page.evaluate`. Log render-phase elapsed.

**2.7** Build the generate-phase heartbeat. Unlike Node's
`setInterval`, use `asyncio.create_task` with a sleep loop, and cancel
it in a `finally`:

```python
async def heartbeat():
    while True:
        await asyncio.sleep(0.5)
        elapsed = (time.monotonic() - t_generate) * 1
        # write progress line
hb = asyncio.create_task(heartbeat()) if is_tty else None
try:
    raw_pdf = await page.pdf(...)
finally:
    if hb: hb.cancel()
    clear_progress()
```

**2.8** The `page.pdf()` call. Mirror
[render-book.mjs:219-224](docs/render-book.mjs:219), translating to
snake_case kwargs:

```python
raw_pdf = await page.pdf(
    print_background=True,
    display_header_footer=False,
    prefer_css_page_size=True,
    margin={"top": "0", "right": "0", "bottom": "0", "left": "0"},
)
```

Note Playwright wants margin values as **strings with units** (`"0"`,
`"1cm"`) not numbers. Puppeteer accepts both.

**2.9** Log generate-phase elapsed and raw PDF size.

**Phase 2 done when:** `python docs/render_book.py _site-pdf/book.html
-o _pdf/test.pdf` produces a PDF that opens, has the expected page
count, and shows the right pages — but no outline or metadata.

### Phase 3: Outline (5-8 hours, the risky phase)

**3.1 (SPIKE — do this first, before anything else in Phase 3).**
Verify that pypdf round-trips name-reference destinations cleanly.
Write a throwaway script that:

- Creates a 2-page PDF with `reportlab` or any tool.
- Loads it with `PdfReader`, makes a `PdfWriter` with `clone_from=reader`.
- Adds a `/Dests` entry pointing the name `/foo` at page 1.
- Adds an outline item as a hand-built `DictionaryObject` with
  `/Dest = NameObject("/foo")`.
- Writes the output, reloads it, and confirms (a) the outline item
  exists, (b) its `/Dest` is still a name (not rewritten as an explicit
  `[page /XYZ ...]` array), and (c) opening the PDF in a viewer jumps
  to page 1 when the outline item is clicked.

**If this fails or pypdf mangles the `/Dest`, stop and switch the plan
to pikepdf.** Don't proceed with the rest of Phase 3 on a foundation
that doesn't hold the structure we need. Budget: 1-2 hours for the
spike.

**3.2** Copy the JS body of `parseOutline` from
[outline.mjs:34-95](docs/lib/outline.mjs:34) into a Python triple-quoted
string constant in `docs/lib/outline.py`. **Do not translate the JS to
Python** — it runs in the browser.

**3.3** Implement the `parse_outline` async wrapper:

```python
async def parse_outline(page, tags: list[str]) -> list[dict]:
    return await page.evaluate(PARSE_OUTLINE_JS, tags)
```

Playwright auto-serializes the `tags` arg and auto-decodes the returned
JSON. The result is a list of dicts with `title`, `destination`,
`children` — same shape as today.

**3.4** Implement the `sanitize()` helper. Mirror
[outline.mjs:24-31](docs/lib/outline.mjs:24):

```python
_SANITIZE_XML_RX = re.compile(r"<[^>]+>")
def sanitize(s: str) -> str:
    if "<" in s:
        s = _SANITIZE_XML_RX.sub("", s)
    return html.unescape(s)
```

`html.unescape` is in the standard library — no `html-entities`
equivalent dependency needed.

**3.5** Implement `count_children(layer)` — recursive sum of nodes.
Trivial port from [outline.mjs:106-113](docs/lib/outline.mjs:106).

**3.6** Implement `assign_refs(layer, writer, parent_ref)` — walks the
tree, allocates an `IndirectObject` for each item, attaches a
`.ref` and `.parent_ref` for use in 3.7. pypdf allocates refs via
`writer._add_object(obj)` returning an `IndirectObject`; we want refs
before objects, so pre-allocate a placeholder `DictionaryObject` and
fill it in 3.7.

**3.7** Implement `build_outline_dicts(layer, writer)` — fills in each
pre-allocated dict with `/Title`, `/Dest`, `/Parent`, plus `/Prev`,
`/Next`, `/First`, `/Last`, `/Count` as applicable. Mirror
[outline.mjs:115-141](docs/lib/outline.mjs:115). Key types:

```python
from pypdf.generic import (
    DictionaryObject, NameObject, NumberObject, TextStringObject,
    IndirectObject,
)
item_dict[NameObject("/Title")]  = TextStringObject(sanitize(item["title"]))
item_dict[NameObject("/Dest")]   = NameObject("/" + item["destination"])
item_dict[NameObject("/Parent")] = parent_ref
```

**3.8** Implement `set_outline(writer, outline)` — top-level entry
point. Mirror [outline.mjs:157-181](docs/lib/outline.mjs:157):

- Bail out if outline is empty.
- Allocate root ref.
- Call `assign_refs` and `build_outline_dicts`.
- Build root dict with `/First`, `/Last`, `/Count`.
- Attach to catalog: `writer._root_object[NameObject("/Outlines")] = root_ref`.

**3.9** Wire `parse_outline` + `set_outline` into the driver between
the generate and process phases, matching the order in
[render-book.mjs:202, 239](docs/render-book.mjs:202).

**3.10** Build the full book and verify in a PDF viewer:

- Open `_pdf/book.pdf` in Adobe Acrobat or Chrome.
- Confirm the Bookmarks / Outline panel is populated with the expected
  hierarchy (matches the H1/H2/H3/H4 structure of book.html).
- Click 10 entries sampled across depths 1-4. Each should jump to the
  correct page.
- Compare the outline structure against a recent Node-built PDF using
  the comparison script from Phase 5.

**Phase 3 done when:** outline structure matches Node output and all
sampled destinations resolve to the right pages.

### Phase 4: Metadata (1-2 hours)

**4.1** Implement a PDF-date helper:

```python
def pdf_date(d: datetime) -> str:
    # PDF spec: D:YYYYMMDDHHmmSSOHH'mm' where O is + or - or Z.
    return d.strftime("D:%Y%m%d%H%M%S") + d.strftime("%z")[:3].replace("+", "+").replace("-", "-") + "'" + d.strftime("%z")[3:] + "'"
```

(Refine the format details against the PDF 1.7 spec §7.9.4 — pypdf may
also offer a built-in formatter; check `pypdf.generic.create_string_object`
or look in `pypdf._utils`.)

**4.2** Implement `gather_meta(page)` — async wrapper around the JS from
[render-book.mjs:191-201](docs/render-book.mjs:191). Copy the JS body
verbatim into a Python string, same pattern as parse_outline.

**4.3** Implement `set_metadata(reader, writer, meta)`. Mirror
[postprocesser.mjs:39-97](docs/lib/postprocesser.mjs:39):

- Normalize `meta["keywords"]` (string → list, missing → []).
- Default `meta["creationDate"]` to now if missing; always set `modDate`
  to now.
- If `meta["creator"]` is unset, read it via
  `reader.metadata.creator` and append `" + Paged.js"`.
- If `meta["producer"]` is unset, inherit from
  `reader.metadata.producer`.
- Build the metadata dict and call `writer.add_metadata({...})`.

```python
md = {}
if meta.get("title"):    md["/Title"]    = meta["title"]
if meta.get("subject"):  md["/Subject"]  = meta["subject"]
if meta.get("author"):   md["/Author"]   = meta["author"]
if meta["keywords"]:     md["/Keywords"] = " ".join(meta["keywords"])
md["/Creator"]      = meta["creator"]
md["/Producer"]     = meta["producer"]
md["/CreationDate"] = pdf_date(meta["creationDate"])
md["/ModDate"]      = pdf_date(meta["modDate"])
writer.add_metadata(md)
```

**4.4** Handle `/Lang` (not part of `/Info`, lives on catalog):

```python
if meta.get("lang"):
    writer._root_object[NameObject("/Lang")] = TextStringObject(meta["lang"])
```

This is currently done by pdf-lib's `setLanguage` — port matches.

**4.5** Verify with `pdfinfo`:

```cmd
pdftk _pdf/book.pdf data_dump | head -50
:: or
pdfinfo _pdf/book.pdf
```

Expected fields: Title (book title), Creator (`Skia/PDF mXX + Paged.js`),
Producer (`Skia/PDF mXX`), CreationDate, ModDate, Lang (`en` or whatever
the source declares).

**Phase 4 done when:** all expected metadata fields are present and
match the Node-built reference.

### Phase 5: Parallel install (1-3 hours)

This phase produces a working Python build path **alongside** the
existing Node path, not as a replacement. `book.bat` continues to
produce `_pdf/book.pdf` exactly as before; `pybook.bat` produces
`_pdf/book-py.pdf` from the same inputs. The Node toolchain stays
untouched until Phase 6 (the cutover, gated on user acceptance).

**5.1** Wire the process phase in `render_book.py`:

```python
reader = PdfReader(BytesIO(raw_pdf))
writer = PdfWriter(clone_from=reader)
set_metadata(reader, writer, meta)
set_outline(writer, outline)
with open(args.output, "wb") as f:
    writer.write(f)
```

Log process-phase elapsed and final PDF size.

**5.2** Log total elapsed (render + generate + process). Match the
shape of the current Node output so eyeballing logs from a CI pipeline
that mixes old and new builds isn't confusing.

**5.3** Create [docs/pybook.bat](docs/pybook.bat) as a parallel entry
point to [docs/book.bat](docs/book.bat). Mirror book.bat's structure
but:

- Output path is `_pdf\book-py.pdf` (not `book.pdf`) so it sits next to
  the Node output for A/B comparison.
- Dependency-check line: replace `node_modules\puppeteer\package.json`
  check with `python -c "import playwright" 2>nul` (or check for a
  venv marker).
- Keep `if not exist _site-pdf\book.html ...` — same precondition.
- Keep the `--additional-script ..\perf\detach-pages.js` flag — the
  injection still applies (the JS file runs in the browser, host
  language doesn't matter).
- The Node `book.bat` is **not modified** in this phase.

**5.4** Write the comparison script from the Testing strategy section
as `docs/lib/compare_pdfs.py`. Compares page count, outline JSON, and
metadata between two PDFs. ~50 lines. Designed to be called as
`python docs/lib/compare_pdfs.py _pdf/book.pdf _pdf/book-py.pdf`.

**5.5** Run both builds end-to-end on the same input:

```cmd
docs\build.bat
docs\book.bat
docs\pybook.bat
python docs\lib\compare_pdfs.py _pdf\book.pdf _pdf\book-py.pdf
```

Confirm exit 0 from compare_pdfs.py.

**5.6** Time comparison: both `book.bat` and `pybook.bat` run on the
same `_site-pdf/book.html`, same machine. Record wall-clock totals and
phase breakdowns. Expect Python within ±20% of Node. If Python is much
worse, profile and decide whether to re-evaluate pikepdf.

**5.7** Optional: add a `docs/pybook.sh` Linux counterpart if any
contributor or CI environment expects a shell script. Otherwise defer
to Phase 6.

**Phase 5 done when:** both `book.bat` and `pybook.bat` produce PDFs
from the same source, `compare_pdfs.py` returns exit 0 between them,
the Python wall-clock is within acceptable bounds, and the Node
production path (`book.bat`) is byte-for-byte unchanged from main.

### Phase 6: Cutover and cleanup (1-2 hours)

This phase is **gated on acceptance** of the Python output from Phase
5. Run `pybook.bat` over multiple book.html iterations (e.g. several
real build cycles, possibly across multiple days) and confirm the
output is consistently correct before starting Phase 6. The longer the
bake-in, the lower the risk of the cutover surfacing a subtle bug in
production.

**6.0 (gate)** Before touching `book.bat` or `package.json`:

- `compare_pdfs.py` passes between the Node and Python outputs on the
  current book.html.
- At least one human has opened `_pdf/book-py.pdf` in a real viewer
  and confirmed outline navigation, metadata, and visual fidelity.
- Wall-clock performance is acceptable (no surprise 5x regression).
- Optionally: a CI run or downstream consumer has been pointed at
  `book-py.pdf` and is happy with it.

If any of these fail, fix in the Python path **without modifying
book.bat**, then re-evaluate the gate.

**6.1** Cutover: replace [docs/book.bat](docs/book.bat) with the
contents of `pybook.bat`, but change the output path back to
`_pdf\book.pdf` so downstream consumers don't need to update. Delete
`docs/pybook.bat`.

Alternative if more cautious: keep `pybook.bat` as a symlink or
single-line passthrough to `book.bat` for a release or two so anyone
with the old command in muscle memory still gets the right thing, then
remove it.

**6.2** Strip `puppeteer` and `pdf-lib` from
[docs/package.json](docs/package.json). Check whether anything else
lives in `docs/package.json`; if not, delete it and
`docs/package-lock.json`.

**6.3** Delete `docs/node_modules/` (after confirming nothing else uses
it). Add to `.gitignore` if needed — it probably already is.

**6.4** Leave `perf/` intact. Add a note at the top of
[perf/README.md](perf/README.md) clarifying:

> Production rendering moved to Python (`docs/render_book.py`) in
> commit XXX. This perf harness still uses the Node driver because the
> incremental writer (`incremental-pdf.mjs`) relies on pdf-lib
> internals that aren't ported. Numbers from `measure.mjs` are still
> directly comparable to production for the `render` and `generate`
> phases; for the `process` phase, compare against the pdf-lib mode
> only.

**6.5** Update any contributor docs (CLAUDE.md, README, etc.) that
reference the Node toolchain for book builds. Add the Python version
requirement and the one-time `playwright install chromium` step.

**6.6** Decide whether the new Python script should ship a Linux
shell-script counterpart to `book.bat`. Currently `book.bat` is the
only entry point; if CI runs on Linux, add `book.sh` mirroring it.

**Phase 6 done when:** `book.bat` runs the Python driver, the Node
toolchain is removed from `docs/`, contributor docs mention the new
prerequisites, and nobody on a fresh checkout would accidentally try
`npm install` for the book build.

### Phase totals

| Phase | Estimate | Cumulative |
|-------|----------|------------|
| 1     | 1-2 h    | 1-2 h      |
| 2     | 3-5 h    | 4-7 h      |
| 3     | 5-8 h    | 9-15 h     |
| 4     | 1-2 h    | 10-17 h    |
| 5     | 1-3 h    | 11-20 h    |
| 6     | 1-2 h    | 12-22 h    |

**Total: 1.5-3 days of focused work.** The wide spread is mostly Phase
3 (within that, the 3.1 spike) and Phase 6 (gated on acceptance —
calendar time may be longer than wall-clock work if you want a
bake-in period before cutover). If the 3.1 spike succeeds cleanly the
total comes in at the low end; if it requires switching to pikepdf,
the estimate roughly doubles.

## Testing strategy

No automated test suite exists for the renderer today, and the output is
large + non-deterministic enough that golden-file byte comparison
doesn't work (Chrome embeds a CreationDate in the raw PDF; pypdf will
shuffle object numbers vs. pdf-lib even with identical inputs).

The parallel-track strategy makes testing simple: throughout
development, `book.bat` produces the Node-built ground truth and
`pybook.bat` produces the Python-built candidate from the same input.
Compare them directly at every checkpoint — no need to manually stash
a reference PDF.

Verify four structural invariants between `_pdf/book.pdf` (Node) and
`_pdf/book-py.pdf` (Python) from the same `book.html`:

1. **Page count** identical (`pdfinfo` → `Pages:` line).
2. **Outline structure** identical — same titles, same hierarchy, same
   destinations. Easiest check: dump both outlines to JSON via a small
   pypdf script and `diff` them.
3. **Outline destinations resolve** — sample 5-10 entries at varied
   depths, open in Acrobat or Chrome, confirm each jumps to the right
   page.
4. **Metadata fields** match expected values (`pdfinfo` → Title /
   Author / Creator / Producer / CreationDate / ModDate).

A one-shot Python script comparing (1), (2), (4) between two PDF paths
is worth writing and keeping in `docs/lib/` for future regressions. ~50
lines.

## Open questions / risks

- **Named-destination outline format.** pypdf's outline helpers assume
  page-indexed destinations. We need to confirm a hand-built
  `DictionaryObject` with `/Dest` as a `NameObject` survives the
  `PdfWriter.clone_from(reader)` + `write()` round-trip without
  pypdf "helpfully" rewriting it. **Mitigation:** spike this in Phase 3
  before doing the full port. ~1 hour to verify with a 2-page test PDF.
- **`add_script_tag(path=)` with absolute Windows paths.** Playwright
  Python passes the file content to the page; the path resolution
  semantics may differ subtly from puppeteer (which we know works with
  `D:\...` paths today). **Mitigation:** verify in Phase 1 scaffolding.
- **`page.pdf()` output equivalence.** Chromium's PDF writer is what it
  is — same Chromium, same output. But Playwright may pass different
  CDP-level options than puppeteer for the same Python call signature.
  **Mitigation:** raw-PDF byte-length comparison between Node and Python
  outputs in Phase 2; should differ by < 1 KB (timestamp only).
- **pypdf performance on a 50 MB PDF.** Order-of-magnitude check: load +
  save should be < 30 s. If it's much worse, revisit pikepdf.
  **Mitigation:** Phase 2 timing comparison; we'd discover this before
  committing to the outline port.

## Out of scope (explicitly)

- Porting `perf/`. The profiling harness, including the incremental
  writer in [perf/incremental-pdf.mjs](perf/incremental-pdf.mjs), stays
  Node. Rationale: it's only used by humans doing performance work, it
  doesn't run in CI, and porting the incremental writer to pypdf would
  triple the project effort with no production benefit.
- Replacing Chromium with a different headless browser. Paged.js
  targets Blink; Firefox/WebKit aren't options.
- Migrating away from paged.js itself. Out of scope by a wide margin.

## Effort estimate

See the **Phase totals** table above for the per-phase breakdown.
Headline: **1.5-2.5 days of focused work**, with the spread driven
almost entirely by the Phase 3.1 spike outcome.

The work is parallelizable up to two contributors at most: Phase 1 must
finish first, then Phases 2 and 3 can proceed in parallel (3.1 spike +
3.2-3.4 setup don't need a working browser driver), with Phase 4
unblocked by either. Phases 5 and 6 are sequential and small enough
that splitting them isn't worth the coordination overhead.

For a single contributor, the natural rhythm is one day for Phases 1-3
(with the spike done early on day 1), half a day for Phases 4-5, and
the leftover hour for Phase 6.
