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
  manifest.json                # Version tracking (which packages are indexed)
  Assert.md                    # Generated markdown indexes
  CustomControlsPackage.md
  ...
  packages/                    # Only with --save-packages (gitignored)
    Assert/
      Sources/
        Exact.twin
        Permissive.twin
        Strict.twin
    CustomControlsPackage/
      Sources/
        WaynesGrid.twin
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

Binary format reference: [`docs/Features/Packages/TWINPACK file format.md`](../docs/Features/Packages/TWINPACK%20file%20format.md).

```js
export function parseTwinpack(buffer)
// Takes Buffer or Uint8Array. Validates magic 0xEA0BA51C and format version.
// Returns: TwinpackEntry (the root)
//
// TwinpackEntry = {
//   kind: 'file' | 'directory',
//   name: string,
//   revision: number,          // uint64 revision counter (low 16 bits vary in practice)
//   flags: number,             // uint32 bitmask: 0x01=Hidden, 0x02=SuperHidden, 0x04=Virtual
//   category: number,          // 0x03=Sources, 0x07=Packages, etc. — see CATEGORY constants
//   content?: Buffer,          // file content (only for kind='file')
//   children?: TwinpackEntry[] // child entries (only for kind='directory')
// }
```

Dependencies: none (pure computation on bytes). Uses DataView for little-endian
reads. Maintains a position cursor like `parse_tree.ps1`'s `$script:pos`.

### lib/sync.mjs

```js
export async function compareWithManifest(manifestPath)
// 1. Loads manifest from manifestPath (missing/empty → all packages new).
// 2. Queries TWINSERV for all public packages (latest version of each).
// 3. Compares versions; categorises each as added/updated/unchanged/removed.
// Returns: { toDownload, unchanged, removed, manifest }
// toDownload entries carry { id, pkg, version, symbol, reason }.

export async function fetchPackage(projectId, version)
// Downloads a single .twinpack, parses it, returns collectFiles() result.
// Throws on network or parse error (caller handles).

export function versionString(v)
// Returns "major.minor.revision.build" string from a VersionInfo object.
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
node indexer/twin-index.mjs --out <dir>                # custom output directory
node indexer/twin-index.mjs --save-packages            # also write sources to <out>/packages/
```

Defaults:
- Output: `./package-indexes/`
- `--save-packages`: writes extracted source files to `<out>/packages/<symbol>/`

**Indexing loop:**

1. Source files are filtered by extension (`.twin`, `.bas`, `.cls`, `.frm`,
   `.dsr`, `.ctl`). Files under `Packages/` subtrees are excluded by the
   twinpack parser (`collectFiles` skips category=0x07 (Packages)).
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
PowerShell → similar-sized JS with DataView helpers). Binary format is
documented in
[`docs/Features/Packages/TWINPACK file format.md`](../docs/Features/Packages/TWINPACK%20file%20format.md).

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

### Phase 7: Direct package-to-parser pipeline

Phases 1–6 round-trip through the filesystem: `extractTree` writes parsed
twinpack content to disk, then `globSources` + `readFile` reads it back.
Phase 7 eliminates this — the twinpack parser feeds results directly to the
language parser in memory. The manifest file is retained as the sole record
of which package versions are currently indexed, enabling incremental
updates without scanning `.md` output files.

**Manifest rules:**

- Missing or empty manifest → treat every package as new (download all).
- Manifest entry exists with matching version string → skip (unchanged).
- Manifest entry missing for a remote package, or version mismatch →
  download, parse, and re-index.
- Manifest entry has no corresponding remote package → package was removed
  from TWINSERV; delete its `.md` and drop the entry.
- Failed download/parse → retain old manifest entry (if any) so the next
  run retries.

The manifest moves from `packages/manifest.json` to the output directory
(default `./package-indexes/manifest.json`) since the `packages/` extraction
tree is no longer used in default mode.

**`lib/twinpack-parser.mjs`** — add `collectFiles(rootEntry)`:

```js
collectFiles(rootEntry)
// Walks TwinpackEntry tree. Skips category=0x07 (Packages) subtrees.
// Returns: [{ relativePath: string, content: Buffer }]
// Paths are relative to root (e.g. "Sources/WaynesGrid.twin").
// Sorted by relativePath for deterministic output.
```

Iterates `rootEntry.children` (root name is the package name, not a path
component). Recursive helper accumulates `prefix + name + '/'` for
directories and `prefix + name` for files. Sort the result to match
`globSources` order: group by directory (`path.dirname`), then by filename
(`path.basename`) within each group, both via `localeCompare`.

