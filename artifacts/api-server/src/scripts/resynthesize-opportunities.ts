/**
 * One-time script: re-run opportunity synthesis for every analysis result
 * that has findings but produced no opportunities.
 *
 * Run: pnpm exec tsx src/scripts/resynthesize-opportunities.ts
 */

import { db, analysisResultsTable, opportunitiesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { runOpportunitySynthesis } from "../lib/opportunity-ai";
import type { Finding } from "@workspace/db";

async function main() {
  const rows = await db
    .select({
      id: analysisResultsTable.id,
      companyId: analysisResultsTable.companyId,
      inspectionId: analysisResultsTable.inspectionId,
      findings: analysisResultsTable.findings,
    })
    .from(analysisResultsTable);

  const eligible = rows.filter((r) => Array.isArray(r.findings) && r.findings.length > 0);
  console.log(`Found ${eligible.length} analysis results with findings.`);

  let processed = 0;
  let failed = 0;

  for (const row of eligible) {
    // Check how many opportunities already exist for this inspection
    const existing = await db
      .select({ id: opportunitiesTable.id })
      .from(opportunitiesTable)
      .where(eq(opportunitiesTable.inspectionId, row.inspectionId));

    console.log(
      `Analysis ${row.id} (inspection ${row.inspectionId}, company ${row.companyId}): ` +
      `${row.findings!.length} findings, ${existing.length} existing opportunities`
    );

    try {
      await runOpportunitySynthesis({
        companyId: row.companyId,
        inspectionId: row.inspectionId,
        findings: row.findings as Finding[],
      });
      processed++;
      console.log(`  ✓ Synthesis complete`);
    } catch (err) {
      failed++;
      console.error(`  ✗ Failed:`, err instanceof Error ? err.message : err);
    }
  }

  // Final count
  const totalOpps = await db.select({ id: opportunitiesTable.id }).from(opportunitiesTable);
  console.log(`\nDone. Processed: ${processed}, Failed: ${failed}`);
  console.log(`Total opportunities now in DB: ${totalOpps.length}`);

  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
