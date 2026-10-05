# Official Meta camera integration

This document concerns the main Pest Insight/ReadyLoq app in `artifacts/readyloq-app`.
Do not copy the separate `readyloq-mobile` starter or create another DAT bridge.

## Pinned contract

Keep `mwdat-core` and `mwdat-camera` at **0.9.0** together. The verified official
0.9-era sample uses `Wearables.createSession`, `DeviceSession.start`,
`DeviceSession.addCamera`, `Camera.stream.start`, and `Stream.capturePhoto`.
Photos are `PhotoData.Bitmap` or `PhotoData.HEIC`. A new stream initially emits
`STOPPED`; this must not be treated as a disconnect before startup begins.
Camera and session lifecycle are distinct. `Camera.close()` detaches the camera
in the official sample; stopping a stream alone leaves the capability attached.

Sources reviewed:
- [Official 0.9.0 changelog](https://github.com/facebook/meta-wearables-dat-android/blob/main/CHANGELOG.md)
- [Version-matched camera sample](https://github.com/facebook/meta-wearables-dat-android/blob/81dfb51b9be26de5cd262bb1dcbb4b8d0d6bd2bc/samples/CameraAccess/app/src/main/java/com/meta/wearable/dat/externalsampleapps/cameraaccess/camera/CameraViewModel.kt)
- [Version-matched setup](https://github.com/facebook/meta-wearables-dat-android/blob/81dfb51b9be26de5cd262bb1dcbb4b8d0d6bd2bc/plugins/mwdat-android/skills/getting-started/SKILL.md)

Android minimum API is **31** in both Expo and checked-in native configuration,
matching that official sample. Expo SDK remains 54; no SDK upgrade is needed.

## Configuration and build ownership

The callback filter is `readyloq://mwdat`. Confirm this callback and
`com.hgwashingllc.readyloqmobile` against the intended app in Meta's developer
configuration; matching source alone does not establish dashboard ownership.
Application ID and client token are injected as Gradle string resources.
The Expo manifest plugin must never serialize their values into source.
Developer Mode can use `0` placeholders; release tasks reject those placeholders.
SDK dependency retrieval requires the configured GitHub Packages credential.

The checked-in Android project contains the bridge, package registration,
initialization, permission launcher, SDK dependencies and resources. The manifest
plugin preserves manifest entries only. **Do not run clean Expo prebuild and
assume it recreates those native changes.** Build this native project directly.
Custom DAT native changes cannot be delivered solely through OTA or Expo Go.

## Capture ownership

Only the active inspection consumes native capture events. DAT photos become
`EvidenceItem` objects with `source: smart_glasses`, original capture time and
explicit DAT transport metadata. They enter the existing `ingestEvidence` queue,
durable local inspection storage, offline sync, authorized media registration,
analysis and reporting. No DAT-specific upload or analysis service is used.

Repeated events are deduplicated. Cache deletion follows durable intake only;
failed intake retains the file. Sessions release on background or inspection
unmount; late native captures are cancelled rather than attached to a later
inspection. Foreground refresh reads actual Meta registration/permission state.
There is no background DAT streaming service in this integration.

Custom BLE/GATT glasses and the optional cloud/webhook relay remain separate
mechanisms. Neither is the official consumer Meta DAT camera transport.

## Device validation

Workspace verification on 2026-10-04:
- Mobile TypeScript: passed.
- Focused DAT, configuration and sync suites: 98 tests passed.
- Native DAT contract: 4 tests passed, no failures/errors.
- `:app:assembleDebug :app:testDebugUnitTest`: BUILD SUCCESSFUL.
- APK package: `com.hgwashingllc.readyloqmobile`; min API 31, target API 36,
  native ABI `arm64-v8a`.
- Browser preview: blocked by the separate custom BLE manager trying to create
  a native client on web. It does not establish DAT or native-device acceptance.
- No connected phone/glasses: registration, Developer Center callback ownership,
  capture, disconnect/resume and actual offline synchronization remain device gates.

A debug development-client APK requires Metro for the current JavaScript.
It retains the existing application ID. A differently signed installed build
may reject an in-place install; do not uninstall a working app while it holds
unsynced inspections. Use a test device or confirm evidence is safely synced first.
On supported physical glasses and an Android phone with Meta's companion app:
1. Enable authorized Developer Mode; register the app and approve camera access.
2. Start a session and wait for actual `STREAMING`, then capture a real photo.
3. Verify its thumbnail, durable local file, timestamp and DAT source metadata.
4. Capture offline, restore network, and verify normal media sync/analysis.
5. Exercise denial, glasses disconnect, background/resume and inspection exit.
6. Confirm no duplicate, lost, or cross-inspection evidence; phone capture still works.

Unit tests and a compiled APK do not establish physical-device acceptance.