**`lib/sync.mjs`** — replace `syncPackages` with `fetchUpdatedSources`:

```js
fetchUpdatedSources(manifestPath, { concurrency = 4 })
// 1. Queries TWINSERV for all public packages (latest version of each).
// 2. Loads manifest from manifestPath (missing/empty file → all packages new).
// 3. Compares: manifest entry with matching version → unchanged;
//    missing entry or version mismatch → download + parse in memory.
// 4. For downloads: downloadPackage → parseTwinpack → collectFiles.
// 5. Detects removed: manifest entries whose projectId is not on TWINSERV.
// Returns: {
//   toIndex:    [{ symbol, projectId, reason: 'added'|'updated',
//                  versionInfo, files: [{ relativePath, content }] }],
//   unchanged:  [string],            // symbols skipped (already indexed)
//   removed:    [{ id, symbol }],    // in manifest but gone from TWINSERV
//   failed:     [{ symbol, error }], // download/parse errors
//   manifest:   object               // updated manifest, ready to persist
// }
```

The returned `manifest` carries forward unchanged entries, adds/replaces
entries for successfully fetched packages, omits removed packages, and
preserves old entries for failed packages (so they retry next run). The
caller writes the manifest to disk after indexing succeeds.

Remove `extractTree`, `dirExists`, and `rm`/`mkdir`/`access` imports.
Keep `latestVersion`, `versionString`. Adjust `loadManifest` to take a
file path instead of a directory. Retain `readFile` from `node:fs/promises`
for manifest loading.

**`twin-index.mjs`** — restructure into two code paths:

Default mode (in-memory):
1. Call `fetchUpdatedSources(manifestPath)`.
2. For each package in `toIndex`: filter files by `SOURCE_EXTS`, strip
   `Sources/` prefix, convert `Buffer` → string, run through `indexFiles`
   helper (VB6 preprocess → lex → extract → collectEnums).
3. `emitMarkdown` → write `.md` to output dir.
4. For each entry in `removed`: delete `<symbol>.md` from output dir.
5. Write updated manifest to `manifestPath`.
6. Log summary: added, updated, removed, unchanged, failed counts.

Extract `countDecls` to module level (currently inline at line 126). Add
shared `indexFiles(files)` helper:

```js
indexFiles(files)
// files: [{ relativePath: string, content: string }]
// For each file: check VB6_EXTS on path.extname(relativePath);
//   if VB6, preprocessVB6(content, ext) first.
//   Then lex(content) → extract(logicalLines) → collectEnums(declarations, relativePath).
// Returns: {
//   fileResults: [{ relativePath, declarations, enums: allEnums }],
//   declCount: number   // total across all files (via countDecls)
// }
```

**Verification:** Parse `indexer/sample.twinpack` with `collectFiles`, verify
it returns `Sources/WaynesGrid.twin` and no Packages/ entries. Run the full
pipeline with `node indexer/twin-index.mjs --out ./test-output/` and diff
output against the phase-6 baseline — must be byte-identical. Run a second
time with no TWINSERV changes — zero downloads, unchanged count matches
package count, manifest and `.md` files unmodified.

### Phase 8: Phased progress output, replace legacy mode with --save-packages

Phase 7's `fetchUpdatedSources` did everything in one call — the user saw
nothing until the entire sync + download + parse cycle finished. Phase 8
splits the work into three visually distinct CLI phases so each step logs
as it happens. It also removes the `--no-sync` legacy disk-reading mode
and replaces it with `--save-packages`, which writes fetched source files
to `<out>/packages/` as a side effect of the normal in-memory pipeline.

**`lib/sync.mjs`** — replace `fetchUpdatedSources` with two functions:

```js
compareWithManifest(manifestPath)
// 1. Loads manifest.
// 2. Queries TWINSERV for all public packages.
// 3. Compares versions; categorises each as added/updated/unchanged/removed.
// Returns: { toDownload, unchanged, removed, manifest }
// toDownload entries carry { id, pkg, version, symbol, reason }.

fetchPackage(projectId, version)
// Downloads a single .twinpack, parses it, returns collectFiles() result.
// Throws on network or parse error (caller handles).
```

Export `versionString` so the CLI can build manifest entries.

**`twin-index.mjs`** — three logged phases:

1. **Fetching package index** — call `compareWithManifest`. Print the
   add/update/remove/unchanged summary. Early-exit with "Up to date." if
   nothing changed.
2. **Fetching packages** — iterate `toDownload` sequentially. Log each
   symbol as it completes. On error, log the failure and continue. Build
   manifest entries for successful fetches.
