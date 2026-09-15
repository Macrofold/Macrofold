# Dashboard navigation layout

The desktop navigation supports an expanded sidebar and a compact icon rail. The collapse button sits beside the Macrofold logo. The icon rail keeps the same links and account menu; each link has an accessible name and a tooltip on hover or keyboard focus. Icons make a brief gesture on pointer hover or keyboard focus, then settle; leaving and re-entering replays it. The account menu’s Play/Pause animations choice controls these gestures. Playback defaults on and overrides the system Reduce Motion preference; pausing keeps ordinary color feedback without moving the icon. Navigation scrolls independently while the account, organization, appearance, and playback controls remain at the bottom.

## Resizing and preferences

Drag the expanded sidebar's right edge to adjust its width between 220 and 360 pixels. The default width is 234 pixels, and the collapsed rail is 64 pixels. Focus the resize handle with the keyboard to use:

- Left or right arrow: adjust by 16 pixels.
- Shift and an arrow: adjust by 64 pixels.
- Home or End: select the minimum or maximum width.
- Double-click: restore the default width.
- Escape during a drag: cancel the drag and restore its starting width.

The resize handle announces its current width and limits. Pointer capture keeps a drag active when the pointer leaves the handle, and pointer cancellation releases the temporary cursor and text-selection lock.

Width and collapse choices are stored as browser preferences under `macrofold.navigation.width` and `macrofold.navigation.collapsed`. They persist across navigation and refresh and synchronize with other tabs on the same origin. A malformed value falls back to the default; blocked preference storage still permits changes on the current page. Collapsing preserves the expanded width for the next expansion. These preferences contain no account or workspace data.

At viewport widths of 760 pixels or less, navigation uses a full 234-pixel drawer regardless of desktop preferences. The collapsed rail and resize handle are unavailable on mobile. Closing the drawer makes its controls inert; opening it restores the full navigation and bottom account menu. Desktop preferences return when the viewport becomes wider.

## Implementation and verification

The persistent [shell](../../../apps/web/components/shell.tsx) owns collapse state and navigation layout. [useResizablePanel](../../../apps/web/lib/use-resizable-panel.ts) shares pointer capture, keyboard resizing, safe width preferences, and cancellation behavior with other left panes. It returns the current width, a setter, resizing state, and separator props; callers supply the accessible name, controlled region, and layout placement. Resizing and collapsing update presentation without replacing page content or changing the authorized organization, identity cache, or sign-out flow.

[Sidebar browser acceptance](../../../tests/browser/sidebar-layout.spec.ts) covers collapse, keyboard tooltips, links, account menus, width limits, pointer cancellation, persistence, cross-tab collapse synchronization, unavailable storage, both themes, mobile layout, and WCAG A/AA audits. The shared isolated dashboard runner owns execution alongside existing account-menu and project-editor tests.
