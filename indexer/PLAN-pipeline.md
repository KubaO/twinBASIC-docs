# Plan: Documentation Maintenance Pipeline

## Context

This repo (`twinBASIC-documentation`) houses the reference
documentation for twinBASIC, a modern BASIC compiler. The site is at
`docs.twinbasic.com`, built with a custom static site generator
(`builder/tbdocs.mjs`) from markdown pages in `docs/`.

The existing indexer (`indexer/twin-index.mjs`) downloads twinBASIC
packages from two sources — TWINSERV (community package registry) and
GitHub Releases (built-in packages bundled with the IDE) — extracts
their source code, parses declarations, and generates markdown index
files. See `indexer/PLAN-auto-sync.md` for the current module layout,
interfaces, and implementation history. This plan supersedes the
directory structure and CLI interface described there; the module
internals (lexer, extractor, twinpack-parser, etc.) remain valid.

Documentation conventions (page format, frontmatter, cross-linking)
are in `WIP.md`. The `document-symbol` skill
(`.claude/commands/document-symbol.md`) describes the per-symbol
workflow.

## Overview

The indexer evolves from a download-and-index tool into a multi-stage
documentation maintenance pipeline. Each stage is an independent
operation the developer runs separately:

```
sync  →  analyze  →  draft  →  verify  →  human review
```

1. **sync** — download packages, extract sources, generate structured
   API snapshots, commit to local package store
2. **analyze** — diff API snapshots against the documented baseline,
   produce a change report
3. **draft** — Claude Workflow fans out agents to write/update doc pages
4. **verify** — build the site, check links, validate formatting
5. **human review** — developer reviews, commits, PRs

Every stage accepts `--package <name>` (or `--packages <a>,<b>`) to
limit scope to specific packages.

## Directory Structure

### Indexer (under `indexer/`)

```
indexer/
  twin-index.mjs                 # CLI: sync | analyze subcommands
  lib/
    sync.mjs                     # TWINSERV sync (refactored)
    builtin-sync.mjs             # GitHub release sync (refactored)
    twinserv-client.mjs           # TWINSERV HTTP client
    github-release.mjs            # GitHub Releases client
    twinpack-parser.mjs           # .twinpack/.twinproj binary parser
    zip-reader.mjs                # Minimal ZIP reader
    vb6-preprocess.mjs            # VB6 → tB normalization
    lexer.mjs                     # Tokenizer + attribute scanner
    extractor.mjs                 # Declaration tree builder
    emitter.mjs                   # Markdown emitter (existing)
    json-emitter.mjs              # api.json emitter (new)
    differ.mjs                    # api.json differ (new)
    store.mjs                     # .packages/ git repo management (new)
  manifests/
    built-in.json                 # committed; tracks synced release tag
    contributed.json              # committed; tracks synced TWINSERV versions
  snapshots/                      # committed; latest api.json per package
    default/
      VBA/api.json
      VBRUN/api.json
      VB/api.json
    built-in/
      WebView2/api.json
      CustomControls/api.json
      ...
    contributed/
      ArrayListLib/api.json
      ...
  .packages/                      # .gitignored; local git repo
    default/
      VBA/
        sources/*.twin
        api.json
    built-in/
      WebView2/
        sources/*.twin
        api.json
    contributed/
      ArrayListLib/
        sources/*.twin
        api.json
```

**Moved from repo root:**
- `builtin-indexes/manifest.json` → `indexer/manifests/built-in.json`
- `package-indexes/manifest.json` → `indexer/manifests/contributed.json`
- `builtin-indexes/` and `package-indexes/` directories removed after migration

### Documentation (under `docs/Reference/`)

