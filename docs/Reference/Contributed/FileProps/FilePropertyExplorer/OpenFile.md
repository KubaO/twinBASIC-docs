---
title: OpenFile
parent: FilePropertyExplorer
has_toc: false
permalink: /tB/Packages/FileProps/FilePropertyExplorer/OpenFile
---
# OpenFile
{: .no_toc }

Opens a file by path and returns a **FileProperties** collection of its Windows shell properties.

Syntax: *object*.**OpenFile**(*FilePath* [ **,** *WriteSupport* ])

*object*
: *required* An object expression that evaluates to a **FilePropertyExplorer** object. The predeclared default instance is available as `FilePropertyExplorer`.

*FilePath*
: *required* A **String** giving the full path to the file to open.

*WriteSupport*
: *optional* A **Boolean** that controls whether the returned **FileProperties** collection is opened with write access to property values. **False** (default) opens in read-only mode. Pass **True** to allow setting [**FileProperty.Value**](../FileProperty/Value).

**OpenFile** creates a Virtual-COM object in memory and returns a [**FileProperties**](../FileProperties/FileProperties) collection for the specified file. The collection contains one [**FileProperty**](../FileProperty/FileProperty) entry for each shell property handler the operating system exposes for that file. Common examples include audio duration on MP3 files, EXIF fields on JPEG images, and extended metadata on Office documents.

The *FilePath* argument must refer to an existing file. If the path is invalid or the file cannot be opened, the underlying COM object raises a runtime error.

Write support requires Windows Vista or later. On Windows XP and Windows 2000, the collection is always read-only regardless of the *WriteSupport* argument.

### Example

This example opens an MP3 file and prints all its shell properties to the Debug console.

```tb
Dim Props As FileProperties
Set Props = FilePropertyExplorer.OpenFile("C:\Music\track.mp3")

Debug.Print "File: " & Props.FilePath
Debug.Print "Properties: " & Props.Count

Dim i As Long
For i = 0 To Props.Count - 1
    Dim Prop As FileProperty
    Set Prop = Props.Item(i)
    Debug.Print Prop.NameDesc & " = " & Prop.ValueDesc
Next i
```

### See Also

- [FilePropertyExplorer](FilePropertyExplorer) class -- the predeclared factory class
- [BrowseAndOpenFile](BrowseAndOpenFile) function -- displays a file-open dialog and returns a **FileProperties** collection
- [FileProperties](../FileProperties/FileProperties) class -- the collection returned by this function
- [FileProperty](../FileProperty/FileProperty) class -- a snapshot of one shell property in the collection
