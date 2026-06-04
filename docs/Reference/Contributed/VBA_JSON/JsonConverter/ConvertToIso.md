---
title: ConvertToIso
parent: JsonConverter Module
permalink: /tB/Packages/Contributed/VBA_JSON/JsonConverter/ConvertToIso
has_toc: false
---
# ConvertToIso
{: .no_toc }

Converts a local date to an ISO 8601 date-time string in UTC.

Syntax: **ConvertToIso** ( *utc_LocalDate* )

*utc_LocalDate*
: *required* A **Date** value representing a local date and time.

Returns a **String** in the form `yyyy-mm-ddTHH:mm:ss.000Z` representing the equivalent UTC instant. The milliseconds field is always `000` because VBA's **Date** type does not store sub-second precision.

### Remarks

**ConvertToIso** first converts *utc_LocalDate* from local time to UTC using [**ConvertToUtc**](ConvertToUtc), then formats the result according to ISO 8601. The trailing `Z` suffix indicates the UTC time zone.

This function is used internally by [**ConvertToJson**](ConvertToJson) when it encounters a value of type **vbDate**: every **Date** value in a Dictionary, Collection, or array is serialized as a quoted ISO 8601 string.

On Windows, the UTC offset is read from the system time-zone information via the Win32 `GetTimeZoneInformation` and `TzSpecificLocalTimeToSystemTime` APIs, so the result reflects the current daylight saving time rules of the local machine. On Mac, an equivalent shell command is used.

Raises run-time error 10014 (`"ISO 8601 conversion error"`) if an internal error occurs during conversion.

### Example

This example converts the current local time to an ISO 8601 UTC string.

```tb
Dim IsoString As String
IsoString = JsonConverter.ConvertToIso(Now)
Debug.Print IsoString   ' e.g. "2024-03-15T14:30:00.000Z"
```

This example shows how **ConvertToJson** automatically applies **ConvertToIso** when a **Date** value is in the data being serialized.

```tb
Dim Data As New Dictionary
Data("timestamp") = CDate("2024-03-15 14:30:00")

Dim Json As String
Json = JsonConverter.ConvertToJson(Data)
Debug.Print Json   ' {"timestamp":"2024-03-15T14:30:00.000Z"}
```

### See Also

- [ConvertToUtc](ConvertToUtc) function
- [ParseIso](ParseIso) function
- [ConvertToJson](ConvertToJson) function
