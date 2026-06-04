---
title: Keys
parent: Dictionary
permalink: /tB/Packages/Contributed/VBA_JSON/Dictionary/Keys
has_toc: false
---
# Keys
{: .no_toc }

Returns all keys stored in the dictionary as a **Variant** array.

Syntax: *object*.**Keys**

*object*
: *required* An object expression that evaluates to a **Dictionary** object.

The property returns a **Variant** containing a zero-based array of **String** values, one entry per key. The order of the entries matches the insertion order of the key-value pairs. If the dictionary is empty, an empty array is returned.

### Example

This example iterates over the keys of a dictionary built from a JSON object.

```tb
Dim Dict As Dictionary
Set Dict = New Dictionary
Dict("name") = "Alice"
Dict("age")  = 30

Dim k As Variant
For Each k In Dict.Keys
    Debug.Print k & " => " & Dict(k)
Next k
' Output (insertion order):
'   name => Alice
'   age  => 30
```

### See Also

- [Item](Item) property
