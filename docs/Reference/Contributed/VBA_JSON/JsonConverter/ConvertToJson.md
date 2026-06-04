---
title: ConvertToJson
parent: JsonConverter Module
permalink: /tB/Packages/Contributed/VBA_JSON/JsonConverter/ConvertToJson
has_toc: false
---
# ConvertToJson
{: .no_toc }

Converts a VBA value to its JSON string representation.

Syntax: **ConvertToJson** ( *JsonValue* [ **,** *Whitespace* ] )

*JsonValue*
: *required* The value to convert. Accepts a **Dictionary** (converted to a JSON object), a **Collection** or VBA array (converted to a JSON array), or any scalar value (**String**, **Boolean**, numeric types, **Date**, **Null**, **Empty**).

*Whitespace*
: *optional* Controls pretty-printing. Pass an **Integer** to indent each level by that many spaces, or a **String** to use that string as the indentation unit at each level. When omitted, the output is compact with no added whitespace.

The function returns a **String** containing the JSON representation of *JsonValue*.

### Remarks

The following table summarises how each VBA type maps to JSON:

| VBA type | JSON output |
|---|---|
| **Null** | `null` |
| **Boolean** **True** | `true` |
| **Boolean** **False** | `false` |
| Numeric (**Integer**, **Long**, **Single**, **Double**, **Currency**, **Decimal**) | Number literal. A locale decimal separator (comma) is replaced with a period. |
| **Date** | ISO 8601 string in double quotes (UTC, e.g. `"2024-06-03T12:00:00.000Z"`). |
| **String** | Double-quoted string with JSON escape sequences applied. Control characters and non-ASCII code points are escaped as `\uXXXX`. |
| Large-number **String** | Numeric literal without quotes (when `JsonOptions.UseDoubleForLargeNumbers` is **False** and the string contains only digit/decimal characters and is 16 or more characters long). |
| VBA array (1D or 2D) | JSON array. **Empty** or **Nothing** elements are emitted as `null`. |
| **Collection** | JSON array. **Empty** or **Nothing** items are emitted as `null`. |
| **Dictionary** | JSON object. Keys are emitted as quoted strings. Entries whose value is **Empty** or **Nothing** are omitted entirely. |
| **Empty** / **Nothing** (top-level) | Empty string `""` (not valid standalone JSON; meaningful only inside arrays and dictionaries as described above). |

When *Whitespace* is provided, each nesting level is indented relative to its parent. An **Integer** *Whitespace* of `4` produces four spaces per level; a **String** *Whitespace* of `vbTab` produces one tab per level.

The solidus (`/`) is not escaped by default. Set `JsonConverter.JsonOptions.EscapeSolidus = True` before calling **ConvertToJson** to escape forward slashes as `\/`.

The `json_CurrentIndentation` parameter in the full signature is for internal recursive use. Do not pass it directly.

### Example

This example converts a **Dictionary** to a compact JSON string and then to a pretty-printed one.

```tb
Dim Person As New Dictionary
Person("name") = "Alice"
Person("age") = 30
Person("active") = True

' Compact output
Dim Compact As String
Compact = ConvertToJson(Person)
' Result: {"name":"Alice","age":30,"active":true}

' Pretty-printed with 2 spaces per level
Dim Pretty As String
Pretty = ConvertToJson(Person, 2)
' Result:
' {
'   "name": "Alice",
'   "age": 30,
'   "active": true
' }
```

This example converts a mixed **Collection** containing a nested **Dictionary**.

```tb
Dim Tags As New Collection
Tags.Add "twinBASIC"
Tags.Add "JSON"

Dim Doc As New Dictionary
Doc("title") = "Getting Started"
Doc("tags") = Tags
Doc("revision") = Null

Dim JsonStr As String
JsonStr = ConvertToJson(Doc, 4)
' Result:
' {
'     "title": "Getting Started",
'     "tags": [
'         "twinBASIC",
'         "JSON"
'     ],
'     "revision": null
' }
```

### See Also

- [ParseJson](ParseJson) function -- parses a JSON string into a **Dictionary** or **Collection**
- [JsonConverter](.) module -- package module overview
