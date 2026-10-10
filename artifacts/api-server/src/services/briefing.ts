/**
 * Daily Executive Briefing Service
 *
 * Aggregates a day's telemetry (completed inspections + risk counts +
 * new pipeline value) into a structured narrative digest for owners / VPs.
 *
 * NOTE: riskLevel lives on inspectionScorecardsTable, not inspectionReportsTable.
 *       companyId is always an integer throughout the schema.
 */
import {
  db,
  inspectionScorecardsTable,
  inspectionsTable,
  opportunitiesTable,
} from "@workspace/db";
import { and, count, eq, gte, lt, sql } from "drizzle-orm";

export interface DailyBriefingPayload {
  date: string;
  summary: string;
  inspectionsCount: number;
  criticalRiskCount: number;
  newOpportunities: number;
  pipelineAdded: number;
  recommendation: string;
}

// ── Timezone helpers ──────────────────────────────────────────────────────────

/**
 * Returns the UTC offset in milliseconds for the given IANA timezone at the
 * given UTC instant.
 *
 *   Positive → timezone is AHEAD of UTC  (e.g. UTC+5  → +18_000_000)
 *   Negative → timezone is BEHIND UTC    (e.g. UTC-5  → -18_000_000)
 *
 * Technique: format the UTC instant as local-time parts in the target timezone,
 * then reinterpret those same parts as if they were a UTC time ("fake UTC").
 * The delta between fake-UTC and real UTC equals the timezone offset.
 */
function getOffsetAtInstant(timezone: string, utcInstant: Date): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(utcInstant);

  const p: Record<string, string> = {};
  for (const { type, value } of parts) p[type] = value;

  // en-CA hour12:false can emit "24" for midnight; clamp to 0.
  const hour = parseInt(p.hour ?? "0", 10) % 24;
  const localAsUtcMs = Date.UTC(
    parseInt(p.year ?? "1970", 10),
    parseInt(p.month ?? "1", 10) - 1,
    parseInt(p.day ?? "1", 10),
    hour,
    parseInt(p.minute ?? "0", 10),
    parseInt(p.second ?? "0", 10),
    0,
  );

  return localAsUtcMs - utcInstant.getTime();
}

/**
 * Returns { y, m, d } for the local date shown in `timezone` at `utcInstant`.
 * Used to verify a computed boundary falls on the expected calendar date.
 */
function localDateComponents(
  utcInstant: Date,
  timezone: string,
): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(utcInstant);
  const p: Record<string, string> = {};
  for (const { type, value } of parts) p[type] = value;
  return {
    y: parseInt(p.year ?? "0", 10),
    m: parseInt(p.month ?? "0", 10),
    d: parseInt(p.day ?? "0", 10),
  };
}

/**
 * Compute the UTC instants bounding a single calendar day in the specified
 * IANA timezone, where `end` is the **exclusive** upper bound (= the first
 * instant of the next local day).
 *
 * Algorithm — DST-safe:
 *   For each boundary (start-of-day and start-of-next-day):
 *   1. Measure the UTC offset at UTC midnight.
 *   2. Compute an initial estimate: `local midnight ≈ UTC midnight − offset`.
 *   3. Re-measure the offset at the estimate (correction step) — handles the
 *      case where the DST transition falls between UTC midnight and local
 *      midnight (e.g. spring-forward at 2 am, where midnight is still in the
 *      old offset but noon has already crossed into the new one).
 *   4. Verify the local date shown at the result matches the expected calendar
 *      date.  If not, the boundary falls in a skipped or repeated clock region
 *      (rare midnight DST transition).  In that case the initial estimate
 *      (`startEstimate`) is the first valid instant of the day, so we fall
 *      back to it.
 *
 * Examples (EDT = UTC-4, EST = UTC-5):
 *   dayBoundsInTimezone("2026-08-14", "America/New_York")
 *   → start = 2026-08-14T04:00:00.000Z  (midnight EDT)
 *   → end   = 2026-08-15T04:00:00.000Z  (next midnight EDT, exclusive)
 *
 *   dayBoundsInTimezone("2025-03-09", "America/New_York")  ← spring-forward day
 *   → start = 2025-03-09T05:00:00.000Z  (midnight EST — 23 h day)
 *   → end   = 2025-03-10T04:00:00.000Z  (midnight EDT, exclusive)
 *
 *   dayBoundsInTimezone("2025-11-02", "America/New_York")  ← fall-back day
 *   → start = 2025-11-02T04:00:00.000Z  (midnight EDT — 25 h day)
 *   → end   = 2025-11-03T05:00:00.000Z  (midnight EST, exclusive)
 */
