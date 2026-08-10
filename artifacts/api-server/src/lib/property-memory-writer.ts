/**
 * Property Memory Writer
 *
 * Writes (or refreshes) the property_memory row for a (companyId, addressKey)
 * pair by recomputing the distilled history from ALL completed inspections at
 * that address.  Called once at the end of the explicit completion pipeline
 * (runInspectionFinalization step 6) — never from in-progress or draft
 * analysis runs.
 *
 * Idempotency guarantee
 * ─────────────────────
 * The memory row is always fully replaced from the canonical source of truth
 * (every completed inspection + latest completed analysis at this address).
 * Calling the function multiple times for the same inspection — retries, race
 * conditions, or future re-runs — produces the same result because the output
 * is a pure function of what is in the database.
 *
 * Frequency semantics
 * ───────────────────
 * historicalFindings[n].frequency = number of distinct completed inspections
 * at this address whose latest analysis contained that (category, description)
 * pair.  An "all-clear" inspection (no findings) contributes its visit date
 * but adds no findings — it is still a valid prior visit.
 *
 * Tenant isolation
 * ────────────────
 * All queries are scoped to companyId.  Two companies sharing a physical
 * address each get their own independent memory row.
 */

import {
  db,
  inspectionsTable,
  analysisResultsTable,
  propertyMemoryTable,
  type Finding,
  type HistoricalFinding,
} from "@workspace/db";
import { eq, and, desc, inArray } from "drizzle-orm";
import { normalizeAddressKey } from "./property-intelligence";
import { logger } from "./logger";

export interface WritePropertyMemoryInput {
  companyId: number;
  /** The inspection that just completed — stored as lastInspectionId. */
  inspectionId: number;
  siteAddress: string;
}

/**
 * Extract a canonical pest name from a Finding.
 * Prefers the technician-corrected species (reviewStatus = "corrected"),
 * then falls back to the AI display label.  Strips the "Possible: " prefix
 * added by the confidence-label step so "Possible: Norway Rat" and
 * "Norway Rat" deduplicate correctly.
 */
function findingPestName(f: Finding): string | null {
  const raw =
    f.reviewStatus === "corrected" ? (f.technicianSpecies ?? f.species) : f.species;
  if (!raw?.trim()) return null;
  return raw.replace(/^Possible:\s*/i, "").trim() || null;
}

/**
 * Recompute the full property memory for (companyId, siteAddress) from
 * the database and upsert it as a single atomic replace.
 *
 * Skips silently when siteAddress cannot be normalized (address-less
 * inspections must never be grouped together in memory).
 */
