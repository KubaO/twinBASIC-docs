---
title: DisplayInDebugConsole
parent: Example
permalink: /tB/Packages/Contributed/FileProps/Example/DisplayInDebugConsole
has_toc: false
---
# DisplayInDebugConsole
{: .no_toc }

Opens a file and prints all its shell properties to the Debug console.

Syntax: **DisplayInDebugConsole** [ *FilePath* ]

*FilePath*
: *optional* A **String** containing the full path of the file whose shell properties are printed. If omitted, a file-open dialog is displayed so the user can choose a file.

The procedure opens the specified file through **FilePropertyExplorer** and iterates over every property in the returned **FileProperties** collection, printing the system property name and its localized value to the Debug console with `Debug.Print`.

When *FilePath* is omitted, **FilePropertyExplorer.BrowseAndOpenFile** is called instead of **FilePropertyExplorer.OpenFile**, which displays the shell file-open dialog.

### Example

This example prints the shell properties of a specific file by passing a path, then repeats the call without a path to let the user choose a file interactively.

```tb
' Print properties for a known file.
DisplayInDebugConsole "C:\Windows\notepad.exe"

' Print properties for a file chosen via dialog.
DisplayInDebugConsole
```

### See Also

- [Example](Example) module
- [FilePropertyExplorer](../FilePropertyExplorer/FilePropertyExplorer) class
- [BrowseAndOpenFile](../FilePropertyExplorer/BrowseAndOpenFile) method
- [OpenFile](../FilePropertyExplorer/OpenFile) method
- [FileProperties](../FileProperties/FileProperties) class
