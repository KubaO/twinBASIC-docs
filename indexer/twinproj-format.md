# .twinproj / .twinpack Binary Format Specification

Reverse-engineered from twinBASIC IDE Beta 983 (June 2026).

Source material: 010 Editor template (`o:\wc\twinproj.bt`), hex analysis of
bundled packages and downloaded `.twinpack` files.

## Overview

Both `.twinproj` (project files) and `.twinpack` (distributable package files)
use the same binary container format.  The format encodes a tree of named
entries — directories containing children, and files containing binary content.

The encoding is little-endian throughout.

## File Header

| Offset | Size | Type   | Value        | Description |
|--------|------|--------|--------------|-------------|
| 0x00   | 4    | uint32 | `0xEA0BA51C` | Magic number.  Constant across all observed files. |

The root entry immediately follows the magic.

## Primitive Types

### LenString

A length-prefixed byte string.  Encoding is UTF-8 for filenames and text
content; binary content (images, etc.) is stored verbatim.

| Offset | Size       | Type   | Description |
|--------|------------|--------|-------------|
| +0     | 4          | uint32 | `length` — byte count.  May be 0. |
| +4     | `length`   | byte[] | Raw bytes.  Absent when `length` is 0. |

## Entry Structure

Every node in the tree (root, directories, and files) shares the same header:

| Offset | Size | Type   | Field    | Description |
|--------|------|--------|----------|-------------|
| +0     | 2    | int16  | `kind`   | Entry type (see below). |
| +2     | var  | LenString | `name` | Entry name (filename or folder name). |
| +2+var | 2    | uint16 | `mark1`  | Revision counter (see below). |
| ...    | 10   | byte[] | `pad`    | Reserved / unknown.  Always observed as all zeros. |
| ...    | 1    | uint8  | `mark2`  | Entry category tag (see below). |

After this common header, the entry body depends on whether the entry is a
**file** or a **directory**.

### Determining entry type

The root entry is always the first entry parsed.  It is always a directory
(even though it has `kind=1`), because the format uses positional logic:

- **Directory** — the root entry, OR any entry with `kind != 1`.
  Body: child count + child entries.
- **File** — any non-root entry with `kind == 1`.
  Body: content blob + trailer.

In practice, observed `kind` values:

| kind | Meaning |
|------|---------|
| 1    | File (or root directory — always the first entry) |
| 2    | Directory / folder |

### Directory body

Follows the common header for directory entries:

| Offset | Size | Type   | Field      | Description |
|--------|------|--------|------------|-------------|
| +0     | 4    | uint32 | `count`    | Number of child entries.  May be 0. |
| +4     | var  | Entry[]| `children` | `count` child entries, concatenated. |

### File body

Follows the common header for file entries:

| Offset | Size          | Type      | Field      | Description |
|--------|---------------|-----------|------------|-------------|
| +0     | var           | LenString | `contents` | File content (source code, images, JSON, etc.). |
| +var   | 4             | uint32    | `trailer`  | Always observed as `0x00000000`. |

## Field Details

### mark1 (revision counter)

For files, this is a revision counter that starts at a low value and increments
by 2 each time the file is updated within the IDE.  For the root entry and
directories, it is 0.

Examples from observations:
- New/untouched file: `0x0002`–`0x0009`
- Heavily edited file: `0x17D5`, `0x1AA0`
- Root and directories: always `0x0000`

### mark2 (category tag)

Encodes the semantic role of the entry within the project.  Observed values:

| mark2 | Entry name             | Meaning |
|-------|------------------------|---------|
| 0x00  | (various)              | Default.  Used for the root, most files, and resource subdirectories (BITMAP, ICON, MANIFEST). |
| 0x02  | `Resources`            | Resource directory. |
| 0x03  | `Sources`              | Source code directory. |
| 0x04  | `Settings`             | Project settings file. |
| 0x05  | `ImportedTypeLibraries`| Imported type library directory. |
| 0x06  | `Miscellaneous`        | Miscellaneous files directory (screenshots, etc.). |
| 0x07  | `Packages`             | Package references directory. |