export async function writePropertyMemory(
  input: WritePropertyMemoryInput,
): Promise<void> {
  const { companyId, inspectionId, siteAddress } = input;

  const addressKey = normalizeAddressKey(siteAddress);
  if (!addressKey) {
    logger.debug(
      { companyId, inspectionId },
      "writePropertyMemory: empty address key — skipping",
    );
    return;
  }

  // ── 1. All completed inspections at this (company, address) ──────────────
  const allInspections = await db
    .select()
    .from(inspectionsTable)
    .where(
      and(
        eq(inspectionsTable.companyId, companyId),
        eq(inspectionsTable.status, "completed"),
      ),
    );

  const matchedInspections = allInspections.filter(
    (i) => normalizeAddressKey(i.siteAddress ?? "") === addressKey,
  );

  if (matchedInspections.length === 0) {
    logger.debug(
      { companyId, inspectionId, addressKey },
      "writePropertyMemory: no completed inspections at address — skipping",
    );
    return;
  }

  // ── 2. Latest completed analysis per inspection ───────────────────────────
  const inspectionIds = matchedInspections.map((i) => i.id);
  const analyses = await db
    .select()
    .from(analysisResultsTable)
    .where(
      and(
        eq(analysisResultsTable.companyId, companyId),
        eq(analysisResultsTable.status, "complete"),
        inArray(analysisResultsTable.inspectionId, inspectionIds),
      ),
    )
    .orderBy(desc(analysisResultsTable.createdAt));

  // Keep only the latest analysis per inspection (rows are newest-first).
  const latestByInspection = new Map<number, typeof analysisResultsTable.$inferSelect>();
  for (const row of analyses) {
    if (row.inspectionId == null || latestByInspection.has(row.inspectionId)) continue;
    latestByInspection.set(row.inspectionId, row);
  }

  // ── 3. Recompute historicalPests and historicalFindings from scratch ──────
  const pestsSeen = new Set<string>();
  const historicalPests: string[] = [];

  // (category, description) → count of inspections where it appeared.
  const findingFreq = new Map<string, { hf: HistoricalFinding; count: number }>();

  for (const insp of matchedInspections) {
    const analysis = latestByInspection.get(insp.id);
    const findings = (analysis?.findings ?? []) as Finding[];

    // Pests: union across all inspections, deduped case-insensitively.
    for (const f of findings) {
      const name = findingPestName(f);
      if (!name) continue;
      const key = name.toLowerCase();
      if (!pestsSeen.has(key)) {
        pestsSeen.add(key);
        historicalPests.push(name);
      }
    }

    // Findings: frequency = # inspections where (category, description) appeared.
    const seenThisInsp = new Set<string>();
    for (const f of findings) {
      const cat = f.category ?? "observation";
      const desc = f.description ?? cat;
      const key = `${cat}::${desc}`;
      if (seenThisInsp.has(key)) continue; // count each finding once per inspection
      seenThisInsp.add(key);

      const entry = findingFreq.get(key);
      if (entry) {
        entry.count++;
        entry.hf.severity = (f.severity as "low" | "medium" | "high") ?? entry.hf.severity;
      } else {
        findingFreq.set(key, {
          hf: {
            category: cat,
            description: desc,
            frequency: 1,
            severity: (f.severity as "low" | "medium" | "high") ?? undefined,
          },
          count: 1,
        });
      }
    }
  }

  // Sync frequency from the count (should always agree, but explicit is safer).
  const historicalFindings: HistoricalFinding[] = Array.from(findingFreq.values()).map(
    ({ hf, count }) => ({ ...hf, frequency: count }),
  );

  // lastVisitedAt = latest completedAt among matched inspections.
  const lastVisitedAt = matchedInspections.reduce<Date | null>((best, i) => {
    const ts = i.completedAt ? new Date(i.completedAt) : null;
    if (!ts) return best;
    return best === null || ts > best ? ts : best;
  }, null);

  // ── 4. Upsert (full replace — not incremental merge) ─────────────────────
  const [existing] = await db
    .select()
    .from(propertyMemoryTable)
    .where(
      and(
        eq(propertyMemoryTable.companyId, companyId),
        eq(propertyMemoryTable.addressKey, addressKey),
      ),
    )
    .limit(1);

  const now = new Date();

  if (existing) {
    await db
      .update(propertyMemoryTable)
      .set({
        siteAddress,
        lastInspectionId: inspectionId,
        lastVisitedAt,
        historicalPests,
        historicalFindings,
        updatedAt: now,
      })
      .where(
        and(
          eq(propertyMemoryTable.companyId, companyId),
          eq(propertyMemoryTable.addressKey, addressKey),
        ),
      );

    logger.info(
      {
        companyId,
        inspectionId,
        addressKey,
        pests: historicalPests.length,
        findings: historicalFindings.length,
      },
      "writePropertyMemory: updated",
    );
  } else {
    await db.insert(propertyMemoryTable).values({
      companyId,
      addressKey,
      siteAddress,
      lastInspectionId: inspectionId,
      lastVisitedAt,
      historicalPests,
      historicalFindings,
    });

    logger.info(
      {
        companyId,
        inspectionId,
        addressKey,
        pests: historicalPests.length,
        findings: historicalFindings.length,
      },
      "writePropertyMemory: created",
    );
  }
}
