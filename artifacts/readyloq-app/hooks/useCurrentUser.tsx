import { useAuth } from "@clerk/expo";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import React, { createContext, useContext, useEffect, useState } from "react";

import { fetchCurrentUser, type CurrentUser } from "@/lib/api";
import { clearUserCache, loadUserCache, saveUserCache } from "@/lib/local/user-cache";

interface CurrentUserContextValue {
  user: CurrentUser | null;
  isLoading: boolean;
  error: unknown;
  refetch: () => void;
}

const CurrentUserContext = createContext<CurrentUserContextValue | null>(null);

/**
 * Offline-first user profile provider.
 *
 * Cold-start behaviour:
 *  1. Read the local user cache (AsyncStorage, typically < 5 ms).
 *  2. Ownership check: if the cached user's `clerkUserId` does not match the
 *     current Clerk session subject (`userId`), the cache is stale (a different
 *     account was cached on this device). Clear it and do NOT seed the store —
 *     the user will see a brief loading state until the live fetch resolves.
 *  3. If the cache is valid, pre-seed the React Query cache so Gate never
 *     blocks on the first render when a previous session exists.
 *  4. Fire /api/auth/me with a 5-second AbortSignal timeout in the background.
 *  5. On success → persist fresh data and update the in-memory cache.
 *  6. On failure (offline / timeout / 5xx) → keep serving the stale cached
 *     value; never surface the error when cached data is available.
 *
 * A technician who has signed in at least once can cold-start the app in a
 * basement with zero connectivity and immediately access inspection screens.
 * A different user signing in on the same device always gets a fresh fetch —
 * never the previous user's cached workspace.
 */
export function CurrentUserProvider({ children }: { children: React.ReactNode }) {
  const { getToken, isSignedIn, userId } = useAuth();
  const queryClient = useQueryClient();

  // Phase 1: read the local cache and seed the React Query store before the
  // network fetch fires. `cacheSeeded` gates the query so it never starts
  // before the cache pre-population attempt completes.
  const [cacheSeeded, setCacheSeeded] = useState(false);

  useEffect(() => {
    if (!userId) {
      // No active Clerk session — skip cache seeding; any stale entry will be
      // cleared on the next sign-in if the userId check fails.
      setCacheSeeded(true);
      return;
    }

    void loadUserCache().then(async (cached) => {
      if (cached) {
        // Ownership check: only seed the cache when the stored profile belongs
        // to the currently authenticated Clerk user. A mismatch means a
        // different account was previously cached on this device (account
        // switch). Serve nothing until the live fetch resolves.
        if (cached.clerkUserId !== userId) {
          await clearUserCache();
        } else if (!queryClient.getQueryData(["current-user"])) {
          queryClient.setQueryData(["current-user"], cached);
        }
      }
      setCacheSeeded(true);
    });
  }, [queryClient, userId]);

  const query = useQuery({
    queryKey: ["current-user"],
    enabled: !!isSignedIn && cacheSeeded,
    queryFn: async () => {
      // 5-second hard timeout so zero-service environments never produce an
      // indefinite hang. On abort the caught error keeps the stale cache alive.
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 5_000);
      try {
        const token = await getToken();
        const user = await fetchCurrentUser(token, { signal: ac.signal });
        // Persist so the next cold start skips the network round-trip.
        void saveUserCache(user);
        return user;
      } finally {
        clearTimeout(timer);
      }
    },
    // Keep the cached value in `data` even when the background refetch fails.
    retry: 1,
  });

  const hasData = !!query.data;

  // Expose error only when there is NO data at all — the first-ever cold start
  // with no network and no prior cache, or an account-switch where the old
  // cache was cleared. When own-account cached data exists, the workspace
  // renders and the network error is silently swallowed.
  const effectiveError = hasData ? null : query.error;

  // isLoading is true only while:
  //   (a) the cache ownership check / seed is still in flight (< 5 ms), OR
  //   (b) the network fetch is running AND we have no data of any kind.
  const isLoading = !cacheSeeded || (query.isLoading && !hasData);

  return (
    <CurrentUserContext.Provider
      value={{
        user: query.data ?? null,
        isLoading,
        error: effectiveError,
        refetch: () => { void query.refetch(); },
      }}
    >
      {children}
    </CurrentUserContext.Provider>
  );
}

export function useCurrentUser() {
  const ctx = useContext(CurrentUserContext);
  if (!ctx) {
    throw new Error("useCurrentUser must be used within a CurrentUserProvider");
  }
  return ctx;
}
