/**
 * Shared local-calendar-date helpers.
 *
 * `technicianDailyRigsTable.rigDate` is written by the mobile daily-route
 * client using the technician's OWN DEVICE local calendar date (see
 * `todayDateString()` in readyloq-app/lib/api-client/daily-route.ts — that
 * file deliberately avoids UTC after a prior UTC day-boundary bug). Any
 * server-side computation that keys against that table (Route Readiness,
 * Route Calendar, Route Chemical Outlook, Today's Route Readiness, and Truck
 * Stock Health) needs to bucket/label calendar dates in the SAME local frame
 * the caller is in, not UTC — so every one of those endpoints accepts an
 * optional `tzOffsetMinutes` query param (the same value
 * `Date.prototype.getTimezoneOffset()` returns on the caller's device) and
 * uses these helpers. Omitting it falls back to UTC.
 *
 * Originally inlined in schedule.ts; extracted so daily-rig.ts and the
 * inventory-forecasting/route-readiness helpers can share the exact same
 * date arithmetic instead of drifting apart.
 */

export function parseTzOffsetMinutes(raw: unknown): number {
  const n = typeof raw === "string" ? Number(raw) : NaN;
  if (!Number.isFinite(n)) return 0;
  // Clamp to a real-world range (UTC-14..UTC+14) to guard against garbage input.
  return Math.max(-840, Math.min(840, Math.trunc(n)));
}

/** Calendar-date string for `d` as seen by a caller at UTC offset `tzOffsetMinutes`
 *  (JS `getTimezoneOffset()` convention: minutes to ADD to local time to reach UTC). */
export function localCalendarDate(d: Date, tzOffsetMinutes: number): string {
  return new Date(d.getTime() - tzOffsetMinutes * 60_000).toISOString().slice(0, 10);
}

/** The UTC instant corresponding to local midnight of `dateStr` at the given offset. */
export function localMidnightUtc(dateStr: string, tzOffsetMinutes: number): Date {
  return new Date(Date.parse(`${dateStr}T00:00:00.000Z`) + tzOffsetMinutes * 60_000);
}

/** The UTC instant corresponding to local end-of-day of `dateStr` at the given offset. */
export function localEndOfDayUtc(dateStr: string, tzOffsetMinutes: number): Date {
  return new Date(Date.parse(`${dateStr}T23:59:59.999Z`) + tzOffsetMinutes * 60_000);
}
