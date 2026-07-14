---
name: app.config.ts overrides app.json
description: Expo completely ignores app.json when app.config.ts is present; version/versionCode must live in app.config.ts.
---

## Rule
When `app.config.ts` (or `app.config.js`) exists in the project root, Expo and EAS CLI use it as the **sole** source of config. `app.json` is silently ignored.

**Why:** Expo's config resolution prefers dynamic config files over static JSON. The project has `artifacts/mobile/app.config.ts` which exports the full `ExpoConfig` including `version` and `android.versionCode`. Editing `app.json` has no effect on builds.

**How to apply:** When bumping app version or versionCode, always update `artifacts/mobile/app.config.ts` — specifically:
- `baseConfig.version` → app version string (e.g. `"0.9.18"`)
- `baseConfig.android.versionCode` → integer build number (e.g. `122`)
- `baseConfig.ios.buildNumber` → string build number if needed for iOS

The `artifacts/mobile/constants/version.ts` file controls what the JS bundle (About screen, headers, etc.) displays — keep it in sync with `app.config.ts`.
