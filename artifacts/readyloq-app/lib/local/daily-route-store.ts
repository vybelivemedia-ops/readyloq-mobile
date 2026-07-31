/**
 * Daily route local store — AsyncStorage-backed source of truth for the
 * technician's daily chemical route assignments (product → pest pairings).
 *
 * Design rules:
 *  - An assignment set is "current" only when its `date` matches today's
 *    YYYY-MM-DD.  Older records are silently ignored; midnight resets are
 *    automatic on the next read.
 *  - `lastSyncedAt === null` is the dirty flag: written by saveRoute() and
 *    cleared only after a successful server upsert.
 *  - Listeners let any component/hook re-render when assignments change.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import type { RouteAssignment } from "@/lib/api-client/daily-route";

const STORAGE_KEY = "readyloq.daily-route.v1";

export type LocalDailyRoute = {
  /** ISO date "YYYY-MM-DD" — the day these assignments apply to. */
  date: string;
  /** Product-to-pest pairings for the day's route. */
  assignments: RouteAssignment[];
  /** ISO timestamp of the last successful server sync; null = pending. */
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

export function subscribeDailyRoute(cb: Listener): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function notify() {
  for (const cb of listeners) {
    try { cb(); } catch { /* never block on a broken listener */ }
  }
}

// ─── Read ─────────────────────────────────────────────────────────────────────

/**
 * Returns today's route assignments, or null if none have been set up
 * (or if the stored date is from a previous day).
 */
export async function getTodayRoute(): Promise<LocalDailyRoute | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as LocalDailyRoute;
    if (
      typeof parsed?.date !== "string" ||
      !Array.isArray(parsed.assignments)
    ) return null;
    if (parsed.date !== todayKey()) return null; // midnight reset
    return parsed;
  } catch {
    return null;
  }
}

// ─── Write ────────────────────────────────────────────────────────────────────

/** Save (or replace) today's route assignments. */
export async function saveRoute(assignments: RouteAssignment[]): Promise<void> {
  const record: LocalDailyRoute = {
    date: todayKey(),
    assignments,
    lastSyncedAt: null,
  };
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(record));
  notify();
}

/** Mark the route as successfully synced to the server. */
export async function markRouteSynced(syncedAt: string): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as LocalDailyRoute;
    if (parsed.date !== todayKey()) return;
    await AsyncStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ ...parsed, lastSyncedAt: syncedAt }),
    );
  } catch { /* best-effort */ }
}

/** Clear stored route (reset / testing). */
export async function clearRoute(): Promise<void> {
  await AsyncStorage.removeItem(STORAGE_KEY);
  notify();
}
