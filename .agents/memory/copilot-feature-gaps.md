---
name: Co-Pilot feature gaps
description: Implementation notes for the 4 Co-Pilot feature gaps completed in one session
---

## T001 — Auto-zoom smooth animation
- `handleCopilotZoom` uses `requestAnimationFrame` cubic-ease-out lerp (450 ms) into `setZoom`
- A `zoomRef` tracks the running zoom value so a new AI command lerps FROM wherever the lens is, not from the snapped chip value
- Manual tap calls `cancelAnimationFrame` on any in-flight animation before setting the new value
- `expo-haptics` light impact fires once per AI zoom takeover

**Why:** CameraView zoom prop updates on every render; driving it via rAF state calls gives smooth hardware lens motion without Reanimated animated props.

## T002 — Bait station tracking
- Table: `bait_stations` (companyId, inspectionId, label, locationType, lat/lng text, status enum, notes, lastCheckedAt, createdAt)
- DB pushed with `drizzle-kit push` (no migration files in this project)
- API: `Router({ mergeParams: true })` — must type handlers as `async (req: Request<Params>, res)` to get proper `req.params` types; plain `req.params.x` is `{}` without this
- Bait station panel lives in Co-Pilot overlay (wide + narrow) as a collapsible accordion below CoPilotHUD

## T003 — Offline/local AI
- `useNetworkStatus` hook: `NetInfo.addEventListener` + initial `NetInfo.fetch()`, returns `{ isConnected, isInternetReachable }`
- NetInfo was already wired into the sync engine (try/catch require pattern in `engine.ts`)
- LocalWhisperProvider was already the default speech provider — no change needed
- Offline banner rendered in capture UI when `isConnected` is false

## T004 — Wi-Fi camera provider
- `ProviderAvailability` is a discriminated union `{ available: true } | { available: false; reason: string }` — `reason` is required (not optional) on the false branch
- wifi-camera-provider.ts: HTTP GET probe (3 s AbortController), Blob → FileReader → dataURL capture
- GoPro detected by `10.5.5.9` in URL; generic cameras use `/snapshot.jpg`
- Mode changed from `session_stream` to `request_response` — far simpler, works with existing capture pipeline without implementing CaptureSession

**How to apply:** Any future external camera using HTTP stills should use `request_response` mode unless true live streaming is needed.
