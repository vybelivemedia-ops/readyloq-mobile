/**
 * Shared retreatment-interval compliance math for chemical applications.
 *
 * A product label may set a `retreatmentIntervalDays` — the minimum number of
 * whole days that must pass before the SAME product may legally be reapplied
 * to the SAME site. Two call sites need this math:
 *
 *  1. Historical ledger (schedule.ts `/property-visit/:id`) — for a logged
 *     application, was it compliant relative to the PRIOR application of the
 *     same product at the same address?
 *  2. Route Chemical Outlook (schedule.ts `/route-calendar`, `/route-outlook`)
 *     — projecting FORWARD from the most recent application, is the product
 *     due, due-soon, or overdue for reapplication as of today?
 *
 * Both share the same date arithmetic; this module is the single source of
 * truth for it so the two features can't silently drift apart.
 */

const DAY_MS = 86_400_000;

export interface ChemicalCompliance {
  retreatmentIntervalDays: number | null;
  priorApplicationAt: string | null;
  daysSincePrior: number | null;
  isCompliant: boolean;
  nextEligibleReapplicationDate: string | null;
  eligibleNow: boolean;
}

/**
 * Historical compliance check: was `appliedAt` compliant relative to the most
 * recent PRIOR application (`priorApplicationAt`) of the same product at the
 * same address, given the label's `retreatmentIntervalDays`?
 */
export function computeApplicationCompliance(
  retreatmentIntervalDays: number | null,
  priorApplicationAt: Date | null,
  appliedAt: Date,
): ChemicalCompliance {
  const daysSincePrior = priorApplicationAt
    ? Math.floor((appliedAt.getTime() - priorApplicationAt.getTime()) / DAY_MS)
    : null;
  const isCompliant =
    retreatmentIntervalDays == null ||
    daysSincePrior == null ||
    daysSincePrior >= retreatmentIntervalDays;

  const nextEligibleReapplicationDate =
    retreatmentIntervalDays != null
      ? new Date(appliedAt.getTime() + retreatmentIntervalDays * DAY_MS)
      : null;
  const eligibleNow =
    nextEligibleReapplicationDate == null || nextEligibleReapplicationDate.getTime() <= Date.now();

  return {
    retreatmentIntervalDays,
    priorApplicationAt: priorApplicationAt ? priorApplicationAt.toISOString() : null,
    daysSincePrior,
    isCompliant,
    nextEligibleReapplicationDate: nextEligibleReapplicationDate
      ? nextEligibleReapplicationDate.toISOString()
      : null,
    eligibleNow,
  };
}

/** "ok" = not due yet and not due soon. "due-soon" = becoming eligible within
 *  the next 7 days, or just became eligible within the last 14 days.
 *  "overdue" = has been eligible for 14+ days past its interval with no
 *  follow-up application recorded — a service window was likely missed. */
export type RouteOutlookStatus = "ok" | "due-soon" | "overdue";

const DUE_SOON_LOOKAHEAD_DAYS = 7;
const OVERDUE_GRACE_DAYS = 14;

export interface ForwardEligibility {
  daysSinceApplication: number;
  nextEligibleReapplicationDate: string | null;
  eligibleNow: boolean;
  outlookStatus: RouteOutlookStatus;
}

/**
 * Projects FORWARD from a product's most recent application to determine
 * whether it is due, due-soon, or overdue for reapplication as of `asOf`
 * (defaults to now). Deterministic/statistical — not a trained forecast.
 */
export function computeForwardEligibility(
  retreatmentIntervalDays: number | null,
  lastAppliedAt: Date,
  asOf: Date = new Date(),
): ForwardEligibility {
  const daysSinceApplication = Math.floor((asOf.getTime() - lastAppliedAt.getTime()) / DAY_MS);

  if (retreatmentIntervalDays == null) {
    // No label-defined interval to project against — nothing to flag.
    return {
      daysSinceApplication,
      nextEligibleReapplicationDate: null,
      eligibleNow: true,
      outlookStatus: "ok",
    };
  }

  const nextEligibleDate = new Date(lastAppliedAt.getTime() + retreatmentIntervalDays * DAY_MS);
  const eligibleNow = nextEligibleDate.getTime() <= asOf.getTime();

  let outlookStatus: RouteOutlookStatus;
  if (eligibleNow) {
    const graceDays = daysSinceApplication - retreatmentIntervalDays;
    outlookStatus = graceDays >= OVERDUE_GRACE_DAYS ? "overdue" : "due-soon";
  } else {
    const daysUntilEligible = Math.ceil((nextEligibleDate.getTime() - asOf.getTime()) / DAY_MS);
    outlookStatus = daysUntilEligible <= DUE_SOON_LOOKAHEAD_DAYS ? "due-soon" : "ok";
  }

  return {
    daysSinceApplication,
    nextEligibleReapplicationDate: nextEligibleDate.toISOString(),
    eligibleNow,
    outlookStatus,
  };
}
