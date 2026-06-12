import { db } from "@workspace/db";
import { analysisResultsTable, reportsTable, type Finding } from "@workspace/db";
import { eq } from "drizzle-orm";

// Idempotent backfill for the Report Confidence model (ReadyLoq V2).
// Adds `evidenceQuality` to existing analysis_results.findings and reports.findings.
// Safe to re-run: each finding is skipped if it already has evidenceQuality.
// Never re-runs the main (non-idempotent) seed.ts and never deletes data.
//
// Quality is assigned by a deterministic hash of category+description so it is stable
// across runs and INTENTIONALLY decorrelated from confidence — a high-confidence finding
// backed by only "fair" evidence is exactly the story the Report Confidence model surfaces.

type Quality = "excellent" | "good" | "fair";

function qualityFor(seed: string): Quality {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
  const r = h % 100;
  if (r < 45) return "excellent";
  if (r < 80) return "good";
  return "fair";
}

function backfillFindings(findings: Finding[] | null): { changed: boolean; findings: Finding[] } {
  const list = findings ?? [];
  let changed = false;
  const next = list.map((f) => {
    if (f.evidenceQuality === "excellent" || f.evidenceQuality === "good" || f.evidenceQuality === "fair") {
      return f;
    }
    changed = true;
    return { ...f, evidenceQuality: qualityFor(`${f.category}|${f.description}`) };
  });
  return { changed, findings: next };
}

async function run() {
  let analysisUpdated = 0;
  let reportsUpdated = 0;

  const analyses = await db.select().from(analysisResultsTable);
  for (const row of analyses) {
    const { changed, findings } = backfillFindings(row.findings);
    if (changed) {
      await db.update(analysisResultsTable).set({ findings }).where(eq(analysisResultsTable.id, row.id));
      analysisUpdated++;
    }
  }

  const reports = await db.select().from(reportsTable);
  for (const row of reports) {
    const { changed, findings } = backfillFindings(row.findings);
    if (changed) {
      await db.update(reportsTable).set({ findings }).where(eq(reportsTable.id, row.id));
      reportsUpdated++;
    }
  }

  if (analysisUpdated === 0 && reportsUpdated === 0) {
    console.log("Evidence quality already backfilled. Nothing to do.");
  } else {
    console.log(`Backfilled evidenceQuality: ${analysisUpdated} analysis rows, ${reportsUpdated} report rows.`);
  }
  process.exit(0);
}

run().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
