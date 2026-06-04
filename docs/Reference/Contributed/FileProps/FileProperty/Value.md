---
title: Value
parent: FileProperty
has_toc: false
permalink: /tB/Packages/FileProps/FileProperty/Value
---
# Value
{: .no_toc }

Returns or sets the current value of the Windows shell property as a **Variant**.

## Get

Returns a **Variant** containing the current value of the shell property.

Syntax: *object*.**Value**

*object*
: *required* An object expression that evaluates to a **FileProperty** object.

The returned value reflects the raw shell property data. For most properties this is a scalar value such as a **String**, **Long**, or **Date**. For multi-value properties---such as a list of keywords or authors---the return is an array of **Variant**.

To obtain a pre-formatted, localized string representation of the same data, use [**ValueDesc**](ValueDesc) instead.

## Let

Sets the current value of the shell property.

Syntax: *object*.**Value** **=** *value*

*value*
: A **Variant** containing the new value for the property. The type must be compatible with the property's underlying shell schema.

> [!IMPORTANT]
>
> Write support requires Windows Vista or newer. Attempting to assign **Value** on Windows XP or Windows 2000 has no effect. On Vista and later, assigning a property that the shell marks as read-only raises a Permission Denied run-time error.

### Remarks

Not all shell properties are writable. The shell property system controls write access per-property. Before assigning **Value**, open the file with write support enabled by passing **True** as the second argument to [**FilePropertyExplorer.OpenFile**](../FilePropertyExplorer/OpenFile).

### Example

This example opens a file, reads the **System.Title** property, then updates it.

```tb
Dim Props As FileProperties
Set Props = FilePropertyExplorer.OpenFile("C:\Documents\Report.docx", True)

Dim Prop As FileProperty
Set Prop = Props.Item("System.Title")

Debug.Print "Current title: " & Prop.Value

Prop.Value = "Annual Report 2025"
Debug.Print "Updated title: " & Prop.Value
```

### See Also

- [ValueDesc](ValueDesc) property
- [Name](Name) property
- [ID](ID) property
- [FileProperty](FileProperty) class