3. **Indexing packages** — iterate fetched packages, run through
   `indexFiles` → `emitMarkdown` → write `.md`. Log per-package file and
   declaration counts. If `--save-packages`, also write each package's
   files to `<out>/packages/<symbol>/`. Handle removals (delete `.md` and,
   if `--save-packages`, the package directory). Write manifest.

Remove `--no-sync`, `legacyDiskMode`, `packagesRoot`, and `globSources`.

**Verification:** Fresh run (no manifest) prints all three phases with
32 packages listed under each. Second run prints only "Fetching package
index..." + "Up to date." with zero downloads. `--save-packages` writes
source trees under `<out>/packages/`.

### Phase 9: Index built-in packages from twinBASIC GitHub releases

twinBASIC ships built-in packages inside every release — VBA, VBRUN,
WinForms, CustomControls, and others. These are `.twinproj` files in
the `packages/` directory of the release zip, using the same binary
format as `.twinpack` files (magic `0xEA0BA51C`, format version 1).
Phase 9 adds a parallel pipeline that checks GitHub for new twinBASIC
releases, downloads the release zip when the version changes, extracts
built-in packages, and indexes them through the same lex → extract →
emit chain as TWINSERV packages.

**Key decisions:**

- Index all built-in packages (16 as of BETA 983), including the
  dot-prefixed core runtime packages (`.{GUID}_VBA`, `.{GUID}_VBRUN`).
- Output to a separate directory (default `./builtin-indexes/`), not
  mixed with TWINSERV package indexes.
- Track the full GitHub release tag (e.g. `beta-x-0983`) in the
  built-in manifest. When the tag changes, re-download and re-index all
  built-in packages.
- Overlapping packages (ones that exist both as built-in and on
  TWINSERV) are indexed independently — both versions get their own
  `.md` files in their respective output directories.

**Release structure** (observed in BETA 983):

```
twinBASIC_IDE_BETA_983.zip
  └─ packages/
       ├─ .{54F90FBF-...}_VBA/package.twinproj
       ├─ .{8BEB50D8-...}_VBRUN/package.twinproj
       ├─ {F50B82D0-...}_VB/package.twinproj
       ├─ {EA18E2B1-...}_CustomControls/package.twinproj
       └─ ... (16 total)
```

Each folder name follows the pattern `[.]{GUID}_SymbolName`. The dot
prefix on VBA and VBRUN indicates core runtime packages but does not
change processing. Each folder contains exactly one `package.twinproj`.

**`lib/zip-reader.mjs`** (new) — Minimal zip central-directory parser,
zero external dependencies:

```js
readZipDirectory(buffer)
// Parses ONLY the zip central directory — file metadata, not contents.
// No file data is read or decompressed at this stage.
// 1. Locate the End of Central Directory record (scan backward for
//    signature 0x06054b50).
// 2. Read the central directory: for each entry, extract the file name,
//    compressed size, uncompressed size, compression method, and the
//    offset to the local file header.
// 3. Return a Map<string, ZipEntry> keyed by file path.
//
// Returns: Map<string, { name, compressedSize, uncompressedSize,
//            compressionMethod, localHeaderOffset }>

extractFile(buffer, entry)
// Extract a single file from the zip buffer given a ZipEntry.
// Called selectively — only for the specific entries the caller needs.
// 1. Seek to localHeaderOffset, read the local file header to get the
//    actual data offset (header is 30 bytes + variable-length fields).
// 2. Read the compressed data.
// 3. If compression method 8 (Deflate), inflate with zlib.inflateRawSync.
//    If method 0 (Stored), return as-is.
// Returns: Buffer
```

Only methods 0 (Stored) and 8 (Deflate) are supported — these cover
all zip files produced by standard tools. The module uses `node:zlib`
for decompression. The two-step design (directory scan, then selective
extract) means we never decompress the IDE binaries, addins, or
anything else in the ~28 MB zip — only the `.twinproj` files we need.

**`lib/github-release.mjs`** (new) — GitHub release fetching:

```js
getLatestRelease()
// GET https://api.github.com/repos/twinbasic/twinbasic/releases
// (all releases are pre-releases, so /releases/latest returns 404).
// Returns the first entry: { tag, assetUrl, publishedAt }.
// Throws on network error or unexpected response shape.
//
// Returns: { tag: 'beta-x-0983',
//            assetUrl: 'https://github.com/.../twinBASIC_IDE_BETA_983.zip',
//            publishedAt: '2026-05-29T...' }

downloadRelease(assetUrl)
// Downloads the release zip. Follows redirects (GitHub assets redirect
// to a CDN). Returns the full zip as a Buffer.
// Throws on network error or non-2xx status.
//
// Returns: Buffer
```

