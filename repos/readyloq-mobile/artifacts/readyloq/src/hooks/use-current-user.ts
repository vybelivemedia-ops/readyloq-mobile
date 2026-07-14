import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@clerk/react";

export type UserRole = "technician" | "sales" | "manager" | "owner";

export type CurrentUser = {
  id: number;
  clerkUserId: string;
  role: UserRole;
  companyId: number | null;
  betaAccess: boolean;
  company: { id: number; name: string; slug: string } | null;
};

/**
 * Role hierarchy gate: owners and managers both have management authority.
 * Centralizing this keeps every client-side manager check consistent with the
 * server's requireRole hierarchy.
 */
export function isManagerRole(role: UserRole | null | undefined): boolean {
  return role === "manager" || role === "owner";
}

/**
 * Opportunity Intelligence gate: sales, managers, and owners can see the
 * Opportunity Log. Technicians never can — mirrors the server's
 * requireRole("sales") mount so the nav item and route stay consistent
 * with the API-layer 403.
 */
export function isSalesRole(role: UserRole | null | undefined): boolean {
  return role === "sales" || role === "manager" || role === "owner";
}

export function useCurrentUser() {
  const { isSignedIn, isLoaded } = useAuth();
  return useQuery({
    queryKey: ["currentUser"],
    queryFn: async (): Promise<CurrentUser> => {
      const res = await fetch("/api/auth/me");
      if (!res.ok) throw new Error("Not authenticated");
      return res.json();
    },
    enabled: isLoaded && !!isSignedIn,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
}
