---
name: Property-visit grouping & retreatment-interval compliance
description: How "a visit" is defined for drill-down history, and how chemical retreatment-interval compliance is computed from treatment logs.
---

## Visit grouping
A "visit" = every inspection sharing company + site address + calendar date, where calendar date is `COALESCE(scheduledDate, createdAt)::date`. This covers both a single-family stop (one inspection) and a multi-unit property visited the same day (one inspection per unit, distinguished by the existing `unitNumber` field). Group by re-querying inspections with that same triple, not by any explicit "visit" foreign key — there is no visit table.

`visitPurpose` (freeform nullable text on `inspections`, not an enum) captures why the visit happened, deliberately unstructured so a future legacy-import "stop type" field can populate it too.

## Retreatment-interval compliance
`product_label_rules.retreatmentIntervalDays` (nullable int) is the minimum whole days before a product may legally be reapplied to the *same address*. It is distinct from `reEntryIntervalHours`, which is a human safety window measured in hours, not a legal reapplication gate.

Per treatment log entry, compliance is computed on read (not stored) by:
1. Finding the most recent PRIOR application of the same `productId` at the same `siteAddress` (company-scoped), strictly before the current log's `appliedAt`.
2. `daysSincePrior` = floor((current.appliedAt − prior.appliedAt) / 1 day).
3. `isCompliant` = interval is null, OR no prior application, OR `daysSincePrior >= retreatmentIntervalDays`.
4. `nextEligibleReapplicationDate` = current.appliedAt + interval days (only when interval is set); `eligibleNow` = that date has passed (or no interval).

**Why:** this makes the compliance badge purely derived — no migration needed if the interval value changes later, and it naturally handles the "no prior application" and "no interval configured" cases without special-casing the UI.

**Gap (tracked as follow-up task, not yet built):** this check currently only surfaces in the read-only property-visit history screen. It does NOT warn a technician in `TreatmentLogWizard` at the moment they're about to log a new application — that would need the same prior-lookup exposed near submission time.
