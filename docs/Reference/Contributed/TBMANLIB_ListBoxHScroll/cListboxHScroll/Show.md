---
title: Show
parent: cListboxHScroll
permalink: /tB/Packages/Contributed/TBMANLIB_ListBoxHScroll/cListboxHScroll/Show
has_toc: false
---
# Show
{: .no_toc }

Attaches the horizontal scroll bar to a **ListBox** control and initialises scroll handling.

Syntax: *object*.**Show** *ListBoxInst*

*ListBoxInst*
: *required* An object expression that evaluates to a **ListBox** control. The class holds a reference to this control for the lifetime of the object, or until [**UnShow**](UnShow) is called.

**Show** performs three actions in sequence:

1. Calls the Win32 `ShowScrollBar` API to make the horizontal scroll bar visible on *ListBoxInst*.
2. Iterates every item in the list, measures each item's pixel width using the GDI `GetTextExtentPoint32` API with the control's own font, then sets the horizontal scrollable extent via the `LB_SETHORIZONTALEXTENT` message. A 10-pixel margin is added to the widest item.
3. Installs a window subclass (`SetWindowSubclass` from `comctl32`) on the control's `hWnd` to intercept `WM_HSCROLL` messages and translate them into `SetScrollInfo` / `DefSubclassProc` calls, enabling smooth scrolling behaviour.

After **Show** returns, the **ListBox** scrolls horizontally when any item is wider than the visible area.

> [!IMPORTANT]
> **Show** must be called after the **ListBox** has been populated. If items are added or removed after the call, the horizontal extent is no longer updated automatically. Call **Show** again on the same control to recalculate the extent for the updated item list.

> [!NOTE]
> The subclass installed by **Show** is removed automatically when the class instance is destroyed (`Class_Terminate`). It can also be removed explicitly by calling [**UnShow**](UnShow).

### Example

This example attaches a horizontal scroll bar to a **ListBox** named `List1` after filling it with items.

```tb
Private hScroll As New cListboxHScroll

Private Sub Form_Load()
    List1.AddItem "Short item"
    List1.AddItem "A much longer item that exceeds the visible width of the list box"
    List1.AddItem "Another moderately long entry"

    hScroll.Show List1
End Sub

Private Sub Form_Unload(Cancel As Integer)
    hScroll.UnShow
End Sub
```

### See Also

- [UnShow](UnShow) method
