---
name: Co-Pilot animation and hardware camera patterns
description: Durable decisions for CameraView zoom animation and external camera providers
---

## Smooth CameraView zoom without Reanimated animated props
Drive `CameraView zoom=` via `requestAnimationFrame` + `useState`, not `useSharedValue`/`useAnimatedProps`.
CameraView does not support animated props, so the rAF loop calling `setState` every frame is the right pattern.
Track the running value in a `ref` so new AI commands lerp from the actual current position, not the last discrete chip value.
Cancel any in-flight frame before starting a new animation.

**Why:** Reanimated animated props require the host component to be wrapped in `Animated.createAnimatedComponent`; expo-camera's `CameraView` is not. rAF + setState is lighter and sidesteps the dependency.

## External camera providers: prefer request_response over session_stream
HTTP-still cameras (GoPro, IP cams, anything with a `/snapshot.jpg` endpoint) should be registered as `request_response` mode, not `session_stream`.
Session mode requires implementing the full `CaptureSession` connect/end lifecycle; request mode works directly with the existing capture pipeline.

**Why:** session_stream is only needed for cameras that push a live video stream requiring explicit connect/disconnect lifecycle management.

## ProviderAvailability is a discriminated union — reason required on false branch
`ProviderAvailability = { available: true } | { available: false; reason: string }`.
The `reason` field is **required** (not optional) when `available: false`. A probe function returning `{ available: boolean; reason?: string }` will fail the TS assignability check.

## Express mergeParams router params typing
`Router({ mergeParams: true })` loses parent-segment params in the TS type.
Fix: type each handler as `async (req: Request<ParamsType>, res)` where `ParamsType` maps the merged segment names.
