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

## Status

| Phase | Status | Notes |
|---|---|---|
| A — Restructure indexer directory | ✓ Done | Manifests created as stubs (old gitignored dirs left in place) |
| B — JSON emitter + store management | ✓ Done | Includes extractor enhancement (signature/access on all nodes) |
| C — Analyze stage | ✓ Done | `auditCoverage` returns documented/undocumented; mismatched deferred |
| D — Documentation reorganization | ✓ Done | Landing pages created; packages moved into Default/, Built-In/, Contributed/ |
| E — Draft workflow | ✓ Done | `.claude/workflows/doc-draft.mjs`; Haiku triage → Sonnet draft/index |
| F — Roll out | In progress | First sync+analyze done; `package_name` mapping + container audit fixes |

The CLI stages (`sync`, `analyze`) accept `--package <name>` (or
`--packages <a>,<b>`) to limit scope. The draft workflow accepts an
optional package name via `args`.

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
    json-emitter.mjs              # api.json emitter
    differ.mjs                    # api.json differ
    store.mjs                     # .packages/ git repo management
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

### Draft workflow (under `.claude/workflows/`)

```
.claude/workflows/
  doc-draft.mjs                   # Claude Code workflow: triage → draft → index
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

### `package_name` frontmatter

When the documentation directory name differs from the internal package
name (the `symbol` in the manifest), the package's `index.md` carries a
`package_name` field so the analyze stage can locate existing docs:

```yaml
---
title: Assert Package
package_name: TwinBasicAssertions
parent: Built-In Packages
---
```

The field is a comma-separated list when multiple packages share one
docs directory (e.g., the three CEF runtime versions):

```yaml
package_name: cefPackage49, cefPackage109, cefPackage145
```

When omitted, the analyzer falls back to matching the docs directory
name against the package name directly. Only add this field when the
names diverge.

Current mappings:

| Docs directory | `package_name` |
|---|---|
| `Built-In/Assert` | `TwinBasicAssertions` |
| `Built-In/WebView2` | `WebView2Package` |
| `Built-In/CEF` | `cefPackage49, cefPackage109, cefPackage145` |

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

**`lib/extractor.mjs`** (enhanced):

The extractor now captures `signature` and `access` on every
declaration node. The `consumeAttrs(node, rawSig)` helper sets both
from the stripped declaration text (`rawSig` = `stripped` with
whitespace normalized). CoClassInterface nodes get their signature
from the original `text` (preserves `[Default]`/`[Source]` markers).
The old `Declare` node's hand-built `signature` field is replaced by
the full `rawSig` from the source line.

**`lib/json-emitter.mjs`**:

```js
export function emitApiJson(packageName, version, fileResults)
// Takes the same fileResults as emitMarkdown.
// Returns: string (deterministic JSON, sorted keys)
```

Produces api.json from the extractor's declaration tree. Applies
signature normalization. Output is deterministic: sorted keys, sorted
arrays, consistent formatting.

**`lib/store.mjs`**:

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

**`lib/differ.mjs`**:

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

export function auditCoverage(apiJson, docPageMap)
// Takes a parsed api.json and a Map<title, filePath> of existing doc pages.
// Returns: {
//   documented: Symbol[],       // have pages
//   undocumented: Symbol[],     // missing pages
// }
// Note: mismatched detection (pages with stale signatures) is deferred —
// it requires parsing signatures from doc page content, which is
// format-dependent. For now, audit reports documented vs undocumented.
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
The full JSON — an **array** of per-package report objects — is
written to `indexer/.packages/report.json` (not committed to the
store repo — transient working file). The draft workflow reads this
file as its input.

If `--package` is used, the array contains only that package's report.
Without it, the array covers all packages with api.json files in the
store.

## Stage 3: draft (Claude Workflow)

`.claude/workflows/doc-draft.mjs` — a Claude Code workflow that reads
a change report and dispatches agents to write documentation.

### Workflow structure

```
Phase 1 — Triage  [Haiku]
  Single agent reads the change report + existing doc structure.
  Validates tasks, resolves file paths, determines page templates.
  Output: enriched task list with concrete file paths and instructions.

