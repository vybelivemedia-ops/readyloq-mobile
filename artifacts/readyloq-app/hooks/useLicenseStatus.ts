/**
 * useLicenseStatus
 *
 * Fetches and caches the company's Stripe subscription status from
 * GET /api/billing/license. Called on app startup so the Owner dashboard
 * can surface upgrade prompts and seat-overage warnings without extra taps.
 *
 * Only active for users who have a company (companyId != null).
 * Non-owners see the result but cannot act on it (billing UI is Owner-only).
 */
import { useAuth } from "@clerk/expo";
import { useQuery } from "@tanstack/react-query";

import { API_BASE } from "@/lib/api";

export type SubscriptionTier = "solo" | "micro" | "small" | "growth" | "professional" | "enterprise" | "pilot";

export interface LicenseStatus {
  tier: SubscriptionTier | null;
  status: string | null;           // Stripe subscription.status (active/trialing/past_due/canceled…)
  isActive: boolean;               // true when status === 'active' | 'trialing'
  billedSeats: number;
  activeTeamMembers: number;
  seatOverage: number;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
}

async function fetchLicenseStatus(token: string | null): Promise<LicenseStatus> {
  const headers: HeadersInit = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}/api/billing/license`, { headers });
  if (!res.ok) throw new Error(`License check failed (${res.status})`);
  return (await res.json()) as LicenseStatus;
}

export function useLicenseStatus(enabled = true) {
  const { getToken, isSignedIn } = useAuth();

  return useQuery<LicenseStatus, Error>({
    queryKey: ["license-status"],
    enabled: !!isSignedIn && enabled,
    staleTime: 5 * 60 * 1000,       // re-fetch at most every 5 min
    retry: 1,
    queryFn: async () => {
      const token = await getToken();
      return fetchLicenseStatus(token);
    },
  });
}
