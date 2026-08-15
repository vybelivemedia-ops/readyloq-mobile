/**
 * BLE connection-mode badge display helpers — ReadyLoq
 *
 * Pure functions extracted from the glasses-strip JSX in new-inspection.tsx
 * so they can be unit-tested without a React renderer.
 *
 * The badge shows one of two states:
 *   "BLE · direct"  — glasses are BLE-connected to this device (low-latency)
 *   "Cloud · relay" — frames arrive via Meta Live AI webhook (~1–2 s delay)
 *
 * Used by:
 *   app/(app)/new-inspection.tsx  (connection-mode badge row, ~line 1718)
 *   lib/ble/__tests__/ble-reconnect-badge.test.ts
 */

// ─── Badge style ─────────────────────────────────────────────────────────────

/** All visual properties needed to render the connection-mode badge. */
export interface BleBadgeStyle {
  /** Background fill of the pill. */
  bgColor: string;
  /** Border color of the pill. */
  borderColor: string;
  /** Small status dot color. */
  dotColor: string;
  /** Label text color. */
  textColor: string;
  /** Human-readable label. */
  label: string;
}

/** Green palette — used when the BLE direct link is active. */
export const BLE_DIRECT_STYLE: BleBadgeStyle = {
  bgColor: "rgba(34,197,94,0.22)",
  borderColor: "rgba(34,197,94,0.55)",
  dotColor: "#22c55e",
  textColor: "#86efac",
  label: "BLE · direct",
} as const;

/** Amber palette — used when falling back to the cloud relay. */
export const CLOUD_RELAY_STYLE: BleBadgeStyle = {
  bgColor: "rgba(245,158,11,0.22)",
  borderColor: "rgba(245,158,11,0.55)",
  dotColor: "#f59e0b",
  textColor: "#fcd34d",
  label: "Cloud · relay",
} as const;

/**
 * Returns the badge style for the current connection mode.
 *
 * @param isBleConnected - `true` when `smartGlassesBle.getState().connectionState === "connected"`
 */
export function getBleBadgeStyle(isBleConnected: boolean): BleBadgeStyle {
  return isBleConnected ? BLE_DIRECT_STYLE : CLOUD_RELAY_STYLE;
}

