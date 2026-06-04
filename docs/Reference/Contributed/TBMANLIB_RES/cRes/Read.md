---
title: Read
parent: cRes
permalink: /tB/Packages/Contributed/TBMANLIB_RES/cRes/Read
has_toc: false
---
# Read
{: .no_toc }

Loads a resource from the compiled executable into the **cRes** instance.

Syntax: *object*.**Read**( *id*, *Type* ) **As cRes**

*id*
: *required* A **Variant** identifying the resource to load. Pass a numeric **Long** to identify the resource by its integer ID, or a **String** to identify it by name.

*Type*
: *required* A **Variant** identifying the resource type. Pass a numeric **Long** for a predefined resource type (for example, `2` for `RT_BITMAP`), or a **String** for a named custom resource type (for example, `"CUSTOM"`).

**Read** calls the VBA runtime function `LoadResData` with the supplied *id* and *Type* arguments and stores the resulting byte array internally. The method returns the **cRes** instance itself, so calls to the retrieval methods ([**ReturnBytes**](ReturnBytes), [**ReturnString**](ReturnString), [**ReturnHex**](ReturnHex), [**ReturnBase64**](ReturnBase64), [**ReturnPicture**](ReturnPicture)) can be chained directly onto the **Read** call.

> [!IMPORTANT]
> **Read** must be called before any retrieval method. The resource data is not populated at construction time; a retrieval method called without a prior **Read** will operate on an empty byte array and may raise a runtime error.

> [!NOTE]
> `LoadResData` reads resources that were embedded in the compiled executable at build time. It is not available at design time and will fail if called from the IDE before the project has been compiled to a standalone EXE.

### Example

This example loads a custom binary resource by name and retrieves it as a byte array, then loads a bitmap resource by integer ID and assigns it to a **PictureBox**.

```tb
Private Sub Form_Load()
    ' Load a named custom resource and retrieve the raw bytes.
    Dim res As New cRes
    res.Read "CONFIG_DATA", "CUSTOM"
    Dim data() As Byte
    data = res.ReturnBytes()

    ' Load a bitmap resource by integer ID and display it.
    Dim bmpRes As New cRes
    Picture1.Picture = bmpRes.Read(101, 2).ReturnPicture()
End Sub
```

### See Also

- [ReturnBytes](ReturnBytes) method
- [ReturnString](ReturnString) method
- [ReturnHex](ReturnHex) method
- [ReturnBase64](ReturnBase64) method
- [ReturnPicture](ReturnPicture) method
