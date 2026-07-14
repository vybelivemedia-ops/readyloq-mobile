// Server-authoritative plan entitlement limits.
// These are the source of truth for all feature gating. Routes must never
// accept client-supplied plan names or limits as authoritative.
// Values must stay in sync with DEFAULT_PLANS in routes/subscriptions.ts.
export const PLAN_LIMITS = {
  free: {
    maxPlatforms: 1,      // null = unlimited
    advancedAnalytics: false,
  },
  pro: {
    maxPlatforms: null,
    advancedAnalytics: true,
  },
  enterprise: {
    maxPlatforms: null,
    advancedAnalytics: true,
  },
} as const;

export type PlanName = keyof typeof PLAN_LIMITS;

export function getPlanLimits(plan: string) {
  return PLAN_LIMITS[plan as PlanName] ?? PLAN_LIMITS.free;
}
