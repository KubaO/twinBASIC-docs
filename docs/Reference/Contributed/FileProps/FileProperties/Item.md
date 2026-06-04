---
title: Item
parent: FileProperties
has_toc: false
permalink: /tB/Packages/FileProps/FileProperties/Item
---
# Item
{: .no_toc }

Returns the **FileProperty** object at the given index, name, or ID in the collection.

Syntax: *object*.**Item**(*IndexOrNameOrID*)

*object*
: *required* An object expression that evaluates to a **FileProperties** object.

*IndexOrNameOrID*
: *required* A **Variant** identifying the property to retrieve. Pass an integer index (zero-based, from `0` to `Count - 1`), a **String** matching **FileProperty.Name**, or a **String** matching **FileProperty.ID**.

**Item** delegates to the underlying Virtual-COM object. Passing an integer retrieves the property at that position in the collection. Passing a string first tries to match **FileProperty.Name** (the system identity name, such as `"System.Audio.EncodingBitrate"`); if no name matches, it tries **FileProperty.ID** (the unique GUID-based identifier string for the shell property).

If *IndexOrNameOrID* does not match any entry, a runtime error is raised by the underlying COM object.

### Example

This example opens a file, iterates the properties by index, and also retrieves one property by name.

```tb
Dim fp As FileProperties
Set fp = FilePropertyExplorer.OpenFile("C:\Music\track.mp3")

' Iterate all properties by index.
Dim i As Long
For i = 0 To fp.Count - 1
    Dim prop As FileProperty
    Set prop = fp.Item(i)
    Debug.Print prop.NameDesc & ": " & prop.ValueDesc
Next i

' Retrieve a specific property by system name.
Dim bitrate As FileProperty
Set bitrate = fp.Item("System.Audio.EncodingBitrate")
Debug.Print "Bitrate: " & bitrate.ValueDesc
```

### See Also

- [FileProperties](FileProperties) class
- [Count](Count) property
- [FilePath](FilePath) property
- [FileProperty](../FileProperty/FileProperty) class
