/**
 * V6.6 Daily COO Briefing
 *
 * Auto-generates a rich AI briefing once per UTC day (idempotent).
 * Reads all live data from the DB, feeds it to Quinn as a compact context,
 * and returns a structured 12-section briefing the Founder sees on first
 * Mission Control load.
 *
 * Generation is intentionally lazy — triggered by the first GET request of
 * the day, not by a cron job. Subsequent requests return the cached row.
 */

import { eq, desc, gte, and, count, sum } from "drizzle-orm";
import { randomUUID } from "crypto";
import {
  db,
  aiExecutivesTable,
  agentTasksTable,
  agentObjectivesTable,
  agentApprovalsTable,
  agentActivityTable,
  agentReportsTable,
  aiUsageLogTable,
  founderProfileInsightsTable,
  dailyCOOBriefingsTable,
} from "@workspace/db";
import { completeWithFallback } from "./ai/AIProviderFactory.js";
// V11 Tier 1: shared Founder-context assembler (operating profile + insights)
import { getFounderProfileSummary } from "./founderProfile.js";
import {
  getFlagshipSnapshot,
  getPortfolioOverview,
} from "./engineering/engineeringIntelligence.js";
import { getBlockerSummary, listBlockers } from "./blockers/blockerResolution.js";
import { logger } from "../lib/logger.js";

// ─── Public types ─────────────────────────────────────────────────────────────

export type COOBriefingSectionUrgency = "low" | "medium" | "high" | "critical";

export interface COOBriefingSection {
  headline: string;
  content: string;
  items: string[];
  urgency: COOBriefingSectionUrgency;
}

export interface COOBriefingSections {
  executiveSummary: COOBriefingSection;
  overnightChanges: COOBriefingSection;
  completedObjectives: COOBriefingSection;
  blockers: COOBriefingSection;
  pendingApprovals: COOBriefingSection;
  highRiskItems: COOBriefingSection;
  recommendedPriorities: COOBriefingSection;
  estimatedCompletionDates: COOBriefingSection;
  executiveWorkload: COOBriefingSection;
  aiUsageSummary: COOBriefingSection;
  newRecommendations: COOBriefingSection;
  engineering: COOBriefingSection;
}

