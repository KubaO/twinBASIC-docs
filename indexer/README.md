# indexer — TWINSERV reverse-engineering artifacts

Files produced while reverse-engineering the twinBASIC TWINSERV package
protocol and the `.twinproj` / `.twinpack` binary format (June 2026, IDE Beta
983).

## Specifications

| File | Description |
|------|-------------|
| `TWINSERV-protocol.md` | TWINSERV HTTP API specification — endpoints, auth flow, error codes, IDE-to-compiler WebSocket commands. |
| `twinproj-format.md` | Binary container format shared by `.twinproj` and `.twinpack` files — header, entry structure, field semantics. |

## Beautified IDE sources

Extracted from `C:\...\twinBASIC_IDE_BETA_983\ide\` and reformatted with
`npx prettier --print-width 120`.

| File | Description |
|------|-------------|
| `main.js` | Primary IDE JavaScript (1.2 MB).  Contains the package query/download/publish logic, the references panel, version-check flow, and all UI wiring. |
| `main2.js` | Secondary IDE script (8 KB).  Window close handler, promotional dialogs, CEF debug console bridge. |
| `toolWindow.js` | Tool-window JavaScript (151 KB).  Duplicate copies of the publisher login/register/publish functions (used in detached tool windows), plus panel layout persistence. |
| `websocketWorker.js` | Web Worker (1.4 KB).  Manages the `ws://localhost:{port}` WebSocket to the compiler process, batches incoming messages. |

## Captured data

| File | Description |
|------|-------------|
| `query_response.json` | Full response from `GET /twinbasic/packages/query?auth=` (238 KB).  32 public packages with all version metadata as of June 2026. |
| `sample.twinpack` | Downloaded `.twinpack` binary (151 KB).  CustomControlsPackage v0.0.3.0 by WaynePhillipsEA, fetched via the `/download` endpoint. |

## Tools

| File | Description |
|------|-------------|
| `parse_tree.ps1` | PowerShell script that parses and prints the entry tree of a `.twinproj` or `.twinpack` file.  Usage: `powershell -File parse_tree.ps1 <path>` |