```
docs/Reference/
  Core/                           # 92 language keyword pages (unchanged)
  Default/                        # VB, VBA, VBRUN (always loaded)
    VBA/
      index.md                    # indexed_from: beta-x-0983
      DateTime/
        Now.md
      ...
    VBRUN/
      index.md
      ...
    VB/
      index.md
      ...
  Built-In/                       # 9 opt-in bundled packages
    WebView2/
      index.md                    # indexed_from: beta-x-0983
      ...
    CustomControls/
      index.md
      ...
    Assert/
    CEF/
    WinEventLogLib/
    WinNamedPipesLib/
    WinServicesLib/
    tbIDE/
    WinNativeCommonCtls/
  Contributed/                    # TWINSERV community packages
    ArrayListLib/
      index.md                    # indexed_from: 1.3.0
      ...
```

**Landing pages** (virtual index pages):
- `docs/Reference/Default.md` — parent for VB, VBA, VBRUN
- `docs/Reference/Built-In.md` — parent for the other 9
- `docs/Reference/Contributed.md` — parent for TWINSERV packages

Existing permalinks are preserved via the `permalink:` frontmatter
field. Navigation hierarchy is updated via `parent:` / `grand_parent:`.

## Package Group Classification

Every package belongs to exactly one group. The group determines its
docs directory, snapshot directory, and store directory.

| Group | Source | Docs path | Packages |
|---|---|---|---|
| default | GitHub Release | `Reference/Default/` | VB, VBA, VBRUN |
| built-in | GitHub Release | `Reference/Built-In/` | Assert, CEF, CustomControls, WebView2, WinEventLogLib, WinNamedPipesLib, WinServicesLib, tbIDE, WinNativeCommonCtls |
| contributed | TWINSERV | `Reference/Contributed/` | everything from TWINSERV (32+ packages) |

**Default vs built-in**: all come from the same GitHub release zip, but
the three default packages (VB, VBA, VBRUN) are always loaded in every
twinBASIC project. The distinction is documentation-organizational, not
technical. Define the default list as a constant:

```js
const DEFAULT_PACKAGES = ['VBA', 'VBRUN', 'VB'];
```

Everything else from the release zip is "built-in." Everything from
TWINSERV is "contributed." New built-in packages may appear in future
releases; they default to the built-in group unless added to the
constant.

The group is used when:
- Choosing the store subdirectory (`indexer/.packages/{group}/{pkg}/`)
- Choosing the snapshots subdirectory (`indexer/snapshots/{group}/{pkg}/`)
- Locating existing doc pages (`docs/Reference/{Group}/{pkg}/`)
- Determining `indexed_from` format (beta tag vs version string)

## Version Tracking

### `indexed_from` frontmatter

Each package's `index.md` carries an `indexed_from` field recording what
version the documentation was last updated from:

```yaml
# Default/Built-In package
---
title: WebView2 Package
parent: Built-In Packages
indexed_from: beta-x-0983
---
```

```yaml
# Contributed package
---
title: ArrayListLib Package
parent: Contributed Packages
indexed_from: 1.3.0
---
```

- **Default + Built-In packages**: the twinBASIC release tag (e.g.,
  `beta-x-0983`)
- **Contributed packages**: the TWINSERV version string (e.g., `1.3.0`).
  TWINSERV's `/query` endpoint returns ALL published versions per
  package (not just the latest), so specific historical versions can be
  downloaded if needed.
- **Absent field**: means "pre-tracking" — the package has never been
  through the pipeline. The analyze stage treats this as a full audit.

Tracking is package-level only. Individual member pages do not carry
`indexed_from`.

### Committed snapshots (`indexer/snapshots/`)

The `api.json` files under `indexer/snapshots/` are committed to the
docs repo. They represent the latest synced state of each package and
survive cloning. Updated by the sync stage but not auto-committed — the
developer commits them (typically alongside documentation changes).

### Manifests (`indexer/manifests/`)

The manifest files track what the indexer last downloaded from TWINSERV
and GitHub. They are committed to the docs repo so the indexer knows
where it left off across machines.

## Package Store (`indexer/.packages/`)

A `.gitignored` directory that is its own local git repo. Contains
extracted source files and `api.json` snapshots for every synced package.

### Automatic lifecycle management

