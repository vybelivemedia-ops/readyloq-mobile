/**
 * Backfill estimatedAnnualValue on existing open opportunities.
 *
 * Populates `estimated_annual_value` for every open opportunity (status
 * "new", "reviewed", "quoted") that currently has NULL in that column.
 * Human-entered values (IS NOT NULL) are never touched.
 *
 * Idempotent — safe to re-run; a second pass is a no-op.
 *
 * Prerequisites:
 *   DATABASE_URL must point at the target database (same env var used by
 *   the API server). Example:
 *     DATABASE_URL=postgres://... pnpm --filter @workspace/scripts exec tsx src/backfill-opportunity-values.ts
 *
 * Run with:
 *   pnpm --filter @workspace/scripts exec tsx src/backfill-opportunity-values.ts
 */

import { db, opportunitiesTable, propertyProfilesTable } from "@workspace/db";
import { calculateEstimatedAnnualValue } from "../../artifacts/api-server/src/lib/pricing.js";
import { eq, and, isNull, inArray } from "drizzle-orm";
import type { OpportunityStatus, OpportunityValueTier } from "@workspace/db";

const OPEN_STATUSES: OpportunityStatus[] = ["new", "reviewed", "quoted"];

async function backfill() {
  console.log("ReadyLoq — backfill estimatedAnnualValue on open opportunities\n");

  // ── 1. Query target rows (open + no value yet), left-join property profile ──
  const rows = await db
    .select({
      id: opportunitiesTable.id,
      companyId: opportunitiesTable.companyId,
      propertyAddress: opportunitiesTable.propertyAddress,
      estimatedValueTier: opportunitiesTable.estimatedValueTier,
      riskLevel: opportunitiesTable.riskLevel,
      status: opportunitiesTable.status,
      // From profile (nullable — profile row may not exist; squareFootage is
      // not stored on the profile so we rely on the pricing engine's category default)
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

  console.log(`Found ${rows.length} open opportunit${rows.length === 1 ? "y" : "ies"} with no value set.\n`);

  if (rows.length === 0) {
    console.log("Nothing to do — all open opportunities already have a value.");
    return { updated: 0, skipped: 0 };
  }

  let updated = 0;
  let skipped = 0;

  // ── 2. Compute + write each row ────────────────────────────────────────────
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

    // Guard: only update if still NULL (race-condition safety net).
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
      console.log(
        `  ✓ Updated  id=${row.id.toString().padEnd(6)} status=${row.status.padEnd(8)} ` +
          `value=$${value.toLocaleString().padStart(8)} address="${row.propertyAddress}"`,
      );
      updated++;
    } else {
      console.log(
        `  – Skipped  id=${row.id.toString().padEnd(6)} (already set between query and update)`,
      );
      skipped++;
    }
  }

  return { updated, skipped };
}

backfill()
  .then(({ updated, skipped }) => {
    const total = updated + skipped;
    console.log(
      `\n✅ Done — Updated ${updated} / Skipped ${skipped} / Total ${total}`,
    );
    process.exit(0);
  })
  .catch((err) => {
    console.error("\n❌ Backfill failed:", err instanceof Error ? err.message : err);
    process.exit(1);
  });
