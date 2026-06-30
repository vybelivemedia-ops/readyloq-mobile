import { useAuth } from "@clerk/expo";
import { useQuery } from "@tanstack/react-query";
import React, { createContext, useContext } from "react";

import { fetchCurrentUser, type CurrentUser } from "@/lib/api";

interface CurrentUserContextValue {
  user: CurrentUser | null;
  isLoading: boolean;
  error: unknown;
  refetch: () => void;
}

const CurrentUserContext = createContext<CurrentUserContextValue | null>(null);

/**
 * Loads the local app user (role, company, beta access) from /api/auth/me using
 * the Clerk session token. Provided once inside the authenticated layout so the
 * whole app tree can read it without refetching.
 */
export function CurrentUserProvider({ children }: { children: React.ReactNode }) {
  const { getToken, isSignedIn } = useAuth();

  const query = useQuery({
    queryKey: ["current-user"],
    enabled: !!isSignedIn,
    queryFn: async () => {
      const token = await getToken();
      return fetchCurrentUser(token);
    },
  });

  return (
    <CurrentUserContext.Provider
      value={{
        user: query.data ?? null,
        isLoading: query.isLoading,
        error: query.error,
        refetch: () => query.refetch(),
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
