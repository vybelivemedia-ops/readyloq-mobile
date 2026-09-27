---
name: EAS Update public environment
description: Prevent OTA bundles from shipping without ReadyLoq's production API and Clerk public configuration.
---

When publishing ReadyLoq OTA updates locally, explicitly export the production `EXPO_PUBLIC_DOMAIN`, `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY`, and `EXPO_PUBLIC_CLERK_PROXY_URL` values already defined in the production build profile before running `eas update`.

**Why:** The `env` block under an `eas.json` build profile is applied to EAS builds, but a local `eas update` invocation does not automatically select and inject that build-profile environment. Publishing without it produced a valid OTA bundle that could not reach the API or initialize sign-in.

**How to apply:** Read the public values from `eas.json` into the publishing process without printing them, publish to the intended branch, and verify the compiled Android and iOS Hermes bundles contain the production domain before considering the update complete.

Before preparing another OTA release, verify the installed Android build's update channel through Expo build metadata rather than inferring it from the build profile name. The recent internal preview builds reported no channel in Expo, and the build profiles do not declare one. A JS-only bundle can still be unable to reach those binaries without a channel-enabled replacement build.

**Why:** Matching a declared runtime version is necessary but does not prove that an installed binary subscribes to any EAS Update branch. Publishing to an assumed channel could report success while the tester's phone never receives it.

**How to apply:** Identify the exact installed build and its channel/runtime before publishing. If the channel is absent, stop and arrange a channel-configured build rather than claiming the OTA update is delivered.