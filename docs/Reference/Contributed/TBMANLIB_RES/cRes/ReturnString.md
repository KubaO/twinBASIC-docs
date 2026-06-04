---
title: ReturnString
parent: cRes
permalink: /tB/Packages/Contributed/TBMANLIB_RES/cRes/ReturnString
has_toc: false
---
# ReturnString
{: .no_toc }

Returns the loaded resource bytes as a **String**, with an optional character-set conversion.

Syntax: *object*.**ReturnString** [ *Conversion* ]

*Conversion*
: *optional* A **VbStrConv** constant controlling how the byte array is converted to a string. Defaults to **vbUnicode**, which interprets the bytes as a Unicode (UTF-16 LE) encoded string.

**ReturnString** passes the internal byte array held by the **cRes** instance to the VBA **StrConv** function and returns the result. The byte array is the raw data loaded by a prior call to [**Read**](../index#read).

> [!NOTE]
> The correct value for *Conversion* depends on the encoding of the resource data. For ANSI text resources, pass **vbFromUnicode** to convert from the native Unicode string representation to ANSI, or **vbUnicode** when the resource bytes are already a UTF-16 LE sequence. Passing the wrong constant produces garbled output; no error is raised.

### Example

This example loads a text resource by ID, converts it to an ANSI string, and displays it in a message box.

```tb
Dim r As New cRes
Dim s As String

s = r.Read(101, "TEXT").ReturnString(vbFromUnicode)
MsgBox s
```

### See Also

- [Read](../index#read) method
- [ReturnBytes](ReturnBytes) method
- [ReturnHex](ReturnHex) method
- [ReturnBase64](ReturnBase64) method
