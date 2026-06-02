# Plan: Automated Package Sync and Multi-Format Indexer

## Context

The current indexer (`twin-index.mjs`) reads `.twin` files from a manually-exported
package tree and generates markdown indexes. This works but requires a human to
export packages from the IDE whenever they update. We want to automate the full
pipeline: query TWINSERV for the latest packages, download only what changed,
extract source files from the `.twinpack` binaries, and index everything --
including VB6-format `.bas`, `.cls`, `.frm`, `.dsr`, and `.ctl` files that some
packages contain alongside `.twin` files.

## Module Layout

```
indexer/
  twin-index.mjs              # CLI entry point (refactored)
  lib/
    twinserv-client.mjs        # TWINSERV HTTP API client
    twinpack-parser.mjs        # Binary .twinpack format parser
    sync.mjs                   # Download/delete orchestrator
    vb6-preprocess.mjs         # VB6 file preprocessor
    lexer.mjs                  # Lexer + attribute scanner (from twin-index.mjs)
    extractor.mjs              # Declaration extractor (from twin-index.mjs)
    emitter.mjs                # Markdown emitter (from twin-index.mjs)
```

Dependency graph (arrows = imports):

```
twin-index.mjs
  --> lib/sync.mjs
        --> lib/twinserv-client.mjs
        --> lib/twinpack-parser.mjs
  --> lib/vb6-preprocess.mjs
  --> lib/lexer.mjs
  --> lib/extractor.mjs
  --> lib/emitter.mjs
```

No circular dependencies. Leaf modules (`lexer`, `extractor`, `emitter`,
`vb6-preprocess`, `twinpack-parser`) depend only on Node builtins.

## Directory Structure

```
package-indexes/
  packages/                    # Extracted source files (gitignored)
    manifest.json              # Version tracking
    Assert/
      Sources/
        Exact.twin
        Permissive.twin
        Strict.twin
    CustomControlsPackage/
      Sources/
        WaynesGrid.twin
    ...
  Assert.md                    # Generated markdown indexes (existing location)
  CustomControlsPackage.md
  ...
```

## Module Interfaces

### lib/twinserv-client.mjs

```js
export async function queryPackages()
// Calls GET /twinbasic/packages/query?auth=
// Returns: { public: PackageInfo[] }
// PackageInfo = { publisher, projectId, versions: VersionInfo[] }
// VersionInfo = { symbol, description, licence, versionMajor, versionMinor,
//                 versionRevision, versionBuild, publishedDate, publishedTime, ... }

export async function downloadPackage(projectId, version)
// Calls GET /twinbasic/packages/download with id + version params
// version = { versionMajor, versionMinor, versionRevision, versionBuild }
// Returns: Buffer (raw .twinpack binary)
```

Dependencies: global `fetch` only. No `node:fs`.

### lib/twinpack-parser.mjs

```js
export function parseTwinpack(buffer)
// Takes Buffer or Uint8Array. Validates magic 0xEA0BA51C.
// Returns: TwinpackEntry (the root)
//
// TwinpackEntry = {
//   kind: 'file' | 'directory',
//   name: string,
//   mark2: number,             // 0x03=Sources, 0x07=Packages, etc.
//   content?: Buffer,          // file content (only for kind='file')
//   children?: TwinpackEntry[] // child entries (only for kind='directory')
// }
```

Dependencies: none (pure computation on bytes). Uses DataView for little-endian
reads. Maintains a position cursor like `parse_tree.ps1`'s `$script:pos`.

### lib/sync.mjs

```js
export async function syncPackages(packagesDir, { concurrency = 4 } = {})
// 1. Queries TWINSERV for all public packages (latest version of each)
// 2. Loads manifest.json from packagesDir
// 3. Compares: download new/updated, delete removed, skip unchanged
// 4. For downloads: fetch .twinpack, parse, extract Sources/ tree to disk
//    (skip Packages/ subtree -- mark2=0x07 -- to avoid transitive deps)
// 5. Writes updated manifest.json
// Returns: { added: string[], updated: string[], removed: string[], unchanged: string[] }
```

**Manifest shape** (persisted as `manifest.json`):

```json
{
  "syncedAt": "2026-06-02T12:00:00Z",
  "packages": {
    "{697A5CBF-...}": {
      "symbol": "CustomControlsPackage",
      "publisher": "WaynePhillipsEA",
      "version": "0.0.3.0",
      "publishedDate": "24-JAN-2022",
      "publishedTime": "09:30:44"
    }
  }
}
```

Version comparison uses the dot-joined string `"major.minor.revision.build"`.
Keyed by projectId GUID so renames of the symbol don't cause spurious
re-downloads.

### lib/vb6-preprocess.mjs

```js
export function preprocessVB6(fileContent, extension)
// Strips VB6 headers and wraps body in a synthetic container.
// Returns: { content: string, lineOffset: number }
//
// extension → container mapping:
//   .bas → Module
//   .cls → Class
//   .frm → Class (form)
//   .dsr → Class (designer)
//   .ctl → Class (user control)
//
// lineOffset = number of original lines consumed before the body starts,
// so the caller can fix up line numbers to refer to the original file.
```

**Preprocessing steps:**

