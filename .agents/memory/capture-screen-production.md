---
name: Capture screen production wiring
description: What was wired into new-inspection.tsx for production readiness — device health, guidance, sensors, permission recheck
---

## What was done

**New files:**
- `artifacts/readyloq-app/components/DeviceHealthStrip.tsx` — compact strip showing WiFi camera + sensor health; renders null when only native camera is registered (no UI noise for basic inspections)
- `artifacts/readyloq-app/hooks/useSmartGuidance.ts` — photo-count + idle-time based guidance hook; evaluates every 15s; photo-type thresholds vary by property type (residential/commercial/industrial)

**Changes to `artifacts/readyloq-app/app/(app)/new-inspection.tsx`:**
- Added `AppState` listener (Task #36) — on foreground, calls `requestPermission()` silently to refresh permission state so CameraView unmounts before it can throw
- Added `useSmartGuidance` hook call early in component body
- Added photo-length effect that calls `guidance.notifyCapture(uri)` to track idle time
- Added `DeviceHealthStrip` + guidance banner to widescreen camera pane (below zoomChips)
- Added `MeasurementDevicePanel` to widescreen right panel (Co-Pilot mode, below bait stations)
- Added guidance banner + `DeviceHealthStrip` to phone portrait bottom controls
- Added `MeasurementDevicePanel` to phone Co-Pilot bottom sheet (42% height overlay)

## Key rules

**Why:** DeviceHealthStrip hides itself when only native camera registered — keeps basic inspection UI clean. Only surfaces when supplemental cameras (WiFi) or BLE sensors are active.

**AppState permission recheck:** `requestPermission()` is safe to call silently — if permission is already granted it returns status; if blocked by OS it throws (caught and ignored); `permission.granted` then updates via hook reactivity.

**useSmartGuidance upgrade path:** The hook return shape is designed to be swappable with `session.snapshot().guidance` from a live SmartVisionSession once native frame processing is available (react-native-vision-camera or periodic base64 capture at 1 FPS).

## Expo ENOSPC fix

When Metro hits "System limit for number of file watchers reached":
1. `rm -rf artifacts/readyloq-app/.expo`
2. `rm -rf node_modules/.cache`
3. Restart Expo Dev Server workflow
Cannot increase inotify limit (permission denied in sandbox). The TS cache was the main culprit.
