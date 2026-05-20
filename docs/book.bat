@echo off
rem PDF render only. Run build.bat (or `bundle exec jekyll build`)
rem first so _site-pdf\book.html and its dependencies exist; this
rem script assumes the Pdfify plugin has already populated _site-pdf\.
rem
rem Drives Chromium (via Playwright) + paged.js + pypdf directly so
rem we don't go through pagedjs-cli's wrapper -- see PYTHON-PORT-PLAN.md
rem for the port history and perf\README.md for the original
rem investigation. Same call convention as before:
rem `cd docs && book.bat`.
rem
rem Internally the script pushd's to the worktree root before invoking
rem Python: the driver does `from docs.lib.outline import ...`, so
rem `docs` needs to be discoverable as a top-level package on
rem sys.path, and the worktree-local .venv\ lives at .venv\Scripts\.
rem popd restores docs\ before exit so callers in a chain see the cwd
rem they started with.
rem
rem --additional-script perf\detach-pages.js injects a Paged.Handler
rem that hides each finalised page from Chromium's layout tree and
rem restores them all before page.pdf() runs. Drops total render time
rem by eliminating the O(n^2) getBoundingClientRect cost in paged.js's
rem overflow walker. See perf\README.md.

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

%PY% docs\render_book.py docs\_site-pdf\book.html -o docs\_pdf\book.pdf --outline-tags h1,h2,h3,h4 --additional-script perf\detach-pages.js
set ERR=%ERRORLEVEL%

popd
exit /b %ERR%
