---
title: FileProperties
parent: FileProps Package
permalink: /tB/Packages/Contributed/FileProps/FileProperties
has_toc: false
---

# FileProperties class
{: .no_toc }

A read-only collection of Windows shell properties for a single file, returned by **FilePropertyExplorer**.

**FileProperties** is a Virtual-COM object that provides indexed access to all shell property handlers the operating system exposes for the opened file. Each entry in the collection is a [**FileProperty**](../FileProperty/FileProperty) object carrying the system name, localized name, unique property ID, and current value for one shell property. Common examples include audio duration on MP3 files, EXIF fields on JPEG images, and extended metadata on Office documents.

Instances are not constructed directly. Call [**FilePropertyExplorer.OpenFile**](../FilePropertyExplorer/OpenFile) or [**FilePropertyExplorer.BrowseAndOpenFile**](../FilePropertyExplorer/BrowseAndOpenFile) to obtain a **FileProperties** collection.

```tb
Dim Props As FileProperties
Set Props = FilePropertyExplorer.OpenFile("C:\Music\track.mp3")

Dim i As Long
For i = 0 To Props.Count - 1
    Dim Prop As FileProperty
    Set Prop = Props.Item(i)
    Debug.Print Prop.NameDesc & " = " & Prop.ValueDesc
Next i
```

* TOC
{:toc}

## Properties

### Count
{: .no_toc }

Returns the number of shell properties in the collection. **Long**. Read-only.

Syntax: *object*.**Count**

The count reflects the number of property handlers the shell exposes for the opened file. Different file types expose different property sets.

### FilePath
{: .no_toc }

Returns the full file path of the file that was opened. **String**. Read-only.

Syntax: *object*.**FilePath**

The value matches the path originally passed to [**FilePropertyExplorer.OpenFile**](../FilePropertyExplorer/OpenFile). When a collection is obtained through [**FilePropertyExplorer.BrowseAndOpenFile**](../FilePropertyExplorer/BrowseAndOpenFile), this property returns the path the user selected in the dialog.

### Item
{: .no_toc }

Returns the [**FileProperty**](../FileProperty/FileProperty) object at the given position, name, or ID in the collection.

Syntax: *object*.**Item** ( *IndexOrNameOrID* ) **As FileProperty**

*IndexOrNameOrID*
: *required* A **Variant** that identifies the property to retrieve. Accepted forms:
  - An integer index from `0` to `Count - 1`.
  - A **String** matching [**FileProperty.Name**](../FileProperty/Name) (the system identity name, e.g. `"System.Media.Duration"`).
  - A **String** matching [**FileProperty.ID**](../FileProperty/ID) (the unique property identifier).

```tb
' By zero-based index:
Dim Prop As FileProperty
Set Prop = Props.Item(0)

' By system name:
Set Prop = Props.Item("System.Media.Duration")
```

> [!NOTE]
> **Item** is the default member of **FileProperties**, so `Props("System.Media.Duration")` is equivalent to `Props.Item("System.Media.Duration")`.

### VCOMObject
{: .no_toc }

Holds the native-code COM object created internally by the Virtual-COM library. **Object**. For internal use only.

> [!WARNING]
> Do not read, assign, or pass **VCOMObject** to any function. All calls to its members are proxied through the named properties of **FileProperties**. Direct access may corrupt the internal state of the Virtual-COM library.

## Example

This example opens a JPEG file and prints all its shell properties to the Debug console.

```tb
Sub PrintShellProps(FilePath As String)
    Dim Props As FileProperties
    Set Props = FilePropertyExplorer.OpenFile(FilePath)

    Debug.Print "File: " & Props.FilePath
    Debug.Print "Properties: " & Props.Count

    Dim i As Long
    For i = 0 To Props.Count - 1
        Dim Prop As FileProperty
        Set Prop = Props.Item(i)
        Debug.Print Prop.NameDesc & " (" & Prop.Name & ")" & " = " & Prop.ValueDesc
    Next i
End Sub
```

## See Also

- [FilePropertyExplorer](../FilePropertyExplorer/FilePropertyExplorer) class -- the predeclared factory that opens a file and returns a **FileProperties** collection
- [FileProperty](../FileProperty/FileProperty) class -- a snapshot of one shell property in the collection
- [FilePropertyExplorer.OpenFile](../FilePropertyExplorer/OpenFile) -- opens a file by path and returns a **FileProperties** collection
- [FilePropertyExplorer.BrowseAndOpenFile](../FilePropertyExplorer/BrowseAndOpenFile) -- displays a file-open dialog and returns a **FileProperties** collection
