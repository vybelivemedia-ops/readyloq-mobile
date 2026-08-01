import AsyncStorage from "@react-native-async-storage/async-storage";

import { type CurrentUser } from "@/lib/api";

const USER_CACHE_KEY = "readyloq.user-cache.v1";

/**
 * Persist the current user profile locally so cold starts in zero-connectivity
 * environments can resolve the workspace without a network round-trip.
 *
 * Stored under a versioned key so a schema change can invalidate stale entries
 * by simply bumping the suffix.
 */
export async function saveUserCache(user: CurrentUser): Promise<void> {
  try {
    await AsyncStorage.setItem(USER_CACHE_KEY, JSON.stringify(user));
  } catch {
    // Non-fatal — best effort. The live network fetch remains the source of truth.
  }
}

/**
 * Load the cached user profile from local storage.
 * Returns null when no cache exists or the stored value is malformed / stale.
 */
export async function loadUserCache(): Promise<CurrentUser | null> {
  try {
    const raw = await AsyncStorage.getItem(USER_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CurrentUser;
    // Minimal sanity check: id and role are the two fields Gate depends on.
    if (!parsed || typeof parsed.id === "undefined" || !parsed.role) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Remove the cached user profile. Must be called on explicit sign-out so a
 * deliberately signed-out user cannot re-enter the workspace on the next cold
 * start via stale cached credentials.
 */
export async function clearUserCache(): Promise<void> {
  try {
    await AsyncStorage.removeItem(USER_CACHE_KEY);
  } catch {
    // Best effort.
  }
}
