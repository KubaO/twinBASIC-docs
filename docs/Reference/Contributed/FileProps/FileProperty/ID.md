---
title: ID
parent: FileProperty
permalink: /tB/Packages/Contributed/FileProps/FileProperty/ID
has_toc: false
---
# ID
{: .no_toc }

Returns a unique identifier string for the shell property.

Syntax: *object*.**ID**

*object*
: *required* An object expression that evaluates to a **FileProperty** object.

The **ID** property returns a **String** composed of a GUID identifying the property schema, followed by a space and an integer identifying the property's index within that schema. This format is the canonical identifier for a Windows shell property and is locale-independent, making it reliable for storing or comparing property references across systems with different language settings.

A typical value looks like `{D5CDD505-2E9C-101B-9397-08002B2CF9AE} 2`, where the GUID identifies the schema and the integer selects the specific property within it.

Unlike [**Name**](Name), which uses a human-readable dotted system name such as `System.ItemFolderNameDisplay`, the **ID** string is based on the underlying COM property key (`PROPERTYKEY`) and does not depend on any installed property handler descriptions.

### Example

This example opens a file and prints the ID and name of each shell property to the Debug console.

```tb
Dim props As FileProperties
Set props = FilePropertyExplorer.OpenFile("C:\example\photo.jpg")

Dim i As Long
For i = 1 To props.Count
    Dim prop As FileProperty
    Set prop = props.Item(i)
    Debug.Print prop.ID & "  ->  " & prop.Name
Next i
```

### See Also

- [Name](Name) property
- [NameDesc](NameDesc) property
- [Value](Value) property
- [ValueDesc](ValueDesc) property
- [FileProperty](FileProperty) class
