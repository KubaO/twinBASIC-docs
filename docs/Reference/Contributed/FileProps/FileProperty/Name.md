---
title: Name
parent: FileProperty
permalink: /tB/Packages/Contributed/FileProps/FileProperty/Name
has_toc: false
---
# Name
{: .no_toc }

Returns the system identity name of the Windows shell property.

Syntax: *object*.**Name**

*object*
: *required* An object expression that evaluates to a **FileProperty** object.

Returns a **String** containing the canonical system name for the property, such as `"System.ItemFolderNameDisplay"` or `"System.Author"`. This name is defined by the Windows property schema and remains stable across all locales and Windows versions, making it suitable as a reliable identity key for a specific property.

### Remarks

The system identity name is safe to use as a stable identifier even on non-English systems. It differs from [**NameDesc**](NameDesc), which returns a localized display name that may not be available on all systems. When storing or comparing property identifiers across locale boundaries, use **Name** rather than **NameDesc**.

For an alternative unique identifier that includes the property schema GUID and index, see [**ID**](ID).

### Example

This example iterates over all shell properties for a file and prints the system name and value of each one to the Debug console.

```tb
Dim Props As FileProperties
Set Props = FilePropertyExplorer.OpenFile("C:\Example\photo.jpg")

Dim i As Long
For i = 1 To Props.Count
    Dim Prop As FileProperty
    Set Prop = Props.Item(i)
    Debug.Print Prop.Name & " = " & Prop.ValueDesc
Next i
```

### See Also

- [NameDesc](NameDesc) property -- returns the localized display name of the property
- [ID](ID) property -- returns the schema GUID and index as a unique identifier
- [Value](Value) property -- returns or sets the current value of the shell property as a Variant
- [ValueDesc](ValueDesc) property -- returns the current value as a localized string
- [FileProperty](FileProperty) class
