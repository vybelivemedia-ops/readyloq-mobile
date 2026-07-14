// ─── Product Manager capability: roadmap + backlog ────────────────────────────
import { sql } from "drizzle-orm";
import { db, agentTasksTable } from "@workspace/db";
import type { ExecutiveReport } from "./index.js";
import { MILESTONES, CURRENT_STAGE, NEXT_MILESTONE, OVERALL_PROGRESS, isStaleMilestone } from "../../config/roadmap.js";

export async function inspectProduct(): Promise<ExecutiveReport> {
  const completed = MILESTONES.filter((m) => m.status === "completed").length;
  const active = MILESTONES.filter((m) => m.status === "active").length;
  const upcoming = MILESTONES.filter((m) => m.status === "upcoming").length;
  const stale = MILESTONES.filter(isStaleMilestone);

  // Backlog from the agent_tasks table, grouped by status and priority.
  const byStatus = await db
    .select({ status: agentTasksTable.status, n: sql<number>`count(*)::int` })
    .from(agentTasksTable)
    .groupBy(agentTasksTable.status);
  const byPriority = await db
    .select({ priority: agentTasksTable.priority, n: sql<number>`count(*)::int` })
    .from(agentTasksTable)
    .groupBy(agentTasksTable.priority);

  const statusCount = (s: string) => Number(byStatus.find((r) => r.status === s)?.n ?? 0);
  const total = byStatus.reduce((acc, r) => acc + Number(r.n), 0);
  const backlog = statusCount("backlog");
  const inProgress = statusCount("in_progress");
  const done = statusCount("done");
  const blocked = statusCount("blocked");
  const critical = Number(byPriority.find((r) => r.priority === "critical")?.n ?? 0);
  const high = Number(byPriority.find((r) => r.priority === "high")?.n ?? 0);

  const findings: ExecutiveReport["findings"] = [];
  if (stale.length > 0) {
    findings.push({
      severity: "warning",
      text: `${stale.length} stale milestone(s) past target date: ${stale.map((m) => m.title).join(", ")}.`,
    });
  }
  if (blocked > 0) {
    findings.push({ severity: "warning", text: `${blocked} blocked task(s) in the backlog.` });
  }
  if (critical > 0) {
    findings.push({ severity: "critical", text: `${critical} critical-priority task(s) awaiting action.` });
  }
  findings.push({
    severity: "info",
    text: `Currently in "${CURRENT_STAGE}". Next milestone: ${NEXT_MILESTONE}.`,
  });

  const status: ExecutiveReport["status"] =
    critical > 0 ? "critical" : stale.length > 0 || blocked > 0 ? "attention" : "healthy";

  return {
    status,
    headline: `${OVERALL_PROGRESS}% roadmap progress, ${backlog + inProgress} open task(s)`,
    summary:
      `Roadmap: ${completed} completed, ${active} active, ${upcoming} upcoming milestone(s); ${stale.length} stale. ` +
      `Overall progress ${OVERALL_PROGRESS}%, currently in "${CURRENT_STAGE}". ` +
      `Backlog of ${total} task(s): ${backlog} backlog, ${inProgress} in progress, ${blocked} blocked, ${done} done ` +
      `(${critical} critical, ${high} high priority).`,
    metrics: [
      { label: "Roadmap progress", value: `${OVERALL_PROGRESS}%` },
      { label: "Milestones done", value: `${completed}/${MILESTONES.length}` },
      { label: "Stale milestones", value: String(stale.length) },
      { label: "Open tasks", value: String(backlog + inProgress) },
      { label: "Blocked", value: String(blocked) },
      { label: "Critical", value: String(critical) },
    ],
    findings,
  };
}
