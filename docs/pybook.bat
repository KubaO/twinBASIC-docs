@echo off
rem PDF render only -- Python port. Run build.bat (or `bundle exec
rem jekyll build`) first so _site-pdf\book.html and its dependencies
rem exist; this script assumes the Pdfify plugin has already populated
rem _site-pdf\.
rem
rem Parallel build path next to book.bat (Node). Same call convention:
rem run from docs\, e.g. `cd docs && pybook.bat`. Produces
rem _pdf\book-py.pdf for A/B comparison against the Node-built
rem _pdf\book.pdf; the Node path is unchanged through Phase 5 and
rem replaced in Phase 6 once the Python output is trusted. See
rem PYTHON-PORT-PLAN.md.
rem
rem Internally the script pushd's to the worktree root before invoking
rem Python so (a) `docs` is importable as a top-level package -- the
rem driver does `from docs.lib.outline import ...` -- and (b) the
rem worktree-local .venv\ is reachable at .venv\Scripts\. popd
rem restores docs\ before exit so callers in a chain see the cwd they
rem started with.
rem
rem --additional-script perf\detach-pages.js injects a Paged.Handler
rem that hides each finalised page from Chromium's layout tree and
rem restores them all before page.pdf() runs. Same flag as book.bat;
rem the injected JS runs in the browser, so it doesn't care which
rem host language drove the render.

if not exist _site-pdf\book.html (
    echo _site-pdf\book.html not found. Run build.bat first.
    exit /b 1
)

pushd ..

rem Prefer the worktree-local .venv if it exists; otherwise fall back
rem to whatever `python` is on PATH. The venv keeps playwright + pypdf
rem isolated from the system Python.
set PY=python
if exist .venv\Scripts\python.exe set PY=.venv\Scripts\python.exe

%PY% -c "import playwright, pypdf" >nul 2>&1
if errorlevel 1 (
    echo Python dependencies not importable with %PY%. From the worktree root:
    echo     python -m venv .venv
    echo     .venv\Scripts\activate
    echo     pip install -e .
    echo     playwright install chromium
    popd
    exit /b 1
)

if not exist docs\_pdf mkdir docs\_pdf

%PY% docs\render_book.py docs\_site-pdf\book.html -o docs\_pdf\book-py.pdf --outline-tags h1,h2,h3,h4 --additional-script perf\detach-pages.js
set ERR=%ERRORLEVEL%

popd
exit /b %ERR%