The store module (`lib/store.mjs`) handles all git operations
transparently. No manual setup required.

**Initialization** (on first sync or fresh clone):

```
if .packages/ does not exist:
  mkdir .packages/
  git init .packages/
  configure: user.name="indexer", user.email="indexer@local"
  if indexer/snapshots/ has api.json files:
    copy snapshots/**/*.json → .packages/ (matching directory structure)
    git add -A
    git commit "baseline: seeded from docs repo snapshots"
```

**After sync:**

```
(sources and api.json written to .packages/)
git add -A
git commit "sync: WebView2 beta-x-0980→0983, ArrayListLib 1.2.0→1.3.0"
copy .packages/**/api.json → indexer/snapshots/ (for docs repo)
```

The structured commit message includes package names and version
transitions for easy `git log` review.

**Fresh clone recovery:**

1. Developer clones the docs repo — `indexer/snapshots/` is present,
   `indexer/.packages/` is absent.
2. Developer runs `sync` — store initializes from committed snapshots
   (first commit), then downloads current packages (second commit).
3. Ready to `analyze` immediately.

## api.json Schema

The structured API surface for each package. Includes all members
(public and private) with normalized signatures. Designed for clean,
stable diffs.

```json
{
  "package": "WebView2",
  "version": "beta-x-0983",
  "modules": [
    {
      "name": "WebView2",
      "kind": "Class",
      "file": "Classes/WebView2.twin",
      "access": "Public",
      "attributes": ["ClassId", "InterfaceId"],
      "implements": ["IWebView2"],
      "inherits": null,
      "members": [
        {
          "name": "Navigate",
          "kind": "Sub",
          "access": "Public",
          "signature": "Public Sub Navigate(url As String)",
          "attributes": [],
          "description": "Navigates to the specified URL."
        },
        {
          "name": "Source",
          "kind": "Property",
          "access": "Public",
          "signature": "Public Property Get Source() As String",
          "attributes": [],
          "description": "Returns the current URL."
        },
        {
          "name": "m_handle",
          "kind": "Field",
          "access": "Private",
          "signature": "Private m_handle As LongPtr",
          "attributes": [],
          "description": null
        }
      ],
      "events": [
        {
          "name": "NavigationCompleted",
          "signature": "Public Event NavigationCompleted(sender As WebView2, e As NavigationCompletedEventArgs)",
          "attributes": []
        }
      ]
    }
  ],
  "enums": [
    {
      "name": "wv2PermissionKind",
      "file": "Classes/WebView2.twin",
      "access": "Public",
      "members": [
        { "name": "wv2PermUnknown", "value": "0" },
        { "name": "wv2PermMicrophone", "value": "1" }
      ]
    }
  ],
  "types": [
    {
      "name": "NavigationCompletedEventArgs",
      "file": "Types/Events.twin",
      "access": "Public",
      "fields": [
        {
          "name": "IsSuccess",
          "signature": "Public IsSuccess As Boolean"
        }
      ]
    }
  ]
}
```

### Normalization rules (for stable diffs)

- Keyword casing: `Public Sub`, `Private Function`, `As String`
  (VB-canonical casing)
