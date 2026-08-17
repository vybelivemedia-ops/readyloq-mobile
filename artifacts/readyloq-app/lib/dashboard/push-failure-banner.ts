/**
 * Pure push-failure banner logic extracted from the dashboard screen so it
 * can be unit-tested without a React Native renderer.
 *
 * Two flows:
 *
 * 1. Dismiss-only (dashboard banner "Dismiss" button):
 *    runDismissPushFailure — calls DELETE /me/push-failure, optimistic update first.
 *
 * 2. Re-registration (Settings "Fix" button):
 *    runReRegisterPushToken — acquires a new Expo push token, registers it with the
 *    server, and clears the banner optimistically before ANY awaited native/auth
 *    operations.  Rolls back the optimistic update if registration ultimately fails.
 *
 * Both helpers are injectable-dependency designs so they can be unit-tested
 * without mounting a React Native component tree or calling native APIs.
 */

/** Minimum shape the cached user object must satisfy for this helper. */
export type UserWithPushStatus = { pushLastFailedAt: string | null };

/**
 * Dependencies for `runDismissPushFailure`.
 *
 * Generic `T` extends `UserWithPushStatus` so the return type of `setUserCache`
 * matches the actual query-cache type (e.g. `CurrentUser`) rather than just the
 * structural minimum.  This allows the helper to be passed directly to
 * `queryClient.setQueryData<T | null | undefined>` without a cast.
 */
export interface DismissPushFailureDeps<T extends UserWithPushStatus> {
  /** Resolves the current auth token. */
  getToken: () => Promise<string | null>;
  /**
   * Calls the server endpoint that clears pushLastFailedAt.
   * Injectable for tests so no real fetch is made.
   */
  callDismissApi: (token: string | null) => Promise<unknown>;
  /**
   * Applies an optimistic update to the React Query "current-user" cache.
   *
   * Mirrors `queryClient.setQueryData<T | null | undefined>(
   *   ["current-user"], updater)`.
   *
   * The updater receives `T | null | undefined` — null arises when the query
   * returned a null result and undefined when no cache entry exists yet.
   */
  setUserCache: (
    updater: (prev: T | null | undefined) => T | null | undefined,
  ) => void;
}

/**
 * Dismisses the push-failure banner with an optimistic local update.
 *
 * Order of operations:
 *   1. Optimistically set `pushLastFailedAt: null` in the query cache —
 *      the banner disappears immediately, no reload required.
 *   2. Obtain the auth token.
 *   3. Call the server to clear the flag persistently.
 *
 * If step 3 fails the optimistic update stays in the cache until the next
 * `/me` refetch restores the correct server state (best-effort semantics).
 */
export async function runDismissPushFailure<T extends UserWithPushStatus>(
  deps: DismissPushFailureDeps<T>,
): Promise<void> {
  const { getToken, callDismissApi, setUserCache } = deps;

  // ── 1. Optimistic update — banner hides before the network round-trip ──────
  setUserCache((prev) => {
    if (prev == null) return prev; // null/undefined — nothing to update
    return { ...prev, pushLastFailedAt: null } as T;
  });

  // ── 2-3. Persist on the server (best-effort) ──────────────────────────────
  try {
    const token = await getToken();
    await callDismissApi(token);
  } catch {
    // Swallow — the local optimistic update already hid the banner.
    // The server flag will be re-read on the next /me refetch.
  }
}

// ─── Re-registration flow ─────────────────────────────────────────────────────

/**
 * Result of the device-side permission + token acquisition step.
 * "granted" carries the fresh Expo push token string.
 * "denied" means the owner refused — show guidance and do NOT register.
 */
export type PermissionResult =
  | { status: "granted"; expoPushToken: string }
  | { status: "denied" };

export interface ReRegisterPushTokenDeps<T extends UserWithPushStatus> {
  /**
   * The current value of `pushLastFailedAt` from the cached user object.
   * Used to roll back the optimistic update if registration ultimately fails.
   */
  currentPushLastFailedAt: string | null;
  /**
   * Applies an optimistic or rollback update to the React Query cache.
   * Same contract as `DismissPushFailureDeps.setUserCache`.
   */
  setUserCache: (
    updater: (prev: T | null | undefined) => T | null | undefined,
  ) => void;
  /**
   * Performs the platform-specific steps: channel setup, permission check/request,
   * and Expo push token acquisition.  Returns the result so pure logic can branch.
   * Injectable for tests — no native calls in the helper itself.
   */
  acquireToken: () => Promise<PermissionResult>;
  /** Resolves the current Clerk auth token. */
  getToken: () => Promise<string | null>;
  /**
   * Registers the acquired Expo push token with the server.
   * Mirrors `registerPushToken(authToken, expoPushToken)`.
   */
  registerWithServer: (authToken: string | null, expoPushToken: string) => Promise<unknown>;
  /**
   * Called after a successful registration to sync remaining server-side
   * changes (e.g. hasPushToken flag).  Mirrors `refetchUser()`.
   */
  onSuccess: () => void;
  /**
   * Called when `acquireToken` returns "denied" so the component can guide
   * the owner to system Settings.
   */
  onPermissionDenied: () => void;
  /**
   * Called when registration throws so the component can show an error alert.
   */
  onError: (err: unknown) => void;
}

/**
 * Runs the full push-token re-registration flow with an optimistic update
 * that hides the failure banner **immediately on tap**, before any awaited
 * native or network operations.
 *
 * Order of operations:
 *   1. Apply optimistic update — banner hides immediately.
 *   2. Acquire the Expo push token (permission check + native API).
 *      • If permission is denied → roll back + call onPermissionDenied.
 *   3. Register the token with the server.
 *      • If registration throws → roll back + call onError.
 *   4. Call onSuccess so the query can be refreshed for non-banner fields.
 */
export async function runReRegisterPushToken<T extends UserWithPushStatus>(
  deps: ReRegisterPushTokenDeps<T>,
): Promise<void> {
  const {
    currentPushLastFailedAt,
    setUserCache,
    acquireToken,
    getToken,
    registerWithServer,
    onSuccess,
    onPermissionDenied,
    onError,
  } = deps;

  // ── 1. Optimistic update — banner hides before any native await ─────────────
  setUserCache((prev) => {
    if (prev == null) return prev;
    return { ...prev, pushLastFailedAt: null } as T;
  });

  const rollback = () => {
    setUserCache((prev) => {
      if (prev == null) return prev;
      return { ...prev, pushLastFailedAt: currentPushLastFailedAt } as T;
    });
  };

  try {
    // ── 2. Acquire Expo push token (permission + native call) ─────────────────
    const result = await acquireToken();
    if (result.status === "denied") {
      rollback();
      onPermissionDenied();
      return;
    }

    // ── 3. Register with server ───────────────────────────────────────────────
    const authToken = await getToken();
    await registerWithServer(authToken, result.expoPushToken);

    // ── 4. Sync remaining server-side fields ──────────────────────────────────
    onSuccess();
  } catch (e: unknown) {
    rollback();
    onError(e);
  }
}

// ─── Banner visibility ────────────────────────────────────────────────────────

/**
 * Returns true when the push-failure banner should be visible.
 *
 * Extracted so tests can assert the render condition in isolation without
 * mounting the full dashboard component tree.
 */
export function isBannerVisible(pushLastFailedAt: string | null | undefined): boolean {
  return Boolean(pushLastFailedAt);
}
