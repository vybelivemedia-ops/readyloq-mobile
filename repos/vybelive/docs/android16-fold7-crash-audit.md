# Android 16 / Galaxy Z Fold 7 Launch-Crash Audit

**Date:** 2026-07-08
**Symptom:** App exits instantly on launch on Samsung Galaxy Z Fold 7 (Android 16 / One UI 8). No UI renders. System shows "VYBE LIVE closed because this app has a bug."
**Scope:** Both v0.9.18 (build fc072ec2, commit 287f4632) and v0.9.19 (build cccc64fc, commit 28d6ed3) crash identically → **NOT a regression between builds**. This is an Android 16 / device compatibility issue present in all existing builds.

## Forensic comparison of the two APKs (downloaded from EAS, inspected byte-level)

| Layer | Result |
|---|---|
| Native libs (51 × `.so`, arm64-v8a) | **Byte-identical** between builds |
| ELF LOAD alignment (all segments, all libs) | **All 0x4000 (16 KB)** — fully compliant, incl. all Agora libs |
| Zip entry alignment (stored `.so`, `extractNativeLibs=false`) | All 16 KB-aligned, none compressed |
| AndroidManifest | Identical except versionName/versionCode; targetSdk 36, compileSdk 36 |
| React / react-native-renderer versions | Identical (19.1.0) in both bundles |
| Dependency resolution (lockfile at both commits) | agora 4.5.4, all expo-* identical |
| OTA / expo-updates | `ENABLED=false` in manifest; zero updates published — ruled out |
| Firebase | Not present in dex — ruled out |
| ContentProviders | Standard only: ML Kit init, androidx.startup (EmojiCompat, ProcessLifecycle, ProfileInstaller), file providers |
| MainApplication / MainActivity dex | Stock Expo SDK 54 / RN 0.81 template, no custom startup code |
| JS bundle | Only real difference (+492 KB of new screens in 0.9.19); all source diffs benign |

## Ruled out

- 16 KB page-size misalignment (verified compliant at ELF and zip level)
- Build-to-build regression (0.9.18 crashes too)
- OTA update poisoning (updates disabled)
- React version mismatch invariant
- Custom Java startup code (stock template)
- Uncommitted-tree bundle drift (bundle matches 28d6ed3 content)

## Remaining hypotheses (ranked)

1. **Agora native SDK (4.5.4) failing at `System.loadLibrary`/`JNI_OnLoad` on Android 16 / One UI 8.** Even with the JS-level lazy-require guards, `require("react-native-agora")` executes at bundle init and a native abort in `JNI_OnLoad` is uncatchable and kills the process pre-UI. Agora added 16 KB/Android 16 fixes in releases after the native SDK bundled in RN wrapper 4.5.4.
2. **ML Kit `MlKitInitProvider`** — runs before `Application.onCreate`; Samsung/Android 16-specific init failures would crash pre-UI.
3. **Early expo-modules native init** (SDK 54 has known Android 16 JNI issues fixed in later patch releases; project is on expo 54.0.34 — recent, but native module patches matter).
4. Samsung One UI 8-specific runtime restriction not present in AOSP Android 16.

## Constraint

An Android emulator cannot run inside the Replit build environment (no hardware virtualization). Static analysis is exhausted; the crash log is required for definitive root cause.

## Verification plan (before any new APK)

1. **Capture the real stack trace** — one of:
   - `adb logcat -b crash -d` on the Fold 7 immediately after the crash (decisive, 5 min)
   - **Samsung Remote Test Lab** (free, remote.samsung.com): rent a real Galaxy Z Fold 7 / Android 16, install the existing APK, reproduce, export logcat — no new build required, satisfies the "real-device test" requirement
   - Firebase Test Lab / BrowserStack with the existing APK (needs account credentials)
2. Root-cause from the stack trace; apply the targeted fix (likely an Agora native SDK bump or expo patch-release bump).
3. Re-test the **existing fixed APK on the same remote-device service** before distributing to the user's device.