## .twinproj vs .twinpack

Both formats use the identical binary structure.  The differences are in
which entries are present:

| Feature                | .twinproj | .twinpack |
|------------------------|-----------|-----------|
| `.meta` file           | Yes       | No        |
| `References` directory | Sometimes | No        |
| `CHANGELOG.md`         | Sometimes | Sometimes |
| `LICENCE.md`           | Sometimes | Sometimes |
| `Settings` file        | Yes       | Yes       |
| `Sources` directory    | Yes       | Yes       |
| `Resources` directory  | Yes       | Yes       |
| `Packages` directory   | Yes       | Yes       |

### .meta file

Present only in `.twinproj` files.  Contains JSON with IDE state:

```json
{
  "rootFolder": "/ProjectName",
  "fs_expandedFolders": ["/ProjectName", "/ProjectName/Sources"],
  "openEditors": [],
  "debugConsoleEntryHistory": [],
  "variables_expandedCache": { "/Locals": true },
  "watches": [],
  "watches_expandedCache": {},
  "outlinePanelOptions": {
    "showClassFields": true,
    "showModuleVariables": true,
    "showEnumerations": true,
    "showUDTs": true,
    "showDLLs": true,
    "showConstructors": true
  }
}
```

This file stores the user's IDE layout preferences for the project and is
stripped when generating a `.twinpack` for distribution.

### Settings file

Always present (mark2 = 0x04).  Contains JSON with project configuration
(build type, references, version numbers, etc.).  The settings content itself
is documented separately as part of the twinBASIC project configuration.

## Typical tree structures

### .twinproj (Standard EXE project)

```
ROOT "NewProject"               (kind=1, mark2=0x00)
  DIR  "Miscellaneous"          (kind=2, mark2=0x06)
  DIR  "Packages"               (kind=2, mark2=0x07)
  DIR  "ImportedTypeLibraries"  (kind=2, mark2=0x05)
  DIR  "Resources"              (kind=2, mark2=0x02)
    DIR  "ICON"                 (kind=2, mark2=0x00)
      FILE "twinBASIC.ico"      (kind=1, mark2=0x00)
  DIR  "Sources"                (kind=2, mark2=0x03)
    FILE "Form1.tbform"         (kind=1, mark2=0x00)
    FILE "Form1.twin"           (kind=1, mark2=0x00)
  FILE "Settings"               (kind=1, mark2=0x04)
  FILE ".meta"                  (kind=1, mark2=0x00)
```

### .twinpack (distributed package)

```
ROOT "CustomControlsPackage"    (kind=1, mark2=0x00)
  FILE "CHANGELOG.md"           (kind=1, mark2=0x00)
  FILE "LICENCE.md"             (kind=1, mark2=0x00)
  DIR  "Miscellaneous"          (kind=2, mark2=0x06)
    FILE "frmTextbox.png"       (kind=1, mark2=0x00)
    ...
  DIR  "ImportedTypeLibraries"  (kind=2, mark2=0x05)
  FILE "Settings"               (kind=1, mark2=0x04)
  DIR  "Sources"                (kind=2, mark2=0x03)
    FILE "WaynesGrid.twin"      (kind=1, mark2=0x00)
    ...
  DIR  "Resources"              (kind=2, mark2=0x02)
    DIR  "MANIFEST"             (kind=2, mark2=0x00)
      FILE "#1.xml"             (kind=1, mark2=0x00)
    DIR  "BITMAP"               (kind=2, mark2=0x00)
      FILE "twinBASIC.bmp"      (kind=1, mark2=0x00)
  DIR  "Packages"               (kind=2, mark2=0x07)
```

## Notes

- Child entry order within a directory is not sorted — it reflects insertion
  order within the IDE.
- The format has no index or offset table; entries must be read sequentially
  from the start.
- Maximum observed file size: ~245 versions of WinDevLib at 9.3.688.0 is the
  most prolific package on TWINSERV as of June 2026.
