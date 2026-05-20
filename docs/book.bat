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
rem Python: `python -m docs.render_book` puts cwd on sys.path[0] so
rem the driver's `from docs.lib.outline import ...` resolves. popd
rem restores docs\ before exit so callers in a chain see the cwd they
rem started with.
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

python -c "import playwright, pypdf" >nul 2>&1
if errorlevel 1 (
    echo Python dependencies not importable. From the worktree root:
    echo     pip install -r requirements.txt
    echo     playwright install chromium
    popd
    exit /b 1
)

if not exist docs\_pdf mkdir docs\_pdf

python -m docs.render_book docs\_site-pdf\book.html -o docs\_pdf\book.pdf --outline-tags h1,h2,h3,h4 --additional-script perf\detach-pages.js
set ERR=%ERRORLEVEL%

popd
exit /b %ERR%
