---
name: DeviceHealthStrip sensor/camera chip visibility
description: Why peripheral sensor chips in the mobile capture viewfinder must be filtered to "actively connected" rather than "registered", and how to avoid a stale-async-response race in that filtering
---

`artifacts/readyloq-app/lib/platform/device-plugin.ts` registers all 5 BLE
sensor providers (moisture/Protimeter, laser/Bosch GLM, temperature+humidity,
CO2, acoustic) into the DeviceRegistry unconditionally at app startup, in a
disconnected state — they only pair on demand from the Connections tab /
DeviceScannerModal.

**Why this matters:** `registry.findByCategory("sensor")` therefore always
returns all 5 providers regardless of whether the technician has ever
connected one. Any UI that renders a chip per item in that list (e.g.
`DeviceHealthStrip`) will show every peripheral all the time unless it
explicitly filters by live connection status (`getStatus().connection.state
=== "connected" | "paired"`), not just registration.

**How to apply:** When adding/adjusting hardware-status UI in the capture
viewfinder, always filter to actively-connected (or errored) devices before
rendering a chip — never assume "registered" implies "in use". The
`media-import` camera provider has a similar quirk: its `getStatus()` always
reports `connection.state: "connected"`, so any unfiltered camera chip list
will show it permanently too (tracked as a follow-up, not yet fixed).

## Async event-driven status refresh needs a sequence guard

`DeviceHealthStrip`'s multi-provider hook (`useActiveOnlySlots`) re-fetches
`provider.getStatus()` on every "device.connected"/"device.disconnected"
event rather than trusting the event payload. Two overlapping `getStatus()`
calls for the same provider (e.g. the mount-time probe and an event fired
moments later) are not guaranteed to resolve in request order — whichever
resolves LAST wins and can silently overwrite fresher state with stale data
(a just-connected chip flipping back to hidden, or vice versa).

**Why this matters:** today's concrete BLE sensor providers wrap a synchronous
property read in an `async` function, so in practice resolution order happens
to match call order — but that's an implementation accident, not a guarantee,
and any future provider with real I/O in `getStatus()` (network call, actual
hardware round-trip) would hit this for real.

**How to apply:** any per-provider async refresh triggered by multiple
overlapping events must carry a monotonically increasing per-provider
request-sequence counter, and discard a response whose sequence number is no
longer current before calling `setState`. See the guard in
`useActiveOnlySlots` (`requestSeq` map) for the pattern, and
`components/__tests__/device-health-strip-sensor-race.test.ts` for a
regression test that fails without the guard (drive two overlapping
`getStatus()` calls with deferred promises and resolve them out of order).
