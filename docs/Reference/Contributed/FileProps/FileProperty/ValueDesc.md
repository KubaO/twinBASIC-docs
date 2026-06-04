---
title: ValueDesc
parent: FileProperty
permalink: /tB/Packages/Contributed/FileProps/FileProperty/ValueDesc
has_toc: false
---
# ValueDesc
{: .no_toc }

Returns the current value of the shell property as a localized string. Read-only.

Syntax: *object*.**ValueDesc**

*object*
: *required* An object expression that evaluates to a **FileProperty** object.

**ValueDesc** returns a **String** containing the property value in a form suitable for display. The string is localized according to the current system locale. For multi-value properties, all values are combined into a single string; no array handling is required.

To retrieve the raw value as a **Variant** (which may be an array for multi-value properties), use the [**Value**](Value) property instead.

### Example

This example opens a file and prints the localized value of each shell property to the Debug console.

```tb
Dim Props As FileProperties
Set Props = FilePropertyExplorer.OpenFile("C:\Music\track.mp3")

Dim Prop As FileProperty
For Each Prop In Props
    Debug.Print Prop.Name & " = " & Prop.ValueDesc
Next Prop
```

### See Also

- [Value](Value) property
- [Name](Name) property
- [NameDesc](NameDesc) property
- [ID](ID) property
- [FileProperty](FileProperty) class
