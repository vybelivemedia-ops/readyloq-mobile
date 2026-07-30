/**
 * BLE runtime permission helpers — ReadyLoq
 *
 * Android splits Bluetooth permissions across API levels:
 *   API >= 31 (Android 12+):  BLUETOOTH_SCAN + BLUETOOTH_CONNECT
 *   API 23–30 (Android 6–11): ACCESS_FINE_LOCATION (required for BLE scan)
 *   API < 23:                 No runtime permissions needed
 *
 * iOS handles BLE access via a native system dialog on the first scan attempt.
 * If the user denies it, BleHwState becomes Unauthorized — we direct to
 * Settings from the UI layer rather than requesting here.
 */

import { Platform, PermissionsAndroid } from "react-native";
import * as Location from "expo-location";

// ─── Types ────────────────────────────────────────────────────────────────────

export type BlePermissionStatus =
  /** Initial state — check has not completed yet. */
  | "checking"
  /** All required permissions are granted; scan can proceed. */
  | "granted"
  /** User declined but can be prompted again. */
  | "denied"
  /** Permanently denied (never_ask_again) — must redirect to Settings. */
  | "blocked";

type ResolvedStatus = Exclude<BlePermissionStatus, "checking">;

// ─── Implementation ───────────────────────────────────────────────────────────

/**
 * Check current BLE permission status without showing any dialog.
 * Useful on mount or when the app returns to the foreground.
 */
export async function checkBlePermissions(): Promise<ResolvedStatus> {
  if (Platform.OS !== "android") {
    // iOS: BLE access is granted via the system dialog on first scan.
    // We rely on BleHwState.Unauthorized to detect post-grant revocations.
    return "granted";
  }

  const api = Platform.Version as number;

  if (api < 23) {
    // Android < 6: runtime permissions don't exist.
    return "granted";
  }

  if (api >= 31) {
    // Android 12+: BLUETOOTH_SCAN + BLUETOOTH_CONNECT
    const [scanOk, connectOk] = await Promise.all([
      PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN),
      PermissionsAndroid.check(
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
      ),
    ]);
    return scanOk && connectOk ? "granted" : "denied";
  } else {
    // Android 6–11: ACCESS_FINE_LOCATION is required for BLE scan results.
    const locOk = await PermissionsAndroid.check(
      PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
    );
    return locOk ? "granted" : "denied";
  }
}

/**
 * Request BLE permissions from the user, showing the system dialog.
 *
 * Returns:
 *   "granted"  — all required permissions granted; scan can proceed immediately
 *   "denied"   — user declined; can prompt again on a future tap
 *   "blocked"  — permanently denied (never_ask_again); must open Settings
 */
export async function requestBlePermissions(): Promise<ResolvedStatus> {
  if (Platform.OS !== "android") {
    return "granted"; // iOS handles BLE via native dialog on first scan
  }

  const api = Platform.Version as number;

  if (api < 23) {
    return "granted";
  }

  if (api >= 31) {
    // Android 12+: request BLUETOOTH_SCAN + BLUETOOTH_CONNECT together.
    const results = await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
    ]);

    const scan = results[PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN];
    const connect = results[PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT];

    if (
      scan === PermissionsAndroid.RESULTS.GRANTED &&
      connect === PermissionsAndroid.RESULTS.GRANTED
    ) {
      return "granted";
    }
    if (
      scan === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN ||
      connect === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN
    ) {
      return "blocked";
    }
    return "denied";
  } else {
    // Android 6–11: request ACCESS_FINE_LOCATION via expo-location for a
    // better-worded rationale dialog.
    const { status, canAskAgain } =
      await Location.requestForegroundPermissionsAsync();
    if (status === "granted") return "granted";
    return canAskAgain ? "denied" : "blocked";
  }
}
