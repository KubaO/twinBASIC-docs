---
title: ParseJson
parent: JsonConverter Module
permalink: /tB/Packages/Contributed/VBA_JSON/JsonConverter/ParseJson
has_toc: false
---
# ParseJson
{: .no_toc }

Parses a JSON string and returns the result as a **Dictionary** or **Collection** object.

Syntax: **ParseJson** ( *JsonString* )

*JsonString*
: *required* A **String** containing a valid JSON text. The root value must be a JSON object (`{...}`) or a JSON array (`[...]`).

Returns an **Object** --- a **Dictionary** when the root JSON value is an object, or a **Collection** when it is an array. Nested objects and arrays are likewise returned as **Dictionary** and **Collection** values respectively. JSON strings become **String**, JSON numbers become **Double** (or **String** for numbers longer than 15 significant digits when `JsonOptions.UseDoubleForLargeNumbers` is **False**), JSON booleans become **Boolean**, and JSON `null` becomes **Null**.

Carriage returns, line feeds, and tab characters are stripped from *JsonString* before parsing, so formatted (pretty-printed) JSON is accepted without pre-processing.

### Remarks

If *JsonString* does not begin with `{` or `[` after leading whitespace is skipped, **ParseJson** raises run-time error **10001** with source `JSONConverter` and a message that includes the position of the unexpected character together with a short excerpt of the surrounding text.

Large integers in JSON (16 or more digits with no decimal point; 17 or more characters when a decimal point is present) are returned as **String** by default to avoid the 15-significant-digit limit of **Double**. Set `JsonConverter.JsonOptions.UseDoubleForLargeNumbers = True` to force all numbers to **Double** regardless of length.

Object keys must be quoted (single or double quotes) unless `JsonConverter.JsonOptions.AllowUnquotedKeys` is set to **True**.

### Example

This example parses a JSON object and a JSON array, then reads values from each result.

```tb
Dim Json As Object

' Parse a JSON object -- result is a Dictionary.
Set Json = ParseJson("{""name"":""Alice"",""age"":30}")
Debug.Print Json("name")   ' Alice
Debug.Print Json("age")    ' 30

' Parse a JSON array -- result is a Collection.
Set Json = ParseJson("[1, 2, 3]")
Dim Item As Variant
For Each Item In Json
    Debug.Print Item
Next Item

' Parse formatted (multi-line) JSON -- tabs and newlines are stripped automatically.
Dim Pretty As String
Pretty = "{" & vbCrLf & "  ""status"": ""ok""" & vbCrLf & "}"
Set Json = ParseJson(Pretty)
Debug.Print Json("status")   ' ok
```

### See Also

- [ConvertToJson](ConvertToJson) function
- [JsonConverter Module](.) module
