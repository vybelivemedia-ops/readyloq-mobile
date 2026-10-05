import { useAuth } from "@clerk/expo";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import React, { createContext, useContext, useEffect, useState } from "react";

import { fetchCurrentUser, type CurrentUser } from "@/lib/api";
import { clearUserCache, loadUserCache, saveUserCache } from "@/lib/local/user-cache";

interface CurrentUserContextValue {
  user: CurrentUser | null;
  isLoading: boolean;
  /** True only after /api/auth/me validated this profile for this session. */
  isServerVerified: boolean;
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
 * The cached profile may seed query state, but the inspection workspace stays
 * gated until /api/auth/me confirms the current company scope. This is
 * necessary because one Clerk subject may have moved to another company since
 * the cached profile was written. A different user never inherits the prior
 * user's workspace.
 */
export function CurrentUserProvider({ children }: { children: React.ReactNode }) {
  const { getToken, isSignedIn, userId } = useAuth();
  const queryClient = useQueryClient();

  // Phase 1: read the local cache and seed the React Query store before the
  // network fetch fires. `cacheSeeded` gates the query so it never starts
  // before the cache pre-population attempt completes.
  const [cacheSeeded, setCacheSeeded] = useState(false);
  const [verifiedProfile, setVerifiedProfile] = useState<CurrentUser | null>(null);

  useEffect(() => {
    setVerifiedProfile(null);
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
      // A cached same-subject profile may belong to a company the user has
      // since left. Revoke local-data scope until the live profile confirms
      // the current tenant.
      setVerifiedProfile(null);
      // 5-second hard timeout so zero-service environments never produce an
      // indefinite hang. On abort the caught error keeps the stale cache alive.
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), 5_000);
      try {
        const token = await getToken();
        const user = await fetchCurrentUser(token, { signal: ac.signal });
        if (user.clerkUserId === userId) setVerifiedProfile(user);
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
  const isServerVerified = !!verifiedProfile &&
    verifiedProfile.clerkUserId === userId &&
    verifiedProfile.companyId === query.data?.companyId &&
    query.data?.clerkUserId === userId;

  // A cached same-subject profile is still insufficient to expose local data:
  // its company may have changed. Keep the validation error visible until the
  // server confirms the owner+company scope.
  const effectiveError = isServerVerified ? null : query.error;

  // Keep the workspace gated while a stale cached profile is being validated,
  // even when its user fields are available for rendering.
  const isLoading = !cacheSeeded ||
    (query.isLoading && !hasData) ||
    (!isServerVerified && query.isFetching);

  return (
    <CurrentUserContext.Provider
      value={{
        user: query.data ?? null,
        isLoading,
        isServerVerified,
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