export interface COOBriefing {
  id: string;
  date: string;
  generatedAt: string;
  sections: COOBriefingSections;
  promptTokens: number;
  completionTokens: number;
  estimatedCostUsd: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function todayDateUTC(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function hoursAgo(h: number): Date {
  return new Date(Date.now() - h * 60 * 60 * 1000);
}

function serializeBriefingRow(row: typeof dailyCOOBriefingsTable.$inferSelect): COOBriefing {
  return {
    id: row.id,
    date: row.date,
    generatedAt: row.generatedAt.toISOString(),
    sections: row.sections as COOBriefingSections,
    promptTokens: row.promptTokens,
    completionTokens: row.completionTokens,
    estimatedCostUsd: row.estimatedCostUsd,
  };
}

// ─── Fallback briefing (used when AI call fails) ──────────────────────────────

function buildFallbackSections(snapshot: DataSnapshot): COOBriefingSections {
  const totalTasks = snapshot.tasks.total;
  const blocked = snapshot.tasks.blocked;
  const critical = snapshot.tasks.critical;
  const pending = snapshot.approvals.pending;

  const section = (
    headline: string,
    content: string,
    items: string[] = [],
    urgency: COOBriefingSectionUrgency = "low",
  ): COOBriefingSection => ({ headline, content, items, urgency });

  return {
    executiveSummary: section(
      blocked > 0 || critical > 0 ? "Attention required" : "Operations normal",
      `${totalTasks} active tasks across ${snapshot.executives.length} executives. ${blocked} blocked, ${critical} critical.`,
      [],
      blocked > 2 || critical > 2 ? "high" : "low",
    ),
    overnightChanges: section(
      `${snapshot.activity.overnight} events in the last 12 hours`,
      snapshot.activity.overnight > 0
        ? `${snapshot.activity.overnight} activity events recorded overnight.`
        : "No significant activity recorded overnight.",
    ),
    completedObjectives: section(
      `${snapshot.objectives.completedRecent} completed recently`,
      snapshot.objectives.completedRecent > 0
        ? `${snapshot.objectives.completedRecent} objective(s) completed in the last 7 days.`
        : "No objectives completed recently.",
    ),
    blockers: (() => {
      const bc = snapshot.blockerCenter;
      const headline =
        bc.active === 0 && bc.resolvedToday === 0
          ? "No active blockers"
          : `${bc.active} active · ${bc.resolvedToday} resolved today`;
      const content =
        bc.active === 0 && bc.resolvedToday === 0
          ? "No blockers detected. The resolution engine found nothing to classify."
          : `Mission Control classified and routed every blocker: ${bc.autonomous} being resolved autonomously, ` +
            `${bc.connected} via connected providers, ${bc.awaitingApproval} awaiting your approval, ` +
            `${bc.humanRequired} need a human action${bc.failed > 0 ? `, ${bc.failed} with no autonomous path left` : ""}. ` +
            `${bc.resolvedToday} resolved today without involving you.`;
      const items =
        bc.highlights.length > 0
          ? bc.highlights
          : blocked > 0
            ? snapshot.tasks.blockedTitles
            : [];
      const urgency: COOBriefingSectionUrgency =
        bc.awaitingApproval > 0 || bc.humanRequired > 0 || bc.failed > 0
          ? "high"
          : bc.active > 0
            ? "medium"
            : "low";
      return section(headline, content, items, urgency);
    })(),
    pendingApprovals: section(
      `${pending} approval${pending !== 1 ? "s" : ""} pending`,
      pending === 0
        ? "No approvals waiting."
        : `${pending} item(s) are waiting for your decision.`,
      snapshot.approvals.pendingTitles,
      pending > 0 ? "medium" : "low",
    ),
    highRiskItems: section(
      critical > 0 ? `${critical} critical priority items` : "No critical items",
      critical === 0 ? "No high-risk items flagged." : `${critical} critical task(s) require immediate attention.`,
      snapshot.tasks.criticalTitles,
      critical > 0 ? "critical" : "low",
    ),
    recommendedPriorities: section(
      "Focus areas for today",
      "Based on current task state and executive workload.",
      snapshot.tasks.topPriorityTitles,
      "medium",
    ),
    estimatedCompletionDates: section(
      `${snapshot.objectives.active} active objective${snapshot.objectives.active !== 1 ? "s" : ""}`,
      "Completion estimates require AI analysis — refresh to generate.",
    ),
    executiveWorkload: section(
      "Team workload overview",
      snapshot.executives.map((e) => `${e.name}: ${e.taskCount} task${e.taskCount !== 1 ? "s" : ""}`).join(", "),
    ),
    aiUsageSummary: section(
      `${snapshot.aiUsage.calls24h} AI calls in the last 24h`,
      `Total: ${snapshot.aiUsage.totalTokens24h.toLocaleString()} tokens, estimated $${snapshot.aiUsage.estimatedCost24h.toFixed(4)} USD.`,
    ),
    newRecommendations: section(
      "AI analysis unavailable",
      "Refresh the briefing to get Quinn's strategic recommendations.",
    ),
    engineering: (() => {
      const e = snapshot.engineering;
      if (!e.available) {
        return section(
          "Engineering telemetry degraded",
          `Engineering Intelligence is running on limited providers${
            e.providerStatuses.length ? ` (${e.providerStatuses.join(", ")})` : ""
          }. Reconnect providers for a full read.`,
          e.providerStatuses,
          "medium",
        );
      }
      const items = [
        `${e.productName} health score: ${e.healthScore}/100`,
        `Launch readiness: ${e.launchReadinessScore}/100 (${e.launchReadinessState})`,
        `Portfolio launch readiness: ${e.portfolioLaunchReadinessScore}/100 across ${e.monitoredProducts}/${e.totalProducts} monitored product(s)`,
        `Deployment: ${e.deploymentStatus} (production ${e.productionHealth})`,
        `Build: ${e.buildStatus}`,
        `Risk: deployment ${e.deploymentRisk}, launch ${e.launchRisk}`,
        ...(e.latestCommit ? [`Latest commit: ${e.latestCommit}`] : []),
        ...e.blockers,
      ];
      const urgency: COOBriefingSectionUrgency =
        e.blockers.length > 0 || e.productionHealth === "down" || e.launchRisk === "high"
          ? "critical"
          : e.deploymentRisk === "high" || e.buildStatus === "failing"
            ? "high"
            : e.healthScore < 70
              ? "medium"
              : "low";
      return section(
        `Engineering health ${e.healthScore}/100 · launch readiness ${e.launchReadinessScore}/100`,
        `${e.productName}: build ${e.buildStatus}; deployment ${e.deploymentStatus} with production ${e.productionHealth}. Portfolio launch readiness ${e.portfolioLaunchReadinessScore}/100 (${e.portfolioLaunchReadinessState}). ${
          e.blockers.length > 0 ? `Top risk: ${e.blockers[0]}.` : "No engineering blockers."
        }`,
        items.slice(0, 7),
        urgency,
      );
    })(),
  };
}

// ─── Data collection ──────────────────────────────────────────────────────────

interface DataSnapshot {
  executives: { id: string; name: string; title: string; status: string; role: string; taskCount: number }[];
  tasks: {
    total: number;
    open: number;
    blocked: number;
    critical: number;
    done24h: number;
    blockedTitles: string[];
    criticalTitles: string[];
    topPriorityTitles: string[];
  };
  objectives: {
    active: number;
    completed: number;
    completedRecent: number;
    activeList: { title: string; status: string; taskCount?: number }[];
  };
  approvals: {
    pending: number;
    pendingTitles: string[];
    pendingDetails: { title: string; detail: string; execName: string }[];
  };
  activity: {
    overnight: number;
    recentSummaries: string[];
  };
  reports: { execName: string; headline: string; status: string; createdAt: string }[];
  aiUsage: {
    calls24h: number;
    totalTokens24h: number;
    estimatedCost24h: number;
    byTask: { task: string; calls: number; tokens: number }[];
  };
  founderProfile: string;
  blockerCenter: {
    active: number;
    resolvedToday: number;
    autonomous: number;
    connected: number;
    awaitingApproval: number;
    humanRequired: number;
    failed: number;
    highlights: string[];
  };
  engineering: {
    available: boolean;
    productName: string;
    healthScore: number;
    launchReadinessScore: number;
    launchReadinessState: string;
    portfolioLaunchReadinessScore: number;
    portfolioLaunchReadinessState: string;
    monitoredProducts: number;
    totalProducts: number;
    buildStatus: string;
    deploymentStatus: string;
    productionHealth: string;
    deploymentRisk: string;
    launchRisk: string;
    blockers: string[];
    latestCommit: string | null;
    runtimeErrors: number;
    unhealthyServices: string[];
    providerStatuses: string[];
  };
}

async function gatherSnapshot(): Promise<DataSnapshot> {
  const since12h = hoursAgo(12);
  const since24h = hoursAgo(24);
  const since7d = hoursAgo(24 * 7);

  const [
    execs,
    allTasks,
    allObjectives,
    pendingApprovals,
    activityRows,
    recentReports,
    aiUsageRows,
    profileInsights,
  ] = await Promise.all([
    db.select().from(aiExecutivesTable),
    db.select().from(agentTasksTable).orderBy(desc(agentTasksTable.createdAt)),
    db.select().from(agentObjectivesTable).orderBy(desc(agentObjectivesTable.createdAt)).limit(50),
    db
      .select()
      .from(agentApprovalsTable)
      .where(eq(agentApprovalsTable.status, "pending"))
      .orderBy(desc(agentApprovalsTable.createdAt))
      .limit(10),
    db
      .select()
      .from(agentActivityTable)
      .where(gte(agentActivityTable.createdAt, since12h))
      .orderBy(desc(agentActivityTable.createdAt))
      .limit(30),
    db
      .select()
      .from(agentReportsTable)
      .orderBy(desc(agentReportsTable.createdAt))
      .limit(20),
    db
      .select()
      .from(aiUsageLogTable)
      .where(gte(aiUsageLogTable.createdAt, since24h)),
    db
      .select()
      .from(founderProfileInsightsTable)
      .where(
        and(
          eq(founderProfileInsightsTable.isActive, true),
          // only medium/high confidence insights for briefing context
        ),
      )
      .limit(10),
  ]);

  // ── Executives + task counts ────────────────────────────────────────────────
  const taskCountByExec: Record<string, number> = {};
  for (const t of allTasks) {
    if (t.status !== "done") {
      taskCountByExec[t.executiveId] = (taskCountByExec[t.executiveId] ?? 0) + 1;
    }
  }

  const execMap = Object.fromEntries(execs.map((e) => [e.id, e]));
  const executives = execs.map((e) => ({
    id: e.id,
    name: e.name,
    title: e.title,
    status: e.statusMessage ?? e.status ?? "idle",
    role: e.role,
    taskCount: taskCountByExec[e.id] ?? 0,
  }));

  // ── Tasks ───────────────────────────────────────────────────────────────────
  const openTasks = allTasks.filter((t) => t.status !== "done");
  const blockedTasks = openTasks.filter((t) => t.status === "blocked");
  const criticalTasks = openTasks.filter((t) => t.priority === "critical");
  const done24h = allTasks.filter(
    (t) => t.status === "done" && t.updatedAt && new Date(t.updatedAt) >= since24h,
  );
  const topPriority = [...openTasks]
    .sort((a, b) => {
      const rank: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
      return (rank[a.priority] ?? 4) - (rank[b.priority] ?? 4);
    })
    .slice(0, 5);

  const tasks = {
    total: openTasks.length,
    open: openTasks.filter((t) => t.status === "in_progress" || t.status === "backlog").length,
    blocked: blockedTasks.length,
    critical: criticalTasks.length,
    done24h: done24h.length,
    blockedTitles: blockedTasks.slice(0, 5).map((t) => {
      const exec = execMap[t.executiveId];
      return `${t.title} (${exec?.name ?? "Unknown"})`;
    }),
    criticalTitles: criticalTasks.slice(0, 5).map((t) => {
      const exec = execMap[t.executiveId];
      return `[CRITICAL] ${t.title} — ${exec?.name ?? "Unknown"}`;
    }),
    topPriorityTitles: topPriority.map((t) => {
      const exec = execMap[t.executiveId];
      return `[${t.priority.toUpperCase()}] ${t.title} → ${exec?.name ?? "Unknown"}`;
    }),
  };

  // ── Objectives ──────────────────────────────────────────────────────────────
  const activeObjectives = allObjectives.filter(
    (o) => o.status === "in_progress" || o.status === "planning",
  );
  const completedObjectives = allObjectives.filter((o) => o.status === "completed");
  const completedRecent = completedObjectives.filter(
    (o) => o.updatedAt && new Date(o.updatedAt) >= since7d,
  );

  const objectives = {
    active: activeObjectives.length,
    completed: completedObjectives.length,
    completedRecent: completedRecent.length,
    activeList: activeObjectives.slice(0, 6).map((o) => ({
      title: o.title,
      status: o.status,
    })),
  };

  // ── Approvals ───────────────────────────────────────────────────────────────
  const approvals = {
    pending: pendingApprovals.length,
    pendingTitles: pendingApprovals.slice(0, 5).map((a) => a.title),
    pendingDetails: pendingApprovals.slice(0, 5).map((a) => {
      const exec = execMap[a.executiveId ?? ""];
      return {
        title: a.title,
        detail: (a.detail ?? "").slice(0, 120),
        execName: exec?.name ?? "Unknown",
      };
    }),
  };

  // ── Activity ────────────────────────────────────────────────────────────────
  const activity = {
    overnight: activityRows.length,
    recentSummaries: activityRows.slice(0, 10).map((a) => {
      const exec = execMap[a.executiveId ?? ""];
      return `${exec?.name ?? "System"}: ${a.summary}`;
    }),
  };

  // ── Reports ─────────────────────────────────────────────────────────────────
  // One latest report per executive (dedup by executiveId)
  const latestByExec: Record<string, typeof recentReports[0]> = {};
  for (const r of recentReports) {
    if (!latestByExec[r.executiveId]) latestByExec[r.executiveId] = r;
  }
  const reports = Object.values(latestByExec).slice(0, 8).map((r) => {
    const exec = execMap[r.executiveId];
    return {
      execName: exec?.name ?? "Unknown",
      headline: r.headline,
      status: r.status,
      createdAt: r.createdAt.toISOString().slice(0, 10),
    };
  });

  // ── AI usage ────────────────────────────────────────────────────────────────
  const byTask: Record<string, { calls: number; tokens: number }> = {};
  let totalTokens24h = 0;
  let estimatedCost24h = 0;
  for (const u of aiUsageRows) {
    if (!byTask[u.task]) byTask[u.task] = { calls: 0, tokens: 0 };
    byTask[u.task].calls += 1;
    byTask[u.task].tokens += u.totalTokens;
    totalTokens24h += u.totalTokens;
    estimatedCost24h += u.estimatedCostUsd;
  }

  const aiUsage = {
    calls24h: aiUsageRows.length,
    totalTokens24h,
    estimatedCost24h,
    byTask: Object.entries(byTask)
      .map(([task, v]) => ({ task, ...v }))
      .sort((a, b) => b.tokens - a.tokens)
      .slice(0, 5),
  };

  // ── Founder profile summary ─────────────────────────────────────────────────
  // V11 Tier 1: the Founder-context summary (explicit operating profile +
  // observed insights) comes from the single shared assembler. Reuse the
  // already-fetched insight rows to avoid a redundant query.
  const founderProfile = await getFounderProfileSummary(profileInsights);

  // ── Engineering Intelligence snapshot (degrades gracefully) ─────────────────
  let engineering: DataSnapshot["engineering"];
  try {
    // Portfolio-aware: the flagship snapshot anchors the engineering section,
    // while the portfolio overview supplies the aggregate launch readiness.
    const [snap, overview] = await Promise.all([
      getFlagshipSnapshot(),
      getPortfolioOverview(),
    ]);
    engineering = {
      available: snap.providers.some((p) => p.status === "connected"),
      productName: snap.productName || "Flagship product",
      healthScore: snap.healthScore,
      launchReadinessScore: snap.launchReadiness.score,
      launchReadinessState: snap.launchReadiness.state,
      portfolioLaunchReadinessScore: overview.portfolioLaunchReadiness.score,
      portfolioLaunchReadinessState: overview.portfolioLaunchReadiness.state,
      monitoredProducts: overview.products.filter((p) => p.monitored).length,
      totalProducts: overview.products.length,
      buildStatus: snap.build.status,
      deploymentStatus: snap.deployment.status,
      productionHealth: snap.deployment.productionHealth,
      deploymentRisk: snap.deploymentRisk,
      launchRisk: snap.launchRisk,
      blockers: snap.blockers.slice(0, 5),
      latestCommit: snap.repository.latestCommit
        ? `${snap.repository.latestCommit.message} (${snap.repository.latestCommit.author})`
        : null,
      runtimeErrors: snap.runtime.errors.length,
      unhealthyServices: snap.runtime.unhealthyServices.slice(0, 5),
      providerStatuses: snap.providers.map((p) => `${p.name}: ${p.status}`),
    };
  } catch (err) {
    logger.warn({ err }, "briefing: engineering snapshot unavailable");
    engineering = {
      available: false,
      productName: "Flagship product",
      healthScore: 0,
      launchReadinessScore: 0,
      launchReadinessState: "unknown",
      portfolioLaunchReadinessScore: 0,
      portfolioLaunchReadinessState: "unknown",
      monitoredProducts: 0,
      totalProducts: 0,
      buildStatus: "unknown",
      deploymentStatus: "unknown",
      productionHealth: "unknown",
      deploymentRisk: "unknown",
      launchRisk: "unknown",
      blockers: [],
      latestCommit: null,
      runtimeErrors: 0,
      unhealthyServices: [],
      providerStatuses: [],
    };
  }

  // ── Blocker Center (V11.1) ──────────────────────────────────────────────────
  let blockerCenter: DataSnapshot["blockerCenter"] = {
    active: 0,
    resolvedToday: 0,
    autonomous: 0,
    connected: 0,
    awaitingApproval: 0,
    humanRequired: 0,
    failed: 0,
    highlights: [],
  };
  try {
    const summary = await getBlockerSummary();
    const recent = await listBlockers();
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const resolvedToday = recent.filter(
      (b) => b.status === "resolved" && b.resolvedAt && new Date(b.resolvedAt) >= startOfDay,
    ).length;
    const highlights: string[] = [];
    for (const b of recent.filter((b) => b.status === "awaiting_approval").slice(0, 2)) {
      highlights.push(`Awaiting your approval: ${b.title}`);
    }
    for (const b of recent.filter((b) => b.status === "awaiting_human").slice(0, 2)) {
      highlights.push(`Needs you: ${b.humanAction || b.title}`);
    }
    for (const b of recent
      .filter((b) => b.status === "resolved" && b.resolvedAt && new Date(b.resolvedAt) >= startOfDay)
      .slice(0, 2)) {
      highlights.push(`Resolved autonomously: ${b.title}`);
    }
    blockerCenter = {
      active: summary.active,
      resolvedToday,
      autonomous: summary.byCategory.autonomous,
      connected: summary.byCategory.connected,
      awaitingApproval: summary.byStatus.awaiting_approval,
      humanRequired: summary.byCategory.human_required,
      failed: summary.failed,
      highlights,
    };
  } catch (err) {
    logger.warn({ err }, "cooBriefing: blocker center gather failed");
  }

  return {
    executives,
    tasks,
    objectives,
    approvals,
    activity,
    reports,
    aiUsage,
    founderProfile,
    blockerCenter,
    engineering,
  };
}

// ─── AI generation ────────────────────────────────────────────────────────────

const SECTION_KEYS: (keyof COOBriefingSections)[] = [
  "executiveSummary",
  "overnightChanges",
  "completedObjectives",
  "blockers",
  "pendingApprovals",
  "highRiskItems",
  "recommendedPriorities",
  "estimatedCompletionDates",
  "executiveWorkload",
  "aiUsageSummary",
  "newRecommendations",
  "engineering",
];

const SECTION_LABELS: Record<keyof COOBriefingSections, string> = {
  executiveSummary: "Executive Summary",
  overnightChanges: "Overnight Changes",
  completedObjectives: "Completed Objectives",
  blockers: "Blockers",
  pendingApprovals: "Pending Approvals",
  highRiskItems: "High-Risk Items",
  recommendedPriorities: "Recommended Priorities",
  estimatedCompletionDates: "Estimated Completion Dates",
  executiveWorkload: "Executive Workload",
  aiUsageSummary: "AI Usage Summary",
  newRecommendations: "New Recommendations",
  engineering: "Engineering",
};

const COO_SYSTEM_PROMPT = `You are Quinn Harlow, Chief of Staff to the Founder of VYBE LIVE.

You are preparing the daily morning briefing — the first thing the Founder sees when they open Mission Control.

STYLE:
- Direct, data-driven, action-oriented
- No fluff, no corporate speak
- Write like a trusted COO updating a CEO before the workday begins
- Every section must reference specific numbers or names from the snapshot
- Urgency levels: "low" (normal), "medium" (watch it), "high" (needs attention today), "critical" (stop everything)

OUTPUT: Return valid JSON with exactly these 12 keys:
executiveSummary, overnightChanges, completedObjectives, blockers, pendingApprovals,
highRiskItems, recommendedPriorities, estimatedCompletionDates, executiveWorkload,
aiUsageSummary, newRecommendations, engineering

Each section must have:
{
  "headline": "short punchy title (< 8 words)",
  "content": "1-3 sentences with specific data",
  "items": ["bullet 1", "bullet 2", ...],  // 0-5 items, use [] if none
  "urgency": "low" | "medium" | "high" | "critical"
}

For estimatedCompletionDates: estimate completion timeline for each active objective based on task counts and pace.
For newRecommendations: provide 2-3 strategic recommendations based on the full picture.
For executiveWorkload: one bullet per executive showing their task load and status.
For blockers: this is the Autonomous Blocker Resolution report, NOT a raw list of blocked tasks. Use blockerCenter. State how many blockers are active vs resolved today, then explain how Mission Control routed them — how many are being resolved autonomously by the team, how many via connected providers, how many await the Founder's approval, and how many need a human action. Lead with what was resolved WITHOUT the Founder. Set urgency: critical if any failed (no autonomous path left), high if any await approval or human action, medium if active blockers exist, low otherwise. Use blockerCenter.highlights for items.
For engineering: summarize the Engineering Intelligence snapshot — engineering health score (0-100), latest deployment status and production stability, build status, the single top engineering risk, and the next engineering action. Set urgency from deploymentRisk/launchRisk and blockers (high/critical when production health is down or blockers exist). If engineering.available is false, state that engineering telemetry is degraded and which providers are unavailable.`;

async function generateWithAI(snapshot: DataSnapshot, date: string = todayDateUTC()): Promise<{ sections: COOBriefingSections; promptTokens: number; completionTokens: number; estimatedCostUsd: number }> {
  const contextPayload = {
    date,
    executives: snapshot.executives,
    tasks: snapshot.tasks,
    objectives: snapshot.objectives,
    approvals: snapshot.approvals,
    overnightActivity: {
      count: snapshot.activity.overnight,
      recent: snapshot.activity.recentSummaries,
    },
    latestExecReports: snapshot.reports,
    aiUsage24h: snapshot.aiUsage,
    founderProfile: snapshot.founderProfile,
    blockerCenter: snapshot.blockerCenter,
    engineering: snapshot.engineering,
  };

  const userContent = `TODAY'S BRIEFING DATE: ${todayDateUTC()}

DATA SNAPSHOT:
${JSON.stringify(contextPayload, null, 2)}

Generate the full 12-section COO morning briefing. Return ONLY valid JSON — no markdown, no preamble.`;

  const response = await completeWithFallback({
    task: "briefing",
    modelHint: "standard",
    systemPrompt: COO_SYSTEM_PROMPT,
    userContent,
    maxTokens: 1800,
    responseFormat: "json",
    executiveId: "system",
    executiveName: "Quinn Harlow",
    executiveRole: "chief_of_staff",
  });

  if (response.fromFallback || !response.parsed) {
    throw new Error("AI returned fallback — no real provider available");
  }

  const promptTokens = response.usage?.promptTokens ?? 0;
  const completionTokens = response.usage?.completionTokens ?? 0;
  const estimatedCostUsd = response.usage?.estimatedCostUsd ?? 0;

  // AI sometimes nests sections under a "sections" key — handle both shapes
  const topLevel: Record<string, unknown> =
    response.parsed.sections && typeof response.parsed.sections === "object"
      ? (response.parsed.sections as Record<string, unknown>)
      : response.parsed;

  // Validate and normalize — ensure all 12 sections exist
  const sections: Partial<COOBriefingSections> = {};
  for (const key of SECTION_KEYS) {
    const s = topLevel[key] as Record<string, unknown> | undefined;
    if (s && typeof s.headline === "string" && typeof s.content === "string") {
      sections[key] = {
        headline: String(s.headline),
        content: String(s.content),
        items: Array.isArray(s.items) ? (s.items as unknown[]).map(String).slice(0, 8) : [],
        urgency: (["low", "medium", "high", "critical"] as const).includes(String(s.urgency) as COOBriefingSectionUrgency)
          ? (String(s.urgency) as COOBriefingSectionUrgency)
          : "low",
      };
    } else {
      // Fallback for missing sections
      sections[key] = {
        headline: SECTION_LABELS[key],
        content: "Data unavailable for this section.",
        items: [],
        urgency: "low",
      };
    }
  }

  return { sections: sections as COOBriefingSections, promptTokens, completionTokens, estimatedCostUsd };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Returns today's COO briefing. If one doesn't exist yet for today's UTC date,
 * generates it via AI and stores it. Thread-safe via DB unique constraint.
 */
export async function getOrGenerateTodaysBriefing(targetDate?: string): Promise<COOBriefing> {
  const date = targetDate ?? todayDateUTC();

  // Fast path: already generated today
  const [existing] = await db
    .select()
    .from(dailyCOOBriefingsTable)
    .where(eq(dailyCOOBriefingsTable.date, date))
    .limit(1);

  if (existing) {
    return serializeBriefingRow(existing);
  }

  // Slow path: gather data + generate
  logger.info({ date }, "COO briefing: generating for new day");
  const snapshot = await gatherSnapshot();

  let sections: COOBriefingSections;
  let promptTokens = 0;
  let completionTokens = 0;
  let estimatedCostUsd = 0;

  try {
    const result = await generateWithAI(snapshot, date);
    sections = result.sections;
    promptTokens = result.promptTokens;
    completionTokens = result.completionTokens;
    estimatedCostUsd = result.estimatedCostUsd;
  } catch (err) {
    logger.warn({ err }, "COO briefing: AI generation failed — using deterministic fallback");
    sections = buildFallbackSections(snapshot);
  }

  // Upsert — handles the race condition where two concurrent requests both
  // reach here on the same day (the unique constraint on date prevents dups).
  try {
    const id = randomUUID();
    const [row] = await db
      .insert(dailyCOOBriefingsTable)
      .values({
        id,
        date,
        sections,
        promptTokens,
        completionTokens,
        estimatedCostUsd,
        generatedAt: new Date(),
      })
      .onConflictDoNothing()
      .returning();

    if (row) {
      logger.info({ date, id, promptTokens, completionTokens }, "COO briefing: stored");
      return serializeBriefingRow(row);
    }

    // Another request won the race — fetch what they wrote
    const [raced] = await db
      .select()
      .from(dailyCOOBriefingsTable)
      .where(eq(dailyCOOBriefingsTable.date, date))
      .limit(1);
    if (!raced) throw new Error("COO briefing: race resolution failed");
    return serializeBriefingRow(raced);
  } catch (err) {
    logger.error({ err }, "COO briefing: DB storage failed — returning in-memory result");
    // Return the in-memory result without persisting
    return {
      id: randomUUID(),
      date,
      generatedAt: new Date().toISOString(),
      sections,
      promptTokens,
      completionTokens,
      estimatedCostUsd,
    };
  }
}

/**
 * Force-regenerates today's briefing, deleting any existing one first.
 * Called by POST /mission-control/coo-briefing/regenerate.
 */
export async function regenerateTodaysBriefing(): Promise<COOBriefing> {
  const date = todayDateUTC();

  await db
    .delete(dailyCOOBriefingsTable)
    .where(eq(dailyCOOBriefingsTable.date, date));

  return getOrGenerateTodaysBriefing();
}

/**
 * Returns the UTC date string (YYYY-MM-DD) for N days after today, without
 * mutating the system clock. Used by virtual-day simulation tooling.
 */
export function dateUTCOffsetDays(offsetDays: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

/**
 * Force-generates a briefing for a specific UTC date (YYYY-MM-DD), replacing any
 * existing one for that date. Today's briefing is left untouched unless `date`
 * is today. Used by "Simulate Tomorrow Morning" to advance one virtual day.
 */
export async function regenerateBriefingForDate(date: string): Promise<COOBriefing> {
  await db.delete(dailyCOOBriefingsTable).where(eq(dailyCOOBriefingsTable.date, date));
  return getOrGenerateTodaysBriefing(date);
}
