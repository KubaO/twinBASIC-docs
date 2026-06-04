---
title: NameDesc
parent: FileProperty
has_toc: false
permalink: /tB/Packages/FileProps/FileProperty/NameDesc
---
# NameDesc
{: .no_toc }

Returns the localized display name of the shell property, when one is available.

Syntax: *object*.**NameDesc**

*object*
: *required* An object expression that evaluates to a **FileProperty** object.

Returns a **String** containing the localized name for the property as reported by the Windows shell property handler. This name is suitable for display to the user in the locale of the current system.

Not every shell property has a localized display name. When none is available, **NameDesc** returns an empty string. Use [**Name**](Name) instead when a stable, locale-independent identifier is needed---for example, when storing or comparing property names across systems.

### See Also

- [Name](Name) property
- [ID](ID) property
- [Value](Value) property
- [ValueDesc](ValueDesc) property
- [FileProperty](FileProperty) class
