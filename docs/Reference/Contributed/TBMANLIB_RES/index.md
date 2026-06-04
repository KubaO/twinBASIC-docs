---
title: TBMANLIB_RES Package
nav_order: 1
has_children: true
permalink: /tB/Packages/Contributed/TBMANLIB_RES/
indexed_from: 1.0.0.0
---

# TBMANLIB_RES Package

A twinBASIC package for loading binary resources embedded in a compiled executable and converting them to bytes, strings, hex, Base64, or pictures.

## Classes

- [cRes](cRes/cRes.md) -- loads a binary resource from the compiled executable and converts it to bytes, a string, hex, Base64, or a picture.

## Modules

- [TBMAN](TBMAN/TBMAN.md) -- exposes a pre-instantiated `cRes` object as a public variable, providing package-wide access to resource loading without requiring a separate instance.

## Enumerations

- [Base64Prefix](Base64Prefix.md) -- specifies whether, and with what MIME type, a data URI prefix is prepended to the Base64 string returned by `ReturnBase64`.

## Methods (cRes)

- [Read](cRes/Read.md) -- loads a resource from the compiled executable into the `cRes` instance.
- [ReturnBase64](cRes/ReturnBase64.md) -- returns the resource bytes as a Base64-encoded string, with an optional MIME-type data-URI prefix.
- [ReturnBytes](cRes/ReturnBytes.md) -- returns the raw byte array loaded from the resource file.
- [ReturnHex](cRes/ReturnHex.md) -- returns the loaded resource bytes as an uppercase hex string, with an optional separator between each byte and an optional line-break interval.
- [ReturnPicture](cRes/ReturnPicture.md) -- returns the loaded resource bytes as an `IPictureDisp` object.
- [ReturnString](cRes/ReturnString.md) -- returns the loaded resource bytes as a `String`, with an optional character-set conversion.
