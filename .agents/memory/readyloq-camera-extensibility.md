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
- **The real gap is interaction model, not the contract.** Current `VisionProvider.capture()
  : Promise<EvidenceItem[]>` is pull / request-response (fits phone + library import + USB/WiFi
  *still* grabs). Glasses and drone are **async-push / session-oriented**: evidence arrives
  later, out of band, possibly while the capture screen is unmounted. That needs (a) a
  capability-typed provider (request_response | session_stream | async_push), (b) an
  EvidenceIntake sink so sources can push evidence without the screen awaiting a call,
  (c) session/connection lifecycle owned OUTSIDE the screen (like the sync engine), and
  (d) a provider registry with per-transport availability probing + a preview-surface
  descriptor (native_camera | stream_url | none) instead of hardcoded `useMemo` providers.
- **External transports break the pure-JS / Route A / standalone-portable rules.** USB-OTG
  UVC, BLE glasses SDKs, WiFi/RTSP, and drone SDKs all require custom native modules /
  config plugins + a dev client — they canNOT be pure-JS and won't run in Expo Go. The JS
  abstraction can be built + unit-tested now with mock providers; real hardware is a later,
  native-build tier. Keep intake/registry/session logic pure-JS; keep transport drivers
  isolated behind the capability interface.
- **Streaming sources must throttle + downscale at intake.** A live USB/WiFi/drone feed can
  flood intake; sample on-demand / N-fps and downscale to a max edge before persist (ties to
  the "resize before upload/AI" lever in readyloq-scalability-risks.md).
