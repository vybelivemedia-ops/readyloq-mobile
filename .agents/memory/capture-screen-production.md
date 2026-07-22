---
name: Capture screen production wiring
description: What was wired into new-inspection.tsx for production readiness — device health, guidance, sensors, permission recheck
---

## What was done

**New files:**
- `artifacts/readyloq-app/components/DeviceHealthStrip.tsx` — compact strip showing WiFi camera + sensor health; renders null when only native camera is registered (no UI noise for basic inspections)
- `artifacts/readyloq-app/hooks/useSmartGuidance.ts` — photo-count + idle-time based guidance hook; evaluates every 15s; photo-type thresholds vary by property type (residential/commercial/industrial)

**Changes to `artifacts/readyloq-app/app/(app)/new-inspection.tsx`:**
- Added `AppState` listener — on foreground, calls `requestPermission()` silently to refresh permission state so CameraView unmounts before it can throw on mid-inspection revocation
- Added `guidance.notifyCapture(uri)` effect that fires whenever photos.length increases to track idle time
- **Widescreen camera pane**: DeviceHealthStrip + guidance banner below zoom chips
- **Widescreen right panel (Co-Pilot mode)**: MeasurementDevicePanel below bait stations
- **Phone portrait layout**: Guidance banner + DeviceHealthStrip below zoom chips
- **Phone Co-Pilot bottom sheet**: MeasurementDevicePanel section with border separator

## Key rules

**Why:** DeviceHealthStrip hides itself when only native camera registered — keeps basic inspection UI clean. Only surfaces when supplemental cameras (WiFi) or BLE sensors are active.

**AppState permission recheck:** `requestPermission()` is safe to call silently — if already granted it returns status; if blocked by OS it throws (caught and ignored); `permission.granted` then updates via hook reactivity.

**useSmartGuidance upgrade path:** The hook return shape is designed to be swappable with `session.snapshot().guidance` from a live SmartVisionSession once native frame processing is available (react-native-vision-camera or periodic base64 capture at 1 FPS).

## Expo ENOSPC fix

When Metro hits "System limit for number of file watchers reached":
1. `rm -rf artifacts/readyloq-app/.expo`
2. `rm -rf node_modules/.cache`
3. Restart Expo Dev Server workflow
Cannot increase inotify limit (sandbox restriction). Root cause: Metro tries to watch global eas-cli node_modules via the workspace watchFolders setting.

**Permanent fix**: Add `blockList` to `metro.config.js` excluding `$HOME/.config`, `$HOME/.npm`, workspace `.cache`, `.git`, and `.expo` directories. This prevents Metro FallbackWatcher from traversing global npm installations.