Phase 2 — Draft (fan-out)  [Sonnet]
  pipeline(tasks, task => agent(draftPrompt(task)))
  Each agent receives:
    - The symbol's source code (from .packages/)
    - The existing doc page (if updating)
    - WIP.md conventions (cross-linking, formatting, templates)
    - 2-3 example pages of the same kind (Sub, Property, Class, Enum)
    - Package index.md for context
  Produces: markdown file content written to the correct path.

Phase 3 — Index updates  [Sonnet]
  One agent per package updates the package index.md (including
  indexed_from update). Cross-reference index updates (Statements.md,
  Procedures and Functions.md) deferred to manual pass.
```

### Model selection

Every `agent()` call specifies an explicit `model:` — the default
(inherited parent model) is never used.

| Phase | Model | Rationale |
|---|---|---|
| Triage | Haiku | Mechanical: read JSON, apply deterministic path-resolution rules, return structured output. No prose generation. |
| Draft | Sonnet | Creative: read source code, follow conventions, write quality documentation prose matching existing style. |
| Index | Sonnet | Semi-creative: read source for accurate one-line descriptions, edit existing pages while preserving structure. |

Opus is not used — the draft task is convention-following (imitate
example pages), not open-ended reasoning. Sonnet's writing quality is
sufficient when guided by explicit examples and a structured prompt.
Haiku handles the data-wrangling triage at a fraction of the cost.

### Implementation details

**Triage agent** returns structured output (JSON Schema) with an
enriched flat task list. Each task carries resolved `sourcePath` and
`targetPath`. The agent reads `report.json` and checks the filesystem
to determine folder-style vs single-file layout for each target.
`flag_removal` tasks are separated into a `flagged` list.

**Draft agents** read files themselves — each agent's prompt lists
exact paths and the agent uses the Read tool to fetch:
1. The source file (implementation context)
2. `WIP.md` (page template, frontmatter format, cross-linking rules)
3. 2–3 kind-matched example pages from `EXAMPLES_BY_KIND` table
4. The package's `index.md` (package-level context)
5. The existing page (for update actions)

The agent writes the file directly via Write (create) or Edit (update).

**Kind → example page mapping** (hardcoded in the workflow):

| Kind | Example pages |
|---|---|
| Sub, Function | `Default/VBA/Interaction/AppActivate.md`, `Beep.md` |
| Property | `Default/VBRUN/AmbientProperties/BackColor.md`, `Default/VBA/DateTime/Date.md` |
| Event | `Default/VB/CheckBox/index.md` |
| Class | `Built-In/CEF/CefBrowser/index.md`, `Built-In/WinEventLogLib/EventLog.md` |
| Module | `Built-In/Assert/Exact.md` |
| Enum | `Built-In/CustomControls/Enumerations/WindowState.md` |
| Type | `Default/VBRUN/PropertyBag/index.md` |

**Index agents** run in parallel (one per affected package). Each
reads the current `index.md`, adds alphabetically-sorted bullet
entries for new symbols, and sets `indexed_from` to the new version.

**Package filter**: the workflow accepts an optional `args` string. If
set, the triage agent processes only the named package from the
report.

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

1. `node indexer/twin-index.mjs sync` — populates `.packages/default/VBA/`
2. `node indexer/twin-index.mjs analyze --package VBA` — sees no
   `indexed_from` → full audit mode. Compares api.json against pages
   in `docs/Reference/Default/VBA/`. Reports: documented, undocumented.
3. Run the `doc-draft` workflow (with `args: "VBA"`) — agents fill gaps.
4. Developer reviews, adds `indexed_from: beta-x-0983` to index.md.
5. If a `WIP-VBA.md` exists: extract user-relevant architectural
   notes into the package's index.md, then delete the WIP file.

### Adopting a new contributed package

Example: ArrayListLib (no existing docs).

1. `node indexer/twin-index.mjs sync --package ArrayListLib` —
   downloads, extracts, generates api.json.
2. `node indexer/twin-index.mjs analyze --package ArrayListLib` — no
   docs at all → full scaffold report listing every public symbol.
3. Run the `doc-draft` workflow (with `args: "ArrayListLib"`) — agents
   scaffold the entire package:
   - `Contributed/ArrayListLib/index.md` with overview + `indexed_from`
   - Per-module/class pages with members
   - Enum detail pages
4. Developer reviews, commits.

### Subsequent updates

Example: ArrayListLib 1.3.0 → 1.4.0.

1. `node indexer/twin-index.mjs sync` — downloads new version,
   commits to `.packages/`, copies api.json to `snapshots/`.
2. `node indexer/twin-index.mjs analyze --package ArrayListLib` —
   diffs api.json (1.3.0 baseline from committed snapshot vs 1.4.0
   current in `.packages/`). Reports: 2 added, 1 modified.
3. Run the `doc-draft` workflow (with `args: "ArrayListLib"`) — agents
   update only affected pages, update `indexed_from: 1.4.0`.
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

### Phase A: Restructure indexer directory — ✓ Done

1. ✓ Create `indexer/manifests/` directory.
2. ✓ Created `indexer/manifests/built-in.json` and `contributed.json`
   as stubs (`syncedAt: null`). Old gitignored directories
   (`builtin-indexes/`, `package-indexes/`) are not in the repo;
   first sync populates the new manifests from remote state.
3. ✓ (See 2 — stubs created directly; no files to move from git.)
4. Old directories are gitignored and were never committed. Code no
   longer references them. `.gitignore` entries kept as safety net.
5. ✓ Added `indexer/.packages/` to `.gitignore`.
6. ✓ Created `indexer/snapshots/{default,built-in,contributed}/` with
   `.gitkeep` files.
7. ✓ Manifest paths updated in `twin-index.mjs` (the refactored CLI).
   `sync.mjs` and `builtin-sync.mjs` accept paths as parameters —
   unchanged.

### Phase B: JSON emitter + store management — ✓ Done

8. ✓ Implemented `lib/json-emitter.mjs`. Also enhanced
   `lib/extractor.mjs` to capture `signature` (normalized stripped
   text) and `access` (Public/Private/etc.) on all declaration nodes.
9. ✓ Implemented `lib/store.mjs`.
10. ✓ Refactored `twin-index.mjs` into `sync` subcommand. Old CLI
    flags removed. Added fresh-clone recovery: both contributed and
    built-in sync paths detect unchanged packages with missing store
    directories and force re-download.

**Verification:** Run `node indexer/twin-index.mjs sync`. Confirm:
- `indexer/.packages/` is created as a git repo with one or two
  commits (seed + sync).
- `indexer/snapshots/` contains api.json files for all packages.
- `indexer/manifests/` is updated.
- Run again immediately — no new commit (nothing changed).

### Phase C: Analyze stage — ✓ Done

11. ✓ Implemented `lib/differ.mjs`. `diffApi` compares flattened
    symbol maps by `(container.name.kind)` key. `auditCoverage`
    returns `{documented, undocumented}` — the `mismatched` return
    (pages with stale signatures) is deferred since it requires
    parsing signatures from markdown page content.
12. ✓ Added `analyze` subcommand. Supports update mode (diff against
    `git show HEAD:indexer/snapshots/...`) and audit/pre-tracking
    mode. `findPackageDocsDir()` tries the grouped layout first
    (`Reference/{Group}/{Package}/`), falls back to the flat layout
    (`Reference/{Package}/`) as a safety net.
13. Test end-to-end after first sync.

**Verification:** Run `sync`, then `analyze --package Assert` (small
package, has existing docs). Confirm the change report correctly
identifies documented vs undocumented symbols.

### Phase D: Documentation reorganization — ✓ Done

14. ✓ Created landing pages: `Default.md`, `Built-In.md`,
    `Contributed.md` under `docs/Reference/`.
15. ✓ Moved all 12 package directories into grouped subdirectories
    (`Default/`, `Built-In/`). Created empty `Contributed/`.
16. ✓ Updated `parent:` frontmatter in all 12 package index.md files
    (`Packages` → `Default Packages` / `Built-In Packages`). No pages
    used `grand_parent: Packages` so no child pages needed changes.
    All `permalink` and `redirect_from` values preserved.
17. ✓ Updated `Packages.md` to reference the three landing pages.
18. Build verification deferred to Phase F roll-out.

### Phase E: Draft workflow — ✓ Done

19. ✓ Wrote `.claude/workflows/doc-draft.mjs`. Three-phase workflow:
    Triage (Haiku) reads report, resolves paths → Draft (Sonnet)
    pipeline fans out one agent per symbol → Index (Sonnet) updates
    package index pages. Accepts optional `args` string to filter by
    package name.
20. Test with one small package (e.g., Assert) end-to-end.

### Phase F: Roll out — In progress

21. ✓ First full sync: 32 contributed + 16 built-in packages synced,
    snapshots generated, store repo committed.
22. ✓ Added `package_name` frontmatter field for packages whose docs
    directory name differs from the internal package name. See
    `package_name` section above. Mappings: Assert → TwinBasicAssertions,
    WebView2 → WebView2Package, CEF → cefPackage49/109/145.
23. ✓ Fixed `auditCoverage` to include container-level (module/class)
    coverage checks — previously only checked members.
24. ✓ Updated `findPackageDocsDir` to scan `package_name` frontmatter
    as a fallback when the docs directory name doesn't match.
25. ✓ Fixed `writeToStore` to strip `Sources/` prefix so source file
    paths match the `file` fields in api.json. Fixed missing-sources
    detection to check for `sources/` subdir (not just the package dir)
    so snapshot-seeded stores correctly trigger re-download.
26. ✓ Added missing `EXAMPLES_BY_KIND` entries to the draft workflow:
    Declare, Const, Field, Interface, CoClass, CoClassInterface.
27. ✓ Fixed `buildDraftPrompt` to construct full repo-root-relative
    target paths (`docs/Reference/{group}/{package}/{target}`) instead
    of using the triage agent's package-relative `targetPath` directly.
    First test run confirmed agents wrote to the repo root without this.
28. Draft workflow tested on WinEventLogLib — triage + draft agents
    ran successfully. Draft agents correctly detected inline-documented
    members on existing container pages and did not create redundant
    standalone pages. Need to test on a package with NO existing docs
    (e.g., TwinTimerPackage) to verify page creation works.
29. Adopt remaining built-in packages one at a time.
30. Begin contributed package documentation.

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

## Known Limitations

- **API internals in audit results**: `auditCoverage` includes all
  Public symbols, but some (WinAPI `Declare` statements, internal helper
  modules) are implementation details. The draft workflow creates pages
  for them; the developer should skip or delete low-value pages during
  review. A future enhancement could let packages opt out specific
  modules or symbol kinds from audit.

- **Inline-documented members**: packages that document all members on
  the container page (e.g., Assert puts 15 functions on `Exact.md`)
  report those members as "undocumented" because no standalone page
  exists. The audit is technically correct — there is no page titled
  `AreEqual` — but the content is present on the parent page. The
  developer should not run the draft workflow for these packages; just
  add `indexed_from` after manual review.

- **CEF version duplication**: the three CEF packages
  (`cefPackage49/109/145`) have identical API surfaces. Running a full
  analyze produces three redundant reports. Use `--package cefPackage145`
  to analyze only the recommended version.
