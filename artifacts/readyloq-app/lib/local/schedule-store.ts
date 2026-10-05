/**
 * Schedule local store — AsyncStorage-backed cache for the current week's
 * inspection stops.
 *
 * Design rules:
 *  - One entry per (userId, week), keyed as `readyloq.schedule.v2.<userId>.<weekStart>`.
 *    Scoping to userId ensures that if a different account signs in on the same
 *    device, they never see the prior user's cached stops.
 *  - On a successful network fetch (including empty results) the response is
 *    stored with cachedAt so that a week that becomes empty correctly evicts
 *    stale stops offline.
 *  - On network failure the screen falls back to the cached data and shows
 *    an offline indicator.
 *  - Weeks older than 7 days are auto-pruned on the next write to keep
 *    storage minimal.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import type { ScheduleEntry } from "@/lib/api-client/schedule";

const KEY_PREFIX = "readyloq.schedule.v2.";

export interface CachedWeek {
  weekStart: string; // Monday "YYYY-MM-DD"
  userId: string;    // Clerk user ID — validated on read
  entries: ScheduleEntry[];
  cachedAt: string; // ISO timestamp
}

// ─── Key helpers ──────────────────────────────────────────────────────────────

function cacheKey(userId: string, weekStart: string): string {
  return `${KEY_PREFIX}${userId}.${weekStart}`;
}

// ─── Read ─────────────────────────────────────────────────────────────────────

/**
 * Load the cached schedule for the given user and week start (Monday date
 * string).  Returns null when no cache exists, the data is malformed, or
 * the stored userId does not match `userId` (cross-account guard).
 */
export async function getCachedWeek(
  userId: string,
  weekStart: string,
): Promise<CachedWeek | null> {
  try {
    const raw = await AsyncStorage.getItem(cacheKey(userId, weekStart));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedWeek;
    if (
      typeof parsed?.weekStart !== "string" ||
      !Array.isArray(parsed.entries) ||
      parsed.userId !== userId // reject cross-account data
    ) return null;
    return parsed;
  } catch {
    return null;
  }
}

// ─── Write ────────────────────────────────────────────────────────────────────

/**
 * Cache a week's schedule entries (including empty arrays so stale stops are
 * evicted when the server returns an empty week).  Also prunes weeks older
 * than 7 days to avoid unbounded storage growth.
 */
export async function cacheWeek(
  userId: string,
  weekStart: string,
  entries: ScheduleEntry[],
): Promise<void> {
  const record: CachedWeek = {
    weekStart,
    userId,
    entries,
    cachedAt: new Date().toISOString(),
  };
  await AsyncStorage.setItem(cacheKey(userId, weekStart), JSON.stringify(record));
  // Prune old weeks (fire-and-forget; never block the render)
  void pruneOldWeeks(userId, weekStart);
}

/** Remove cached weeks for this user that are older than 7 days. */
async function pruneOldWeeks(userId: string, currentWeekStart: string): Promise<void> {
  try {
    const allKeys = await AsyncStorage.getAllKeys();
    const prefix = `${KEY_PREFIX}${userId}.`;
    const scheduleKeys = allKeys.filter((k) => k.startsWith(prefix));
    const cutoff = new Date(currentWeekStart);
    cutoff.setDate(cutoff.getDate() - 7);
    const cutoffStr = cutoff.toISOString().slice(0, 10);

    const stale = scheduleKeys.filter((k) => {
      const wk = k.slice(prefix.length); // "YYYY-MM-DD"
      return wk < cutoffStr;
    });

    if (stale.length > 0) {
      await AsyncStorage.multiRemove(stale);
    }
  } catch { /* best-effort */ }
}

/** Clear all cached schedule weeks for a specific user. */
export async function clearScheduleCache(userId: string): Promise<void> {
  try {
    const allKeys = await AsyncStorage.getAllKeys();
    const prefix = `${KEY_PREFIX}${userId}.`;
    const scheduleKeys = allKeys.filter((k) => k.startsWith(prefix));
    if (scheduleKeys.length > 0) await AsyncStorage.multiRemove(scheduleKeys);
  } catch { /* best-effort */ }
}
