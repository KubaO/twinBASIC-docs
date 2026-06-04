---
title: BrowseAndOpenFile
parent: FilePropertyExplorer
has_toc: false
permalink: /tB/Packages/FileProps/FilePropertyExplorer/BrowseAndOpenFile
---
# BrowseAndOpenFile
{: .no_toc }

Displays a file-open dialog and returns a **FileProperties** collection for the file the user selects.

Syntax: *object*.**BrowseAndOpenFile** [ (*WriteSupport*) ]

*object*
: *required* An object expression that evaluates to a **FilePropertyExplorer** object. The predeclared default instance is available as `FilePropertyExplorer`.

*WriteSupport*
: *optional* A **Boolean** that controls whether the returned **FileProperties** collection is opened with write access to property values. **False** (default) opens in read-only mode. Pass **True** to allow setting [**FileProperty.Value**](../FileProperty/Value).

**BrowseAndOpenFile** presents the standard Windows file-open dialog. If the user selects a file and confirms, the function returns a [**FileProperties**](../FileProperties/FileProperties) collection for that file. If the user cancels the dialog, the function returns **Nothing**.

The file is opened through the same Virtual-COM path as [**OpenFile**](OpenFile). The returned collection contains one [**FileProperty**](../FileProperty/FileProperty) entry for each shell property handler the operating system exposes for the selected file.

### Example

This example uses **BrowseAndOpenFile** to let the user pick a file and then prints all its shell properties to the Debug console.

```tb
Dim Props As FileProperties
Set Props = FilePropertyExplorer.BrowseAndOpenFile()

If Props Is Nothing Then
    Debug.Print "No file selected."
Else
    Debug.Print "File: " & Props.FilePath
    Dim i As Long
    For i = 0 To Props.Count - 1
        Dim Prop As FileProperty
        Set Prop = Props.Item(i)
        Debug.Print Prop.NameDesc & " = " & Prop.ValueDesc
    Next i
End If
```

### See Also

- [FilePropertyExplorer](FilePropertyExplorer) class -- the predeclared factory class
- [OpenFile](OpenFile) function -- opens a file by path and returns a **FileProperties** collection
- [FileProperties](../FileProperties/FileProperties) class -- the collection returned by this function
- [FileProperty](../FileProperty/FileProperty) class -- a snapshot of one shell property in the collection
