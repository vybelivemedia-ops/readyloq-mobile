---
name: smart-vision Live Session Engine
description: Design decisions and non-obvious contracts for the LiveSessionEngine pipeline implementation.
---

## Privacy stage design decision

The pipeline's privacy stage calls `PrivacyProvider.detect(frame, request)` directly — it does NOT use `PrivacyEngine` or `PrivacySession`. Consequence: `PipelinePrivacyObjectDetectedEvent.objects` carries `readonly DetectedPrivacyObject[]` (raw per-frame detections, no stable cross-frame `PrivacyObjectId`).

**Why:** The `PrivacySession.feedFrame()` is fire-and-forget (void return). Making the awaitable pipeline wait on a push-model engine would require adding a separate async method to the privacy contracts. Simpler to call the provider directly; `PrivacyEngine` remains available for standalone use when stable IDs are needed.

**How to apply:** If a consumer needs stable `PrivacyObjectId` across frames (e.g. VYBE blur-tracking), wire a standalone `PrivacyEngine` alongside the `LiveSessionEngine` rather than depending on pipeline privacy events.

---

## PrivacyProvider.detect() signature

```typescript
detect(frame: VideoFrame, request: PrivacyDetectionRequest): Promise<PrivacyDetectionResult>
```

`PrivacyDetectionRequest` has **two required fields**: `classes: readonly PrivacyObjectClass[]` and `confidenceThreshold: number`. Pass `classes` derived from `policy.objects.filter(p => p.redact).map(p => p.classId)`.

---

## FramePipeline / FrameDropPolicy name clash in top-level barrel

Both `FramePipeline` and `FrameDropPolicy` exist in `./frame` (old SmartVision frame contracts) AND in `./live-session/*`. To avoid duplicate-identifier TS errors in `src/index.ts`, the live-session versions of these two types are **not** re-exported from the top-level `@platform/smart-vision` barrel. Import them from the sub-path:

```typescript
import type { FramePipeline } from "@platform/smart-vision/live-session";
import type { FrameDropPolicy } from "@platform/smart-vision/live-session";
```

---

## Stage runner key contracts

| Stage | Dep method | Signature note |
|---|---|---|
| detection | `DetectionEngine.detect` | stride-gated via `ctx.isInferenceFrame` |
| tracking | `ObjectTracker.update` | takes `VideoFrame` (not detections) |
| smart_zoom | `SmartZoomController.analyse` | `(primary, all) → ZoomCommand \| null`; `.state` is a readable property |
| scene_memory | `SceneMemory.checkDuplicate` | `(region: BoundingBox, kinds: string[])` — pass full-frame box + `[]` |
| auto_capture | `AutoCaptureEngine.evaluate` | requires `CapturePolicyContext` — skipped if quality or stability stage absent |
