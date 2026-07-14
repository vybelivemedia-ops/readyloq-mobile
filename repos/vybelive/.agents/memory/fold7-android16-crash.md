---
name: Fold 7 / Android 16 launch crash investigation
description: Status + forensic method for the pre-splash instant crash on Galaxy Z Fold 7 (Android 16); what's ruled out and what evidence is still needed.
---

## Status (2026-07-08) — RESOLVED (root cause found, fix built)
- Root cause: SDK 56 expo packages (`expo-keep-awake@56`, `expo-speech-recognition@56`) installed against expo@54 core → Kotlin crash in `expo.modules.kotlin.types.AnyTypeCache` at module registration, pre-splash, on all devices strict about it.
- Fix: `npx expo install --fix` + `expo-speech-recognition@3.1.3` (official `sdk-54` npm dist-tag); verify with `npx expo install --check` + `pnpm why`. Clean 0.9.20/124 APK built and manifest-verified.
- Durable rule: after ANY expo package install, run `npx expo install --check` — a single cross-SDK expo-* package crashes the whole app at launch with an opaque Kotlin frame.
- Full audit: `docs/android16-fold7-crash-audit.md`. EAS build pitfalls hit during the rebuild: see `eas-bare-workflow-trap.md`.

## Ruled out (verified, don't re-check)
- 16 KB page size: ALL .so LOAD segments 0x4000-aligned AND zip-stored 16 KB-aligned (extractNativeLibs=false). Compliant.
- OTA poisoning (expo-updates ENABLED=false, zero updates published), Firebase (absent), react/renderer mismatch, custom Java startup (stock template), dirty-tree bundle drift.

## Leading hypotheses
1. Agora native SDK 4.5.4 JNI_OnLoad abort on Android 16/One UI 8 — JS lazy-require guards do NOT protect against native aborts during System.loadLibrary at bundle init.
2. MlKitInitProvider / androidx.startup providers (run before Application.onCreate).

## Method that worked (reusable APK forensics on Replit)
- Download EAS APKs via artifact URL, `readelf -lW` awk ALL LOAD segments (not just first), python zipfile for stored-entry data-offset % 16384, pyaxmlparser for manifest decode, androguard for dex method bytecode, hermes strings diff for bundle comparison.
- No Android emulator possible on Replit (no KVM). Decisive evidence needs device logcat or Samsung Remote Test Lab (free, has Fold devices, no new build needed).

**How to apply:** any "instant crash before splash" report → get `adb logcat -b crash -d` FIRST; static APK forensics can rule out classes of causes but cannot name the crashing frame.
