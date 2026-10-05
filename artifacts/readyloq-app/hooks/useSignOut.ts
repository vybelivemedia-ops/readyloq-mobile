import { useAuth } from "@clerk/expo";
import { useQueryClient } from "@tanstack/react-query";

import { clearUserCache } from "@/lib/local/user-cache";

/**
 * Centralized sign-out hook.
 *
 * Always use this instead of calling Clerk `signOut` directly. It:
 *   1. Clears the persisted user-profile cache so a stale identity is never
 *      served to a different user who signs in on the same device offline.
 *   2. Removes the in-memory React Query `current-user` entry for the same reason.
 *   3. Calls Clerk `signOut` last so the session is invalidated after local
 *      cleanup completes.
 *
 * All four sign-out surfaces (Gate error, BetaPaused, Onboarding, dashboard
 * header) must go through this hook — never call `useAuth().signOut` directly.
 */
export function useSignOut() {
  const { signOut } = useAuth();
  const queryClient = useQueryClient();

  return async () => {
    // Clear local identity cache first so the next cold start cannot pick up
    // a stale profile belonging to the now-signed-out user.
    await clearUserCache();
    // Evict the in-memory React Query entry for the same reason.
    queryClient.removeQueries({ queryKey: ["current-user"] });
    // Platform data is cross-company and must never survive an identity change.
    queryClient.removeQueries({
      predicate: (query) =>
        query.queryKey.some(
          (part) =>
            typeof part === "string" &&
            part.startsWith("/api/mission-control/"),
        ),
    });
    // Revoke the Clerk session.
    await signOut();
  };
}
