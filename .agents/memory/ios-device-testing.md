---
name: iOS device testing reminder
description: User wants to be reminded when the 6 known iOS issues are fixed and the app is ready for real-device testing
---

## Reminder

The user explicitly asked to be reminded when it is time to test on a real iOS device. Do NOT suggest iOS testing until all 6 issues below are resolved.

## Open iOS issues (must all be fixed first)

1. **lib/ble/permissions.ts** — iOS always returns "granted" for Bluetooth; never checks CoreBluetooth authorization. Needs real denied/restricted handling.
2. **ios/ReadyLoq/Info.plist** — Missing `NSPhotoLibraryAddUsageDescription`; inspection image export will silently fail permission on iOS.
3. **ios/ReadyLoq/Info.plist** — Missing `NSBluetoothAlwaysUsageDescription`, `NSBluetoothPeripheralUsageDescription`, and `UIBackgroundModes`; BLE never prompts and background reconnection is silent.
4. **app.json / BLE config** — No iOS BLE restoration identifier; background BLE won't resume after suspension.
5. **lib/platform/device-plugin.ts** — All BLE sensor providers register on iOS too; Connections screen offers hardware that can never work on iOS.
6. **connections.tsx** — Meta Glasses card renders on iOS even though the feature immediately returns `unsupported_build` (cosmetic, but should be hidden).

## When to remind

Once all 6 are resolved (or consciously deferred), tell the user:
> "The iOS issues we identified are all addressed — now would be a good time to test on a real iOS device."