1. Extract `Attribute VB_Name = "name"` → use as container name.
2. Strip format-specific headers:
   - `.cls`: Remove `VERSION 1.0 CLASS` + `BEGIN...END` block + `Attribute VB_*` lines.
   - `.frm`: Remove `VERSION 5.00` + `Begin VB.Form...End` block + `Attribute VB_*` lines.
   - `.ctl`: Remove `VERSION 5.00` + `Begin VB.UserControl...End` block + `Attribute VB_*` lines.
   - `.dsr`: Remove `VERSION 5.00` + `Begin...End` block + `Attribute VB_*` lines.
   - `.bas`: Remove `Attribute VB_*` lines only (no block header).
3. Strip per-member `Attribute member.VB_Description = "text"` lines.
   (Future: convert these to `[Description("text")]` annotations.)
4. Wrap remaining body:
   ```
   <ContainerKind> <VB_Name>
   <body>
   End <ContainerKind>
   ```
5. Return wrapped content + lineOffset.

### lib/lexer.mjs

Extracted from `twin-index.mjs` lines 25-137.

```js
export function lex(fileContent)
// Returns: { line, text, rawText }[]

export function scanAttributes(rawText)
// Returns: { attrs: string[], description: string|null }

export function isAttributeOnlyLine(text)
// Returns: boolean
```

### lib/extractor.mjs

Extracted from `twin-index.mjs` lines 144-411.

```js
import { scanAttributes, isAttributeOnlyLine } from './lexer.mjs';

export function extract(logicalLines)
// Returns: { declarations: DeclNode[], collectEnums: Function, allEnums: [] }
```

### lib/emitter.mjs

Extracted from `twin-index.mjs` lines 416-521.

```js
export function emitMarkdown(packageName, fileResults)
// fileResults = [{ relativePath, declarations, enums }]
// Returns: string (markdown)

export function formatSignature(node)
export function emitNode(node, depth, lines)
```

### twin-index.mjs (refactored CLI)

```
node indexer/twin-index.mjs                           # sync + index (default)
node indexer/twin-index.mjs --no-sync [<packages-root>]  # index only (legacy mode)
node indexer/twin-index.mjs --sync-only               # sync only, no indexing
node indexer/twin-index.mjs --out <dir>                # custom output directory
```

Defaults:
- Packages source: `./package-indexes/packages` (synced cache)
- Output: `./package-indexes/`
- `--no-sync` + positional arg: uses the given directory (backward compat)

**Indexing loop changes:**

1. `globTwin()` → `globSources()`: matches `*.twin`, `*.bas`, `*.cls`, `*.frm`,
   `*.dsr`, `*.ctl`. Excludes files under any `Packages/` subdirectory.
2. Non-`.twin` files go through `preprocessVB6()` before `lex()`.
3. Line numbers adjusted by `lineOffset` from the preprocessor.

## Implementation Phases

### Phase 1: Extract existing code into lib/ modules

Move `lex`, `scanAttributes`, `isAttributeOnlyLine` → `lib/lexer.mjs`.
Move `extract` → `lib/extractor.mjs` (imports from lexer).
Move `emitMarkdown`, `formatSignature`, `emitNode` → `lib/emitter.mjs`.
Refactor `twin-index.mjs` to import from lib/.

**Verification:** Run against existing `../tb-export/AllPackages/Packages`.
Diff output against current `package-indexes/*.md` — must be byte-identical.

### Phase 2: Twinpack binary parser

Create `lib/twinpack-parser.mjs`. Port logic from `parse_tree.ps1` (34 lines of
PowerShell → similar-sized JS with DataView helpers).

**Verification:** Parse `indexer/sample.twinpack`. Verify root name is
`CustomControlsPackage`, Sources/ contains `WaynesGrid.twin`, content is valid
UTF-8 twinBASIC source.

### Phase 3: TWINSERV client

Create `lib/twinserv-client.mjs`. Two functions wrapping `fetch()`.

**Verification:** Call `queryPackages()`, verify response has `public` array
with ~32 entries. Call `downloadPackage()` for CustomControlsPackage, verify
first 4 bytes are the magic number.

### Phase 4: Sync orchestrator

Create `lib/sync.mjs`. Implements manifest-based diffing + extraction.

**Verification:** Run sync with fresh cache dir. All ~32 packages downloaded.
Run again immediately — zero downloads (all cached). Delete one package dir,
run again — only that one re-downloaded.

### Phase 5: VB6 preprocessor

Create `lib/vb6-preprocess.mjs`. Pure string transformation.

**Verification:** Test with hand-crafted `.bas` and `.cls` samples. Verify
output parses correctly through lex → extract and produces the expected
Module/Class container structure.

### Phase 6: Integration

Wire everything into `twin-index.mjs`:
- Add `--sync-only`, `--no-sync` flags
- Replace `globTwin` with `globSources` (multi-extension, excludes Packages/)
- Add VB6 preprocessing branch in the file-processing loop
- Default mode: sync then index

**Verification:** Run `node indexer/twin-index.mjs` end-to-end. Should sync
from TWINSERV, extract all packages, index `.twin` + VB6 files, and produce
markdown in `package-indexes/`. Spot-check a few packages against expected
structure.
