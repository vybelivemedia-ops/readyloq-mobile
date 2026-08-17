---
name: R8 full mode startup crash
description: R8 full mode (android.enableR8.fullMode=true) causes NoClassDefFoundError at runtime for expo-task-manager and expo-background-fetch internal classes. Standard mode works correctly.
---

## Rule
Do NOT enable `android.enableR8.fullMode=true` in `android/gradle.properties` for this project.

## Why
R8 full mode is more aggressive than standard R8 at dead-code elimination. It detects references to `expo.modules.kotlin.services.Service` and `expo.modules.kotlin.types.*` in expo-task-manager and expo-background-fetch as "missing classes". These classes exist in expo-modules-core at runtime but R8's static analysis cannot verify them in full mode.

- `-dontwarn` suppresses the compile-time error, letting the build pass (build 200 succeeded).
- But at runtime the JVM still needs those classes — `TaskManagerInternalModule.onCreate()` references them and is called at startup, causing an immediate `NoClassDefFoundError` crash.
- Builds 194–198 failed at compile time; build 200 passed but crashed at startup.

## How to apply
- All three flags in `android/gradle.properties` must stay false/off:
  - `android.enableR8.fullMode=false`
  - `android.enableMinifyInReleaseBuilds=false`
  - `android.enableShrinkResourcesInReleaseBuilds=false`
- The `-dontwarn` rules in `proguard-rules.pro` are harmless but not sufficient to prevent crashes on their own.
- If a task agent re-enables any of these three flags (commit a31f9e7 did all three), revert all three immediately.
- APK size is marginally larger without minification — acceptable trade-off for beta stability.
- Build 188 = stable (no minification). Builds 200 and 201 = crash at startup (minification on).
