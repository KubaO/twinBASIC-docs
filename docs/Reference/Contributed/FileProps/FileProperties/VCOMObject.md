---
title: VCOMObject
parent: FileProperties
has_toc: false
permalink: /tB/Packages/FileProps/FileProperties/VCOMObject
---
# VCOMObject
{: .no_toc }

Holds the native-code COM object created internally by the Virtual-COM library. For internal use only.

> [!WARNING]
>
> **VCOMObject** is an internal implementation detail of the FileProps Virtual-COM loader. Reading or writing this field from outside the class will corrupt the object's state and may cause a crash. Do not use it in application code.

Syntax: *object*.**VCOMObject**

*object*
: *required* An object expression that evaluates to a **FileProperties** object.

The **FileProps** package is a Virtual-COM library. It creates native-code x86 COM objects in memory without a separate DLL. **VCOMObject** is the raw **Object** reference to that in-memory COM object; the **FileProperties** class delegates all its property implementations (**Count**, **FilePath**, **Item**) to it. The field is marked with `VB_VarUserMemId = -4`, which designates it as the default collection object in the COM type information.

This field has no documented interface and no stable contract outside the library. Use **Count**, **FilePath**, and **Item** to access file properties.

### See Also

- [FileProperties](FileProperties) class
- [Count](Count) property
- [FilePath](FilePath) property
- [Item](Item) property