- Whitespace: single spaces, no trailing, normalized parameter lists
- Access modifiers: always explicit (`Public` even when it's the default)
- Default types: `As Variant` included when the source omits the type
- Sorted: top-level arrays (modules, enums, types) sorted by name;
  members sorted by name within each container
- No line numbers: they change with implementation edits that don't
  affect the API surface

Normalization is incremental — start with what the extractor already
captures, improve as edge cases surface. The JSON emitter applies
whatever normalization is in place.

## Stage 1: sync

```
node indexer/twin-index.mjs sync [--package <name>] [--packages <a>,<b>]
```

### What changes from the current indexer

| Current behavior | New behavior |
|---|---|
| Writes sources to `package-indexes/packages/` | Writes to `indexer/.packages/` |
| Generates markdown indexes (`.md`) | Generates `api.json`; markdown indexes no longer produced (`emitter.mjs` retained for optional/debug use) |
| Stores manifests in output directories | Stores in `indexer/manifests/` |
| No git integration | Auto-manages `.packages/` git repo |
| No snapshots | Copies api.json to `indexer/snapshots/` |
| `--dont-save-packages` flag | Sources always saved (they're the primary artifact) |
| `--out`, `--builtin-out` flags | Removed; paths derived from store/snapshots layout |

### `--package` filter behavior

For contributed packages, `--package ArrayListLib` downloads only that
one package from TWINSERV.

For default/built-in packages, all come from a single release zip.
`--package VBA` still downloads the entire zip (unavoidable) but only
processes and commits VBA. Other packages from the same zip are
discarded. If multiple built-in packages are specified, the zip is
downloaded once and the requested packages are extracted.

### Module changes

**`lib/json-emitter.mjs`** (new):

```js
export function emitApiJson(packageName, version, fileResults)
// Takes the same fileResults as emitMarkdown.
// Returns: string (deterministic JSON, sorted keys)
```

Produces api.json from the extractor's declaration tree. Applies
signature normalization. Output is deterministic: sorted keys, sorted
arrays, consistent formatting.

**`lib/store.mjs`** (new):

```js
export async function ensureStore(storePath, snapshotsPath)
// Initializes .packages/ git repo if absent.
// Seeds from snapshots if available.

export async function commitStore(storePath, message)
// git add -A && git commit in the store repo.
// No-ops if nothing changed (no empty commits).

export async function copyToSnapshots(storePath, snapshotsPath, groups)
// Copies api.json files from .packages/ to indexer/snapshots/.
// groups: array of {group, package} to copy (from the current sync).
// Only copies packages that were actually synced, not the entire store.
```

Git operations use `child_process.execFile('git', ...)` — no git
library dependency.

Note: `findCommitForVersion` is NOT needed. The analyze stage compares
the current `.packages/` api.json against the committed snapshot in
`indexer/snapshots/` — the snapshot IS the baseline. The `.packages/`
git history is useful for developer review (`git log`) but not queried
programmatically.

**`twin-index.mjs`** — new `sync` subcommand:

```
1. ensureStore()
2. compareWithManifest() / compareBuiltinManifest()
3. Download changed packages
4. For each: extract sources, run through lex → extract
5. Generate api.json via json-emitter
6. Write sources + api.json to .packages/
7. commitStore() with structured message
8. copyToSnapshots()
9. Write updated manifests
10. Print summary
```

## Stage 2: analyze

```
node indexer/twin-index.mjs analyze [--package <name>]
```

### Two modes

**Update mode** (package has `indexed_from` in frontmatter):

1. Read the current `api.json` from `indexer/.packages/{group}/<pkg>/`
2. Read the baseline `api.json` from the **last-committed** snapshot.
   Since sync updates the snapshot working tree, use
   `git show HEAD:indexer/snapshots/{group}/{pkg}/api.json` to get the
   committed version (the one that corresponds to the current docs).
   If `indexed_from` matches the baseline's `version` field, proceed.
   If they disagree (shouldn't happen in normal flow), warn and fall
   back to pre-tracking mode. If the snapshot doesn't exist at HEAD
   (new package, first sync), use pre-tracking mode.
3. Diff the two: added, modified, removed symbols

**Pre-tracking mode** (package has no `indexed_from`, or is brand new):

1. Read the current `api.json` from `indexer/.packages/{group}/<pkg>/`
2. Scan `docs/Reference/{Default,Built-In,Contributed}/<pkg>/` for
   existing doc pages
3. Cross-reference: which public symbols have pages, which don't, which
   pages have stale signatures

### Symbol → doc page mapping

The analyze stage needs to match API symbols to existing documentation
pages. Strategy:

1. Scan all `.md` files under the package's docs directory.
2. Read the `title:` frontmatter field from each page.
3. Build a map: `title → file path`.
4. Match each public symbol name against this map.

This handles renamed files and non-obvious paths. For container symbols
(classes, modules), also check for `index.md` inside a directory named
after the symbol.

### Module changes

**`lib/differ.mjs`** (new):

```js
export function diffApi(baseline, current)
// Takes two parsed api.json objects.
// Returns: {
//   added: Symbol[],       // in current but not baseline
//   modified: Symbol[],    // in both but signature/attributes changed
//   removed: Symbol[],     // in baseline but not current
//   unchanged: Symbol[]    // identical in both
// }
// Comparison is by (module.name, member.name, member.kind) tuple.
// Only public symbols generate tasks. Private symbols are included
// in api.json for context but filtered out of the change report.

export function auditCoverage(apiJson, docPages)
// Takes a parsed api.json and a list of existing doc page paths.
// Returns: {
//   documented: Symbol[],       // have pages
//   undocumented: Symbol[],     // missing pages
//   mismatched: MismatchInfo[]  // pages with wrong signatures
// }
```

### Change report output

```json
{
  "package": "WebView2",
  "group": "built-in",
  "mode": "update",
  "from": "beta-x-0980",
  "to": "beta-x-0983",
  "tasks": [
    {
      "action": "create",
      "module": "WebView2",
      "symbol": "NavigateWithOptions",
      "kind": "Sub",
      "signature": "Public Sub NavigateWithOptions(url As String, options As NavigateOptions)",
      "file": "Classes/WebView2.twin"
    },
    {
      "action": "update",
      "module": "WebView2",
      "symbol": "Navigate",
      "kind": "Sub",
      "reason": "signature_changed",
      "old_signature": "Public Sub Navigate(url As String)",
      "new_signature": "Public Sub Navigate(url As String, Optional headers As String = \"\")",
      "file": "Classes/WebView2.twin",
      "doc_page": "docs/Reference/Built-In/WebView2/Navigate.md"
    },
    {
      "action": "flag_removal",
      "module": "WebView2",
      "symbol": "OldMethod",
      "kind": "Sub",
      "doc_page": "docs/Reference/Built-In/WebView2/OldMethod.md"
    }
  ],
  "summary": {
    "total_public": 50,
    "documented": 47,
    "to_create": 2,
    "to_update": 1,
    "to_remove": 0,
    "flagged": 1
  }
}
```

The change report is printed to stdout as a human-readable summary.
The full JSON is written to `indexer/.packages/report.json` (not
committed to the store repo — transient working file). The draft
workflow reads this file as its input.

If `--package` is used, the report covers only that package. Without
it, the report covers all packages that have changes.

## Stage 3: draft (Claude Workflow)

`.claude/workflows/doc-draft.mjs` — a Claude Code workflow that reads
a change report and dispatches agents to write documentation.

### Workflow structure

```
Phase 1 — Triage
  Single agent reads the change report + existing doc structure.
  Validates tasks, resolves file paths, determines page templates.
  Output: enriched task list with concrete file paths and instructions.

Phase 2 — Draft (fan-out)
  pipeline(tasks, task => agent(draftPrompt(task)))
  Each agent receives:
    - The symbol's source code (from .packages/)
    - The existing doc page (if updating)
    - WIP.md conventions (cross-linking, formatting, templates)
    - 2-3 example pages of the same kind (Sub, Property, Class, Enum)
    - Package index.md for context
  Produces: markdown file content written to the correct path.

Phase 3 — Index updates
  Single agent updates parent index pages, cross-reference indexes
  (Statements.md, Procedures and Functions.md), and the package
  index.md (including indexed_from update).
```

### Agent prompt template (sketch)

```
You are documenting `{symbol}` from the `{package}` package.

ACTION: {create | update}
SYMBOL: {module}.{name} ({kind})
SIGNATURE: {signature}
SOURCE FILE: {path to source in .packages/}
{if update: EXISTING PAGE: {path to current .md}}
{if update: REASON: {signature_changed | ...}}

Write a documentation page following these conventions:
[... WIP.md excerpt: frontmatter format, definition-list style,
     cross-linking patterns, example format ...]

Example pages to imitate:
[... 2-3 similar pages included inline ...]

Output ONLY the complete markdown file content.
```

## Stage 4: verify

```
node builder/tbdocs.mjs --src docs --dest docs/_site
```

After drafting, the developer (or a workflow agent) builds the site to
catch:
- Broken cross-reference links
- Invalid frontmatter (missing parent, bad permalink)
- Formatting issues

This stage uses the existing builder and does not require new code.

## Package Adoption Flow

When a package enters the pipeline for the first time (whether it has
existing docs or not), there is a one-time "adoption" process.

### Adopting a built-in package with existing docs

Example: VBA (has extensive docs, written before the pipeline existed).

1. `sync` — populates `.packages/default/VBA/`
2. `analyze --package VBA` — sees no `indexed_from` → full audit mode.
   Compares api.json against pages in `docs/Reference/Default/VBA/`.
   Reports: documented, undocumented, mismatched.
3. `draft --package VBA` — agents fill gaps, fix mismatches.
4. Developer reviews, adds `indexed_from: beta-x-0983` to index.md.
5. If a `WIP-VBA.md` exists: extract user-relevant architectural
   notes into the package's index.md, then delete the WIP file.

### Adopting a new contributed package

Example: ArrayListLib (no existing docs).

1. `sync --package ArrayListLib` — downloads, extracts, generates api.json.
2. `analyze --package ArrayListLib` — no docs at all → full scaffold
   report listing every module, class, enum, member.
3. `draft --package ArrayListLib` — agents scaffold the entire package:
   - `Contributed/ArrayListLib/index.md` with overview + `indexed_from`
   - Per-module/class pages with members
   - Enum detail pages
4. Developer reviews, commits.

### Subsequent updates

Example: ArrayListLib 1.3.0 → 1.4.0.

1. `sync` — downloads new version, commits to `.packages/`, copies
   api.json to `snapshots/`.
2. `analyze --package ArrayListLib` — diffs api.json (1.3.0 baseline
   from committed snapshot vs 1.4.0 current in `.packages/`). Reports:
   2 added, 1 modified.
3. `draft --package ArrayListLib` — agents update only affected pages,
   update `indexed_from: 1.4.0`.
4. Developer reviews, commits (doc changes + updated snapshot +
   updated `indexed_from`).

## WIP-<package>.md Orientation Files

These files contain architectural context about each package (threading
models, composition patterns, framework splits, etc.). They are used
**once** during package adoption:

- The draft workflow reads the orientation file (if present) when
  creating the initial package documentation.
- User-relevant architectural documentation is incorporated into the
  package's `index.md` overview section.
- Process-specific notes (file lists, download instructions, etc.) are
  discarded.
- After adoption, the `WIP-<package>.md` file is deleted.

Packages without orientation files are adopted without this step — the
agents read the source code directly.

## Migration Steps

### Phase A: Restructure indexer directory

1. Create `indexer/manifests/` directory.
2. Move `builtin-indexes/manifest.json` → `indexer/manifests/built-in.json`.
3. Move `package-indexes/manifest.json` → `indexer/manifests/contributed.json`.
4. Remove old `builtin-indexes/` and `package-indexes/` directories
   (including their `*.md` index files and `packages/` subdirectories).
5. Add `indexer/.packages/` to `.gitignore`.
6. Create `indexer/snapshots/{default,built-in,contributed}/` directory
   structure (initially empty; populated by first sync).
7. Update manifest-loading paths in `sync.mjs` and `builtin-sync.mjs`.
   Manifest format stays the same — only the file paths change.

**Verification:** `node indexer/twin-index.mjs` (old CLI, not yet
refactored) still runs using the moved manifests. No data loss.

### Phase B: JSON emitter + store management

8. Implement `lib/json-emitter.mjs` — api.json emitter with signature
   normalization.
9. Implement `lib/store.mjs` — .packages/ git repo lifecycle management
   (init, seed from snapshots, commit, copy to snapshots).
10. Refactor `twin-index.mjs` into `sync` subcommand that writes to
    `.packages/` and `snapshots/`. Old CLI flags (`--out`,
    `--builtin-out`, `--dont-save-packages`) are removed.

**Verification:** Run `node indexer/twin-index.mjs sync`. Confirm:
- `indexer/.packages/` is created as a git repo with one or two
  commits (seed + sync).
- `indexer/snapshots/` contains api.json files for all packages.
- `indexer/manifests/` is updated.
- Run again immediately — no new commit (nothing changed).

### Phase C: Analyze stage

11. Implement `lib/differ.mjs` — api.json diffing + coverage auditing.
12. Add `analyze` subcommand to `twin-index.mjs`.
13. Test end-to-end: sync → analyze for one package.

**Verification:** Run `analyze --package Assert` (small package, has
existing docs). Confirm the change report correctly identifies
documented vs undocumented symbols. Manually verify against the actual
doc pages in `docs/Reference/Assert/` (after Phase D moves them to
`docs/Reference/Built-In/Assert/`).

### Phase D: Documentation reorganization

Phase D is independent of Phases A–C and can be done in parallel.

14. Create landing pages: `Default.md`, `Built-In.md`, `Contributed.md`
    under `docs/Reference/`.
15. Move doc directories:
    - `Reference/VB/` → `Reference/Default/VB/`
    - `Reference/VBA/` → `Reference/Default/VBA/`
    - `Reference/VBRUN/` → `Reference/Default/VBRUN/`
    - `Reference/Assert/` → `Reference/Built-In/Assert/`
    - `Reference/CEF/` → `Reference/Built-In/CEF/`
    - `Reference/CustomControls/` → `Reference/Built-In/CustomControls/`
    - `Reference/WebView2/` → `Reference/Built-In/WebView2/`
    - `Reference/WinEventLogLib/` → `Reference/Built-In/WinEventLogLib/`
    - `Reference/WinNamedPipesLib/` → `Reference/Built-In/WinNamedPipesLib/`
    - `Reference/WinServicesLib/` → `Reference/Built-In/WinServicesLib/`
    - `Reference/tbIDE/` → `Reference/Built-In/tbIDE/`
    - `Reference/WinNativeCommonCtls/` → `Reference/Built-In/WinNativeCommonCtls/`
    - `Reference/Contributed/` created empty (populated by the pipeline).
16. Update frontmatter in all moved pages:
    - Package index.md: change `parent: Packages` to
      `parent: Default Packages` / `parent: Built-In Packages` /
      `parent: Contributed Packages` as appropriate.
    - Child pages using `grand_parent: Packages`: update to new parent.
    - Preserve ALL `permalink` values — no URL changes.
    - Preserve ALL `redirect_from` values.
17. Update `Packages.md` to reference the three new landing pages.
18. Build site with `node builder/tbdocs.mjs`, verify no broken links
    or missing pages. Compare output page count before and after — must
    be identical (no pages lost in the move).

### Phase E: Draft workflow

19. Write `.claude/workflows/doc-draft.mjs`.
20. Test with one small package (e.g., Assert) end-to-end.

### Phase F: Roll out

21. Adopt remaining built-in packages one at a time.
22. Begin contributed package documentation.

## Parser Improvements (incremental)

The current extractor captures declarations but signatures are not
fully normalized. Improvements to pursue as edge cases surface:

- Explicit default types (`As Variant` when omitted in source)
- Consistent `ByRef`/`ByVal` (tB defaults to `ByRef`; make it explicit)
- Optional parameter defaults in normalized form
- Generic type parameters (`Of T`) in consistent format
- `WithEvents` field signatures

These don't block the pipeline — the JSON emitter normalizes what it
can, and the differ compares what's there. Better normalization reduces
false-positive "modified" reports.
