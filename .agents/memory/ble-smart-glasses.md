---
name: BLE smart glasses driver
description: react-native-ble-plx wiring for Meta Ray-Ban / ReadyLoq glasses — UUIDs, frame protocol, install quirks
---

## Package install quirk

`react-native-ble-plx@3.2.1` cannot be installed locally in Replit because its runtime dep `expo@^51` pulls `@expo/cli@0.18 → tar@6.2.1` which is blocked by the Replit package firewall.

**Workarounds applied:**
1. Root `package.json` pnpm override: `"react-native-ble-plx>expo": "54.0.36"` — redirects ble-plx's expo dep to the already-installed version.
2. Symlink from pnpm virtual store to `artifacts/readyloq-app/node_modules/react-native-ble-plx` for TypeScript resolution.
3. The EAS cloud build installs it natively (no firewall restriction there).

## UUIDs

| Characteristic | UUID | Purpose |
|---|---|---|
| ReadyLoq Service | `0000A001-0000-1000-8000-00805f9b34fb` | Custom GATT service |
| Frame notify | `0000A002-…` | JPEG chunk delivery |
| Audio notify | `0000A003-…` | PCM int16 audio chunks |
| Control write | `0000A004-…` | Snapshot/ACK/audio enable commands |
| Nordic UART Service | `6E400001-…` | Firmware fallback |
| Nordic UART TX | `6E400003-…` | NUS data path |

## Frame chunk protocol

6-byte big-endian header: `frame_seq (u16) | chunk_idx (u8) | total_chunks (u8) | reserved (u16)` + JPEG payload. Reassembly uses a Map keyed by `frame_seq` with a 5-second TTL per frame.

## Control commands

`0x01` REQUEST_SNAPSHOT · `0x02` ACK_FRAME · `0x03` ENABLE_AUDIO · `0x04` DISABLE_AUDIO — all 4-byte big-endian writes to the control characteristic.

## Persistence

Paired device stored in AsyncStorage under `@readyloq:paired_glasses_id` and `@readyloq:paired_glasses_name`. On mount the driver attempts auto-reconnect to the saved ID.

## Wiring to capture pipeline

`future-source-providers.ts` smart-glasses entry:
- `probe()` — checks `smartGlassesBle.getState().connectionState === "connected"`
- `create()` — returns a push provider that routes frames via `smartGlassesBle.onFrame(cb)`

**Why:** The BLE driver is a singleton (`lib/ble/smart-glasses-ble.ts`); any consumer calls `smartGlassesBle.getState()` or subscribes via `smartGlassesBle.subscribe()`.

## TypeScript note

The `monitorCharacteristicForService` call returns a `Subscription` synchronously (not a Promise). Using `.then?.()` on it produces TS2339. Wrap in `try/catch` and push the returned subscription to `_subscriptions` directly.