Uses `fetch()` — the GitHub API is public, no auth required for
read-only access to public releases. Unauthenticated requests are
rate-limited to 60/hour, which is fine since we make at most one
request per run.

**`lib/builtin-sync.mjs`** (new) — Built-in package sync logic:

```js
compareBuiltinManifest(manifestPath)
// 1. Load manifest (same shape: { syncedAt, twinbasicTag, packages: {} }).
// 2. Call getLatestRelease() to get the current tag.
// 3. If manifest.twinbasicTag matches the current tag, return early:
//    all packages are unchanged.
// 4. Otherwise, return { tag, assetUrl, publishedAt } so the caller
//    can download.
//
// Returns: { tag, assetUrl, publishedAt, manifest,
//            needsUpdate: boolean }

extractBuiltinPackages(zipBuffer)
// 1. readZipDirectory(zipBuffer) to scan the central directory.
//    This reads only file metadata — no contents are decompressed.
// 2. Filter the directory for entries matching
//    packages/<folder>/package.twinproj. Everything else in the zip
//    (IDE binaries, addins, themes, etc.) is ignored entirely.
// 3. For each matching entry only:
//    a. extractFile() to decompress the .twinproj Buffer.
//    b. parseTwinpack() + collectFiles() (existing pipeline).
//    c. Parse the folder name to extract GUID and symbol.
// 4. Return an array of { guid, symbol, files } — same shape as
//    TWINSERV fetchPackage results, ready for indexFiles().
//
// folder name pattern: /^\.?\{([0-9A-F-]+)\}_(.+)$/i
//
// Returns: [{ guid: '54F90FBF-...', symbol: 'VBA',
//             files: [{ relativePath, content }] }, ...]
```

**`twin-index.mjs`** — Extend with built-in package pipeline:

New CLI option:

```
--builtin-out <dir>   Output directory for built-in packages
                      (default: ./builtin-indexes/)
```

After the TWINSERV sync completes, run the built-in pipeline using the
same three-phase structure:

1. **Checking twinBASIC release** — call `compareBuiltinManifest`.
   Print the current release tag. If `needsUpdate` is false, print
   "Built-in packages up to date (beta-x-XXXX)." and skip.

2. **Downloading release** — call `downloadRelease(assetUrl)`, then
   `extractBuiltinPackages(zipBuffer)`. Print the count of extracted
   packages.

3. **Indexing built-in packages** — iterate extracted packages through
   `indexFiles` → `emitMarkdown` → write `.md` to `builtinOutDir`.
   Log per-package file and declaration counts. If `savePackages`,
   write source files to `<builtinOutDir>/packages/<symbol>/`. Write
   the built-in manifest with the new tag:
   ```json
   {
     "syncedAt": "...",
     "twinbasicTag": "beta-x-0983",
     "publishedAt": "2026-05-29T...",
     "packages": {
       "54F90FBF-5CDC-41D6-AEC2-983DEF203B07": { "symbol": "VBA" },
       "F50B82D0-DCAB-43FE-9631-11959D4A4728": { "symbol": "VB" },
       ...
     }
   }
   ```

The `--dont-save-packages` flag applies to built-in packages too.

**Missing-folder check for built-ins:** When `savePackages` is true,
after `compareBuiltinManifest` returns `needsUpdate: false` (tag
matches), scan `<builtinOutDir>/packages/` and check that a folder
exists for every package listed in the manifest. If any folder is
missing, override `needsUpdate` to `true` — this forces a full
re-download of the release zip because all built-in packages come from
a single zip (unlike TWINSERV packages, which can be fetched
individually). This matches the behaviour already implemented for
TWINSERV packages in `twin-index.mjs`, where unchanged packages with
missing source folders are promoted to `toDownload`.

**Verification:**

1. Fresh run (no built-in manifest): prints "Checking twinBASIC
   release..." with tag, downloads the release, extracts and indexes
   all 16 built-in packages, writes `.md` files and manifest to
   `./builtin-indexes/`.
2. Second run (same tag): prints "Built-in packages up to date
   (beta-x-0983)." with no download.
3. Delete one package's folder under `builtin-indexes/packages/`,
   run again with `savePackages` on: the missing-folder check detects
   the gap and forces a full re-download despite the tag being
   unchanged. All built-in packages are re-extracted and re-indexed.
4. Verify `.md` output for a known package (e.g. VBA) contains
   expected declarations.
5. `--dont-save-packages`: no `packages/` subdirectory written under
   `builtin-indexes/`, and the missing-folder check is skipped.
6. `--builtin-out ./my-builtins/`: output lands in the specified
   directory.
