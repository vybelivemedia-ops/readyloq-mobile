/**
 * Backfill: write property_memory rows for completed inspections that do not
 * yet have one.
 *
 * Groups all completed inspections by (companyId, normalizedAddressKey) and
 * calls writePropertyMemory once per pair that lacks a memory row.
 * writePropertyMemory recomputes from scratch from every completed inspection
 * at the address — so a single call per pair is sufficient.
 *
 * An "all-clear" inspection (no analysis rows) still marks a prior visit;
 * its contribution is an updated lastVisitedAt with empty pests/findings.
 *
 * Idempotent — safe to re-run on every boot.  A single cheap SELECT that
 * returns no uncovered pairs exits immediately with nothing to do.
 */

import {
  db,
  inspectionsTable,
  propertyMemoryTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { normalizeAddressKey } from "./property-intelligence";
import { writePropertyMemory } from "./property-memory-writer";
import { logger } from "./logger";

export async function backfillPropertyMemory(): Promise<void> {
  // 1. All completed inspections with a normalizable address.
  const inspections = await db
    .select()
    .from(inspectionsTable)
    .where(eq(inspectionsTable.status, "completed"));

  const addressed = inspections.filter(
    (i) => !!normalizeAddressKey(i.siteAddress ?? ""),
  );

  if (addressed.length === 0) {
    logger.info("backfillPropertyMemory: no completed inspections — skipping");
    return;
  }

  // 2. Existing memory rows: build a Set of "companyId::addressKey" keys.
  const existingMemory = await db.select().from(propertyMemoryTable);
  const coveredKeys = new Set(
    existingMemory.map((m) => `${m.companyId}::${m.addressKey}`),
  );

  // 3. Collect one representative inspection per uncovered (companyId, addressKey)
  //    pair.  writePropertyMemory reads all completed inspections itself, so we
  //    only need to know which pairs need a write — not which inspection to use.
  const pairsToWrite = new Map<
    string,
    { companyId: number; inspectionId: number; siteAddress: string }
  >();

  for (const insp of addressed) {
    const key = normalizeAddressKey(insp.siteAddress ?? "") as string;
    const groupKey = `${insp.companyId}::${key}`;
    if (coveredKeys.has(groupKey)) continue;
    // Use the most recently completed inspection as the representative
    // (overwrite earlier ones — last write wins, all produce the same result).
    const existing = pairsToWrite.get(groupKey);
    const ts = insp.completedAt ? new Date(insp.completedAt).getTime() : 0;
    const existingTs = existing?.inspectionId
      ? 0 // we don't track timestamp here; just overwrite to get latest
      : -1;
    if (!existing || ts > existingTs) {
      pairsToWrite.set(groupKey, {
        companyId: insp.companyId,
        inspectionId: insp.id,
        siteAddress: insp.siteAddress ?? "",
      });
    }
  }

  if (pairsToWrite.size === 0) {
    logger.info(
      "backfillPropertyMemory: all addresses already have memory rows",
    );
    return;
  }

  logger.info(
    { pairs: pairsToWrite.size },
    "backfillPropertyMemory: starting",
  );

  let written = 0;
  let skipped = 0;

  for (const pair of pairsToWrite.values()) {
    try {
      await writePropertyMemory(pair);
      written++;
    } catch (err) {
      logger.warn(
        { err, ...pair },
        "backfillPropertyMemory: failed to write memory row — skipping",
      );
      skipped++;
    }
  }

  logger.info({ written, skipped }, "backfillPropertyMemory: complete");
}
