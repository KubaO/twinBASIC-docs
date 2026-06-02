# Plan: twinBASIC Package Index Generator

## Context

Documenting twinBASIC packages requires reading `.twin` source files to find every public declaration, its signature, and its line number. With 40 packages and hundreds of source files, re-reading everything for each documentation update is slow and wasteful. A per-package index file listing every declaration with its line number would let us jump straight to the relevant source, and combined with git tracking of the decompressed sources, would let us diff exactly what changed between tB releases.

## Script: `indexer/twin-index.mjs`

Single ESM file (matches the project's `.mjs` / `import`/`export` / `fs/promises` conventions). Run as:

```
node indexer/twin-index.mjs [--out <dir>] <packages-root>
```

- `<packages-root>` defaults to `../tb-export/AllPackages/Packages`
- `--out` defaults to `./package-indexes/` (add to `.gitignore` in this repo)
- Produces one `<PackageName>.md` per package directory

### Output format

```markdown
# Assert

## Exact.twin

- L12: `Module Exact`
  - L16: `Declare Sub Succeed` `[DebugOnly]`
  - L20: `Declare Sub Fail` `[DebugOnly]`
  - L28: `Declare Sub AreEqual` `[DebugOnly]`
  - L32: `Declare Sub AreNotEqual` `[DebugOnly]`

## Permissive.twin

- L8: `Module Permissive`
  - L12: `Declare Sub Succeed` `[DebugOnly]`
  ...
```

A larger package with enums would look like:

```markdown
# WinServicesLib

## Constants.twin

- L1: `Module Constants`
  - L6: `Const SC_MANAGER_CONNECT`
  - L92: `Enum SC_STATUS_TYPE` (2 members) — [full listing](#sc_status_type)

## Interfaces.twin

- L1: `Interface ITbService` `[InterfaceId]` — Implement this interface to create a Windows service
  - L5: `Sub ServiceMain`
  - L6: `Sub ChangeState`

...

## Enum Details

### SC_STATUS_TYPE
_Constants.twin, L92_

| Value | Name |
|-------|------|
| 0 | SC_STATUS_PROCESS_INFO |
```

Nested bullets show containment (members inside their Module/Class/Interface/Type/Enum/CoClass). Each line shows the **physical line number** in the original file (the line where the declaration keyword appears, even if the declaration spans continuation lines) and a short signature: kind + name + key qualifiers (return type for functions, `Extends` for interfaces).

### Architecture: three stages

```
Physical lines  ──►  Lexer  ──►  Logical lines  ──►  Extractor  ──►  Declarations tree  ──►  Emitter  ──►  .md
```

---

## Stage 1: Lexer (physical lines → logical lines)

Processes a file's raw lines into **logical lines** — joined continuations with strings and comments stripped.

### Character-by-character state machine

Two states: `CODE` and `STRING`.

For each physical line, walk character by character:

- **CODE state:**
  - `'` → rest of line is a comment; stop processing this physical line.
  - `"` → enter STRING state.
  - Anything else → accumulate into the code buffer.

- **STRING state:**
  - `""` → escaped quote; skip both characters (stay in STRING).
  - `"` → exit STRING; replace the entire string literal content with nothing (emit `""` — empty placeholder so attribute brackets still balance, but no keywords can match inside strings).
  - Anything else → skip (consuming string content).

After processing each physical line:

1. The code buffer (with strings replaced by `""`) is the **stripped code**.
2. Check if the stripped code matches `\s_\s*$` (underscore preceded by whitespace, with optional trailing whitespace): if yes, this is a **continuation** — strip the trailing `\s_\s*`, append the next physical line, and keep going. An identifier ending in `_` (no preceding space) is NOT a continuation.
3. Record the **start line number** (1-based, from the first physical line of the logical line).
4. Also accumulate the raw (pre-strip) text of each physical line into a `rawText` field — needed for Description extraction.

Output: array of `{ line, text, rawText }` where `line` is the starting physical line number, `text` is the fully joined stripped logical line, and `rawText` is the fully joined raw line (with original strings/comments intact).

Read files with `await fs.readFile(path, 'utf-8')`. If a BOM is present, strip it (`text.replace(/^﻿/, '')`).

### Edge cases

- `_` inside a string literal: already handled — string content is stripped before checking for continuation.
- `_` inside a comment (`' note: see foo_`): already handled — comment portion is stripped first.
- Attribute blocks `[Attr1] [Attr2]` on separate lines joined by `_`: works — the joined logical line will be `[Attr1] [Attr2] Public Sub Foo(...)`.
- Multi-line `[Description("long text" & vbCrLf & _` : the string content is stripped, `_` continuation is honored, and the joined line has `[Description("" & vbCrLf &` which won't falsely match any declaration keyword.
- Identifiers ending in `_` (e.g. `Dim foo_`): NOT treated as continuations because the `_` is not preceded by whitespace.
- Attribute lines WITHOUT continuation (the common case): `[ClassId("...")]` / `[COMCreatable(False)]` / `Class Foo` are three separate logical lines. The extractor (not the lexer) handles associating attributes with declarations — see "Description attribute extraction" in Stage 2.
- `#If` / `#End If` / `#Region` / `#End Region` conditional-compilation directives: ignored. They don't match any declaration pattern and pass through harmlessly.

---

## Stage 2: Extractor (logical lines → declaration tree)

Walks the logical lines and matches declaration patterns using regex. Maintains a **container stack** to track nesting.

### Containers (push onto stack)

| Pattern (on stripped logical line) | Kind | Captured |
|---|---|---|
| `(Public\|Private\|Protected)?\s*(Module)\s+(\w+)` | Module | access, name |
| `(Public\|Private\|Protected)?\s*(Class)\s+(\w+)` | Class | access, name |
| `(Public\|Private)?\s*(Interface)\s+(\w+)(\s+Extends\s+(\S+))?` (**suppress when inside CoClass** — see below) | Interface | access, name, base |
| `(Public\|Private)?\s*(Enum)\s+(\w+)` | Enum | access, name |
| `(Public\|Private)?\s*(Type)\s+(\w+)` | Type | access, name |
| `CoClass\s+(\w+)` | CoClass | name |

Each pushed container gets a `children: []` array.

### Container ends (pop from stack)

| Pattern | Pops |
|---|---|
| `End\s+(Module\|Class\|Interface\|Enum\|Type\|CoClass)` | matching container kind |

### Members (append to current container's children)

| Pattern | Kind | Captured |
|---|---|---|
| `(Public\|Private\|Protected\|Friend)?\s*(Static\s+)?(Sub\|Function)\s+(\w+)` | Sub/Function | access, name |
| `(Public\|Private\|Protected\|Friend)?\s*Property\s+(Get\|Let\|Set)\s+(\w+)` | Property | access, get/let/set, name |
| `Declare(Wide)?\s+(PtrSafe\s+)?(Sub\|Function)\s+(\w+)\s+Lib\s+"([^"]*)"` | Declare | sub/func, name, lib |
| `(Public\|Private)?\s*Const\s+(\w+)` | Const | access, name |
| `(Public\|Private\|Protected)?\s*Event\s+(\w+)` | Event | access, name |
| `Implements\s+(\S+)` | Implements | interface name |
| `Inherits\s+(\S+)` | Inherits | base class |
| `(Public\|Protected)\s+(WithEvents\s+)?(\w+)\s+As\s+` (only inside Class/Type, not inside Sub/Function/Property) | Field | access, name (flag WithEvents if present) |

Private fields are **skipped** — they're implementation details. Only Public and Protected fields are indexed.

### Enum members

Inside an `Enum` container, lines like `MemberName = value` or just `MemberName` are enum members. Match: `(\w+)\s*(=\s*(.+))?` when the current container is Enum.

Enum members are **collected but not shown inline** in the main listing. Instead:

- The main listing shows a collapsed count with a cross-reference anchor:
  ```
  - L200: `Enum wv2PermissionKind` (15 members) — [full listing](#wv2permissionkind)
  ```
- A **supplementary chapter** at the end of the file (`## Enum Details`) gives the full member listings, one H3 per enum:
  ```
  ## Enum Details

  ### wv2PermissionKind
  _Classes/WebView2.twin, L200_

  | Value | Name |
  |-------|------|
  | 0 | wv2PermissionKindUnknownPermission |
  | 1 | wv2PermissionKindMicrophone |
  ...
  ```

### CoClass body handling

CoClass blocks contain interface *references*, not interface declarations:

```
[CoClassId("E7F3D923-...")] CoClass CustomControlTimer
    [Default] Interface _CustomControlTimer
    [Default, Source] Interface _CustomControlTimerEvents
End CoClass
```

These `[Default] Interface X` / `[Default, Source] Interface Y` lines must NOT be matched as Interface container starts — doing so would push a phantom container that never gets popped, corrupting the stack for the rest of the file.

**Rule:** When the current container is a CoClass, suppress the Interface container-start pattern. Instead, match `(Default|Source).*Interface\s+(\w+)` as a CoClass member annotation (kind: `CoClassInterface`, capturing the interface name and the Default/Source role). These appear as children of the CoClass in the index:

```
- L162: `CoClass CustomControlTimer`
  - L163: `[Default] Interface _CustomControlTimer`
  - L164: `[Default, Source] Interface _CustomControlTimerEvents`
```

### What NOT to extract

- Local variables inside Sub/Function/Property bodies — the extractor skips member-pattern matching when inside a procedure body (track procedure depth separately from container depth).
- `Dim` / `ReDim` statements (local variables).
- Assignment statements, control flow, etc.

### Procedure body tracking

When we enter a Sub/Function/Property Get/Let/Set, set a "in procedure" flag. While this flag is set, skip member extraction (only look for `End Sub` / `End Function` / `End Property` to clear the flag). This prevents local `Const` or `Dim` from being indexed.

Exception: nested Type/Enum declarations inside a procedure (rare but legal) should still be extracted — if we see a container-start pattern while in a procedure, push it and handle normally.

### Pattern matching priority

The extractor checks patterns in this order (first match wins), to prevent the field catch-all from stealing keyword declarations:

1. Container ends (`End Module`, `End Class`, ...)
2. CoClass interface references (`[Default] Interface X` — only when inside a CoClass)
3. Container starts (Module, Class, Interface — **suppressed inside CoClass**, Enum, Type, CoClass)
4. Procedure ends (`End Sub`, `End Function`, `End Property`)
5. Declare statements (`Declare` or `DeclareWide`, with optional `PtrSafe`)
6. Const declarations
7. Event declarations
8. Sub / Function declarations
9. Property declarations
10. Implements / Inherits
11. Enum members (only when inside an Enum container)
12. Fields — with optional `WithEvents` (only when inside a Class/Type and NOT inside a procedure) — **last**, as catch-all

### Attribute extraction

Attribute lines like `[COMCreatable(False)]` or `[Description("...")]` typically appear as **separate logical lines** before the declaration (no `_` continuation joining them):

```
[ClassId("66CF1252-...")]
[InterfaceId("A7CDEA84-...")]
[COMCreatable(False)]
[EventsUseDispInterface]
[ComImport(True)]
Class ListViewBaseCtl
```

The extractor maintains two pending accumulators:

- `pendingAttrs: string[]` — attribute names (with short values where meaningful)
- `pendingDescription: string | null` — extracted Description text

**Attribute scanning.** For each logical line, scan `rawText` for all `\[(\w+)(?:\(([^)]*)\))?\]` matches. For each match:

- If the attribute name is `Description`: extract the description text from the raw first argument. Multi-line descriptions using `& vbCrLf &` won't fully capture — accept the first segment. Store in `pendingDescription`.
- If the attribute value is a GUID string (matches `"[0-9A-Fa-f-]{36}"`): emit just the name (e.g., `ClassId`). The GUID itself isn't useful in the index.
- Otherwise: emit `Name(value)` for short values (e.g., `COMCreatable(False)`, `DispId(0)`) or just `Name` for no-arg attributes (e.g., `EventsUseDispInterface`, `Hidden`, `ConstantFoldable`).

**Attachment rules:**

1. If a logical line contains only attribute brackets (no declaration keyword), append to `pendingAttrs` / `pendingDescription` and continue.
2. If a logical line contains both attributes AND a declaration (joined by `_`), extract attributes from that line too, then attach all pending + inline attributes to the declaration.
3. When a declaration is matched, consume and clear both `pendingAttrs` and `pendingDescription`.
4. If a non-attribute, non-blank, non-declaration line appears, clear both accumulators.

**Output in the index:**

```
- L44: `Class ListViewBaseCtl` `[COMCreatable(False), ComImport, EventsUseDispInterface]` — optional description
- L16: `Declare Sub Succeed` `[DebugOnly, PreserveSig(False)]`
- L102: `Property Get Source() As String` — Returns the current URL
```

Attribute names are shown in a backtick-wrapped `[...]` block after the signature. Omit the block when there are no notable attributes. Skip these noise attributes that appear on nearly every Declare: `UseGetLastError(False)`, `MustBeQualified(True)` — configure a skip-list in the emitter.

### Return type extraction

For Function and Property Get declarations, extract the return type from the stripped logical line using a post-match scan for `\)\s+As\s+(\w[\w.]*(?:\(Of\s+[^)]+\))?)` after the parameter list. Include it in the signature:

```
- L102: `Property Get Source() As String`
- L55: `Function Item(Index) As Variant`
```

---

## Stage 3: Emitter (declaration tree → markdown)

For each package directory:

1. Glob `**/*.twin` under `<package>/Sources/` (preserving subfolder structure).
2. Sort files: subdirectory path first (alphabetical), then filename.
3. Emit `# <PackageName>` as H1.
4. For each source file, emit `## <relative-path>` as H2 (e.g., `## Classes/WebView2.twin`, `## Exact.twin`).
5. Walk the declaration tree depth-first, emitting nested markdown bullets:
   - Indent level = container nesting depth.
   - Format: `- L<line>: \`<kind> <name>[<qualifiers>]\`` with optional ` — <description>`.
   - For Enum containers: append ` (<N> members)` count and a markdown link `[full listing](#<anchor>)` pointing to the supplementary chapter.
6. After all source files, emit `## Enum Details` supplementary chapter:
   - One H3 per enum (across all source files in the package), anchored by enum name.
   - Under each H3: source file + line reference, then a table of `| Value | Name |` rows.

---

## File structure

Single file: `indexer/twin-index.mjs`

Internal structure (not separate files, just clearly separated sections):

```
// --- CLI ---
// Argument parsing (process.argv), defaults, --help

// --- Lexer ---
// lex(lines) → { line, text, rawText }[]
//   line = 1-based physical start line; text = stripped+joined; rawText = raw joined

// --- Extractor ---
// extract(logicalLines) → { declarations: node[], enums: enumInfo[] }
//   Checks patterns in priority order (see "Pattern matching priority")
//   Tracks container stack, procedure depth, pendingDescription

// --- Emitter ---
// emitMarkdown(packageName, fileResults[]) → string

// --- Main ---
// Walk packages, read files, lex → extract → emit, write .md files
```

## Verification

1. Run against the full `../tb-export/AllPackages/Packages` tree.
2. Spot-check the generated index for a few known packages:
   - **Assert** (small, simple — 3 modules with Declare statements)
   - **VB** (large, deep nesting — classes with properties, events, inherits)
   - **WebView2Package** (interfaces with Extends, enums, nested classes)
   - **WinServicesLib** (mix of Types, Enums, Declares, interfaces)
3. Confirm line numbers match: open a `.twin` file, go to the reported line, verify the declaration is there.
4. Confirm nesting: members should appear indented under their container.
5. Confirm strings/comments don't cause false matches.
