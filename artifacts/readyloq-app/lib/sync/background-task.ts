/**
 * ReadyLoq Background Sync Task
 *
 * Registers an `expo-background-fetch` task that uploads any locally-queued
 * inspection data even when the app is completely closed. The OS fires this
 * task roughly every 15 minutes (exact interval is OS-controlled; iOS and
 * Android both enforce a platform minimum regardless of the requested value).
 *
 * Architecture notes
 * ──────────────────
 * • `TaskManager.defineTask` MUST be called at module-initialisation time
 *   (i.e. before any `await`), which is why this file has a side-effect
 *   import from `_layout.tsx` via a bare `import "@/lib/sync/background-task"`.
 * • In a background context the JS runtime is a fresh isolate — module-level
 *   singletons (like the sync engine's `state`) start from zero. We use
 *   `expo-secure-store` to bridge the Clerk session token across that
 *   boundary. The stored token may be expired by the time the task fires;
 *   that is acceptable — the upload will fail gracefully and the engine's
 *   existing retry/backoff logic will handle it when the app next foregrounds.
 * • We never persist the full JWT permanently. `cacheTokenForBackground`
 *   is called from the authenticated layout each time a fresh token is
 *   obtained, so the cached value is as fresh as the last foreground session.
 */

import * as BackgroundFetch from "expo-background-fetch";
import * as SecureStore from "expo-secure-store";
import * as TaskManager from "expo-task-manager";

import { runBackgroundSync } from "@/lib/sync/engine";

// ─── Constants ────────────────────────────────────────────────────────────────

export const BACKGROUND_SYNC_TASK = "readyloq-background-sync";

/** SecureStore key for the cached Clerk JWT. */
const TOKEN_KEY = "readyloq_bg_token";
let credentialWriteChain: Promise<void> = Promise.resolve();

/** Requested minimum interval between background fetches (seconds). */
const FETCH_INTERVAL_SECONDS = 15 * 60; // 15 min — OS may enforce a longer minimum

// ─── Token cache ──────────────────────────────────────────────────────────────

/**
 * Store a fresh Clerk token so the background task can authenticate.
 * Call this from the authenticated layout whenever a new token is obtained.
 * The token is stored in the device keychain (encrypted at rest).
 */
export async function cacheTokenForBackground(
  token: string,
  ownerId: string,
  companyId: number | null,
): Promise<void> {
  try {
    // Keep token and owner in a single key so a crash cannot pair one account's
    // credentials with another account's ownership marker.
    const write = credentialWriteChain.then(() =>
      SecureStore.setItemAsync(TOKEN_KEY, JSON.stringify({ token, ownerId, companyId })),
    );
    credentialWriteChain = write.catch(() => undefined);
    await write;
  } catch {
    // Non-fatal: foreground sync still works; background task will use the
    // previously cached token or skip if nothing is stored.
  }
}

/** Remove the cached token (e.g. on sign-out). */
export async function clearCachedBackgroundToken(): Promise<void> {
  try {
    const clear = credentialWriteChain.then(() => SecureStore.deleteItemAsync(TOKEN_KEY));
    credentialWriteChain = clear.catch(() => undefined);
    await clear;
  } catch {
    // Already absent — safe to ignore.
  }
}

// ─── Task definition ──────────────────────────────────────────────────────────
// Must be top-level (synchronous, before any await) so that TaskManager can
// replay it after the OS relaunches the app for background work.

TaskManager.defineTask(BACKGROUND_SYNC_TASK, async () => {
  try {
    // A token is only safe to use alongside the owner it was cached for.
    const cached = await SecureStore.getItemAsync(TOKEN_KEY);
    let credentials: {
      token?: unknown;
      ownerId?: unknown;
      companyId?: unknown;
    } | null = null;
    try {
      credentials = cached
        ? JSON.parse(cached) as { token?: unknown; ownerId?: unknown; companyId?: unknown }
        : null;
    } catch {
      // A previous unscoped raw-token cache is deliberately not reused.
    }
    const cachedToken = typeof credentials?.token === "string" ? credentials.token : null;
    const cachedOwnerId = typeof credentials?.ownerId === "string" ? credentials.ownerId : null;
    const hasCompanyScope = credentials != null &&
      Object.prototype.hasOwnProperty.call(credentials, "companyId") &&
      (credentials.companyId === null ||
        (typeof credentials.companyId === "number" && Number.isFinite(credentials.companyId)));
    const cachedCompanyId = typeof credentials?.companyId === "number"
      ? credentials.companyId
      : null;
    if (!cachedToken || !cachedOwnerId || !hasCompanyScope) {
      return BackgroundFetch.BackgroundFetchResult.NoData;
    }
    // Run one full sync pass using the cached token. The engine handles
    // upload retries internally; a single failed photo never aborts the rest.
    const didWork = await runBackgroundSync(
      async () => cachedToken,
      cachedOwnerId,
      cachedCompanyId,
    );

    return didWork
      ? BackgroundFetch.BackgroundFetchResult.NewData
      : BackgroundFetch.BackgroundFetchResult.NoData;
  } catch (err) {
    console.error("[BackgroundSync] task failed:", err);
    return BackgroundFetch.BackgroundFetchResult.Failed;
  }
});

// ─── Registration ─────────────────────────────────────────────────────────────

/**
 * Register the background fetch task with the OS.
 * Safe to call on every app launch — `registerTaskAsync` is idempotent
 * (it updates the interval if already registered).
 */
export async function registerBackgroundSync(): Promise<void> {
  try {
    await BackgroundFetch.registerTaskAsync(BACKGROUND_SYNC_TASK, {
      minimumInterval: FETCH_INTERVAL_SECONDS,
      stopOnTerminate: false, // Android: keep running after the user swipes the app away
      startOnBoot: true,     // Android: re-register after device reboot
    });
  } catch (err) {
    // Not fatal — foreground and AppState-triggered sync still work.
    // Common on iOS simulator (background fetch is not supported there).
    console.warn("[BackgroundSync] registration failed:", err);
  }
}

/**
 * Unregister the task (e.g. when the user signs out and we no longer have
 * credentials to run with).
 */
export async function unregisterBackgroundSync(): Promise<void> {
  try {
    const isRegistered = await TaskManager.isTaskRegisteredAsync(BACKGROUND_SYNC_TASK);
    if (isRegistered) {
      await BackgroundFetch.unregisterTaskAsync(BACKGROUND_SYNC_TASK);
    }
  } catch {
    // Ignore — task was never registered or already removed.
  }
}
