---
title: FileProperty
parent: FileProps Package
permalink: /tB/Packages/Contributed/FileProps/FileProperty/FileProperty
has_toc: false
---

# FileProperty class
{: .no_toc }

A **FileProperty** represents one Windows shell property attached to a file --- its system name, localized name, unique ID, and current value.

**FileProperty** objects are not created directly. They are returned as items from the [**FileProperties**](../FileProperties/FileProperties) collection, which is obtained by calling [**FilePropertyExplorer.OpenFile**](../FilePropertyExplorer/OpenFile) or [**FilePropertyExplorer.BrowseAndOpenFile**](../FilePropertyExplorer/BrowseAndOpenFile).

```tb
Dim Props As FileProperties
Set Props = FilePropertyExplorer.OpenFile("C:\Photos\image.jpg")

Dim Prop As FileProperty
Set Prop = Props.Item(1)

Debug.Print Prop.Name       ' e.g. "System.ItemFolderNameDisplay"
Debug.Print Prop.ValueDesc  ' e.g. "Photos"
```

* TOC
{:toc}

## Properties

### ID
{: .no_toc }

A unique identifier string for the shell property.

Syntax: *object*.**ID** **As String** (read-only)

The identifier consists of a GUID identifying the property schema, followed by an integer identifying the property index within that schema --- for example, `"{D5CDD505-2E9C-101B-9397-08002B2CF9AE}, 2"`. This value is stable across locales and Windows versions and can always be used to refer to a specific property unambiguously.

### Name
{: .no_toc }

The system identity name of the property.

Syntax: *object*.**Name** **As String** (read-only)

Returns a canonical name such as `"System.ItemFolderNameDisplay"` or `"System.Media.Duration"`. This name is locale-independent and suitable for use as a stable identifier. For the localized display name, use [**NameDesc**](#namedesc).

### NameDesc
{: .no_toc }

The localized display name of the property.

Syntax: *object*.**NameDesc** **As String** (read-only)

Returns the human-readable name as it appears in the Windows shell for the current UI locale --- for example, `"Folder name"` or `"Length"`. This name is not always available; when the shell does not provide a localized name, the property returns an empty string. Use [**Name**](#name) for a locale-independent identifier.

### Value
{: .no_toc }

The current value of the shell property as a **Variant**.

Syntax: *object*.**Value** [ **=** *value* ]

Reading this property returns the raw value for the property as exposed by the operating system shell. The type of the returned **Variant** depends on the property --- most are **String** or **Long**, but multi-value properties return an array.

Assigning a value writes back to the shell property store. Write support requires Windows Vista or newer; on Windows XP and Windows 2000, a write attempt raises run-time error 70 (*Permission denied*). On Vista and newer, write access also depends on the file not being read-only and the property being writable in its schema --- properties marked read-only by the schema always raise run-time error 70 regardless of the OS version.

> [!NOTE]
> Multi-value properties return a **Variant** array. Check `IsArray(Prop.Value)` before using the result as a scalar.

For a string representation of the value formatted for the current locale, use [**ValueDesc**](#valuedesc).

### ValueDesc
{: .no_toc }

The current value of the property as a localized string.

Syntax: *object*.**ValueDesc** **As String** (read-only)

Returns the property value already formatted for the current UI locale and combined into a single string. Multi-value properties that would return an array from [**Value**](#value) are already concatenated here. For example, an audio duration stored internally as a tick count is returned here as `"0:03:45"`.

Use this property when displaying values to an end user. Use [**Value**](#value) when the raw typed value is needed for computation or comparison.

### VCOMObject
{: .no_toc }

Holds the native-code COM object created internally by the Virtual-COM library.

Syntax: *object*.**VCOMObject** **As Object**

> [!WARNING]
> This member is for internal use only. Do not read or assign **VCOMObject** from application code. All public members of **FileProperty** delegate to it automatically.

## Example

This example opens a file and prints the system name, localized description, and value for each shell property.

```tb
Sub PrintFileProperties(ByVal FilePath As String)
    Dim Props As FileProperties
    Set Props = FilePropertyExplorer.OpenFile(FilePath)

    Dim i As Long
    For i = 1 To Props.Count
        Dim Prop As FileProperty
        Set Prop = Props.Item(i)
        Debug.Print Prop.Name & " (" & Prop.NameDesc & "): " & Prop.ValueDesc
    Next i
End Sub
```

## See Also

- [FileProperties](../FileProperties/FileProperties) class -- the collection that contains **FileProperty** objects
- [FilePropertyExplorer](../FilePropertyExplorer/FilePropertyExplorer) class -- the factory that opens a file and returns a **FileProperties** collection
- [FileProps Package](../) package -- overview and usage