export function dayBoundsInTimezone(
  isoDate: string,
  timezone: string,
): { start: Date; end: Date } {
  const [year, month, day] = isoDate.split("-").map(Number);

  // ── Local boundary resolver ───────────────────────────────────────────────
  // Resolve the UTC instant for local midnight of any given UTC date,
  // applying the two-step correction and date-verification.
  function resolveLocalMidnight(
    utcY: number,
    utcM: number,
    utcD: number,
    expectedY: number,
    expectedM: number,
    expectedD: number,
  ): Date {
    const utcMidnight = new Date(Date.UTC(utcY, utcM - 1, utcD, 0, 0, 0, 0));
    const offset0 = getOffsetAtInstant(timezone, utcMidnight);
    const estimate = new Date(utcMidnight.getTime() - offset0);
    const offset1 = getOffsetAtInstant(timezone, estimate);
    const corrected = offset1 !== offset0
      ? new Date(utcMidnight.getTime() - offset1)
      : estimate;

    // Verify the corrected result shows the expected local date.
    // If not (midnight-skip DST transition), fall back to the initial estimate,
    // which is the first valid instant of the local day.
    const { y, m, d } = localDateComponents(corrected, timezone);
    if (y !== expectedY || m !== expectedM || d !== expectedD) {
      return estimate;
    }
    return corrected;
  }

  // Start of the local day (local 00:00:00).
  const start = resolveLocalMidnight(year, month, day, year, month, day);

  // Start of the next local day — used as the exclusive upper bound.
  // Compute nextDay components via Date.UTC to handle month/year rollovers.
  const nextDayUtc = new Date(Date.UTC(year, month - 1, day + 1));
  const ny = nextDayUtc.getUTCFullYear();
  const nm = nextDayUtc.getUTCMonth() + 1;
  const nd = nextDayUtc.getUTCDate();
  const end = resolveLocalMidnight(ny, nm, nd, ny, nm, nd);

  return { start, end };
}

// ── Main service ──────────────────────────────────────────────────────────────

/**
 * Generate a daily executive briefing for the given company and calendar date.
 *
 * @param companyId  - The company to aggregate telemetry for.
 * @param isoDate    - The requested day as a YYYY-MM-DD string in the owner's
 *                     timezone (e.g. "2026-08-14").  The caller is responsible
 *                     for deriving this from the owner's local calendar, not
 *                     from the server's timezone.
 * @param timezone   - IANA timezone string for the owner (e.g. "America/New_York").
 *                     Defaults to "UTC".  Day boundaries are computed in this
 *                     timezone so an owner in UTC-5 never sees inspections
 *                     completed after 7 pm silently shifted to the next day.
 */
export async function generateDailyExecutiveBriefing(
  companyId: number,
  isoDate: string,
  timezone: string = "UTC",
): Promise<{ success: true; briefing: DailyBriefingPayload }> {
  // end is the exclusive upper bound (first instant of the next local day).
  const { start: startOfDay, end: endOfDay } = dayBoundsInTimezone(isoDate, timezone);

  // ── 1. Completed inspections in the day window ────────────────────────────
  const [inspectionRow] = await db
    .select({ totalInspections: count(inspectionsTable.id) })
    .from(inspectionsTable)
    .where(
      and(
        eq(inspectionsTable.companyId, companyId),
        eq(inspectionsTable.status, "completed"),
        gte(inspectionsTable.createdAt, startOfDay),
        lt(inspectionsTable.createdAt, endOfDay),  // exclusive upper bound
      ),
    );

  // ── 2. Critical-risk count from scorecards (joined on completion date) ────
  const [riskRow] = await db
    .select({
      criticalRisks: sql<number>`
        sum(case when ${inspectionScorecardsTable.riskLevel} = 'critical' then 1 else 0 end)
      `,
    })
    .from(inspectionScorecardsTable)
    .innerJoin(
      inspectionsTable,
      eq(inspectionsTable.id, inspectionScorecardsTable.inspectionId),
    )
    .where(
      and(
        eq(inspectionScorecardsTable.companyId, companyId),
        gte(inspectionsTable.createdAt, startOfDay),
        lt(inspectionsTable.createdAt, endOfDay),  // exclusive upper bound
      ),
    );

  // ── 3. New opportunities created in the day window ────────────────────────
  const [oppRow] = await db
    .select({
      newPipelineValue: sql<number>`coalesce(sum(${opportunitiesTable.estimatedAnnualValue}), 0)`,
      newOpportunities: count(opportunitiesTable.id),
    })
    .from(opportunitiesTable)
    .where(
      and(
        eq(opportunitiesTable.companyId, companyId),
        gte(opportunitiesTable.createdAt, startOfDay),
        lt(opportunitiesTable.createdAt, endOfDay),  // exclusive upper bound
      ),
    );

  // ── 4. Synthesise ─────────────────────────────────────────────────────────
  const totalInspections = Number(inspectionRow?.totalInspections ?? 0);
  const criticalRisks = Number(riskRow?.criticalRisks ?? 0);
  const newPipelineValue = Number(oppRow?.newPipelineValue ?? 0);
  const newOpportunities = Number(oppRow?.newOpportunities ?? 0);

  const inspectionWord = totalInspections === 1 ? "inspection" : "inspections";
  const alertPhrase =
    criticalRisks > 0
      ? ` with ${criticalRisks} critical risk alert${criticalRisks === 1 ? "" : "s"} flagged`
      : " with no critical risk alerts";

  const briefing: DailyBriefingPayload = {
    date: isoDate,
    summary: `Yesterday your team completed ${totalInspections} ${inspectionWord}${alertPhrase}. New pipeline value added: $${newPipelineValue.toLocaleString()}.`,
    inspectionsCount: totalInspections,
    criticalRiskCount: criticalRisks,
    newOpportunities,
    pipelineAdded: newPipelineValue,
    recommendation:
      criticalRisks > 0
        ? "Prioritize reviewing the critical-risk sites flagged by Quinn before the day begins."
        : "Operations ran within normal quality thresholds — no critical compliance violations yesterday.",
  };

  return { success: true, briefing };
}
