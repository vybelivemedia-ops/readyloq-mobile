---
name: ReadyLoq camera/vision extensibility
description: How the on-device capture layer is meant to extend to new camera sources, and where the real architectural gap is
---

# Camera source extensibility (mobile lib/vision)

The capture layer is ALREADY a funnel, not a monolith. Respect these when adding sources.

- **`EvidenceItem` (lib/vision/types.ts) is the universal contract — do NOT bypass it.**
  Every source normalizes to `{ uri, source, capturedAt, width?, height?, fileSize?, metadata? }`
  and everything downstream (dedupe dHash, quality-gate, pixels, inspection-store, sync
  engine, server `/analysis/analyze`) is already source-agnostic. New devices normalize
  INTO EvidenceItem; downstream code should need zero changes.
- **`CaptureSource` union + DB columns are pre-reserved.** `phone_camera | media_import |
  wifi_stream | usb_camera | smart_glasses` plus `inspection_media.capture_source` /
  `capture_metadata` already exist, and `describeCaptureSource` has a FALLBACK — so adding
  a source needs NO migration and NO display crash. Extend the union + INFO map only.
- **The capability abstraction is now IMPLEMENTED (pure-JS, no hardware).** `types.ts`
  defines `CaptureMode` (request_response | session_stream | async_push), the provider
  interfaces (Request/Session/Push), and an `EvidenceIntake` sink so sources can push
  evidence without the screen awaiting a call. `provider-registry.ts` is the plug-in point
  (register/probe/create + `PreviewKind` = native_camera | stream_url | none); the screen
  resolves providers via `getRequestProvider(...)` instead of hardcoded `useMemo`.
  `future-source-providers.ts` holds reserved glasses/USB/WiFi/wearable definitions
  (`probe` = unavailable, `create` throws). **To add a real camera: replace one
  definition's `probe`/`create` — nothing downstream of `EvidenceItem` changes.**
- **Still NOT built (needs a dev-client / native tier).** The session/push *connection
  lifecycle* (owned outside the screen, like the sync engine) and the actual transport
  drivers (USB-OTG UVC, BLE glasses, WiFi/RTSP, drone SDKs) are deliberately unbuilt —
  the charter says don't integrate hardware unless required. The interfaces are ready.
- **External transports break the pure-JS / Route A / standalone-portable rules.** USB-OTG
  UVC, BLE glasses SDKs, WiFi/RTSP, and drone SDKs all require custom native modules /
  config plugins + a dev client — they canNOT be pure-JS and won't run in Expo Go. The JS
  abstraction can be built + unit-tested now with mock providers; real hardware is a later,
  native-build tier. Keep intake/registry/session logic pure-JS; keep transport drivers
  isolated behind the capability interface.
- **Streaming sources must throttle + downscale at intake.** A live USB/WiFi/drone feed can
  flood intake; sample on-demand / N-fps and downscale to a max edge before persist (ties to
  the "resize before upload/AI" lever in readyloq-scalability-risks.md).
