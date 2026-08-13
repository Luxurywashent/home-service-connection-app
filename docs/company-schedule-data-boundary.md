# Company Schedule Data Boundary

## Issue

The mobile app contained two calendar routes that could hydrate team lanes from legacy, location-wide sources. The admin schedule preloaded multiple hard-coded city slugs through a global booking endpoint. The alternate schedule queried the copied app's local detailer list and created a synthetic `Unassigned` lane if the returned roster was empty.

This behavior could display team members, shift overlays, jobs, or locations that did not belong to the authenticated JobSync Company.

## Current behavior

For an authenticated JobSync Company session, both calendar routes now suppress the legacy roster and location fetch paths. A Company with no team members receives a clear **No team members yet** state; it receives no team columns, no off-shift overlays, and no synthetic Unassigned column. The city selector was removed from the primary admin calendar.

The next data integration must supply a Company-scoped JobSync roster and Company-scoped job feed before schedule assignment is enabled for a Company with real team members.

## Visual verification

The unauthenticated web preview routes both the direct admin-calendar path and the root path to the native Company login screen. This confirms the route guard remains intact after the schedule changes. The empty-team schedule state requires an authenticated Company session to inspect directly on device.
