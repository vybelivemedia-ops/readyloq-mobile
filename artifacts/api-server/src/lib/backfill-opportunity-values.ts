/**
 * Backfill: set estimatedAnnualValue for legacy open opportunities.
 *
 * Populates `estimated_annual_value` for every OPEN opportunity (status
 * "new", "reviewed", "quoted") that currently has NULL in that column.
 * Human-entered values (IS NOT NULL) are never touched — the UPDATE itself
 * is guarded with `AND estimatedAnnualValue IS NULL` so a concurrent sales
 * edit cannot be overwritten even if it races between the initial SELECT and
 * this UPDATE.
 *
 * Idempotent — safe to re-run on every boot; if there is nothing to fix this
 * is a single cheap SELECT that returns 0 rows and exits immediately.
 *
 * Property type resolution: left-joins propertyProfilesTable so that
 * explicitly typed properties (e.g. "Multifamily", "Restaurant") get accurate
 * pricing. Falls back to "residential" when no profile exists, matching the
 * same logic used in scripts/src/backfill-opportunity-values.ts.
 */

import { db, opportunitiesTable, propertyProfilesTable } from "@workspace/db";
import { eq, and, isNull, inArray } from "drizzle-orm";
import type { OpportunityStatus, OpportunityValueTier } from "@workspace/db";
import { calculateEstimatedAnnualValue } from "./pricing";
import { logger } from "./logger";

const OPEN_STATUSES: OpportunityStatus[] = ["new", "reviewed", "quoted"];

export async function backfillOpportunityValues(): Promise<void> {
  // ── 1. Query open null-value rows, left-join property profile for type ──────
  const rows = await db
    .select({
      id: opportunitiesTable.id,
      propertyAddress: opportunitiesTable.propertyAddress,
      estimatedValueTier: opportunitiesTable.estimatedValueTier,
      riskLevel: opportunitiesTable.riskLevel,
      status: opportunitiesTable.status,
      // Profile may not exist; fall back to "residential" below.
      propertyType: propertyProfilesTable.propertyType,
    })
    .from(opportunitiesTable)
    .leftJoin(
      propertyProfilesTable,
      and(
        eq(propertyProfilesTable.companyId, opportunitiesTable.companyId),
        eq(propertyProfilesTable.siteAddress, opportunitiesTable.propertyAddress),
      ),
    )
    .where(
      and(
        inArray(opportunitiesTable.status, OPEN_STATUSES),
        isNull(opportunitiesTable.estimatedAnnualValue),
      ),
    );

  if (rows.length === 0) {
    logger.info("backfillOpportunityValues: nothing to backfill");
    return;
  }

  logger.info({ count: rows.length }, "backfillOpportunityValues: starting");

  let updated = 0;
  let skipped = 0;

  // ── 2. Compute + conditionally write each row ─────────────────────────────
  for (const row of rows) {
    const propertyType = row.propertyType ?? "residential";
    const tier = (row.estimatedValueTier ?? "medium") as OpportunityValueTier;
    const riskLevel = row.riskLevel ?? null;

    const value = calculateEstimatedAnnualValue({
      propertyType,
      tier,
      riskLevel,
      squareFootage: null, // not stored on the profile; pricing engine uses category default
    });

    // Guard: AND estimatedAnnualValue IS NULL on the UPDATE prevents
    // overwriting a value that was entered by sales between our SELECT and now.
    const result = await db
      .update(opportunitiesTable)
      .set({ estimatedAnnualValue: value, updatedAt: new Date() })
      .where(
        and(
          eq(opportunitiesTable.id, row.id),
          isNull(opportunitiesTable.estimatedAnnualValue),
        ),
      )
      .returning({ id: opportunitiesTable.id });

    if (result.length > 0) {
      updated++;
    } else {
      // A concurrent edit set the value between our SELECT and this UPDATE.
      skipped++;
    }
  }

  logger.info(
    { updated, skipped, total: rows.length },
    "backfillOpportunityValues: complete",
  );
}
