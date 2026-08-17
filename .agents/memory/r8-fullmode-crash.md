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
- Keep `android.enableR8.fullMode=false` in `android/gradle.properties`.
- The `-dontwarn expo.modules.kotlin.services.**` and `-dontwarn expo.modules.kotlin.types.**` rules in `android/app/proguard-rules.pro` are retained as a defensive measure but are not needed without full mode.
- If a task agent re-enables full mode (commit a31f9e7 did this), revert it immediately.
- APK size is marginally larger without full mode — acceptable trade-off.
