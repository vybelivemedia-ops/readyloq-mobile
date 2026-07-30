/**
 * Daily rig local store — AsyncStorage-backed source of truth for the
 * technician's daily rig selection.
 *
 * Design rules:
 *  - A rig is "current" only when its `date` matches today's YYYY-MM-DD.
 *    Anything older is treated as empty; midnight resets happen automatically
 *    on the next read.
 *  - Writes are fire-and-forget for the background server sync; the local
 *    record is the primary source of truth during an offline day.
 *  - Listeners allow any component or hook to re-render when the rig changes.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY = "readyloq.daily-rig.v1";

export type LocalDailyRig = {
  /** ISO date "YYYY-MM-DD" — the day this rig applies to. */
  date: string;
  /** Ordered product IDs selected for the day. */
  productIds: number[];
  /** ISO timestamp of the last successful server sync. */
  lastSyncedAt: string | null;
};

/** Returns today's date as "YYYY-MM-DD" using the device's local clock. */
export function todayKey(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// ─── Change listeners ─────────────────────────────────────────────────────────

type Listener = () => void;
const listeners = new Set<Listener>();

export function subscribeDailyRig(cb: Listener): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function notify() {
  for (const cb of listeners) {
    try { cb(); } catch { /* broken listener must never block storage */ }
  }
}

// ─── Read ─────────────────────────────────────────────────────────────────────

/**
 * Returns the daily rig if it was set up today, or null if it has not been
 * set up yet / expired (previous day's selection is never surfaced).
 */
export async function getTodayRig(): Promise<LocalDailyRig | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LocalDailyRig;
    if (typeof parsed?.date !== "string" || !Array.isArray(parsed.productIds)) return null;
    // Expire silently on day rollover.
    if (parsed.date !== todayKey()) return null;
    return parsed;
  } catch {
    return null;
  }
}

// ─── Write ────────────────────────────────────────────────────────────────────

/** Save (or replace) the daily rig for today. */
export async function saveDailyRig(productIds: number[]): Promise<void> {
  const record: LocalDailyRig = {
    date: todayKey(),
    productIds,
    lastSyncedAt: null,
  };
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(record));
  notify();
}

/** Mark the rig as synced with the server timestamp. */
export async function markDailyRigSynced(syncedAt: string): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as LocalDailyRig;
    if (parsed.date !== todayKey()) return;
    await AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...parsed, lastSyncedAt: syncedAt }),
    );
    // No notify needed — sync status doesn't affect visible rig products.
  } catch {
    // Best-effort; if it fails the rig still works offline.
  }
}

/** Clear the stored rig (useful for testing or an explicit "reset rig" action). */
export async function clearDailyRig(): Promise<void> {
  await AsyncStorage.removeItem(STORAGE_KEY);
  notify();
}
