/**
 * Week-bar tap-guard helpers for the Executive Quality Trend chart.
 *
 * Extracted from QualityTrendChart so that:
 *  - Tests can assert guard and copy decisions without rendering React Native.
 *  - All copy strings for the two outcomes (empty-week Alert vs drill-down
 *    empty state) live in one place and drift together.
 *
 * ## Two distinct "empty" outcomes
 *
 * 1. **Zero-score bar tap** (`avgQuality === 0`)
 *    The trend API returned no score for that week.  Tapping the bar shows an
 *    Alert (visible, immediate feedback) instead of opening the drill-down to
 *    a dead screen.  Copy: ZERO_WEEK_ALERT_TITLE / zeroWeekAlertBody().
 *
 * 2. **Race-condition empty list** (`avgQuality > 0` but API returns 0 rows)
 *    The bar looked scored when the trend loaded, but by the time the user
 *    navigates the score was deleted.  ExecutiveWeekInspectionsScreen renders
 *    its empty-state view.  Copy: WEEK_EMPTY_HEADING / weekEmptySubtitle().
 */

import type { ExecutiveQualityWeek } from "@/lib/api";

// ─── Tap-guard ────────────────────────────────────────────────────────────────

/**
 * Returns true when tapping a bar should produce a visible response.
 *
 * Every bar is tappable when a handler is provided — zero-score bars fire an
 * Alert (see zeroWeekAlertBody); non-zero bars navigate to the drill-down.
 * Silently swallowing the tap (old behaviour) violated the "no silent failure"
 * rule and confused owners who expected feedback.
 */
export function isWeekBarTappable(
  _week: Pick<ExecutiveQualityWeek, "avgQuality">,
  onPressWeekProvided: boolean,
): boolean {
  return onPressWeekProvided;
}

/**
 * Returns true when the tap should NAVIGATE to the drill-down.
 * Zero-score bars are tappable but should show an Alert instead.
 */
export function weekBarNavigates(
  week: Pick<ExecutiveQualityWeek, "avgQuality">,
): boolean {
  return week.avgQuality > 0;
}

// ─── Zero-bar Alert copy ──────────────────────────────────────────────────────

/**
 * Alert title shown when the owner taps a zero-score bar in the trend chart.
 */
export const ZERO_WEEK_ALERT_TITLE = "No inspections scored";

/**
 * Alert body shown when the owner taps a zero-score bar.
 * Explains why nothing happened so the owner is not confused.
 */
export function zeroWeekAlertBody(weekLabel: string): string {
  return `No inspections were scored during the week of ${weekLabel}. Complete and score an inspection to see data for this week.`;
}

// ─── Drill-down empty-state copy (race-condition path) ───────────────────────

/**
 * Heading shown in ExecutiveWeekInspectionsScreen when the API returns an
 * empty list (e.g. the score was deleted after the trend loaded).
 */
export const WEEK_EMPTY_HEADING = "No scored inspections";

/**
 * Subtitle shown in ExecutiveWeekInspectionsScreen when the API returns an
 * empty list, interpolated with the week label.
 */
export function weekEmptySubtitle(weekLabel: string): string {
  return `No inspections were scored during the week of ${weekLabel}.`;
}
