---
title: cListboxHScroll
parent: TBMANLIB_ListBoxHScroll Package
permalink: /tB/Packages/Contributed/TBMANLIB_ListBoxHScroll/cListboxHScroll
has_toc: false
---

# cListboxHScroll class
{: .no_toc }

A helper class that adds a functional horizontal scrollbar to a standard VB **ListBox** control by combining the `LB_SETHORIZONTALEXTENT` message, Win32 scroll-info APIs, and window subclassing.

The class measures the pixel width of each list item using GDI's `GetTextExtentPoint32W`, sets the scroll range to fit the widest item, and installs a subclass procedure to intercept `WM_HSCROLL` messages so the scrollbar thumb tracks correctly. Call [**Show**](#show) after populating the list and [**UnShow**](#unshow) (or allow the class instance to go out of scope) when the scrollbar is no longer needed.

```tb
Private HScroll As New cListboxHScroll

Private Sub Form_Load()
    List1.AddItem "A short item"
    List1.AddItem "A much longer item that overflows the default width"
    HScroll.Show List1
End Sub

Private Sub Form_Unload(Cancel As Integer)
    HScroll.UnShow
End Sub
```

* TOC
{:toc}

## Methods

### Show
{: .no_toc }

Activates horizontal scrolling on a **ListBox** control.

Syntax: *object*.**Show** *ListBoxInst*

*ListBoxInst*
: *required* An **Object** reference to the **ListBox** control to instrument. The control must already have its items populated; **Show** measures the text width of every item at call time to compute the scroll range.

**Show** performs three operations in sequence:

1. Calls the Win32 `ShowScrollBar` API to make the horizontal scrollbar visible.
2. Iterates every list item, measures its pixel width using the GDI device context of the control, and sends `LB_SETHORIZONTALEXTENT` with the widest measurement plus a 10-pixel margin. It also calls `SetScrollInfo` to set the scroll range and page size so the scrollbar thumb reflects the visible proportion of the content.
3. Installs a window subclass procedure via `SetWindowSubclass` (comctl32) to intercept `WM_HSCROLL` messages. The subclass updates the scroll position on line-left / line-right (20 px per step), page-left / page-right, and thumb-track / thumb-position scrolls, then passes control to `DefSubclassProc`.

The scroll range is calculated from the widest item's pixel width measured against the control's own font (retrieved with `WM_GETFONT`), so the extent is accurate even when the **ListBox** uses a non-default font.

> [!NOTE]
> **Show** measures item widths at the moment it is called. If items are added or removed after **Show**, the scroll range is not updated automatically. Call **Show** again after bulk changes to refresh the extent.

> [!IMPORTANT]
> The control's **hWnd** must be valid (the form must be loaded and the control fully created) before calling **Show**. Calling **Show** before the control's window exists returns silently without installing any scrolling behavior.

### UnShow
{: .no_toc }

Removes the window subclass installed by [**Show**](#show).

Syntax: *object*.**UnShow**

Calls `RemoveWindowSubclass` to detach the `WM_HSCROLL` handler. After **UnShow** the **ListBox** reverts to its default scrolling behavior (or none, depending on the control's `LB_SETHORIZONTALEXTENT` state set by **Show**). The horizontal extent set by **Show** is not reset; call `SendMessage` with `LB_SETHORIZONTALEXTENT, 0, 0` if clearing it is required.

**UnShow** is also called automatically from `Class_Terminate`, so the subclass is always removed when the **cListboxHScroll** instance is destroyed.

## Example

This example attaches a horizontal scrollbar to a **ListBox** and removes it when the form closes.

```tb
Private WithEvents HScroll As cListboxHScroll

Private Sub Form_Load()
    Set HScroll = New cListboxHScroll

    List1.AddItem "Alpha"
    List1.AddItem "Beta -- a much longer entry that would normally be clipped"
    List1.AddItem "Gamma"

    HScroll.Show List1
End Sub

Private Sub Form_Unload(Cancel As Integer)
    HScroll.UnShow
End Sub
```

## Remarks

**cListboxHScroll** uses window subclassing via the comctl32 `SetWindowSubclass` / `RemoveWindowSubclass` / `DefSubclassProc` API family, which is the recommended approach for subclassing Win32 controls in-process. The subclass is identified by the constant ID `1`; if the same **ListBox** is passed to two separate **cListboxHScroll** instances, both will attempt to install a subclass with the same ID, which is not supported --- use one instance per **ListBox**.

The class stores the **ListBox** reference in a module-level variable (`Ctl`). Replacing the control by calling **Show** with a different **ListBox** does not automatically remove the subclass from the first control; call **UnShow** before switching targets.

## See Also

- [TBMANLIB_ListBoxHScroll](../) package -- overview and installation
