// ─── Marketing Director capability: waitlist + launch assets ──────────────────
import path from "path";
import { sql } from "drizzle-orm";
import { db, betaWaitlistTable } from "@workspace/db";
import type { ExecutiveReport } from "./index.js";
import { findRepoRoot, walkFiles, isImageFile, listDirs } from "./repo.js";
import { CURRENT_STAGE, NEXT_MILESTONE } from "../../config/roadmap.js";

export async function inspectMarketing(): Promise<ExecutiveReport> {
  const root = findRepoRoot();

  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(betaWaitlistTable);
  const waitlist = Number(total);

  const byType = await db
    .select({ type: betaWaitlistTable.creatorType, n: sql<number>`count(*)::int` })
    .from(betaWaitlistTable)
    .groupBy(betaWaitlistTable.creatorType);
  const topType = [...byType].sort((a, b) => Number(b.n) - Number(a.n))[0];

  // Launch asset inventory.
  let launchAssets = 0;
  for (const f of walkFiles(path.join(root, "attached_assets"))) {
    if (isImageFile(f)) launchAssets++;
  }

  // Marketing surfaces present in the workspace.
  const artifacts = listDirs(path.join(root, "artifacts"));
  const hasWebsite = artifacts.includes("website");
  const hasMarketing = artifacts.includes("marketing");

  const findings: ExecutiveReport["findings"] = [];
  if (waitlist === 0) {
    findings.push({
      severity: "warning",
      text: "No beta waitlist signups yet — top-of-funnel needs a push.",
    });
  } else {
    findings.push({
      severity: "info",
      text: `${waitlist} waitlist signup(s)${topType ? `, mostly "${topType.type}" creators` : ""}.`,
    });
  }
  if (!hasWebsite && !hasMarketing) {
    findings.push({ severity: "warning", text: "No marketing site artifact detected." });
  } else {
    findings.push({
      severity: "info",
      text: `Marketing surfaces live: ${[hasWebsite && "website", hasMarketing && "marketing"].filter(Boolean).join(", ")}.`,
    });
  }
  findings.push({
    severity: "info",
    text: `Launch stage "${CURRENT_STAGE}" — next beat is ${NEXT_MILESTONE}.`,
  });

  const status: ExecutiveReport["status"] = waitlist === 0 ? "attention" : "healthy";

  return {
    status,
    headline: `${waitlist} waitlist signup(s), ${launchAssets} launch asset(s)`,
    summary:
      `The beta waitlist has ${waitlist} signup(s)${topType ? ` (led by "${topType.type}" creators)` : ""}. ` +
      `Marketing surfaces: ${hasWebsite ? "website" : "no website"}${hasMarketing ? " + marketing site" : ""}. ` +
      `${launchAssets} launch asset(s) are ready. Current launch stage: "${CURRENT_STAGE}".`,
    metrics: [
      { label: "Waitlist signups", value: String(waitlist) },
      { label: "Top creator type", value: topType ? String(topType.type) : "n/a" },
      { label: "Launch assets", value: String(launchAssets) },
      { label: "Website", value: hasWebsite ? "live" : "missing" },
      { label: "Launch stage", value: CURRENT_STAGE },
    ],
    findings,
  };
}
