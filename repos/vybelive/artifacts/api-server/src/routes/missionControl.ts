import { Router } from "express";
import { eq, and, desc, inArray, count, sum, sql, ilike } from "drizzle-orm";
import { randomUUID } from "crypto";
import {
  db,
  aiExecutivesTable,
  marketingPostsTable,
  portfolioAssetsTable,
  agentTasksTable,
  agentHandoffsTable,
  agentMemoryTable,
  agentMessagesTable,
  agentActivityTable,
  agentReportsTable,
  agentObjectivesTable,
  agentApprovalsTable,
  aiUsageLogTable,
  execCollabEventsTable,
  dailyCOOBriefingsTable,
  founderProfileInsightsTable,
  founderDecisionPredictionsTable,
  executiveLessonsTable,
  objectiveRetrospectivesTable,
  weeklyReviewsTable,
  autonomyCyclesTable,
  agentZeroJobsTable,
  agentZeroStepsTable,
  aiModelConfigsTable,
  providerReliabilityTable,
  oauthConnectionsTable,
  usersTable,
  streamsTable,
  clipsTable,
  socialScheduledPostsTable,
  type SocialScheduledPostRow,
  type AgentZeroJobRow,
  type AgentZeroStepRow,
  type AiExecutive,
  type AgentTaskRow,
  type AgentMemoryRow,
  type AgentMessageRow,
  type AgentActivityRow,
  type AgentReportRow,
  type AgentObjectiveRow,
  type AgentApprovalRow,
  type ExecCollabEventRow,
} from "@workspace/db";
import { getProviderStatus, reloadAiModelConfig, completeWithFallback } from "../services/ai/AIProviderFactory.js";
import { resolveFounderUser } from "../services/founderUser.js";
import { processInboxReply } from "../services/inboxReply.js";
import { buildOAuthInitUrl } from "./oauth.js";
import { getAppBaseUrl } from "../services/oauthRedirects.js";
import {
  PLATFORM_CAPABILITIES,
  ALL_PLATFORMS,
  getPlatformSnapshot,
  getFounderToken,
  getYouTubeInbox,
  getFacebookInbox,
  getInstagramInbox,
  replyToYouTubeComment,
  replyToFacebookComment,
  replyToInstagramComment,
  isSocialProviderConfigured,
  type PlatformSnapshot,
  type InboxItem,
  type SocialPlatformId,
} from "../services/socialInsights.js";
import {
  CONNECTOR_REGISTRY,
  detectConnectors,
  type ConnectorProvider,
} from "../services/blockers/connectorRegistry.js";
import {
  UpdateExecutiveStatusBody,
  CreateAgentTaskBody,
  UpdateAgentTaskBody,
  HandoffTaskBody,
  AddExecutiveMemoryBody,
  SendExecutiveMessageBody,
  ListTasksQueryParams,
  ListApprovalsQueryParams,
  DecideApprovalBody,
  CreateMarketingDraftPostBody,
  ListMarketingPostsQueryParams,
  DecideMarketingPostRequestBody,
  UpdateMarketingEngagementBody,
  SetMarketingAutonomyBody,
  RunSocialAgentBody,
  GenerateSocialContentBody,
  CreateScheduledSocialPostBody,
  DecideScheduledSocialPostBody,
  RescheduleScheduledSocialPostBody,
  DispatchAgentZeroJobBody,
  ControlAgentZeroJobBody,
  CreatePortfolioAssetBody,
  UpdatePortfolioAssetBody,
  SetGlobalAIModelConfigBody,
  SetObjectiveAIModelConfigBody,
} from "@workspace/api-zod";
import {
  generateExecutiveReply,
  generateDailyBriefing,
  type BriefingInput,
} from "../services/aiExecutive";
import { createAgentZeroJob, controlJob, getOperationsSnapshot, getAgentZeroBrief } from "../services/agentZero";
import {
  runCapability,
  aggregateChiefOfStaff,
  hasCapability,
  CAPABILITY_INFO,
  ROLES_WITH_CAPABILITY,
  type ExecutiveReport,
} from "../services/executiveCapabilities/index.js";
import {
  parseExecutiveCommand,
  commandPriority,
  commandTaskTitle,
  type CommandVerb,
} from "../services/executiveCommandParser.js";
import {
  enrichReport,
  decomposeObjective,
  composeBriefing,
  type EnrichedReport,
} from "../services/chiefOrchestrator.js";
import { routeCollaboration, generateCollabEvents, type CollabEventType } from "../services/collaborationRouter.js";
import { seed as reseedMissionControl } from "../jobs/seedMissionControl.js";
import { getPortfolioHealth, getPortfolioSummary } from "../services/portfolioMonitor.js";
import {
  generateObjectiveRetrospective,
  runWeeklyLearningReview,
  resetExecutiveLearning,
  getLearningTotals,
} from "../services/executiveLearning.js";
import { runAutonomousCycle, getRecentCycles, runReflection, getAutonomySchedulerStatus, processObjectives } from "../services/autonomyEngine.js";
import {
  listBlockers,
  getBlockerById,
  getBlockerSummary,
  runBlockerResolutionPass,
} from "../services/blockers/blockerResolution.js";
import {
  collectSnapshot,
  getLatestSnapshot,
  getFlagshipSnapshot,
  getFlagshipProduct,
  getProductById,
  getActiveProducts,
  getSnapshotHistory,
  getRecentEvents,
  getPortfolioOverview,
  getDiagnostics as getEngineeringDiagnosticsData,
  getExecutiveView,
} from "../services/engineering/engineeringIntelligence.js";
import {
  recordEvent,
  getTimeline,
  getEventChain,
  getLivingCounts,
  getLinkedEventCount,
  type OrgEventType,
  type TimelineEvent,
} from "../services/organizationMemory.js";
import {
  generateConversation,
  getRecentConversations,
  getConversationDetail,
  getOpenConversationCount,
  detectRepeatedDiscussionPatterns,
} from "../services/executiveConversations.js";
import {
  proposeRecommendations,
  getRecommendations,
  reviewRecommendation,
  reviewAllPending,
  getPendingRecommendationCount,
  enrichPendingRecommendations,
} from "../services/executiveInitiative.js";
import {
  getMemoryForExec,
  accumulateFromRecentWork,
  getExecutiveMemoryCount,
} from "../services/executiveMemory.js";
import {
  getRecentReasoning,
  getReasoningCount,
} from "../services/chiefReasoning.js";
import { DecideRecommendationBody } from "@workspace/api-zod";
import {
  analyzeFounderMessage,
  analyzeApprovalDecision,
  analyzeObjectiveDirective,
  analyzeExecutiveEngagement,
  analyzeMarketingDecision,
  getFounderProfilePreamble,
  getAllInsights,
  groupByCategory,
  CATEGORY_META,
} from "../services/founderProfile.js";
import {
  predictApprovalDecision,
  recordPrediction,
  scorePrediction,
  getDecisionModelSummary,
  formatDecisionModelForQuinn,
} from "../services/founderDecisionModel.js";
import {
  getOrGenerateTodaysBriefing,
  regenerateTodaysBriefing,
  regenerateBriefingForDate,
  dateUTCOffsetDays,
} from "../services/cooMorningBriefing.js";
import {
  converseAsChief,
  classifyIntent,
  detectProtectedCategory,
  type ConversationContext,
  type MemoryOp,
  type QuinnReasoningIntent,
} from "../services/chiefConversation.js";
import { logger } from "../lib/logger.js";
import {
  matchSpecialistsForRole,
  consultSpecialist,
  getSpecialistRegistry,
  SPECIALISTS,
  isSpecialistAvailable,
} from "../services/specialistRegistry.js";
import {
  createMarketingDraft,
  decideMarketingPost,
  updateEngagement,
  setFounderAutonomy,
  getMarketingIntelligence,
  getMarketingAutonomyBrief,
} from "../services/marketingLearning.js";

const router = Router();

// ─── Serializers ──────────────────────────────────────────────────────────────

function serializeExecutive(row: AiExecutive): Record<string, unknown> {
  return {
    id: row.id,
    role: row.role,
    name: row.name,
    title: row.title,
    tagline: row.tagline,
    bio: row.bio,
    status: row.status,
    statusMessage: row.statusMessage,
    accentColor: row.accentColor,
    avatarInitials: row.avatarInitials,
    specialties: row.specialties,
    model: row.model,
    sortOrder: row.sortOrder,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function serializeTask(
  row: AgentTaskRow,
  execs: Map<string, AiExecutive>,
): Record<string, unknown> {
  const owner = execs.get(row.executiveId);
  const creator = row.createdByExecutiveId ? execs.get(row.createdByExecutiveId) : undefined;
  return {
    id: row.id,
    executiveId: row.executiveId,
    executiveName: owner?.name ?? "Unknown",
    executiveRole: owner?.role ?? "cto",
    title: row.title,
    description: row.description,
    status: row.status,
    priority: row.priority,
    origin: row.origin,
    createdByExecutiveId: row.createdByExecutiveId,
    createdByName: creator?.name ?? null,
    objectiveId: row.objectiveId ?? null,
    progress: row.progress,
    dueAt: row.dueAt ? row.dueAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function serializeMemory(row: AgentMemoryRow): Record<string, unknown> {
  return {
    id: row.id,
    executiveId: row.executiveId,
    kind: row.kind,
    content: row.content,
    pinned: row.pinned,
    createdAt: row.createdAt.toISOString(),
  };
}

function serializeMessage(row: AgentMessageRow): Record<string, unknown> {
  return {
    id: row.id,
    executiveId: row.executiveId,
    role: row.role,
    content: row.content,
    createdAt: row.createdAt.toISOString(),
  };
}

function serializeReport(
  row: AgentReportRow,
  exec: AiExecutive | undefined,
): Record<string, unknown> {
  return {
    id: row.id,
    executiveId: row.executiveId,
    executiveName: exec?.name ?? "Unknown",
    executiveRole: exec?.role ?? "unknown",
    status: row.status,
    headline: row.headline,
    summary: row.summary,
    metrics: row.metrics,
    findings: row.findings,
    confidence: row.confidence,
    recommendations: row.recommendations,
    followUps: row.followUps,
    estimatedEffort: row.estimatedEffort ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

// Fetch the latest persisted report for a single executive, if any.
async function latestReportFor(executiveId: string): Promise<AgentReportRow | undefined> {
  const [row] = await db
    .select()
    .from(agentReportsTable)
    .where(eq(agentReportsTable.executiveId, executiveId))
    .orderBy(desc(agentReportsTable.createdAt))
    .limit(1);
  return row;
}

// Load the latest global report for every executive — used by Quinn's reasoning engine
// for current_status, objective_planning, and decision_support intents.
async function latestReportsForAll(): Promise<
  Array<{ executiveName: string; status: string; headline: string; topFinding?: string }>
> {
  const execs = await db
    .select({ id: aiExecutivesTable.id, name: aiExecutivesTable.name })
    .from(aiExecutivesTable);
  const rows = await Promise.all(
    execs.map(async (e) => {
      const row = await latestReportFor(e.id);
      if (!row) return null;
      return {
        executiveName: e.name,
        status: row.status,
        headline: row.headline,
        topFinding:
          row.findings.find((f) => f.severity !== "info")?.text ??
          row.findings[0]?.text,
      };
    }),
  );
  return rows.filter(
    (r): r is NonNullable<typeof r> => r !== null,
  );
}

// Latest report an executive filed *as part of a specific objective*. Used by the
// briefing aggregation so an exec's unrelated global-latest report can never leak
// into an objective it had nothing to do with.
async function latestReportForObjective(
  executiveId: string,
  objectiveId: string,
): Promise<AgentReportRow | undefined> {
  const [row] = await db
    .select()
    .from(agentReportsTable)
    .where(
      and(
        eq(agentReportsTable.executiveId, executiveId),
        eq(agentReportsTable.objectiveId, objectiveId),
      ),
    )
    .orderBy(desc(agentReportsTable.createdAt))
    .limit(1);
  return row;
}

// Run an executive's capability and persist the resulting report.
async function generateAndStoreReport(
  exec: AiExecutive,
  report: ExecutiveReport | EnrichedReport,
  objectiveId?: string,
): Promise<AgentReportRow> {
  // Accept either a bare inspector report or an already-enriched one; enrich on
  // the way in so every persisted report carries confidence/recommendations/etc.
  const enriched: EnrichedReport = "confidence" in report ? report : enrichReport(report);
  const [row] = await db
    .insert(agentReportsTable)
    .values({
      id: randomUUID(),
      executiveId: exec.id,
      objectiveId: objectiveId ?? null,
      status: enriched.status,
      headline: enriched.headline,
      summary: enriched.summary,
      metrics: enriched.metrics,
      findings: enriched.findings,
      confidence: enriched.confidence,
      recommendations: enriched.recommendations,
      followUps: enriched.followUps,
      estimatedEffort: enriched.estimatedEffort,
    })
    .returning();
  return row!;
}

// Reconstruct an EnrichedReport from a persisted row (for re-aggregation).
function rowToEnriched(row: AgentReportRow): EnrichedReport {
  return {
    status: row.status,
    headline: row.headline,
    summary: row.summary,
    metrics: row.metrics,
    findings: row.findings,
    confidence: row.confidence,
    recommendations: row.recommendations,
    followUps: row.followUps,
    estimatedEffort: row.estimatedEffort,
  };
}

function serializeActivity(
  row: AgentActivityRow,
  execs: Map<string, AiExecutive>,
): Record<string, unknown> {
  const exec = row.executiveId ? execs.get(row.executiveId) : undefined;
  return {
    id: row.id,
    type: row.type,
    executiveId: row.executiveId,
    executiveName: exec?.name ?? null,
    summary: row.summary,
    detail: row.detail,
    createdAt: row.createdAt.toISOString(),
  };
}

// Parse a client-supplied date string, returning a valid Date, null when the
// caller explicitly cleared it, or `undefined` when the value is unusable so
// the caller can reject the request instead of writing an Invalid Date.
function parseDueAt(value: string | null | undefined): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

async function loadExecutivesMap(): Promise<Map<string, AiExecutive>> {
  const rows = await db.select().from(aiExecutivesTable);
  return new Map(rows.map((r) => [r.id, r]));
}

async function buildExecutiveAwareness() {
  const rows = await db.select().from(aiExecutivesTable).orderBy(aiExecutivesTable.sortOrder);
  const taskCounts = await db
    .select({ executiveId: agentTasksTable.executiveId, value: count() })
    .from(agentTasksTable)
    .where(inArray(agentTasksTable.status, ["backlog", "in_progress", "blocked", "review"]))
    .groupBy(agentTasksTable.executiveId);
  const countMap = new Map(taskCounts.map((r) => [r.executiveId, r.value]));
  return rows.map((e) => ({
    id: e.id,
    name: e.name,
    role: e.role,
    status: e.status,
    statusMessage: e.statusMessage,
    openTaskCount: countMap.get(e.id) ?? 0,
  }));
}

async function recordActivity(
  type:
    | "task_created"
    | "task_updated"
    | "handoff"
    | "message"
    | "collaboration"
    | "approval"
    | "objective",
  executiveId: string | null,
  summary: string,
  detail: string | null,
): Promise<void> {
  await db.insert(agentActivityTable).values({
    id: randomUUID(),
    type,
    executiveId,
    summary,
    detail,
  });
}

// ─── Objective & approval serializers ─────────────────────────────────────────

function serializeApproval(
  row: AgentApprovalRow,
  execs: Map<string, AiExecutive>,
): Record<string, unknown> {
  const exec = execs.get(row.executiveId);
  return {
    id: row.id,
    objectiveId: row.objectiveId ?? null,
    executiveId: row.executiveId,
    executiveName: exec?.name ?? "Unknown",
    executiveRole: exec?.role ?? "unknown",
    taskId: row.taskId ?? null,
    title: row.title,
    detail: row.detail,
    impact: row.impact,
    status: row.status,
    decidedAt: row.decidedAt ? row.decidedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

type ObjectiveCounts = { taskCount: number; openTaskCount: number; pendingApprovalCount: number };

function serializeObjective(
  row: AgentObjectiveRow,
  execs: Map<string, AiExecutive>,
  counts: ObjectiveCounts,
): Record<string, unknown> {
  const creator = row.createdByExecutiveId ? execs.get(row.createdByExecutiveId) : undefined;
  return {
    id: row.id,
    title: row.title,
    request: row.request,
    status: row.status,
    summary: row.summary ?? null,
    priority: row.priority,
    ownerRole: row.ownerRole ?? null,
    progressPercent: row.progressPercent,
    retryCount: row.retryCount,
    dependencies: row.dependencies ?? [],
    executionHistory: row.executionHistory ?? [],
    learningHistory: row.learningHistory ?? [],
    nextAction: row.nextAction ?? null,
    createdByExecutiveId: row.createdByExecutiveId ?? null,
    createdByName: creator?.name ?? null,
    briefingReportId: row.briefingReportId ?? null,
    taskCount: counts.taskCount,
    openTaskCount: counts.openTaskCount,
    pendingApprovalCount: counts.pendingApprovalCount,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// ─── Objective orchestration helpers ──────────────────────────────────────────

// Flip an executive into a visible state in the 5-state machine
// (idle | planning | active[=working] | collaborating | needs_approval).
async function setExecStatus(
  execId: string,
  status: "idle" | "planning" | "active" | "collaborating" | "needs_approval" | "busy",
  message: string | null,
): Promise<void> {
  await db
    .update(aiExecutivesTable)
    .set({ status, statusMessage: message, updatedAt: new Date() })
    .where(eq(aiExecutivesTable.id, execId));
}

async function countPendingApprovalsForExec(execId: string): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(agentApprovalsTable)
    .where(and(eq(agentApprovalsTable.executiveId, execId), eq(agentApprovalsTable.status, "pending")));
  return row?.value ?? 0;
}

async function countPendingApprovalsForObjective(objectiveId: string): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(agentApprovalsTable)
    .where(and(eq(agentApprovalsTable.objectiveId, objectiveId), eq(agentApprovalsTable.status, "pending")));
  return row?.value ?? 0;
}

// Escalate an executive's high-impact recommendations into approval gates.
async function createApprovalsFor(
  objectiveId: string,
  exec: AiExecutive,
  report: EnrichedReport,
  taskId: string | null,
): Promise<number> {
  const highImpact = report.recommendations.filter((r) => r.impact === "high");
  for (const rec of highImpact) {
    const approvalId = randomUUID();
    const title = `${exec.name}: high-impact recommendation`;
    await db.insert(agentApprovalsTable).values({
      id: approvalId,
      objectiveId,
      executiveId: exec.id,
      taskId,
      title,
      detail: rec.text,
      impact: rec.impact,
      status: "pending",
    });
    await recordActivity(
      "approval",
      exec.id,
      `${exec.name} flagged a decision that needs your approval`,
      rec.text,
    );
    // V6.8: predict how the Founder would decide and record it, so the model
    // can be scored against the actual decision later (continuous improvement).
    // Awaited (not fire-and-forget) so the prediction is durably committed before
    // the Founder can decide — otherwise a fast decision races the insert and the
    // learning label is lost forever. This runs on the background orchestration
    // path, so the extra two queries don't affect the Founder's request latency.
    try {
      const prediction = await predictApprovalDecision({
        id: approvalId,
        objectiveId,
        title,
        detail: rec.text,
        impact: rec.impact,
      });
      await recordPrediction(
        { id: approvalId, objectiveId, title, detail: rec.text, impact: rec.impact },
        prediction,
      );
    } catch (err) {
      logger.warn({ err, approvalId }, "V6.8: decision prediction record failed (non-blocking)");
    }
  }
  return highImpact.length;
}

// Tracks how many concurrent orchestration workstreams currently have each
// executive engaged, keyed by exec id. Two founder objectives running at once can
// assign — or hand off to — the same executive; without this refcount the first
// workstream to finish would flip the exec to "idle" while a sibling objective is
// still working it, showing an inaccurate status. `beginExecWork` is paired with a
// `settleExecStatus` call for every engagement.
const execWorkloadCount = new Map<string, number>();

function beginExecWork(execId: string): void {
  execWorkloadCount.set(execId, (execWorkloadCount.get(execId) ?? 0) + 1);
}

async function settleExecStatus(execId: string): Promise<void> {
  const remaining = (execWorkloadCount.get(execId) ?? 0) - 1;
  if (remaining > 0) {
    // Still engaged by another concurrent workstream — leave its live working
    // status intact instead of clobbering it to idle.
    execWorkloadCount.set(execId, remaining);
    return;
  }
  execWorkloadCount.delete(execId);
  const pending = await countPendingApprovalsForExec(execId);
  if (pending > 0) {
    await setExecStatus(execId, "needs_approval", "Awaiting your approval");
  } else {
    await setExecStatus(execId, "idle", null);
  }
}

function clip(text: string, max = 80): string {
  const clean = text.trim().replace(/\s+/g, " ");
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

// SPECIALIST BENCH — loop a second teammate into an executive's report. When the
// focus text matches a specialist owned by this executive, consult them and merge
// their findings/recommendations into the SAME report object (mutates `base`) so
// enrichment, approvals, and briefings reuse the existing pipeline with no
// duplicate memory. Shared by both the objective-orchestration inspection path
// and the standalone "run report" route. Never throws — consultSpecialist
// degrades to null on any failure.
async function consultBenchForReport(
  exec: { id: string; name: string; role: string },
  base: ExecutiveReport,
  focusText: string,
  ctx?: { objectiveId?: string; taskId?: string },
): Promise<void> {
  const bench = matchSpecialistsForRole(exec.role, focusText);
  for (const specialist of bench) {
    const digest = [
      base.headline,
      base.summary,
      ...base.findings.map((f) => `${f.severity}: ${f.text}`),
    ].join("\n");
    const consult = await consultSpecialist({
      specialist,
      focus: focusText,
      contextDigest: digest,
      executive: { id: exec.id, name: exec.name, role: exec.role },
      objectiveId: ctx?.objectiveId,
      taskId: ctx?.taskId,
    });
    if (consult) {
      base.findings.push(...consult.findings);
      for (const rec of consult.recommendations) {
        base.findings.push({ severity: "info", text: `[${consult.specialistName}] Recommendation: ${rec}` });
      }
      base.summary = `${base.summary} ${consult.specialistName} consulted (confidence ${consult.confidence}%): ${consult.summary}`;
      await recordActivity(
        "collaboration",
        exec.id,
        `${exec.name} consulted specialist: ${consult.specialistName}`,
        clip(consult.summary, 120),
      );
    }
  }
}

// Run one executive's capability, persist an enriched report, mark its task done,
// and trigger any approvals. Returns the enriched report (or null on failure).
async function inspectAndReport(
  exec: AiExecutive,
  objectiveId: string,
  taskId: string,
  focus?: string,
): Promise<EnrichedReport | null> {
  try {
    const base = await runCapability(exec.role);

    // ENGINEERING EXPANSION — loop a specialist into this workstream when the
    // assignment focus matches the executive's bench.
    if (focus) await consultBenchForReport(exec, base, focus, { objectiveId, taskId });

    const row = await generateAndStoreReport(exec, base, objectiveId);
    const report = rowToEnriched(row);
    await db
      .update(agentTasksTable)
      .set({ status: "done", progress: 100, updatedAt: new Date() })
      .where(eq(agentTasksTable.id, taskId));
    await createApprovalsFor(objectiveId, exec, report, taskId);
    return report;
  } catch (err) {
    logger.error({ err, role: exec.role, objectiveId }, "objective inspector failed");
    await db
      .update(agentTasksTable)
      .set({ status: "blocked", updatedAt: new Date() })
      .where(eq(agentTasksTable.id, taskId));
    return null;
  }
}

// Compile the aggregated briefing once all child work is done and no approval is
// pending. Idempotent and safe to call from both the runner and approval flow.
async function maybeFinalizeObjective(objectiveId: string): Promise<void> {
  const [objective] = await db
    .select()
    .from(agentObjectivesTable)
    .where(eq(agentObjectivesTable.id, objectiveId));
  if (!objective) return;
  if (objective.status === "completed" || objective.status === "failed") return;

  const tasks = await db
    .select()
    .from(agentTasksTable)
    .where(eq(agentTasksTable.objectiveId, objectiveId));
  const openTasks = tasks.filter((t) => t.status !== "done" && t.status !== "blocked");
  const pendingApprovals = await countPendingApprovalsForObjective(objectiveId);

  const execs = await loadExecutivesMap();
  const chief = [...execs.values()].find((e) => e.role === "chief_of_staff");

  if (openTasks.length > 0) return; // still working

  if (pendingApprovals > 0) {
    await db
      .update(agentObjectivesTable)
      .set({ status: "needs_approval", updatedAt: new Date() })
      .where(eq(agentObjectivesTable.id, objectiveId));
    if (chief) await setExecStatus(chief.id, "needs_approval", "Awaiting your approval to finalize");
    return;
  }

  if (!chief) return;

  // Atomically claim finalization: flip status to "completed" only if it is still
  // in a non-terminal state. The conditional UPDATE is the single source of
  // mutual exclusion — only the caller whose update returns a row composes the
  // briefing, so concurrent calls (runner + approval decision) cannot produce
  // duplicate briefing reports/messages.
  const claimed = await db
    .update(agentObjectivesTable)
    .set({ status: "completed", updatedAt: new Date() })
    .where(
      and(
        eq(agentObjectivesTable.id, objectiveId),
        inArray(agentObjectivesTable.status, ["planning", "in_progress", "needs_approval"]),
      ),
    )
    .returning({ id: agentObjectivesTable.id });
  if (claimed.length === 0) return; // lost the race; another caller is finalizing

  // Aggregate strictly this objective's workstream reports (the latest per exec
  // scoped to this objective), never the exec's unrelated global latest report.
  const childExecIds = [...new Set(tasks.map((t) => t.executiveId))];
  const inputs: { name: string; title: string; role: string; report: EnrichedReport | null }[] = [];
  for (const execId of childExecIds) {
    const exec = execs.get(execId);
    if (!exec || exec.role === "chief_of_staff") continue;
    const row = await latestReportForObjective(execId, objectiveId);
    inputs.push({
      name: exec.name,
      title: exec.title,
      role: exec.role,
      report: row ? rowToEnriched(row) : null,
    });
  }

  const collaborationCount = tasks.filter((t) => t.origin === "agent" && t.createdByExecutiveId).length;
  const resolvedApprovals = await db
    .select({ value: count() })
    .from(agentApprovalsTable)
    .where(and(eq(agentApprovalsTable.objectiveId, objectiveId), inArray(agentApprovalsTable.status, ["approved", "rejected", "deferred"])));

  await setExecStatus(chief.id, "planning", "Compiling the consolidated briefing…");
  const briefing = await composeBriefing({
    title: objective.title,
    request: objective.request,
    inputs,
    collaborationCount,
    approvalsResolved: resolvedApprovals[0]?.value ?? 0,
  });
  const row = await generateAndStoreReport(chief, briefing, objectiveId);

  await db
    .update(agentObjectivesTable)
    .set({ briefingReportId: row.id, updatedAt: new Date() })
    .where(eq(agentObjectivesTable.id, objectiveId));
  await setExecStatus(chief.id, "idle", null);
  await recordActivity(
    "objective",
    chief.id,
    `${chief.name} completed the briefing for "${objective.title}"`,
    briefing.headline,
  );
  await db.insert(agentMessagesTable).values({
    id: randomUUID(),
    executiveId: chief.id,
    role: "agent",
    content: `Objective complete: ${briefing.headline}\n\n${briefing.summary}`,
  });

  // Persist outcome in Quinn's long-term memory for cross-session continuity.
  await db
    .insert(agentMemoryTable)
    .values({
      id: randomUUID(),
      executiveId: chief.id,
      kind: "context",
      content: `Completed objective "${objective.title}": ${briefing.headline}`,
      pinned: false,
    })
    .catch(() => {});

  // V7 Executive Learning Engine: every completed objective produces a
  // retrospective and permanent per-exec lessons. Best-effort — a learning
  // failure must never break objective finalization.
  await generateObjectiveRetrospective(objectiveId).catch((err: unknown) =>
    logger.warn({ err, objectiveId }, "learning: retrospective generation failed"),
  );

  // V8: record this completion to the organization timeline (company memory)
  // as both a milestone and a learning moment.
  await recordEvent({
    type: "milestone",
    title: `Objective completed: "${objective.title}"`,
    summary: briefing.headline,
    actorExecutiveId: chief.id,
    refType: "objective",
    refId: objectiveId,
    importance: "high",
    keywords: ["objective", "completed", "milestone"],
    metadata: { outcome: "completed" },
  });
  await recordEvent({
    type: "learning",
    title: `Lessons captured from "${objective.title}"`,
    summary: "A retrospective and per-executive lessons were recorded.",
    actorExecutiveId: chief.id,
    refType: "objective",
    refId: objectiveId,
    importance: "low",
    keywords: ["learning", "retrospective"],
  });
}

// Drive a founder objective end-to-end: plan → fan out → inspect → collaborate →
// gate on approvals → finalize. Runs in the background; the client polls.
async function runObjectiveOrchestration(
  objectiveId: string,
  chiefId: string,
  request: string,
): Promise<void> {
  const execs = await loadExecutivesMap();
  const chief = execs.get(chiefId);
  if (!chief) return;
  const execList = [...execs.values()];
  const byRole = (role: string): AiExecutive | undefined => execList.find((e) => e.role === role);

  // 1. PLAN
  await setExecStatus(chief.id, "planning", "Decomposing the objective…");
  const plan = await decomposeObjective(
    request,
    execList.map((e) => ({ role: e.role, name: e.name, title: e.title })),
  );
  await db
    .update(agentObjectivesTable)
    .set({ title: plan.title, summary: plan.rationale, status: "in_progress", updatedAt: new Date() })
    .where(eq(agentObjectivesTable.id, objectiveId));
  await recordActivity(
    "objective",
    chief.id,
    `${chief.name} decomposed the objective into ${plan.assignments.length} workstream(s)`,
    plan.title,
  );

  const inspected = new Set<string>(); // roles already inspected this run

  // 2. FAN OUT + INSPECT each assigned executive
  for (const assignment of plan.assignments) {
    const exec = byRole(assignment.role);
    if (!exec) continue;

    const taskId = randomUUID();
    await db.insert(agentTasksTable).values({
      id: taskId,
      executiveId: exec.id,
      title: clip(`${plan.title}: ${assignment.focus}`, 120),
      description: assignment.focus,
      status: "in_progress",
      priority: assignment.priority,
      origin: "agent",
      createdByExecutiveId: chief.id,
      objectiveId,
      progress: 10,
    });
    // Engagement is refcounted (beginExecWork) so a concurrent objective sharing
    // this exec is not idled early; the try/finally guarantees the matching
    // settleExecStatus runs even if a workstream step throws (no stuck-busy leak).
    beginExecWork(exec.id);
    try {
      await setExecStatus(exec.id, "active", `Working on: ${clip(assignment.focus, 60)}`);
      await recordActivity(
        "task_created",
        exec.id,
        `${chief.name} assigned ${exec.name} a workstream`,
        clip(assignment.focus, 120),
      );

      const report = await inspectAndReport(exec, objectiveId, taskId, assignment.focus);
      inspected.add(exec.role);

      // 3a. V6.4 COLLABORATION EVENTS — log typed inter-exec communication
      if (report && (ROLES_WITH_CAPABILITY as readonly string[]).includes(exec.role)) {
        const collabEvents = generateCollabEvents(exec.role as Parameters<typeof generateCollabEvents>[0], report, plan.title);
        for (const evt of collabEvents) {
          const targetExec = evt.toRole ? byRole(evt.toRole) : null;
          await db.insert(execCollabEventsTable).values({
            id: randomUUID(),
            objectiveId,
            fromExecutiveId: exec.id,
            toExecutiveId: targetExec?.id ?? null,
            taskId,
            eventType: evt.eventType as CollabEventType,
            content: evt.content,
            metadata: evt.metadata,
          }).catch((err: unknown) => {
            logger.warn({ err }, "V6.4: failed to log collab event — non-blocking");
          });
          if (targetExec) {
            await recordActivity(
              "collaboration",
              targetExec.id,
              `${exec.name} → ${targetExec.name}: ${evt.eventType.replace(/_/g, " ")}`,
              evt.content.slice(0, 120),
            );
          }
        }
      }

      // 3b. COLLABORATION (single hop) when the report flags something real.
      if (report) {
        const collab = routeCollaboration(exec.role, report);
        if (collab) {
          const target = byRole(collab.to);
          if (target && target.id !== exec.id) {
            await setExecStatus(exec.id, "collaborating", `Handing off to ${target.name}`);
            const collabTaskId = randomUUID();
            await db.insert(agentTasksTable).values({
              id: collabTaskId,
              executiveId: target.id,
              title: clip(`Follow-up from ${exec.name}: ${collab.trigger}`, 120),
              description: `${collab.reason}. Triggering finding: ${collab.trigger}`,
              status: "in_progress",
              priority: "high",
              origin: "agent",
              createdByExecutiveId: exec.id,
              objectiveId,
              progress: 20,
            });
            await db.insert(agentHandoffsTable).values({
              id: randomUUID(),
              taskId: collabTaskId,
              fromExecutiveId: exec.id,
              toExecutiveId: target.id,
              note: collab.reason,
            });
            await recordActivity(
              "collaboration",
              target.id,
              `${exec.name} → ${target.name}: ${collab.reason}`,
              clip(collab.trigger, 120),
            );
            beginExecWork(target.id);
            try {
              await setExecStatus(target.id, "collaborating", `Collaborating with ${exec.name}`);

              if (inspected.has(target.role)) {
                // Already inspected this run — close the follow-up using prior work.
                await db
                  .update(agentTasksTable)
                  .set({ status: "done", progress: 100, updatedAt: new Date() })
                  .where(eq(agentTasksTable.id, collabTaskId));
              } else {
                await inspectAndReport(target, objectiveId, collabTaskId, `${collab.reason}. Triggering finding: ${collab.trigger}`);
                inspected.add(target.role);
              }
            } finally {
              await settleExecStatus(target.id);
            }
          }
        }
      }
    } finally {
      await settleExecStatus(exec.id);
    }
  }

  // 4. FINALIZE (or gate on approvals)
  await maybeFinalizeObjective(objectiveId);
}

// ─── Executive command execution ──────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Build a structured report for an executive on demand. Capability-bearing roles
// inspect real resources; the Chief of Staff aggregates the latest filed reports.
async function buildCommandReport(exec: AiExecutive): Promise<ExecutiveReport> {
  if ((ROLES_WITH_CAPABILITY as readonly string[]).includes(exec.role)) {
    return runCapability(exec.role);
  }
  if (exec.role === "chief_of_staff") {
    const execMap = await loadExecutivesMap();
    const execList = [...execMap.values()];
    const inputs: { name: string; title: string; report: ExecutiveReport | null }[] = [];
    for (const role of ROLES_WITH_CAPABILITY) {
      const e = execList.find((x) => x.role === role);
      if (!e) continue;
      const row = await latestReportFor(e.id);
      inputs.push({
        name: e.name,
        title: e.title,
        report: row
          ? {
              status: row.status,
              headline: row.headline,
              summary: row.summary,
              metrics: row.metrics,
              findings: row.findings,
            }
          : null,
      });
    }
    return aggregateChiefOfStaff(inputs);
  }
  throw new Error(`No analysis path for role "${exec.role}"`);
}

type CommandExecution = {
  exec: AiExecutive;
  taskId: string;
  verb: CommandVerb;
  subject: string;
};

// Tracks command executions currently in flight per executive. The background
// runner is in-process, so an in-memory set precisely identifies *our* command
// tasks — unlike querying the tasks table, which can't distinguish a running
// command from a pre-existing in-progress backlog/seed task.
const activeCommandTasks = new Map<string, Set<string>>();

function markCommandActive(execId: string, taskId: string): void {
  let set = activeCommandTasks.get(execId);
  if (!set) {
    set = new Set();
    activeCommandTasks.set(execId, set);
  }
  set.add(taskId);
}

// Return an executive to a resting state after one of its command tasks finishes.
// If sibling commands are still running, keep it visibly working instead of
// clobbering their state — this avoids a race where the first command to finish
// wrongly clears the working status of a still-running sibling.
async function settleExecutiveStatus(
  execId: string,
  taskId: string,
  restingStatus: AiExecutive["status"],
): Promise<void> {
  const set = activeCommandTasks.get(execId);
  set?.delete(taskId);
  const stillRunning = !!set && set.size > 0;
  if (!stillRunning) activeCommandTasks.delete(execId);

  if (stillRunning) {
    await db
      .update(aiExecutivesTable)
      .set({ status: "active", statusMessage: "Running command…", updatedAt: new Date() })
      .where(eq(aiExecutivesTable.id, execId))
      .catch(() => {});
    return;
  }
  await db
    .update(aiExecutivesTable)
    .set({ status: restingStatus, statusMessage: null, updatedAt: new Date() })
    .where(eq(aiExecutivesTable.id, execId))
    .catch(() => {});
}

// Runs the real analysis behind a founder command: steps task progress, performs
// the inspection, files a structured report, posts a completion message, and
// returns the executive to its prior status. Detached from the request lifecycle.
async function executeCommandInBackground(cmd: CommandExecution): Promise<void> {
  const { exec, taskId, verb, subject } = cmd;
  const prevStatus = exec.status;
  const subjectLabel = subject ? ` on ${subject}` : "";
  const verbCap = verb.charAt(0).toUpperCase() + verb.slice(1);
  markCommandActive(exec.id, taskId);

  try {
    for (const pct of [25, 55, 80]) {
      await sleep(1200);
      await db
        .update(agentTasksTable)
        .set({ progress: pct, updatedAt: new Date() })
        .where(eq(agentTasksTable.id, taskId));
    }

    const report = await buildCommandReport(exec);
    await generateAndStoreReport(exec, report);

    await db
      .update(agentTasksTable)
      .set({ status: "done", progress: 100, updatedAt: new Date() })
      .where(eq(agentTasksTable.id, taskId));

    await settleExecutiveStatus(exec.id, taskId, prevStatus);

    const findingNote =
      report.findings.find((f) => f.severity !== "info")?.text ?? report.findings[0]?.text;
    const completion =
      `✓ ${verbCap} complete${subjectLabel} — status ${report.status.toUpperCase()}. ` +
      `${report.headline}. ${report.summary}` +
      (findingNote ? ` Key item: ${findingNote}` : "") +
      ` Full breakdown is filed under my Capability Report.`;

    await db.insert(agentMessagesTable).values({
      id: randomUUID(),
      executiveId: exec.id,
      role: "agent",
      content: completion,
      createdAt: new Date(),
    });

    await recordActivity(
      "message",
      exec.id,
      `${exec.name} completed a ${verb} command`,
      report.headline,
    );
  } catch (err) {
    // Surface failure in-band: flag the task blocked, clear the working state, and
    // tell the founder rather than leaving a silent spinner. Best-effort writes.
    await db
      .update(agentTasksTable)
      .set({ status: "blocked", updatedAt: new Date() })
      .where(eq(agentTasksTable.id, taskId))
      .catch(() => {});
    await settleExecutiveStatus(exec.id, taskId, prevStatus);
    await db
      .insert(agentMessagesTable)
      .values({
        id: randomUUID(),
        executiveId: exec.id,
        role: "agent",
        content: `I hit a problem while running the ${verb} command and couldn't finish it. I've flagged the directive as blocked — give the word and I'll re-run the analysis.`,
        createdAt: new Date(),
      })
      .catch(() => {});
    throw err;
  }
}

// ─── Overview ─────────────────────────────────────────────────────────────────

router.get("/mission-control/overview", async (_req, res): Promise<void> => {
  const execs = await loadExecutivesMap();
  const execList = [...execs.values()].sort((a, b) => a.sortOrder - b.sortOrder);

  const tasks = await db.select().from(agentTasksTable);
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const openTasks = tasks.filter((t) => t.status !== "done").length;
  const blockedTasks = tasks.filter((t) => t.status === "blocked").length;
  const criticalTasks = tasks.filter((t) => t.status !== "done" && t.priority === "critical").length;
  const completedTasks = tasks.filter((t) => t.status === "done").length;
  const activeCount = execList.filter((e) => e.status === "active" || e.status === "busy").length;

  const allHandoffs = await db.select().from(agentHandoffsTable);
  const handoffsTodayCount = allHandoffs.filter((h) => h.createdAt >= startOfDay).length;

  const priorityRank: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  const priorities = tasks
    .filter((t) => t.status !== "done")
    .sort((a, b) => {
      const r = (priorityRank[a.priority] ?? 9) - (priorityRank[b.priority] ?? 9);
      if (r !== 0) return r;
      return b.updatedAt.getTime() - a.updatedAt.getTime();
    })
    .slice(0, 6)
    .map((t) => serializeTask(t, execs));

  const activityRows = await db
    .select()
    .from(agentActivityTable)
    .orderBy(desc(agentActivityTable.createdAt))
    .limit(12);

  const stats = {
    totalExecutives: execList.length,
    activeExecutives: activeCount,
    openTasks,
    blockedTasks,
    criticalTasks,
    completedTasks,
    handoffsToday: handoffsTodayCount,
  };

  const topPriorities = tasks
    .filter((t) => t.status !== "done")
    .sort((a, b) => (priorityRank[a.priority] ?? 9) - (priorityRank[b.priority] ?? 9))
    .slice(0, 3)
    .map((t) => ({ title: t.title, priority: t.priority }));

  // Portfolio-wide health so the briefing covers every monitored company, not
  // just VYBE's internal team state. Never let a monitor failure kill the brief.
  let portfolioForBriefing: BriefingInput["portfolio"];
  try {
    const { assets } = await getPortfolioHealth();
    portfolioForBriefing = assets.map((a) => {
      const worst =
        a.dimensions.find((d) => d.status === "critical") ??
        a.dimensions.find((d) => d.status === "attention");
      const prod = a.dimensions.find((d) => d.key === "production_status");
      return {
        name: a.name,
        overall: a.overall,
        highlight: worst?.detail ?? prod?.detail ?? "No telemetry connected yet.",
      };
    });
  } catch (err) {
    _req.log.warn({ err }, "briefing: portfolio health unavailable");
  }

  const briefing = generateDailyBriefing({
    executiveCount: execList.length,
    activeCount,
    openTasks,
    blockedTasks,
    criticalTasks,
    completedTasks,
    handoffsToday: handoffsTodayCount,
    topPriorities,
    portfolio: portfolioForBriefing,
  });

  res.json({
    briefing: { ...briefing, generatedAt: new Date().toISOString() },
    stats,
    priorities,
    executives: execList.map(serializeExecutive),
    activity: activityRows.map((a) => serializeActivity(a, execs)),
  });
});

// ─── Executive awareness (live team snapshot) ─────────────────────────────────

router.get("/mission-control/awareness", async (_req, res): Promise<void> => {
  const awareness = await buildExecutiveAwareness();
  res.json(awareness);
});

// ─── Activity feed ────────────────────────────────────────────────────────────

router.get("/mission-control/activity", async (_req, res): Promise<void> => {
  const execs = await loadExecutivesMap();
  const rows = await db
    .select()
    .from(agentActivityTable)
    .orderBy(desc(agentActivityTable.createdAt))
    .limit(50);
  res.json(rows.map((a) => serializeActivity(a, execs)));
});

// ─── Executives ───────────────────────────────────────────────────────────────

router.get("/mission-control/executives", async (_req, res): Promise<void> => {
  const rows = await db.select().from(aiExecutivesTable).orderBy(aiExecutivesTable.sortOrder);
  res.json(rows.map(serializeExecutive));
});

router.get("/mission-control/executives/:executiveId", async (req, res): Promise<void> => {
  const executiveId = String(req.params.executiveId);
  const [exec] = await db
    .select()
    .from(aiExecutivesTable)
    .where(eq(aiExecutivesTable.id, executiveId));
  if (!exec) {
    res.status(404).json({ error: "Executive not found" });
    return;
  }

  const tasks = await db
    .select()
    .from(agentTasksTable)
    .where(eq(agentTasksTable.executiveId, executiveId));
  const [memoryCountRow] = await db
    .select({ value: count() })
    .from(agentMemoryTable)
    .where(eq(agentMemoryTable.executiveId, executiveId));
  const [messageCountRow] = await db
    .select({ value: count() })
    .from(agentMessagesTable)
    .where(eq(agentMessagesTable.executiveId, executiveId));
  const lastMessageRows = await db
    .select()
    .from(agentMessagesTable)
    .where(eq(agentMessagesTable.executiveId, executiveId))
    .orderBy(desc(agentMessagesTable.createdAt))
    .limit(1);

  const capInfo = CAPABILITY_INFO[exec.role];

  res.json({
    executive: serializeExecutive(exec),
    openTasks: tasks.filter((t) => t.status !== "done").length,
    completedTasks: tasks.filter((t) => t.status === "done").length,
    blockedTasks: tasks.filter((t) => t.status === "blocked").length,
    memoryCount: memoryCountRow?.value ?? 0,
    messageCount: messageCountRow?.value ?? 0,
    lastActiveAt: lastMessageRows[0] ? lastMessageRows[0].createdAt.toISOString() : null,
    capability: capInfo
      ? { responsibility: capInfo.responsibility, resources: capInfo.resources }
      : null,
  });
});

router.patch("/mission-control/executives/:executiveId", async (req, res): Promise<void> => {
  const executiveId = String(req.params.executiveId);
  const parsed = UpdateExecutiveStatusBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }

  const update: Partial<typeof aiExecutivesTable.$inferInsert> = { updatedAt: new Date() };
  if (parsed.data.status !== undefined) update.status = parsed.data.status;
  if (parsed.data.statusMessage !== undefined) update.statusMessage = parsed.data.statusMessage;

  const [updated] = await db
    .update(aiExecutivesTable)
    .set(update)
    .where(eq(aiExecutivesTable.id, executiveId))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Executive not found" });
    return;
  }
  res.json(serializeExecutive(updated));
});

router.get("/mission-control/executives/:executiveId/tasks", async (req, res): Promise<void> => {
  const executiveId = String(req.params.executiveId);
  const execs = await loadExecutivesMap();
  const rows = await db
    .select()
    .from(agentTasksTable)
    .where(eq(agentTasksTable.executiveId, executiveId))
    .orderBy(desc(agentTasksTable.updatedAt));
  res.json(rows.map((t) => serializeTask(t, execs)));
});

// ─── Memory ───────────────────────────────────────────────────────────────────

router.get("/mission-control/executives/:executiveId/memory", async (req, res): Promise<void> => {
  const executiveId = String(req.params.executiveId);
  const rows = await db
    .select()
    .from(agentMemoryTable)
    .where(eq(agentMemoryTable.executiveId, executiveId))
    .orderBy(desc(agentMemoryTable.pinned), desc(agentMemoryTable.createdAt));
  res.json(rows.map(serializeMemory));
});

router.post("/mission-control/executives/:executiveId/memory", async (req, res): Promise<void> => {
  const executiveId = String(req.params.executiveId);
  const parsed = AddExecutiveMemoryBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }
  const [exec] = await db
    .select()
    .from(aiExecutivesTable)
    .where(eq(aiExecutivesTable.id, executiveId));
  if (!exec) {
    res.status(404).json({ error: "Executive not found" });
    return;
  }
  const [created] = await db
    .insert(agentMemoryTable)
    .values({
      id: randomUUID(),
      executiveId,
      kind: parsed.data.kind ?? "context",
      content: parsed.data.content,
      pinned: parsed.data.pinned ?? false,
    })
    .returning();
  res.status(201).json(serializeMemory(created!));
});

router.delete("/mission-control/memory/:memoryId", async (req, res): Promise<void> => {
  const memoryId = String(req.params.memoryId);
  const deleted = await db
    .delete(agentMemoryTable)
    .where(eq(agentMemoryTable.id, memoryId))
    .returning();
  if (deleted.length === 0) {
    res.status(404).json({ error: "Memory entry not found" });
    return;
  }
  res.status(204).end();
});

// ─── Messages (chat) ──────────────────────────────────────────────────────────

router.get("/mission-control/executives/:executiveId/messages", async (req, res): Promise<void> => {
  const executiveId = String(req.params.executiveId);
  const rows = await db
    .select()
    .from(agentMessagesTable)
    .where(eq(agentMessagesTable.executiveId, executiveId))
    .orderBy(agentMessagesTable.createdAt);
  res.json(rows.map(serializeMessage));
});

router.post("/mission-control/executives/:executiveId/messages", async (req, res): Promise<void> => {
  const executiveId = String(req.params.executiveId);
  const parsed = SendExecutiveMessageBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }
  const [exec] = await db
    .select()
    .from(aiExecutivesTable)
    .where(eq(aiExecutivesTable.id, executiveId));
  if (!exec) {
    res.status(404).json({ error: "Executive not found" });
    return;
  }

  const openTaskRows = await db
    .select()
    .from(agentTasksTable)
    .where(eq(agentTasksTable.executiveId, executiveId));
  const openTasks = openTaskRows
    .filter((t) => t.status !== "done")
    .map((t) => ({ title: t.title, status: t.status, priority: t.priority }));

  const founderTs = new Date();
  const [founderMessage] = await db
    .insert(agentMessagesTable)
    .values({
      id: randomUUID(),
      executiveId,
      role: "founder",
      content: parsed.data.content,
      createdAt: founderTs,
    })
    .returning();

  // Is this an executive *command* (an imperative to do real work) rather than
  // ordinary discussion? Commands get acknowledged, tracked as a task, and run a
  // real capability inspection in the background.
  const command = parseExecutiveCommand(parsed.data.content);

  // Learning: direct engagement with a non-Quinn executive is an executive-trust
  // observation. (Quinn messages are analyzed separately in the chief branch.)
  if (exec.role !== "chief_of_staff") {
    void analyzeExecutiveEngagement(exec.name, exec.title, parsed.data.content).catch(
      (err: unknown) => req.log.warn({ err }, "founder profile: exec engagement analysis failed"),
    );
  }

  // ─── Quinn Harlow (Chief of Staff) — V6.1 Reasoning Engine ──────────────────
  // Five-step pipeline: classify → load sources → reason → respond → record.
  if (exec.role === "chief_of_staff") {
    // ── Phase 1: Base context (fast, always needed) ───────────────────────────
    const [recentMsgs, awareness, memoryItems, pendingApprovals, recentObjectives] =
      await Promise.all([
        db
          .select()
          .from(agentMessagesTable)
          .where(eq(agentMessagesTable.executiveId, executiveId))
          .orderBy(desc(agentMessagesTable.createdAt))
          .limit(12),
        buildExecutiveAwareness(),
        db
          .select()
          .from(agentMemoryTable)
          .where(eq(agentMemoryTable.executiveId, executiveId))
          .orderBy(desc(agentMemoryTable.pinned), desc(agentMemoryTable.createdAt))
          .limit(12),
        db
          .select({
            id: agentApprovalsTable.id,
            objectiveId: agentApprovalsTable.objectiveId,
            title: agentApprovalsTable.title,
            detail: agentApprovalsTable.detail,
            impact: agentApprovalsTable.impact,
          })
          .from(agentApprovalsTable)
          .where(eq(agentApprovalsTable.status, "pending"))
          .orderBy(desc(agentApprovalsTable.createdAt))
          .limit(5),
        db
          .select({ title: agentObjectivesTable.title, status: agentObjectivesTable.status })
          .from(agentObjectivesTable)
          .orderBy(desc(agentObjectivesTable.createdAt))
          .limit(6),
      ]);

    const reversedMsgs = [...recentMsgs].reverse().map((m) => ({
      role: m.role as "founder" | "agent",
      content: m.content,
    }));

    // ── Phase 2: Classify intent (deterministic, instant) ────────────────────
    const classifiedIntent: QuinnReasoningIntent = classifyIntent(
      parsed.data.content,
      reversedMsgs,
    );
    req.log.info({ classifiedIntent, executiveId }, "Quinn intent classified");

    // ── Phase 3: Load intent-specific sources in parallel ─────────────────────
    const needsReports = (
      ["current_status", "objective_planning", "objective_execution", "decision_support"] as QuinnReasoningIntent[]
    ).includes(classifiedIntent);
    const needsTasks = (
      ["executive_coordination", "objective_planning", "objective_execution", "current_status"] as QuinnReasoningIntent[]
    ).includes(classifiedIntent);
    const needsApprovalHistory = (
      ["decision_support", "memory_retrieval"] as QuinnReasoningIntent[]
    ).includes(classifiedIntent);
    const needsFullHistory = classifiedIntent === "memory_retrieval";

    const [latestReports, activeTasks, approvalHistory, allObjectives] = await Promise.all([
      needsReports ? latestReportsForAll() : Promise.resolve(undefined),
      needsTasks
        ? db
            .select({
              title: agentTasksTable.title,
              status: agentTasksTable.status,
              priority: agentTasksTable.priority,
              executiveName: aiExecutivesTable.name,
            })
            .from(agentTasksTable)
            .innerJoin(aiExecutivesTable, eq(agentTasksTable.executiveId, aiExecutivesTable.id))
            .where(inArray(agentTasksTable.status, ["in_progress", "backlog", "blocked"]))
            .orderBy(desc(agentTasksTable.createdAt))
            .limit(10)
        : Promise.resolve(undefined),
      needsApprovalHistory
        ? db
            .select({
              title: agentApprovalsTable.title,
              status: agentApprovalsTable.status,
              decidedAt: agentApprovalsTable.decidedAt,
            })
            .from(agentApprovalsTable)
            .where(inArray(agentApprovalsTable.status, ["approved", "rejected"]))
            .orderBy(desc(agentApprovalsTable.createdAt))
            .limit(8)
        : Promise.resolve(undefined),
      needsFullHistory
        ? db
            .select({
              title: agentObjectivesTable.title,
              status: agentObjectivesTable.status,
              request: agentObjectivesTable.request,
            })
            .from(agentObjectivesTable)
            .orderBy(desc(agentObjectivesTable.createdAt))
            .limit(15)
        : Promise.resolve(undefined),
    ]);

    // ── Phase 4: Build enriched context and call Quinn brain ──────────────────
    // V11 Tier 1: the Founder-context preamble (explicit operating profile +
    // inferred insights) comes from the single shared assembler so chat, briefing
    // and autonomy never duplicate this composition.
    const founderProfile = await getFounderProfilePreamble();

    // V6.8: load the Founder Decision Model — predicted choices for pending
    // approvals + the model's accuracy, gated act-vs-confirm. Only when it adds
    // value: a pending decision exists or the Founder is asking for a call.
    const decisionModel =
      pendingApprovals.length > 0 || classifiedIntent === "decision_support"
        ? await formatDecisionModelForQuinn(
            pendingApprovals.map((a) => ({
              id: a.id,
              objectiveId: a.objectiveId,
              title: a.title,
              detail: a.detail,
              impact: a.impact,
            })),
          ).catch(() => null)
        : null;

    // Marketing Autonomy: Quinn always knows Dario's autonomy status.
    const marketingBrief = await getMarketingAutonomyBrief().catch(() => null);

    // Agent Zero: Quinn always knows the execution layer's queue status.
    const agentZeroBrief = await getAgentZeroBrief().catch(() => null);

    const ctx: ConversationContext = {
      founderMessage: parsed.data.content,
      classifiedIntent,
      executiveId,
      founderProfile,
      decisionModel,
      marketingBrief,
      agentZeroBrief,
      recentMessages: reversedMsgs,
      executiveAwareness: awareness,
      recentObjectives,
      memoryItems: memoryItems.map((m) => ({ kind: m.kind, content: m.content })),
      pendingApprovals,
      latestReports,
      activeTasks,
      approvalHistory: approvalHistory?.map((a) => ({
        title: a.title,
        status: a.status,
        decidedAt: a.decidedAt?.toISOString(),
      })),
      allObjectives,
    };

    let result = await converseAsChief(ctx);

    // V6.5: Fire-and-forget behavioral analysis — does not block the response
    void analyzeFounderMessage(
      parsed.data.content,
      reversedMsgs.slice(-3).map((m) => `${m.role}: ${m.content.slice(0, 60)}`).join(" | "),
      new Date().getHours(),
    ).catch((err: unknown) => req.log.warn({ err }, "V6.5: founder profile analysis failed (non-blocking)"));

    // ── V6.7 normalize legacy "approval_required" → launch+gate ────────────────
    // The new design never refuses a protected action; it launches the prep and
    // gates the irreversible step. If the AI still returns intent="approval_required"
    // for a protected ACTION (not a queue query like "check approvals"), convert
    // it to a launch so an objective is created and the gate is attached below.
    if (
      result.intent === "approval_required" &&
      result.reasoningIntent !== "approval_request" &&
      parsed.data.content.trim().length > 0
    ) {
      result = {
        ...result,
        intent: "launch",
        reasoningIntent: "objective_execution",
        objectiveText: result.objectiveText ?? parsed.data.content,
      };
    }

    // ── V6.7 deterministic safety gate ────────────────────────────────────────
    // Protected categories NO LONGER block objective creation. Quinn always
    // mobilizes the team for the safe prep work; only the final irreversible step
    // is gated. Here we resolve the protected bucket (if any) so the launch path
    // can attach a pending approval to the objective — parking it at
    // needs_approval before the protected action runs. Pure questions ("…?") are
    // not actions and are never gated.
    let protectedBucket: string | null = null;
    if (result.intent === "launch") {
      const isQuestion = parsed.data.content.trim().endsWith("?");
      if (!isQuestion) {
        const textToGate = [parsed.data.content, result.objectiveText]
          .filter(Boolean)
          .join(" ");
        protectedBucket =
          result.needsApprovalCategory ?? detectProtectedCategory(textToGate);
      }
    }

    // ── Memory directive — write or delete from Quinn's long-term memory ─────
    let memoryOpResult: { action: string; memoryId: string | null; content: string } | null = null;
    if (result.memoryOp) {
      const op: MemoryOp = result.memoryOp;
      if (op.action === "remember") {
        const [newEntry] = await db
          .insert(agentMemoryTable)
          .values({
            id: randomUUID(),
            executiveId,
            kind: op.kind ?? "fact",
            content: op.content,
            pinned: false,
          })
          .returning();
        memoryOpResult = { action: "remember", memoryId: newEntry?.id ?? null, content: op.content };
      } else if (op.action === "forget") {
        // Fuzzy match: find entries where content contains keywords from the forget query
        const existing = await db
          .select()
          .from(agentMemoryTable)
          .where(eq(agentMemoryTable.executiveId, executiveId));
        const keywords = op.content
          .toLowerCase()
          .split(/\s+/)
          .filter((w) => w.length > 3);
        const toDelete = existing.filter((e) =>
          keywords.length === 0
            ? e.content.toLowerCase().includes(op.content.toLowerCase())
            : keywords.some((kw) => e.content.toLowerCase().includes(kw)),
        );
        for (const entry of toDelete) {
          await db.delete(agentMemoryTable).where(eq(agentMemoryTable.id, entry.id));
        }
        memoryOpResult = { action: "forget", memoryId: null, content: op.content };
      }
    }

    // Launch intent → create an objective and run the full team orchestration
    if (result.intent === "launch") {
      const objectiveId = randomUUID();
      const objectiveRequest = result.objectiveText ?? parsed.data.content;
      const provisionalTitle = command.isCommand
        ? commandTaskTitle(command.verb, command.subject)
        : (result.objectiveText ?? parsed.data.content).slice(0, 60);

      await db.insert(agentObjectivesTable).values({
        id: objectiveId,
        title: provisionalTitle,
        request: objectiveRequest,
        status: "planning",
        createdByExecutiveId: exec.id,
      });

      // Learning: a founder-directed objective is an explicit strategic-goal
      // observation. Fire-and-forget — never blocks the launch path.
      void analyzeObjectiveDirective(provisionalTitle, objectiveRequest).catch(
        (err: unknown) => req.log.warn({ err }, "founder profile: objective analysis failed"),
      );

      // V6.7: if the objective's final step lands in a protected bucket, attach a
      // pending approval tied to the objective. Orchestration runs all safe prep
      // autonomously, then maybeFinalizeObjective holds at needs_approval while
      // this approval is pending — gating ONLY the irreversible step.
      let protectedApprovalId: string | null = null;
      if (protectedBucket) {
        protectedApprovalId = randomUUID();
        await db.insert(agentApprovalsTable).values({
          id: protectedApprovalId,
          objectiveId,
          executiveId: exec.id,
          taskId: null,
          title: `Approve ${protectedBucket} step: ${provisionalTitle}`,
          detail:
            `The team is preparing "${objectiveRequest}". This objective's final ` +
            `step falls under a protected category ("${protectedBucket}"). All ` +
            `planning, analysis, and inspection proceed autonomously — the ` +
            `${protectedBucket} action will not run until you approve it here.`,
          impact: "high",
          status: "pending",
        });
      }

      // V6.7: ensure the reply tells the founder the protected step is gated, even
      // if the AI path didn't phrase it that way.
      const replyText =
        protectedBucket && !/approv/i.test(result.reply)
          ? `${result.reply}\n\nNote: the ${protectedBucket} step is the only action I'll hold for your explicit approval — everything up to it proceeds autonomously.`
          : result.reply;

      const [agentMessage] = await db
        .insert(agentMessagesTable)
        .values({
          id: randomUUID(),
          executiveId,
          role: "agent",
          content: replyText,
          createdAt: new Date(founderTs.getTime() + 1),
        })
        .returning();

      await setExecStatus(exec.id, "planning", "Decomposing the objective…");
      await recordActivity(
        "objective",
        exec.id,
        `${exec.name} accepted a founder objective`,
        provisionalTitle,
      );

      void runObjectiveOrchestration(objectiveId, exec.id, objectiveRequest).catch(
        async (err) => {
          req.log.error({ err, objectiveId }, "objective orchestration failed");
          try {
            await db
              .update(agentObjectivesTable)
              .set({ status: "failed", updatedAt: new Date() })
              .where(
                and(
                  eq(agentObjectivesTable.id, objectiveId),
                  inArray(agentObjectivesTable.status, [
                    "planning",
                    "in_progress",
                    "needs_approval",
                  ]),
                ),
              );
            await setExecStatus(exec.id, "idle", null);
            await recordActivity(
              "objective",
              exec.id,
              `${exec.name} could not complete the objective`,
              "Orchestration failed — see logs.",
            );
          } catch (cleanupErr) {
            req.log.error({ err: cleanupErr, objectiveId }, "failed to mark objective failed");
          }
        },
      );

      res.status(201).json({
        founderMessage: serializeMessage(founderMessage!),
        agentMessage: serializeMessage(agentMessage!),
        command: {
          detected: true,
          verb: command.isCommand ? command.verb || null : null,
          subject: command.isCommand ? command.subject || null : null,
          taskId: null,
          objectiveId,
        },
        intent: result.intent,
        reasoningIntent: result.reasoningIntent,
        needsApprovalCategory: protectedBucket ?? undefined,
        approvalId: protectedApprovalId,
        sourcesUsed: result.sourcesUsed,
        memoryOp: memoryOpResult ?? undefined,
        reasoning: result.reasoning
          ? { ...result.reasoning, createdAt: result.reasoning.createdAt.toISOString() }
          : undefined,
      });
      return;
    }

    // approval_required → create a real pending approval record so the UI can act on it
    let approvalId: string | null = null;
    if (result.intent === "approval_required") {
      approvalId = randomUUID();
      const approvalTitle = result.objectiveText
        ? result.objectiveText.slice(0, 80)
        : parsed.data.content.slice(0, 80);
      await db.insert(agentApprovalsTable).values({
        id: approvalId,
        executiveId,
        title: approvalTitle,
        detail: result.reply,
        impact: "high",
        status: "pending",
      });
    }

    // All other intents (answer / clarify / approval_required) — reply only, no objective
    const [agentMessage] = await db
      .insert(agentMessagesTable)
      .values({
        id: randomUUID(),
        executiveId,
        role: "agent",
        content: result.reply,
        createdAt: new Date(founderTs.getTime() + 1),
      })
      .returning();

    await recordActivity(
      "message",
      executiveId,
      `${exec.name} ${result.intent === "approval_required" ? "flagged a protected action for approval" : "responded to the Founder"}`,
      parsed.data.content.length > 80
        ? `${parsed.data.content.slice(0, 77)}…`
        : parsed.data.content,
    );

    res.status(201).json({
      founderMessage: serializeMessage(founderMessage!),
      agentMessage: serializeMessage(agentMessage!),
      command: { detected: false },
      intent: result.intent,
      reasoningIntent: result.reasoningIntent,
      sourcesUsed: result.sourcesUsed,
      approvalId,
      memoryOp: memoryOpResult ?? undefined,
      reasoning: result.reasoning
        ? { ...result.reasoning, createdAt: result.reasoning.createdAt.toISOString() }
        : undefined,
    });
    return;
  }

  // ── Non-Quinn execs: block founder commands — all new directives must flow through Quinn ──
  // The UI already shows a read-only hint; this is the backend enforcement layer.
  if (command.isCommand) {
    res.status(422).json({
      error: "Direct commands to individual executives are not permitted. Message Quinn Harlow to launch an objective — she will coordinate the team on your behalf.",
    });
    return;
  }

  // Non-command conversational message to a non-Quinn exec — still allowed for context/questions
  const reportRow = await latestReportFor(executiveId);
  const replyText = generateExecutiveReply({
    executive: exec,
    founderMessage: parsed.data.content,
    openTasks,
    latestReport: reportRow
      ? {
          status: reportRow.status,
          headline: reportRow.headline,
          topFinding:
            reportRow.findings.find((f) => f.severity !== "info")?.text ??
            reportRow.findings[0]?.text,
        }
      : undefined,
  });
  const [agentMessage] = await db
    .insert(agentMessagesTable)
    .values({
      id: randomUUID(),
      executiveId,
      role: "agent",
      content: replyText,
      createdAt: new Date(founderTs.getTime() + 1),
    })
    .returning();

  await recordActivity(
    "message",
    executiveId,
    `You exchanged a message with ${exec.name}`,
    parsed.data.content.length > 80 ? `${parsed.data.content.slice(0, 77)}…` : parsed.data.content,
  );

  res.status(201).json({
    founderMessage: serializeMessage(founderMessage!),
    agentMessage: serializeMessage(agentMessage!),
    command: { detected: false },
  });
});

// ─── Reports (real project awareness) ─────────────────────────────────────────

// GET latest report + this executive's capability metadata.
router.get("/mission-control/executives/:executiveId/report", async (req, res): Promise<void> => {
  const executiveId = String(req.params.executiveId);
  const [exec] = await db
    .select()
    .from(aiExecutivesTable)
    .where(eq(aiExecutivesTable.id, executiveId));
  if (!exec) {
    res.status(404).json({ error: "Executive not found" });
    return;
  }
  const info = CAPABILITY_INFO[exec.role] ?? { responsibility: "", resources: [] };
  const row = await latestReportFor(executiveId);
  res.json({
    responsibility: info.responsibility,
    resources: info.resources,
    report: row ? serializeReport(row, exec) : null,
  });
});

// POST run the capability against real project resources and persist a report.
router.post("/mission-control/executives/:executiveId/report", async (req, res): Promise<void> => {
  const executiveId = String(req.params.executiveId);
  const [exec] = await db
    .select()
    .from(aiExecutivesTable)
    .where(eq(aiExecutivesTable.id, executiveId));
  if (!exec) {
    res.status(404).json({ error: "Executive not found" });
    return;
  }
  if (exec.role === "chief_of_staff") {
    res.status(422).json({
      error: "The Chief of Staff aggregates other reports — use POST /mission-control/briefing/refresh.",
    });
    return;
  }
  if (!hasCapability(exec.role)) {
    res.status(422).json({ error: "This executive has no inspectable capability." });
    return;
  }

  let report: ExecutiveReport;
  try {
    report = await runCapability(exec.role);
  } catch (err) {
    req.log.error({ err, role: exec.role }, "capability run failed");
    res.status(422).json({ error: "Capability run failed" });
    return;
  }
  // Loop a specialist into the standalone report when the executive's own
  // findings touch their bench's domain — same second-teammate behavior as the
  // objective path, using the report content as the focus signal.
  const focusFromReport = [report.headline, report.summary, ...report.findings.map((f) => f.text)].join(" ");
  await consultBenchForReport(exec, report, focusFromReport);
  const row = await generateAndStoreReport(exec, report);
  await recordActivity(
    "message",
    executiveId,
    `${exec.name} filed a new report`,
    report.headline,
  );
  res.status(201).json(serializeReport(row, exec));
});

// ─── Chief of Staff briefing ──────────────────────────────────────────────────

// GET the latest aggregated briefing produced by the Chief of Staff.
router.get("/mission-control/briefing", async (_req, res): Promise<void> => {
  const [cos] = await db
    .select()
    .from(aiExecutivesTable)
    .where(eq(aiExecutivesTable.role, "chief_of_staff"));
  if (!cos) {
    res.json({ briefing: null });
    return;
  }
  const row = await latestReportFor(cos.id);
  res.json({ briefing: row ? serializeReport(row, cos) : null });
});

// POST re-run every executive's capability, then aggregate into a fresh briefing.
router.post("/mission-control/briefing/refresh", async (req, res): Promise<void> => {
  const execs = await db.select().from(aiExecutivesTable);
  const cos = execs.find((e) => e.role === "chief_of_staff");
  if (!cos) {
    res.status(404).json({ error: "Chief of Staff executive not found" });
    return;
  }

  // Run each capability-bearing executive and persist their fresh report. If a
  // run fails, fall back to that executive's latest persisted report so the
  // briefing still reflects the most recent available data per executive.
  const inputs: { name: string; title: string; report: ExecutiveReport | null }[] = [];
  let failures = 0;
  for (const role of ROLES_WITH_CAPABILITY) {
    const exec = execs.find((e) => e.role === role);
    if (!exec) continue;
    let report: ExecutiveReport | null = null;
    try {
      report = await runCapability(role);
      await generateAndStoreReport(exec, report);
    } catch (err) {
      failures += 1;
      req.log.error({ err, role }, "capability run failed during briefing refresh");
      const existing = await latestReportFor(exec.id);
      if (existing) {
        report = {
          status: existing.status,
          headline: existing.headline,
          summary: existing.summary,
          metrics: existing.metrics,
          findings: existing.findings,
        };
      }
    }
    inputs.push({ name: exec.name, title: exec.title, report });
  }

  const briefing = aggregateChiefOfStaff(inputs);
  const row = await generateAndStoreReport(cos, briefing);
  await recordActivity("message", cos.id, `${cos.name} refreshed the daily briefing`, briefing.headline);
  await recordEvent({
    type: "briefing",
    title: `${cos.name} refreshed the daily briefing`,
    summary: briefing.headline,
    actorExecutiveId: cos.id,
    refType: "briefing",
    importance: "normal",
    keywords: ["briefing", "daily"],
  });
  // Surface partial-failure to the client: every capability failed (and we have
  // no fallback data) is a hard failure; some failures is a partial success.
  const usable = inputs.filter((i) => i.report !== null).length;
  const status = usable === 0 ? 503 : failures > 0 ? 207 : 201;
  res.status(status).json(serializeReport(row, cos));
});

// ─── Tasks ────────────────────────────────────────────────────────────────────

router.get("/mission-control/tasks", async (req, res): Promise<void> => {
  const parsed = ListTasksQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid query parameters" });
    return;
  }
  const { status, priority, executiveId } = parsed.data;
  const conditions = [];
  if (status) conditions.push(eq(agentTasksTable.status, status));
  if (priority) conditions.push(eq(agentTasksTable.priority, priority));
  if (executiveId) conditions.push(eq(agentTasksTable.executiveId, executiveId));

  const execs = await loadExecutivesMap();
  const rows = await db
    .select()
    .from(agentTasksTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(agentTasksTable.updatedAt));
  res.json(rows.map((t) => serializeTask(t, execs)));
});

router.post("/mission-control/tasks", async (req, res): Promise<void> => {
  const parsed = CreateAgentTaskBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }
  const execs = await loadExecutivesMap();
  const owner = execs.get(parsed.data.executiveId);
  if (!owner) {
    res.status(404).json({ error: "Executive not found" });
    return;
  }
  // CreateAgentTaskBody.dueAt is `z.coerce.date()`, so it is already a valid
  // Date here (invalid strings fail safeParse above and return 400).
  const [created] = await db
    .insert(agentTasksTable)
    .values({
      id: randomUUID(),
      executiveId: parsed.data.executiveId,
      title: parsed.data.title,
      description: parsed.data.description ?? null,
      status: parsed.data.status ?? "backlog",
      priority: parsed.data.priority ?? "medium",
      origin: parsed.data.origin ?? "founder",
      dueAt: parsed.data.dueAt ?? null,
    })
    .returning();

  await recordActivity(
    "task_created",
    owner.id,
    `New task assigned to ${owner.name}: ${created!.title}`,
    created!.priority === "critical" || created!.priority === "high"
      ? `${created!.priority.toUpperCase()} priority`
      : null,
  );

  res.status(201).json(serializeTask(created!, execs));
});

router.patch("/mission-control/tasks/:taskId", async (req, res): Promise<void> => {
  const taskId = String(req.params.taskId);
  const parsed = UpdateAgentTaskBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }

  if (parsed.data.dueAt !== undefined && parseDueAt(parsed.data.dueAt) === undefined) {
    res.status(400).json({ error: "Invalid dueAt date" });
    return;
  }

  const update: Partial<typeof agentTasksTable.$inferInsert> = { updatedAt: new Date() };
  if (parsed.data.title !== undefined) update.title = parsed.data.title;
  if (parsed.data.description !== undefined) update.description = parsed.data.description;
  if (parsed.data.status !== undefined) update.status = parsed.data.status;
  if (parsed.data.priority !== undefined) update.priority = parsed.data.priority;
  if (parsed.data.progress !== undefined) update.progress = parsed.data.progress;
  if (parsed.data.dueAt !== undefined) update.dueAt = parseDueAt(parsed.data.dueAt) ?? null;
  if (parsed.data.status === "done" && parsed.data.progress === undefined) update.progress = 100;

  const [updated] = await db
    .update(agentTasksTable)
    .set(update)
    .where(eq(agentTasksTable.id, taskId))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Task not found" });
    return;
  }

  const execs = await loadExecutivesMap();
  const owner = execs.get(updated.executiveId);
  await recordActivity(
    "task_updated",
    updated.executiveId,
    `${owner?.name ?? "An executive"} updated "${updated.title}"`,
    parsed.data.status ? `Status: ${parsed.data.status}` : null,
  );

  res.json(serializeTask(updated, execs));
});

router.post("/mission-control/tasks/:taskId/handoff", async (req, res): Promise<void> => {
  const taskId = String(req.params.taskId);
  const parsed = HandoffTaskBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }

  const [task] = await db.select().from(agentTasksTable).where(eq(agentTasksTable.id, taskId));
  if (!task) {
    res.status(404).json({ error: "Task not found" });
    return;
  }
  const execs = await loadExecutivesMap();
  const target = execs.get(parsed.data.toExecutiveId);
  if (!target) {
    res.status(404).json({ error: "Target executive not found" });
    return;
  }
  if (target.id === task.executiveId) {
    res.status(400).json({ error: "Task is already owned by that executive" });
    return;
  }

  const fromExec = execs.get(task.executiveId);

  await db.insert(agentHandoffsTable).values({
    id: randomUUID(),
    taskId,
    fromExecutiveId: task.executiveId,
    toExecutiveId: target.id,
    note: parsed.data.note ?? null,
  });

  const [updated] = await db
    .update(agentTasksTable)
    .set({
      executiveId: target.id,
      createdByExecutiveId: task.executiveId,
      origin: "agent",
      updatedAt: new Date(),
    })
    .where(eq(agentTasksTable.id, taskId))
    .returning();

  await recordActivity(
    "handoff",
    target.id,
    `${fromExec?.name ?? "An executive"} handed "${task.title}" to ${target.name}`,
    parsed.data.note ?? null,
  );

  res.json(serializeTask(updated!, execs));
});

// ─── Objectives (Chief-of-Staff orchestration) ────────────────────────────────

router.get("/mission-control/objectives", async (_req, res): Promise<void> => {
  const execs = await loadExecutivesMap();
  const objectives = await db
    .select()
    .from(agentObjectivesTable)
    .orderBy(desc(agentObjectivesTable.createdAt));
  if (objectives.length === 0) {
    res.json([]);
    return;
  }
  const ids = objectives.map((o) => o.id);
  const tasks = await db
    .select()
    .from(agentTasksTable)
    .where(inArray(agentTasksTable.objectiveId, ids));
  const pending = await db
    .select()
    .from(agentApprovalsTable)
    .where(and(inArray(agentApprovalsTable.objectiveId, ids), eq(agentApprovalsTable.status, "pending")));

  const result = objectives.map((o) => {
    const oTasks = tasks.filter((t) => t.objectiveId === o.id);
    const counts: ObjectiveCounts = {
      taskCount: oTasks.length,
      openTaskCount: oTasks.filter((t) => t.status !== "done" && t.status !== "blocked").length,
      pendingApprovalCount: pending.filter((a) => a.objectiveId === o.id).length,
    };
    return serializeObjective(o, execs, counts);
  });
  res.json(result);
});

router.get("/mission-control/objectives/:objectiveId", async (req, res): Promise<void> => {
  const objectiveId = String(req.params.objectiveId);
  const [objective] = await db
    .select()
    .from(agentObjectivesTable)
    .where(eq(agentObjectivesTable.id, objectiveId));
  if (!objective) {
    res.status(404).json({ error: "Objective not found" });
    return;
  }
  const execs = await loadExecutivesMap();

  const tasks = await db
    .select()
    .from(agentTasksTable)
    .where(eq(agentTasksTable.objectiveId, objectiveId))
    .orderBy(agentTasksTable.createdAt);

  const approvals = await db
    .select()
    .from(agentApprovalsTable)
    .where(eq(agentApprovalsTable.objectiveId, objectiveId))
    .orderBy(desc(agentApprovalsTable.createdAt));

  // Latest report per participating (non-chief) executive, scoped to THIS
  // objective so unrelated global-latest reports never appear in the detail view.
  const childExecIds = [...new Set(tasks.map((t) => t.executiveId))];
  const reports: Record<string, unknown>[] = [];
  for (const execId of childExecIds) {
    const exec = execs.get(execId);
    if (!exec || exec.role === "chief_of_staff") continue;
    const row = await latestReportForObjective(execId, objectiveId);
    if (row) reports.push(serializeReport(row, exec));
  }

  // Collaboration activity entries tied to this objective's participants.
  const participantIds = new Set(childExecIds);
  const collabRows = await db
    .select()
    .from(agentActivityTable)
    .where(eq(agentActivityTable.type, "collaboration"))
    .orderBy(desc(agentActivityTable.createdAt))
    .limit(50);
  const collaborations = collabRows
    .filter((r) => r.executiveId && participantIds.has(r.executiveId))
    .map((r) => serializeActivity(r, execs));

  let briefing: Record<string, unknown> | null = null;
  if (objective.briefingReportId) {
    const [row] = await db
      .select()
      .from(agentReportsTable)
      .where(eq(agentReportsTable.id, objective.briefingReportId));
    if (row) briefing = serializeReport(row, execs.get(row.executiveId));
  }

  const counts: ObjectiveCounts = {
    taskCount: tasks.length,
    openTaskCount: tasks.filter((t) => t.status !== "done" && t.status !== "blocked").length,
    pendingApprovalCount: approvals.filter((a) => a.status === "pending").length,
  };

  res.json({
    objective: serializeObjective(objective, execs, counts),
    tasks: tasks.map((t) => serializeTask(t, execs)),
    reports,
    collaborations,
    approvals: approvals.map((a) => serializeApproval(a, execs)),
    briefing,
  });
});

// ─── Approvals ────────────────────────────────────────────────────────────────

router.get("/mission-control/approvals", async (req, res): Promise<void> => {
  const parsed = ListApprovalsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid query parameters" });
    return;
  }
  const execs = await loadExecutivesMap();
  const rows = await db
    .select()
    .from(agentApprovalsTable)
    .where(parsed.data.status ? eq(agentApprovalsTable.status, parsed.data.status) : undefined)
    .orderBy(desc(agentApprovalsTable.createdAt));
  res.json(rows.map((a) => serializeApproval(a, execs)));
});

router.post("/mission-control/approvals/:approvalId/decision", async (req, res): Promise<void> => {
  const approvalId = String(req.params.approvalId);
  const parsed = DecideApprovalBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }
  const [approval] = await db
    .select()
    .from(agentApprovalsTable)
    .where(eq(agentApprovalsTable.id, approvalId));
  if (!approval) {
    res.status(404).json({ error: "Approval not found" });
    return;
  }

  const nextStatus =
    parsed.data.decision === "approve"
      ? "approved"
      : parsed.data.decision === "reject"
        ? "rejected"
        : "deferred";
  const decidedAt = parsed.data.decision === "later" ? null : new Date();

  const [updated] = await db
    .update(agentApprovalsTable)
    .set({ status: nextStatus, decidedAt, updatedAt: new Date() })
    .where(eq(agentApprovalsTable.id, approvalId))
    .returning();

  const execs = await loadExecutivesMap();
  const exec = execs.get(approval.executiveId);
  await recordActivity(
    "approval",
    approval.executiveId,
    `${exec?.name ?? "An executive"}'s recommendation was ${nextStatus} by the founder`,
    approval.detail,
  );
  await recordEvent({
    type: "founder_decision",
    title: `Founder ${nextStatus} an approval: "${approval.title}"`,
    summary: approval.detail,
    actorExecutiveId: approval.executiveId,
    refType: "approval",
    refId: approvalId,
    importance: nextStatus === "approved" ? "high" : "normal",
    keywords: ["founder", "approval", nextStatus],
    metadata: { decision: nextStatus },
  });

  // Re-settle the flagged executive, then try to finalize the objective: a
  // resolved (approved/rejected/deferred) gate no longer blocks the briefing.
  await settleExecStatus(approval.executiveId);
  if (approval.objectiveId) await maybeFinalizeObjective(approval.objectiveId);

  // V6.5: Analyze approval decision for founder behavioral profile (fire-and-forget)
  void analyzeApprovalDecision(
    approval.title,
    approval.detail,
    nextStatus as "approved" | "rejected" | "deferred",
    approval.createdAt ? Date.now() - approval.createdAt.getTime() : undefined,
  ).catch((err: unknown) => req.log.warn({ err }, "V6.5: approval profile analysis failed (non-blocking)"));

  // V6.8: score the Decision Model's prediction against this actual decision —
  // this is the continuous-improvement signal (fire-and-forget).
  void scorePrediction(
    approvalId,
    nextStatus as "approved" | "rejected" | "deferred",
  ).catch((err: unknown) => req.log.warn({ err }, "V6.8: decision model scoring failed (non-blocking)"));

  // Persist the decision in Quinn's long-term memory for cross-session continuity.
  const [quinnRow] = await db
    .select()
    .from(aiExecutivesTable)
    .where(eq(aiExecutivesTable.role, "chief_of_staff"));
  if (quinnRow) {
    await db
      .insert(agentMemoryTable)
      .values({
        id: randomUUID(),
        executiveId: quinnRow.id,
        kind: "decision",
        content: `Approval ${nextStatus}: "${approval.title}" — ${approval.detail ?? "no further detail"}`,
        pinned: nextStatus === "approved",
      })
      .catch(() => {});
  }

  res.json(serializeApproval(updated!, execs));
});

// ── GET /mission-control/ai-metrics ──────────────────────────────────────────
// Returns AI usage stats: totals, per-provider, per-executive, last-7-days.
// Costs are estimated from public model pricing; real billing is via the proxy.
router.get("/mission-control/ai-metrics", async (req, res) => {
  // ── Totals ────────────────────────────────────────────────────────────────
  const [totalsRow] = await db
    .select({
      totalRequests: count(),
      totalPromptTokens: sum(aiUsageLogTable.promptTokens),
      totalCompletionTokens: sum(aiUsageLogTable.completionTokens),
      totalTokens: sum(aiUsageLogTable.totalTokens),
      totalCostUsd: sum(aiUsageLogTable.estimatedCostUsd),
      totalLatencyMs: sum(aiUsageLogTable.latencyMs),
      fallbackCount: sql<number>`SUM(CASE WHEN ${aiUsageLogTable.fromFallback} THEN 1 ELSE 0 END)`,
    })
    .from(aiUsageLogTable);

  // ── Per-provider ──────────────────────────────────────────────────────────
  const byProvider = await db
    .select({
      provider: aiUsageLogTable.provider,
      model: aiUsageLogTable.model,
      requests: count(),
      totalTokens: sum(aiUsageLogTable.totalTokens),
      totalCostUsd: sum(aiUsageLogTable.estimatedCostUsd),
    })
    .from(aiUsageLogTable)
    .groupBy(aiUsageLogTable.provider, aiUsageLogTable.model)
    .orderBy(desc(sum(aiUsageLogTable.totalTokens)));

  // ── Per-executive ─────────────────────────────────────────────────────────
  const byExecutive = await db
    .select({
      executiveId: aiUsageLogTable.executiveId,
      executiveName: aiExecutivesTable.name,
      requests: count(),
      totalTokens: sum(aiUsageLogTable.totalTokens),
      totalCostUsd: sum(aiUsageLogTable.estimatedCostUsd),
    })
    .from(aiUsageLogTable)
    .leftJoin(aiExecutivesTable, eq(aiUsageLogTable.executiveId, aiExecutivesTable.id))
    .groupBy(aiUsageLogTable.executiveId, aiExecutivesTable.name)
    .orderBy(desc(sum(aiUsageLogTable.totalTokens)));

  // ── Last 7 days (daily) ───────────────────────────────────────────────────
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const byDay = await db
    .select({
      day: sql<string>`DATE(${aiUsageLogTable.createdAt})`,
      requests: count(),
      totalTokens: sum(aiUsageLogTable.totalTokens),
      totalCostUsd: sum(aiUsageLogTable.estimatedCostUsd),
    })
    .from(aiUsageLogTable)
    .where(sql`${aiUsageLogTable.createdAt} >= ${sevenDaysAgo}`)
    .groupBy(sql`DATE(${aiUsageLogTable.createdAt})`)
    .orderBy(sql`DATE(${aiUsageLogTable.createdAt})`);

  // ── Provider status ───────────────────────────────────────────────────────
  const providerStatus = getProviderStatus();

  res.json({
    totals: {
      requests: Number(totalsRow?.totalRequests ?? 0),
      promptTokens: Number(totalsRow?.totalPromptTokens ?? 0),
      completionTokens: Number(totalsRow?.totalCompletionTokens ?? 0),
      totalTokens: Number(totalsRow?.totalTokens ?? 0),
      estimatedCostUsd: Number(totalsRow?.totalCostUsd ?? 0),
      avgLatencyMs:
        totalsRow && Number(totalsRow.totalRequests) > 0
          ? Math.round(Number(totalsRow.totalLatencyMs) / Number(totalsRow.totalRequests))
          : 0,
      fallbackCount: Number(totalsRow?.fallbackCount ?? 0),
    },
    byProvider: byProvider.map((r) => ({
      provider: r.provider,
      model: r.model,
      requests: Number(r.requests),
      totalTokens: Number(r.totalTokens ?? 0),
      estimatedCostUsd: Number(r.totalCostUsd ?? 0),
    })),
    byExecutive: byExecutive
      .filter((r) => r.executiveId !== null)
      .map((r) => ({
        executiveId: r.executiveId!,
        executiveName: r.executiveName ?? "Unknown",
        requests: Number(r.requests),
        totalTokens: Number(r.totalTokens ?? 0),
        estimatedCostUsd: Number(r.totalCostUsd ?? 0),
      })),
    byDay: byDay.map((r) => ({
      day: r.day,
      requests: Number(r.requests),
      totalTokens: Number(r.totalTokens ?? 0),
      estimatedCostUsd: Number(r.totalCostUsd ?? 0),
    })),
    providerStatus,
  });
});

// ─── V12: AI Model Selection ──────────────────────────────────────────────────
// Founder-facing control over which provider/model tier drives AI work, globally
// or per objective. Consulted by AIProviderFactory at request time. The provider
// is only "active" if its credentials are present — otherwise the factory falls
// back through the priority chain, and this endpoint reports that honestly.

const AI_PROVIDER_NAMES = ["openai", "anthropic", "google"] as const;
const AI_MODEL_HINTS = ["fast", "standard", "reasoning"] as const;

function serializeModelConfig(row: typeof aiModelConfigsTable.$inferSelect) {
  return {
    id: row.id,
    scope: row.scope,
    scopeId: row.scopeId,
    provider: row.provider,
    modelHint: row.modelHint,
    updatedAt: row.updatedAt.toISOString(),
  };
}

// Zod restricts provider/modelHint to known names, but a *valid* provider name
// can still have no credentials configured. Persisting such a pick would silently
// fall through to another provider (or Mock) at request time — dishonest. Reject
// it here. A null provider means "auto" (fall through the chain) and is always OK.
function providerUnavailableError(provider: string | null | undefined): string | null {
  if (!provider) return null;
  const { available } = getProviderStatus();
  if (available[provider]) return null;
  const ready = Object.entries(available)
    .filter(([, ok]) => ok)
    .map(([name]) => name);
  return ready.length
    ? `Provider "${provider}" has no credentials configured. Available now: ${ready.join(", ")}.`
    : `Provider "${provider}" has no credentials configured, and no AI provider is currently available.`;
}

// GET — the global preference, all per-objective overrides, and live provider health.
router.get("/mission-control/ai-config", async (_req, res): Promise<void> => {
  const rows = await db.select().from(aiModelConfigsTable);
  const globalRow = rows.find((r) => r.scope === "global") ?? null;
  const overrides = rows.filter((r) => r.scope === "objective" && r.scopeId);

  const overrideObjectiveIds = overrides.map((o) => o.scopeId!).filter((v) => v.length > 0);
  const objectiveTitles = overrideObjectiveIds.length
    ? await db
        .select({ id: agentObjectivesTable.id, title: agentObjectivesTable.title })
        .from(agentObjectivesTable)
        .where(inArray(agentObjectivesTable.id, overrideObjectiveIds))
    : [];
  const titleById = new Map(objectiveTitles.map((o) => [o.id, o.title]));

  res.json({
    global: globalRow ? serializeModelConfig(globalRow) : null,
    overrides: overrides.map((o) => ({
      ...serializeModelConfig(o),
      objectiveTitle: titleById.get(o.scopeId!) ?? null,
    })),
    providers: AI_PROVIDER_NAMES,
    modelHints: AI_MODEL_HINTS,
    providerStatus: getProviderStatus(),
  });
});

// PUT — set (or clear) the global provider/model preference. A null provider
// means "auto" (fall through the priority chain).
router.put("/mission-control/ai-config", async (req, res): Promise<void> => {
  const parsed = SetGlobalAIModelConfigBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }
  const { provider, modelHint } = parsed.data;
  const unavailable = providerUnavailableError(provider);
  if (unavailable) {
    res.status(400).json({ error: unavailable });
    return;
  }
  const now = new Date();
  const [row] = await db
    .insert(aiModelConfigsTable)
    .values({ id: randomUUID(), scope: "global", scopeId: "global", provider: provider ?? null, modelHint: modelHint ?? null, updatedAt: now })
    .onConflictDoUpdate({
      target: [aiModelConfigsTable.scope, aiModelConfigsTable.scopeId],
      set: { provider: provider ?? null, modelHint: modelHint ?? null, updatedAt: now },
    })
    .returning();
  await reloadAiModelConfig();
  res.json({ global: serializeModelConfig(row!), providerStatus: getProviderStatus() });
});

// PUT — set an objective-scoped override.
router.put("/mission-control/ai-config/objective/:objectiveId", async (req, res): Promise<void> => {
  const objectiveId = String(req.params.objectiveId);
  const [objective] = await db
    .select({ id: agentObjectivesTable.id })
    .from(agentObjectivesTable)
    .where(eq(agentObjectivesTable.id, objectiveId));
  if (!objective) {
    res.status(404).json({ error: "Objective not found" });
    return;
  }
  const parsed = SetObjectiveAIModelConfigBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }
  const { provider, modelHint } = parsed.data;
  const unavailable = providerUnavailableError(provider);
  if (unavailable) {
    res.status(400).json({ error: unavailable });
    return;
  }
  const now = new Date();
  const [row] = await db
    .insert(aiModelConfigsTable)
    .values({ id: randomUUID(), scope: "objective", scopeId: objectiveId, provider: provider ?? null, modelHint: modelHint ?? null, updatedAt: now })
    .onConflictDoUpdate({
      target: [aiModelConfigsTable.scope, aiModelConfigsTable.scopeId],
      set: { provider: provider ?? null, modelHint: modelHint ?? null, updatedAt: now },
    })
    .returning();
  await reloadAiModelConfig();
  res.json(serializeModelConfig(row!));
});

// DELETE — remove an objective override (revert to global/auto).
router.delete("/mission-control/ai-config/objective/:objectiveId", async (req, res): Promise<void> => {
  const objectiveId = String(req.params.objectiveId);
  await db
    .delete(aiModelConfigsTable)
    .where(and(eq(aiModelConfigsTable.scope, "objective"), eq(aiModelConfigsTable.scopeId, objectiveId)));
  await reloadAiModelConfig();
  res.status(204).end();
});

// ─── V12: Connector Framework Surface ─────────────────────────────────────────
// Lists supported connectors with honest live status. Platform connectors come
// from the detection registry (secret presence + engineering snapshot). Social
// connectors are aggregated from real OAuth connections, grouped by platform.

router.get("/mission-control/connectors", async (req, res): Promise<void> => {
  // Platform connectors — best-effort; a stale snapshot must not break the surface.
  let engineeringProviders: Awaited<ReturnType<typeof getFlagshipSnapshot>>["providers"] = [];
  try {
    const snapshot = await getFlagshipSnapshot();
    engineeringProviders = snapshot.providers;
  } catch (err) {
    req.log?.warn?.({ err }, "connectors: engineering snapshot unavailable");
  }
  const detected = detectConnectors({ env: process.env, engineeringProviders });
  const platformConnectors = CONNECTOR_REGISTRY.map((def) => {
    const status = detected[def.provider as ConnectorProvider];
    return {
      provider: def.provider,
      label: def.label,
      available: status?.available ?? false,
      reason: status?.reason ?? "Detection unavailable",
    };
  });

  // Social connectors — aggregate real OAuth connections by platform + status.
  const socialRows = await db
    .select({
      platform: oauthConnectionsTable.platform,
      status: oauthConnectionsTable.status,
      total: count(),
    })
    .from(oauthConnectionsTable)
    .groupBy(oauthConnectionsTable.platform, oauthConnectionsTable.status);

  const SOCIAL_PLATFORMS = ["youtube", "facebook", "instagram", "twitch", "kick"] as const;
  const SOCIAL_LABELS: Record<string, string> = {
    youtube: "YouTube",
    facebook: "Facebook",
    instagram: "Instagram",
    twitch: "Twitch",
    kick: "Kick",
  };
  const socialConnectors = SOCIAL_PLATFORMS.map((platform) => {
    const rows = socialRows.filter((r) => r.platform === platform);
    const statusCounts: Record<string, number> = {};
    let connectedCount = 0;
    let totalCount = 0;
    for (const r of rows) {
      const n = Number(r.total);
      statusCounts[r.status] = n;
      totalCount += n;
      if (r.status === "connected") connectedCount += n;
    }
    return {
      platform,
      label: SOCIAL_LABELS[platform] ?? platform,
      connectedCount,
      totalCount,
      statusCounts,
    };
  });

  res.json({ platformConnectors, socialConnectors });
});

// ─── V12: Memory Engine Search ────────────────────────────────────────────────
// A searchable browser across executive long-term memory and the organization
// timeline (company memory). Optional ?q= filters server-side.

router.get("/mission-control/memory", async (req, res): Promise<void> => {
  const q = req.query.q ? String(req.query.q).trim() : "";
  const like = `%${q}%`;

  const execs = await db.select().from(aiExecutivesTable);
  const execById = new Map(execs.map((e) => [e.id, e]));

  const execMemoryRows = await db
    .select()
    .from(agentMemoryTable)
    .where(q ? ilike(agentMemoryTable.content, like) : undefined)
    .orderBy(desc(agentMemoryTable.createdAt))
    .limit(200);

  const executiveMemory = execMemoryRows.map((row) => {
    const exec = execById.get(row.executiveId);
    return {
      ...serializeMemory(row),
      executiveName: exec?.name ?? "Unknown",
      accentColor: exec?.accentColor ?? "#888888",
    };
  });

  const { events } = await getTimeline({ limit: 200 });
  const filteredEvents = q
    ? events.filter((e) => {
        const hay = `${e.title} ${e.summary} ${e.keywords.join(" ")}`.toLowerCase();
        return hay.includes(q.toLowerCase());
      })
    : events;

  res.json({
    query: q,
    executiveMemory,
    organizationMemory: filteredEvents.map(serializeTimelineEvent),
  });
});

// ─── V6.6 Daily COO Briefing Endpoints ────────────────────────────────────────

// GET — returns today's briefing, auto-generates on first call of the day
router.get("/mission-control/coo-briefing", async (req, res) => {
  try {
    const briefing = await getOrGenerateTodaysBriefing();
    return res.json({ briefing, cached: true });
  } catch (err) {
    req.log.error({ err }, "COO briefing: failed to get or generate");
    return res.status(500).json({ error: "Failed to generate COO briefing" });
  }
});

// POST — force-regenerate today's briefing (manual refresh by Founder)
router.post("/mission-control/coo-briefing/regenerate", async (req, res) => {
  try {
    const briefing = await regenerateTodaysBriefing();
    return res.status(201).json({ briefing, cached: false });
  } catch (err) {
    req.log.error({ err }, "COO briefing: regeneration failed");
    return res.status(500).json({ error: "Failed to regenerate COO briefing" });
  }
});

// ─── V6.5 Founder Operating Profile Endpoint ──────────────────────────────────

router.get("/mission-control/founder-profile", async (_req, res) => {
  const allInsights = await getAllInsights();
  const byCategory = groupByCategory(allInsights);
  return res.json({
    profile: byCategory,
    totalInsights: allInsights.length,
    hasProfile: allInsights.length > 0,
    categoryMeta: Object.fromEntries(
      Object.entries(CATEGORY_META).map(([k, v]) => [k, { label: v.label, description: v.description, icon: v.icon }]),
    ),
  });
});

// ─── V6.8 Founder Decision Model ──────────────────────────────────────────────
// Quinn's model of how the Founder decides: accuracy of past predictions
// (scored against the Founder's actual decisions) and the recent prediction log.
router.get("/mission-control/founder-profile/decision-model", async (_req, res) => {
  const summary = await getDecisionModelSummary();
  return res.json(summary);
});

// ─── V6.4 Collaboration Timeline Endpoints ────────────────────────────────────

// Helper: join exec meta (name, role, color) onto a raw collab event row
async function enrichCollabEvent(
  row: ExecCollabEventRow,
  execMap: Map<string, AiExecutive>,
): Promise<Record<string, unknown>> {
  const fromExec = execMap.get(row.fromExecutiveId);
  const toExec = row.toExecutiveId ? execMap.get(row.toExecutiveId) : null;
  return {
    id: row.id,
    objectiveId: row.objectiveId,
    fromExecutiveId: row.fromExecutiveId,
    fromExecutiveName: fromExec?.name ?? "Unknown",
    fromExecutiveRole: fromExec?.role ?? "",
    fromExecutiveColor: fromExec?.accentColor ?? "#888888",
    toExecutiveId: row.toExecutiveId ?? null,
    toExecutiveName: toExec?.name ?? null,
    taskId: row.taskId ?? null,
    eventType: row.eventType,
    content: row.content,
    metadata: row.metadata ?? {},
    resolved: row.resolved,
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

// GET /mission-control/collaboration/active — events across all active objectives
router.get("/mission-control/collaboration/active", async (req, res) => {
  const execMap = await loadExecutivesMap();

  // Load in-progress objectives
  const activeObjectives = await db
    .select()
    .from(agentObjectivesTable)
    .where(inArray(agentObjectivesTable.status, ["planning", "in_progress", "needs_approval"]))
    .orderBy(desc(agentObjectivesTable.createdAt));

  const objectiveIds = activeObjectives.map((o) => o.id);
  if (objectiveIds.length === 0) {
    return res.json({ activeObjectives: [], recentEvents: [], totalActiveEvents: 0 });
  }

  // Load all collab events for these objectives
  const allEvents = await db
    .select()
    .from(execCollabEventsTable)
    .where(inArray(execCollabEventsTable.objectiveId, objectiveIds))
    .orderBy(desc(execCollabEventsTable.createdAt));

  // Rollup per objective
  const eventCountByObj = new Map<string, { count: number; lastAt: Date | null }>();
  for (const ev of allEvents) {
    const prev = eventCountByObj.get(ev.objectiveId) ?? { count: 0, lastAt: null };
    eventCountByObj.set(ev.objectiveId, {
      count: prev.count + 1,
      lastAt: prev.lastAt === null || ev.createdAt > prev.lastAt ? ev.createdAt : prev.lastAt,
    });
  }

  const recentEvents = await Promise.all(allEvents.slice(0, 20).map((row) => enrichCollabEvent(row, execMap)));

  return res.json({
    activeObjectives: activeObjectives.map((o) => ({
      objectiveId: o.id,
      objectiveTitle: o.title,
      eventCount: eventCountByObj.get(o.id)?.count ?? 0,
      lastEventAt: eventCountByObj.get(o.id)?.lastAt?.toISOString() ?? null,
    })),
    recentEvents,
    totalActiveEvents: allEvents.length,
  });
});

// GET /mission-control/collaboration/:objectiveId — full timeline for one objective
router.get("/mission-control/collaboration/:objectiveId", async (req, res) => {
  const objectiveId = String(req.params.objectiveId);
  const [objective] = await db
    .select()
    .from(agentObjectivesTable)
    .where(eq(agentObjectivesTable.id, objectiveId));
  if (!objective) {
    return res.status(404).json({ error: "Objective not found" });
  }

  const execMap = await loadExecutivesMap();

  const rawEvents = await db
    .select()
    .from(execCollabEventsTable)
    .where(eq(execCollabEventsTable.objectiveId, objectiveId))
    .orderBy(execCollabEventsTable.createdAt);

  const events = await Promise.all(rawEvents.map((row) => enrichCollabEvent(row, execMap)));

  // Build dependency chain: per-exec view of who they're waiting on and next action
  const execIdsSeen = new Set<string>();
  for (const ev of rawEvents) {
    execIdsSeen.add(ev.fromExecutiveId);
    if (ev.toExecutiveId) execIdsSeen.add(ev.toExecutiveId);
  }

  const dependencyChain: Record<string, unknown>[] = [];
  for (const execId of execIdsSeen) {
    const exec = execMap.get(execId);
    if (!exec) continue;

    const myDepEvents = rawEvents.filter(
      (ev) => ev.fromExecutiveId === execId && ev.eventType === "report_dependency",
    );
    const waitingOn = myDepEvents
      .map((ev) => ev.toExecutiveId ? (execMap.get(ev.toExecutiveId)?.name ?? null) : null)
      .filter((n): n is string => n !== null);

    const lastEvent = rawEvents
      .filter((ev) => ev.fromExecutiveId === execId)
      .at(-1);

    const nextAction =
      exec.status === "active" ? "Running inspection…"
      : exec.status === "collaborating" ? "Coordinating with peer…"
      : exec.status === "needs_approval" ? "Awaiting founder approval"
      : exec.status === "planning" ? "Planning workstream…"
      : waitingOn.length > 0 ? `Waiting on ${waitingOn.join(", ")}`
      : lastEvent?.eventType === "update_progress" ? "Complete — findings shared"
      : null;

    dependencyChain.push({
      executiveId: execId,
      executiveName: exec.name,
      executiveRole: exec.role,
      executiveColor: exec.accentColor,
      waitingOn,
      nextAction,
      eventCount: rawEvents.filter((ev) => ev.fromExecutiveId === execId || ev.toExecutiveId === execId).length,
    });
  }

  // Summary counts
  const summary = {
    totalEvents: rawEvents.length,
    sharesCount: rawEvents.filter((ev) => ev.eventType === "share_findings").length,
    dependenciesCount: rawEvents.filter((ev) => ev.eventType === "report_dependency").length,
    reviewRequestsCount: rawEvents.filter((ev) => ev.eventType === "request_review").length,
    progressUpdatesCount: rawEvents.filter((ev) => ev.eventType === "update_progress").length,
  };

  return res.json({
    objectiveId: objective.id,
    objectiveTitle: objective.title,
    events,
    dependencyChain,
    summary,
  });
});

// ─── V7: Portfolio / Learning / Autonomy (read endpoints) ─────────────────────

// Portfolio health across every monitored asset (live monitors + placeholders).
router.get("/mission-control/portfolio", async (_req, res): Promise<void> => {
  const health = await getPortfolioHealth();
  res.json(health);
});

function assetRecord(row: typeof portfolioAssetsTable.$inferSelect) {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    monitorType: row.monitorType,
    liveUrl: row.liveUrl,
    githubRepo: row.githubRepo,
    isActive: row.isActive,
    sortOrder: row.sortOrder,
  };
}

// Normalize external telemetry config: trim, empty string → null, and require
// https?:// on liveUrl so the monitor never pings garbage.
function normalizeAssetConfig(body: { liveUrl?: string | null; githubRepo?: string | null }): {
  liveUrl?: string | null;
  githubRepo?: string | null;
  error?: string;
} {
  const out: { liveUrl?: string | null; githubRepo?: string | null; error?: string } = {};
  if (body.liveUrl !== undefined) {
    const v = body.liveUrl === null ? null : body.liveUrl.trim();
    if (v === null || v === "") out.liveUrl = null;
    else if (!/^https?:\/\//i.test(v)) out.error = "liveUrl must start with http:// or https://";
    else out.liveUrl = v;
  }
  if (body.githubRepo !== undefined) {
    const v = body.githubRepo === null ? null : body.githubRepo.trim();
    if (v === null || v === "") out.githubRepo = null;
    else {
      const cleaned = v.replace(/^https?:\/\/github\.com\//i, "").replace(/\.git$/, "");
      if (!/^[\w.-]+\/[\w.-]+$/.test(cleaned)) out.error = "githubRepo must be owner/repo";
      else out.githubRepo = cleaned;
    }
  }
  return out;
}

// Register a new portfolio company/asset for monitoring.
router.post("/mission-control/portfolio", async (req, res): Promise<void> => {
  const parsed = CreatePortfolioAssetBody.safeParse(req.body);
  if (!parsed.success || !parsed.data.slug?.trim() || !parsed.data.name?.trim()) {
    res.status(400).json({ error: "slug and name are required" });
    return;
  }
  const slug = parsed.data.slug.trim().toLowerCase().replace(/\s+/g, "-");
  const cfg = normalizeAssetConfig(parsed.data);
  if (cfg.error) {
    res.status(400).json({ error: cfg.error });
    return;
  }
  const existing = await db
    .select({ id: portfolioAssetsTable.id })
    .from(portfolioAssetsTable)
    .where(eq(portfolioAssetsTable.slug, slug));
  if (existing.length > 0) {
    res.status(409).json({ error: `Asset "${slug}" already exists` });
    return;
  }
  const [row] = await db
    .insert(portfolioAssetsTable)
    .values({
      id: randomUUID(),
      slug,
      name: parsed.data.name.trim(),
      description: parsed.data.description?.trim() ?? "",
      monitorType: "placeholder",
      liveUrl: cfg.liveUrl ?? null,
      githubRepo: cfg.githubRepo ?? null,
      isActive: parsed.data.isActive ?? true,
      sortOrder: parsed.data.sortOrder ?? 100,
    })
    .returning();
  req.log.info({ slug }, "portfolio: asset registered");
  res.status(201).json(assetRecord(row!));
});

// Update a portfolio asset's monitoring config.
router.patch("/mission-control/portfolio/:slug", async (req, res): Promise<void> => {
  const slug = String(req.params["slug"]);
  const parsed = UpdatePortfolioAssetBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body" });
    return;
  }
  const cfg = normalizeAssetConfig(parsed.data);
  if (cfg.error) {
    res.status(400).json({ error: cfg.error });
    return;
  }
  const updates: Partial<typeof portfolioAssetsTable.$inferInsert> = { updatedAt: new Date() };
  if (parsed.data.name?.trim()) updates.name = parsed.data.name.trim();
  if (parsed.data.description !== undefined) updates.description = parsed.data.description.trim();
  if (cfg.liveUrl !== undefined) updates.liveUrl = cfg.liveUrl;
  if (cfg.githubRepo !== undefined) updates.githubRepo = cfg.githubRepo;
  if (parsed.data.isActive !== undefined) updates.isActive = parsed.data.isActive;
  if (parsed.data.sortOrder !== undefined) updates.sortOrder = parsed.data.sortOrder;
  const [row] = await db
    .update(portfolioAssetsTable)
    .set(updates)
    .where(eq(portfolioAssetsTable.slug, slug))
    .returning();
  if (!row) {
    res.status(404).json({ error: `Asset "${slug}" not found` });
    return;
  }
  req.log.info({ slug }, "portfolio: asset config updated");
  res.json(assetRecord(row));
});

// Executive learning overview: per-exec lesson rollups, recent retrospectives,
// and Quinn's weekly reviews.
router.get("/mission-control/learning", async (_req, res): Promise<void> => {
  const execs = await db.select().from(aiExecutivesTable).orderBy(aiExecutivesTable.sortOrder);
  const [lessons, retros, reviews, totals, reliability] = await Promise.all([
    db.select().from(executiveLessonsTable).orderBy(desc(executiveLessonsTable.createdAt)),
    db
      .select()
      .from(objectiveRetrospectivesTable)
      .orderBy(desc(objectiveRetrospectivesTable.createdAt))
      .limit(20),
    db.select().from(weeklyReviewsTable).orderBy(desc(weeklyReviewsTable.weekOf)).limit(8),
    getLearningTotals(),
    db.select().from(providerReliabilityTable).orderBy(sql`last_seen_at desc`).limit(20),
  ]);

  const objIds = [...new Set(retros.map((r) => r.objectiveId))];
  const objTitles = new Map<string, string>();
  if (objIds.length > 0) {
    const objs = await db
      .select({ id: agentObjectivesTable.id, title: agentObjectivesTable.title })
      .from(agentObjectivesTable)
      .where(inArray(agentObjectivesTable.id, objIds));
    for (const o of objs) objTitles.set(o.id, o.title);
  }

  const lessonsByRole = new Map<string, typeof lessons>();
  for (const l of lessons) {
    const arr = lessonsByRole.get(l.role) ?? [];
    arr.push(l);
    lessonsByRole.set(l.role, arr);
  }

  const serializeLesson = (l: (typeof lessons)[number]) => ({
    id: l.id,
    role: l.role,
    kind: l.kind,
    content: l.content,
    objectiveId: l.objectiveId ?? null,
    source: l.source,
    weight: l.weight,
    createdAt: l.createdAt.toISOString(),
  });

  const executives = execs
    .filter((e) => e.role !== "chief_of_staff")
    .map((e) => {
      const roleLessons = lessonsByRole.get(e.role) ?? [];
      const byKind: Record<string, number> = {};
      for (const l of roleLessons) byKind[l.kind] = (byKind[l.kind] ?? 0) + 1;
      return {
        role: e.role,
        name: e.name,
        title: e.title,
        totalLessons: roleLessons.length,
        byKind,
        recentLessons: roleLessons.slice(0, 6).map(serializeLesson),
      };
    });

  res.json({
    executives,
    recentRetrospectives: retros.map((r) => ({
      id: r.id,
      objectiveId: r.objectiveId,
      objectiveTitle: objTitles.get(r.objectiveId) ?? null,
      role: r.role ?? null,
      whatWorked: r.whatWorked,
      whatFailed: r.whatFailed,
      whatToDoDifferently: r.whatToDoDifferently,
      createdAt: r.createdAt.toISOString(),
    })),
    weeklyReviews: reviews.map((w) => ({
      id: w.id,
      weekOf: w.weekOf,
      recurringMistakes: w.recurringMistakes,
      recurringSuccesses: w.recurringSuccesses,
      collaborationImprovements: w.collaborationImprovements,
      orgRecommendations: w.orgRecommendations,
      distributedCount: w.distributedCount,
      summary: w.summary,
      createdAt: w.createdAt.toISOString(),
    })),
    totals: {
      lessons: totals.lessons,
      retrospectives: totals.retrospectives,
      weeklyReviews: totals.weeklyReviews,
    },
    providerReliability: reliability.map((r) => ({
      id: r.id,
      provider: r.provider,
      model: r.model,
      successCount: r.successCount,
      failureCount: r.failureCount,
      avgLatencyMs: r.avgLatencyMs,
      totalTokens: r.totalTokens,
      lastSeenAt: r.lastSeenAt.toISOString(),
    })),
  });
});

// Recent autonomy cycles — Quinn's continuous decision log.
router.get("/mission-control/autonomy/cycles", async (_req, res): Promise<void> => {
  const cycles = await getRecentCycles(20);
  res.json({
    cycles: cycles.map((c) => ({
      id: c.id,
      trigger: c.trigger,
      status: c.status,
      signals: c.signals,
      actions: c.actions,
      escalations: c.escalations,
      summary: c.summary,
      durationMs: c.durationMs,
      startedAt: c.startedAt.toISOString(),
      finishedAt: c.finishedAt ? c.finishedAt.toISOString() : null,
      createdAt: c.createdAt.toISOString(),
    })),
  });
});

// Autonomy scheduler loop status — Phase 8.
// Returns whether the background scheduler is running, its cadence, and when it started.
router.get("/mission-control/autonomy/loop-status", (_req, res): void => {
  const status = getAutonomySchedulerStatus();
  res.json(status);
});

// ─── V8 Living Organization ───────────────────────────────────────────────────
// The organization timeline (company memory), executive-to-executive
// conversations, and executive initiative (proactive recommendations).

const ORG_EVENT_TYPES = [
  "objective",
  "conversation",
  "approval",
  "learning",
  "founder_decision",
  "portfolio",
  "milestone",
  "briefing",
  "recommendation",
  "reflection",
] as const;

// GET the organization timeline (company memory). Optional ?type and ?limit.
// Serialize a TimelineEvent into the OrganizationEvent wire shape, including the
// V9 cause→effect linkage (causedBy + leadsTo).
function serializeTimelineEvent(e: TimelineEvent) {
  return {
    id: e.id,
    type: e.type,
    title: e.title,
    summary: e.summary,
    actorExecutiveId: e.actorExecutiveId,
    actorName: e.actorName,
    refType: e.refType,
    refId: e.refId,
    causedByEventId: e.causedByEventId,
    causedBy: e.causedBy,
    leadsTo: e.leadsTo,
    importance: e.importance,
    keywords: e.keywords,
    createdAt: e.createdAt.toISOString(),
  };
}

router.get("/mission-control/timeline", async (req, res): Promise<void> => {
  const rawType = req.query.type ? String(req.query.type) : undefined;
  const type =
    rawType && (ORG_EVENT_TYPES as readonly string[]).includes(rawType)
      ? (rawType as OrgEventType)
      : undefined;
  const limit = req.query.limit ? Number(req.query.limit) : undefined;
  const { events, total } = await getTimeline({ type, limit });
  res.json({
    events: events.map(serializeTimelineEvent),
    total,
  });
});

// GET the full cause→effect chain a single event belongs to (root → leaves).
router.get("/mission-control/timeline/:eventId/chain", async (req, res): Promise<void> => {
  const eventId = String(req.params.eventId);
  const chain = await getEventChain(eventId);
  if (chain.length === 0) {
    res.status(404).json({ error: "Event not found" });
    return;
  }
  res.json({ chain: chain.map(serializeTimelineEvent) });
});

// GET recent executive-to-executive conversations.
router.get("/mission-control/conversations", async (_req, res): Promise<void> => {
  const conversations = await getRecentConversations(30);
  res.json({
    conversations: conversations.map((c) => ({
      id: c.id,
      topic: c.topic,
      summary: c.summary,
      status: c.status,
      initiatedByName: c.initiatedByName,
      objectiveId: c.objectiveId,
      messageCount: c.messageCount,
      participants: c.participants,
      lastMessageAt: c.lastMessageAt.toISOString(),
      createdAt: c.createdAt.toISOString(),
    })),
  });
});

// GET one conversation with its full message thread.
router.get("/mission-control/conversations/:conversationId", async (req, res): Promise<void> => {
  const conversationId = String(req.params.conversationId);
  const detail = await getConversationDetail(conversationId);
  if (!detail) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }
  const { conversation: c, messages } = detail;
  res.json({
    conversation: {
      id: c.id,
      topic: c.topic,
      summary: c.summary,
      status: c.status,
      initiatedByName: c.initiatedByName,
      objectiveId: c.objectiveId,
      messageCount: c.messageCount,
      participants: c.participants,
      lastMessageAt: c.lastMessageAt.toISOString(),
      createdAt: c.createdAt.toISOString(),
    },
    messages: messages.map((m) => ({
      id: m.id,
      fromExecutiveId: m.fromExecutiveId,
      fromName: m.fromName,
      fromInitials: m.fromInitials,
      accentColor: m.accentColor,
      content: m.content,
      sequence: m.sequence,
      createdAt: m.createdAt.toISOString(),
    })),
  });
});

// GET executive initiative — proactive recommendations for Quinn to review.
router.get("/mission-control/recommendations", async (_req, res): Promise<void> => {
  const recommendations = await getRecommendations(50);
  res.json({
    recommendations: recommendations.map((r) => ({
      id: r.id,
      proposedByExecutiveId: r.proposedByExecutiveId,
      proposedByName: r.proposedByName,
      category: r.category,
      title: r.title,
      rationale: r.rationale,
      status: r.status,
      priorEventId: r.priorEventId,
      priorContext: r.priorContext,
      objectiveId: r.objectiveId,
      decisionNote: r.decisionNote,
      evidence: r.evidence,
      supportingConversations: r.supportingConversations,
      relatedObjectives: r.relatedObjectives,
      citedMemories: r.citedMemories,
      confidence: r.confidence,
      expectedImpact: r.expectedImpact,
      decidedAt: r.decidedAt ? r.decidedAt.toISOString() : null,
      createdAt: r.createdAt.toISOString(),
    })),
  });
});

// GET an executive's accumulated long-term professional memory.
router.get("/mission-control/executives/:executiveId/exec-memory", async (req, res): Promise<void> => {
  const executiveId = String(req.params.executiveId);
  const memories = await getMemoryForExec(executiveId, 100);
  res.json({
    memories: memories.map((m) => ({
      id: m.id,
      executiveId: m.executiveId,
      kind: m.kind,
      content: m.content,
      weight: m.weight,
      refType: m.refType,
      refId: m.refId,
      keywords: m.keywords,
      createdAt: m.createdAt.toISOString(),
      updatedAt: m.updatedAt ? m.updatedAt.toISOString() : null,
    })),
  });
});

// GET Quinn's recent six-question reasoning traces.
router.get("/mission-control/quinn/reasoning", async (req, res): Promise<void> => {
  const limit = req.query.limit ? Number(req.query.limit) : 20;
  const traces = await getRecentReasoning(Number.isFinite(limit) ? limit : 20);
  res.json({
    reasoning: traces.map((t) => ({
      id: t.id,
      founderMessage: t.founderMessage,
      steps: t.steps,
      reply: t.reply,
      reasoningIntent: t.reasoningIntent,
      coordinated: t.coordinated,
      coordinationNote: t.coordinationNote,
      createdAt: t.createdAt.toISOString(),
    })),
  });
});

// POST a manual Quinn-style decision on one recommendation (convert/dismiss).
router.post("/mission-control/recommendations/:recommendationId/decision", async (req, res): Promise<void> => {
  const recommendationId = String(req.params.recommendationId);
  const parsed = DecideRecommendationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }
  const result = await reviewRecommendation(
    recommendationId,
    parsed.data.decision,
    parsed.data.note,
  );
  if (!result) {
    res.status(404).json({ error: "Recommendation not found" });
    return;
  }
  res.json({ ok: result.ok, message: result.message, affected: result.ok ? 1 : 0 });
});

// ─── Developer Tools (dev/admin maintenance actions) ──────────────────────────
// Destructive maintenance helpers used from the Mission Control "Developer
// Tools" page to reset state between testing cycles. Each returns a uniform
// { ok, message, affected } shape.

// Clear all pending founder approvals.
router.post("/mission-control/dev/clear-approvals", async (req, res): Promise<void> => {
  const deleted = await db
    .delete(agentApprovalsTable)
    .where(eq(agentApprovalsTable.status, "pending"))
    .returning({ id: agentApprovalsTable.id });
  req.log.info({ affected: deleted.length }, "dev: cleared pending approvals");
  res.json({ ok: true, message: `Cleared ${deleted.length} pending approval(s)`, affected: deleted.length });
});

// Delete all objectives. Cascades remove their approvals and collab events;
// child tasks and predictions have their objectiveId nulled by FK rules.
router.post("/mission-control/dev/reset-objectives", async (req, res): Promise<void> => {
  const deleted = await db.delete(agentObjectivesTable).returning({ id: agentObjectivesTable.id });
  req.log.info({ affected: deleted.length }, "dev: reset objectives");
  res.json({ ok: true, message: `Removed ${deleted.length} objective(s)`, affected: deleted.length });
});

// Remove rows tagged with a "[TEST]" marker in their title (objectives, tasks,
// approvals) created during testing cycles.
router.post("/mission-control/dev/remove-test-data", async (req, res): Promise<void> => {
  const marker = "%[TEST]%";
  const { approvals, tasks, objectives } = await db.transaction(async (tx) => {
    const approvals = await tx
      .delete(agentApprovalsTable)
      .where(ilike(agentApprovalsTable.title, marker))
      .returning({ id: agentApprovalsTable.id });
    const tasks = await tx
      .delete(agentTasksTable)
      .where(ilike(agentTasksTable.title, marker))
      .returning({ id: agentTasksTable.id });
    const objectives = await tx
      .delete(agentObjectivesTable)
      .where(ilike(agentObjectivesTable.title, marker))
      .returning({ id: agentObjectivesTable.id });
    return { approvals, tasks, objectives };
  });
  const affected = approvals.length + tasks.length + objectives.length;
  req.log.info(
    { approvals: approvals.length, tasks: tasks.length, objectives: objectives.length },
    "dev: removed test data",
  );
  res.json({ ok: true, message: `Removed ${affected} test record(s)`, affected });
});

// Wipe and reseed all Mission Control data (executives, tasks, memory, etc.).
router.post("/mission-control/dev/reseed", async (req, res): Promise<void> => {
  await reseedMissionControl();
  req.log.info("dev: reseeded mission control");
  res.json({ ok: true, message: "Mission Control reseeded from scratch", affected: null });
});

// Reset the founder operating profile: delete decision predictions and insights.
router.post("/mission-control/dev/reset-founder-profile", async (req, res): Promise<void> => {
  const insights = await db.transaction(async (tx) => {
    await tx.delete(founderDecisionPredictionsTable);
    return tx.delete(founderProfileInsightsTable).returning({ id: founderProfileInsightsTable.id });
  });
  req.log.info({ affected: insights.length }, "dev: reset founder profile");
  res.json({ ok: true, message: `Reset founder profile (${insights.length} insight(s) removed)`, affected: insights.length });
});

// Force-regenerate today's daily COO briefing.
router.post("/mission-control/dev/regenerate-briefing", async (req, res): Promise<void> => {
  try {
    await regenerateTodaysBriefing();
    req.log.info("dev: regenerated daily briefing");
    res.json({ ok: true, message: "Daily briefing regenerated", affected: null });
  } catch (err) {
    req.log.error({ err }, "dev: briefing regeneration failed");
    res.status(500).json({ ok: false, message: "Failed to regenerate daily briefing", affected: null });
  }
});

// ─── Developer Tools (V7 — Autonomy & Learning) ───────────────────────────────

// 🤖 Run one autonomous Chief-of-Staff cycle now (manual trigger; DEV only).
router.post("/mission-control/dev/run-autonomous-cycle", async (req, res): Promise<void> => {
  try {
    const cycle = await runAutonomousCycle({ trigger: "manual" });
    req.log.info(
      { status: cycle.status, actions: cycle.actions.length, escalations: cycle.escalations.length },
      "dev: ran autonomous cycle",
    );
    res.json({
      ok: true,
      message: `Cycle ${cycle.status}: ${cycle.actions.length} action(s), ${cycle.escalations.length} escalation(s)`,
      affected: cycle.actions.length,
    });
  } catch (err) {
    req.log.error({ err }, "dev: autonomous cycle failed");
    res.status(500).json({ ok: false, message: "Autonomous cycle failed", affected: null });
  }
});

// 🧠 Run Quinn's Chief-of-Staff processObjectives cycle now (the real AZ dispatch path).
router.post("/mission-control/dev/run-quinn-cycle", async (req, res): Promise<void> => {
  try {
    const result = await processObjectives();
    req.log.info({ ran: result.ran, cycleId: result.cycleId }, "dev: ran Quinn CoS processObjectives cycle");
    res.json({
      ok: true,
      message: result.ran ? `Quinn cycle ran (${result.cycleId}): ${result.summary}` : "Quinn cycle skipped (already running or no objectives)",
      affected: result.ran ? 1 : 0,
      cycleId: result.cycleId ?? null,
      summary: result.summary ?? null,
    });
  } catch (err) {
    req.log.error({ err }, "dev: Quinn CoS cycle failed");
    res.status(500).json({ ok: false, message: "Quinn CoS cycle failed", affected: null });
  }
});

// 📚 Run Quinn's weekly executive learning review now.
router.post("/mission-control/dev/run-weekly-review", async (req, res): Promise<void> => {
  try {
    const review = await runWeeklyLearningReview();
    req.log.info({ weekOf: review.weekOf, distributed: review.distributedCount }, "dev: ran weekly review");
    res.json({
      ok: true,
      message: `Weekly review for ${review.weekOf} complete — ${review.distributedCount} lesson(s) distributed`,
      affected: review.distributedCount,
    });
  } catch (err) {
    req.log.error({ err }, "dev: weekly review failed");
    res.status(500).json({ ok: false, message: "Weekly review failed", affected: null });
  }
});

// 🧹 Wipe all executive learning (lessons, retrospectives, weekly reviews).
router.post("/mission-control/dev/reset-executive-learning", async (req, res): Promise<void> => {
  const result = await resetExecutiveLearning();
  const affected = result.lessons + result.retrospectives + result.weeklyReviews;
  req.log.info(result, "dev: reset executive learning");
  res.json({
    ok: true,
    message: `Reset executive learning (${result.lessons} lesson(s), ${result.retrospectives} retrospective(s), ${result.weeklyReviews} review(s) removed)`,
    affected,
  });
});

// 🧠 Clear Quinn's long-term memory rows (objectives, reports, founder profile preserved).
router.post("/mission-control/dev/reset-quinn-memory", async (req, res): Promise<void> => {
  const cos = await db
    .select({ id: aiExecutivesTable.id })
    .from(aiExecutivesTable)
    .where(eq(aiExecutivesTable.role, "chief_of_staff"))
    .limit(1);
  if (cos.length === 0) {
    res.json({ ok: true, message: "No Chief of Staff found — nothing to clear", affected: 0 });
    return;
  }
  const deleted = await db
    .delete(agentMemoryTable)
    .where(eq(agentMemoryTable.executiveId, cos[0].id))
    .returning({ id: agentMemoryTable.id });
  req.log.info({ affected: deleted.length }, "dev: reset quinn memory");
  res.json({ ok: true, message: `Cleared ${deleted.length} memory row(s) from Quinn`, affected: deleted.length });
});

// 🛰️ Run a portfolio health scan across all monitored assets now.
router.post("/mission-control/dev/portfolio-scan", async (req, res): Promise<void> => {
  try {
    const summary = await getPortfolioSummary();
    req.log.info(summary, "dev: portfolio scan");
    await recordEvent({
      type: "portfolio",
      title: `Portfolio scan: ${summary.totalAssets} asset(s) reviewed`,
      summary: `${summary.healthy} healthy, ${summary.attention} attention, ${summary.critical} critical`,
      refType: "portfolio",
      importance: summary.critical > 0 ? "high" : "normal",
      keywords: ["portfolio", "scan", ...(summary.critical > 0 ? ["critical"] : [])],
      metadata: { healthy: summary.healthy, attention: summary.attention, critical: summary.critical },
    });
    res.json({
      ok: true,
      message: `Scanned ${summary.totalAssets} asset(s): ${summary.healthy} healthy, ${summary.attention} attention, ${summary.critical} critical`,
      affected: summary.totalAssets,
    });
  } catch (err) {
    req.log.error({ err }, "dev: portfolio scan failed");
    res.status(500).json({ ok: false, message: "Portfolio scan failed", affected: null });
  }
});

// ─── V8 Living Organization dev tools ─────────────────────────────────────────

// 🧠 Run one of Quinn's idle reflection passes now.
router.post("/mission-control/dev/run-reflection", async (req, res): Promise<void> => {
  try {
    const result = await runReflection();
    const parts = [`${result.observations.length} observation(s)`];
    if (result.conversationStarted) parts.push("started a conversation");
    if (result.recommendationsProposed > 0)
      parts.push(`proposed ${result.recommendationsProposed} recommendation(s)`);
    res.json({
      ok: true,
      message: `Quinn reflected: ${parts.join(", ")}.`,
      affected: result.observations.length,
    });
  } catch (err) {
    req.log.error({ err }, "dev: run reflection failed");
    res.status(500).json({ ok: false, message: "Reflection failed", affected: null });
  }
});

// 💬 Generate a sample executive-to-executive conversation now.
router.post("/mission-control/dev/simulate-conversation", async (req, res): Promise<void> => {
  try {
    const conv = await generateConversation();
    if (!conv) {
      res.json({ ok: false, message: "No conversation could be generated (missing executives).", affected: 0 });
      return;
    }
    res.json({
      ok: true,
      message: `Started "${conv.topic}" with ${conv.messageCount} message(s).`,
      affected: conv.messageCount,
    });
  } catch (err) {
    req.log.error({ err }, "dev: simulate conversation failed");
    res.status(500).json({ ok: false, message: "Conversation simulation failed", affected: null });
  }
});

// 💡 Have executives propose new recommendations now.
router.post("/mission-control/dev/generate-recommendations", async (req, res): Promise<void> => {
  try {
    const result = await proposeRecommendations({ count: 2 });
    res.json({
      ok: true,
      message:
        result.created > 0
          ? `Proposed ${result.created} recommendation(s): ${result.titles.join("; ")}.`
          : "No new recommendations proposed (all current ideas already pending).",
      affected: result.created,
    });
  } catch (err) {
    req.log.error({ err }, "dev: generate recommendations failed");
    res.status(500).json({ ok: false, message: "Recommendation generation failed", affected: null });
  }
});

// ✅ Have Quinn review all pending recommendations now.
router.post("/mission-control/dev/review-recommendations", async (req, res): Promise<void> => {
  try {
    const result = await reviewAllPending();
    res.json({
      ok: true,
      message: `Quinn reviewed pending recommendations: ${result.converted} converted, ${result.dismissed} dismissed.`,
      affected: result.converted + result.dismissed,
    });
  } catch (err) {
    req.log.error({ err }, "dev: review recommendations failed");
    res.status(500).json({ ok: false, message: "Recommendation review failed", affected: null });
  }
});

// 🧠 Have executives accumulate professional memory from recent work now.
router.post("/mission-control/dev/accumulate-memory", async (req, res): Promise<void> => {
  try {
    const result = await accumulateFromRecentWork({ perType: 8 });
    res.json({
      ok: true,
      message:
        result.created > 0
          ? `Accumulated ${result.created} professional memory item(s) from recent work.`
          : "No new professional memory to accumulate from recent work.",
      affected: result.created,
    });
  } catch (err) {
    req.log.error({ err }, "dev: accumulate memory failed");
    res.status(500).json({ ok: false, message: "Memory accumulation failed", affected: null });
  }
});

// 🔁 Scan conversations for repeated discussion patterns now.
router.post("/mission-control/dev/detect-patterns", async (req, res): Promise<void> => {
  try {
    const result = await detectRepeatedDiscussionPatterns({});
    res.json({
      ok: true,
      message:
        result.created > 0
          ? `Detected repeated patterns and proposed ${result.created} recommendation(s): ${result.patterns.join("; ")}.`
          : "No repeated discussion patterns crossed the threshold yet.",
      affected: result.created,
    });
  } catch (err) {
    req.log.error({ err }, "dev: detect patterns failed");
    res.status(500).json({ ok: false, message: "Pattern detection failed", affected: null });
  }
});

// 💎 Re-enrich pending recommendations with evidence, sources, and confidence now.
router.post("/mission-control/dev/enrich-recommendations", async (req, res): Promise<void> => {
  try {
    const result = await enrichPendingRecommendations();
    res.json({
      ok: true,
      message:
        result.enriched > 0
          ? `Re-enriched ${result.enriched} pending recommendation(s) with fresh evidence and citations.`
          : "No pending recommendations to enrich.",
      affected: result.enriched,
    });
  } catch (err) {
    req.log.error({ err }, "dev: enrich recommendations failed");
    res.status(500).json({ ok: false, message: "Recommendation enrichment failed", affected: null });
  }
});

// ─── Developer Tools V2 (V6.7 — AI maintenance center) ────────────────────────

// 🧠 Rebuild Founder Memory: re-analyze every founder conversation and approval
// decision from the original evidence and recompute the operating profile.
// Conversations are NEVER deleted — only the derived insights are rebuilt.
// Safety bound only — a full rebuild re-analyzes every founder message/decision.
// These caps exist purely to prevent a pathological runaway (cost/timeout) on an
// unexpectedly huge history; they comfortably exceed any realistic dataset.
const REBUILD_MESSAGE_CAP = 1000;
const REBUILD_APPROVAL_CAP = 1000;
router.post("/mission-control/dev/rebuild-founder-memory", async (req, res): Promise<void> => {
  try {
    // 1. Clear derived state (insights + predictions). Conversations are kept.
    await db.transaction(async (tx) => {
      await tx.delete(founderDecisionPredictionsTable);
      await tx.delete(founderProfileInsightsTable);
    });

    // 2. Re-analyze founder messages from the original evidence.
    // Messages to non-chief executives are handled ONLY by step 6 (executive
    // engagement) so the same message never feeds the profile twice — this
    // mirrors live ingestion, where analyzeFounderMessage runs only in the
    // Quinn (chief_of_staff) branch.
    const allExecs = await db.select().from(aiExecutivesTable);
    const chiefIds = new Set(
      allExecs.filter((e) => e.role === "chief_of_staff").map((e) => e.id),
    );
    const founderMessages = await db
      .select()
      .from(agentMessagesTable)
      .where(eq(agentMessagesTable.role, "founder"))
      .orderBy(desc(agentMessagesTable.createdAt))
      .limit(REBUILD_MESSAGE_CAP);
    // Process oldest-first so confidence accumulates the way it did originally.
    const ordered = [...founderMessages].reverse();
    let priorContext = "";
    let analyzedMessages = 0;
    for (const msg of ordered) {
      if (!chiefIds.has(msg.executiveId)) continue;
      await analyzeFounderMessage(msg.content, priorContext, msg.createdAt.getUTCHours()).catch(
        (err: unknown) => req.log.warn({ err }, "rebuild: founder message analysis failed"),
      );
      priorContext = msg.content;
      analyzedMessages += 1;
    }

    // 3. Re-analyze decided approvals (approval habits, decision patterns).
    const decided = await db
      .select()
      .from(agentApprovalsTable)
      .where(inArray(agentApprovalsTable.status, ["approved", "rejected", "deferred"]))
      .orderBy(desc(agentApprovalsTable.decidedAt))
      .limit(REBUILD_APPROVAL_CAP);
    let analyzedApprovals = 0;
    for (const ap of decided) {
      const responseTimeMs =
        ap.decidedAt && ap.createdAt ? ap.decidedAt.getTime() - ap.createdAt.getTime() : undefined;
      await analyzeApprovalDecision(
        ap.title,
        ap.detail,
        ap.status as "approved" | "rejected" | "deferred",
        responseTimeMs,
      ).catch((err: unknown) => req.log.warn({ err }, "rebuild: approval analysis failed"));
      analyzedApprovals += 1;
    }

    // 4. Re-analyze founder-directed objectives (strategic goals, priorities).
    // All objectives store Quinn as creator (autonomous engines too), so we
    // link them back to the founder by word overlap with founder messages.
    const allObjectives = await db
      .select()
      .from(agentObjectivesTable)
      .orderBy(agentObjectivesTable.createdAt)
      .limit(REBUILD_APPROVAL_CAP);
    const founderTexts = ordered.map((m) => m.content.toLowerCase());
    const isFounderLinked = (request: string): boolean => {
      const words = request
        .toLowerCase()
        .split(/\W+/)
        .filter((w) => w.length > 3);
      if (words.length === 0) return false;
      return founderTexts.some((t) => {
        const hits = words.filter((w) => t.includes(w)).length;
        return hits >= Math.min(3, words.length);
      });
    };
    let analyzedObjectives = 0;
    for (const obj of allObjectives) {
      if (!isFounderLinked(obj.request)) continue;
      await analyzeObjectiveDirective(obj.title, obj.request).catch((err: unknown) =>
        req.log.warn({ err }, "rebuild: objective analysis failed"),
      );
      analyzedObjectives += 1;
    }

    // 5. Re-analyze decided marketing posts (approval habits, brand voice).
    const decidedPosts = await db
      .select()
      .from(marketingPostsTable)
      .where(inArray(marketingPostsTable.status, ["approved", "rejected"]))
      .orderBy(marketingPostsTable.decidedAt)
      .limit(REBUILD_APPROVAL_CAP);
    let analyzedMarketing = 0;
    for (const post of decidedPosts) {
      if (!post.decidedAt) continue; // auto-decided posts have no founder involvement
      await analyzeMarketingDecision(
        post.status as "approved" | "rejected",
        post.platform,
        post.topic,
        post.founderEdited,
      ).catch((err: unknown) => req.log.warn({ err }, "rebuild: marketing analysis failed"));
      analyzedMarketing += 1;
    }

    // 6. Re-analyze direct founder→executive engagement (executive trust).
    const nonChiefExecs = new Map(
      allExecs.filter((e) => e.role !== "chief_of_staff").map((e) => [e.id, e]),
    );
    const execDMs = await db
      .select()
      .from(agentMessagesTable)
      .where(eq(agentMessagesTable.role, "founder"))
      .orderBy(agentMessagesTable.createdAt)
      .limit(REBUILD_MESSAGE_CAP);
    let analyzedEngagements = 0;
    for (const msg of execDMs) {
      const exec = nonChiefExecs.get(msg.executiveId);
      if (!exec) continue;
      await analyzeExecutiveEngagement(exec.name, exec.title, msg.content).catch(
        (err: unknown) => req.log.warn({ err }, "rebuild: exec engagement analysis failed"),
      );
      analyzedEngagements += 1;
    }

    const rebuilt = await getAllInsights();
    await recordActivity(
      "message",
      null,
      "Founder memory rebuilt from original conversation evidence",
      `${rebuilt.length} insight(s) from ${analyzedMessages} message(s), ${analyzedApprovals} approval(s), ${analyzedObjectives} objective(s), ${analyzedMarketing} marketing decision(s), ${analyzedEngagements} exec engagement(s)`,
    );
    req.log.info(
      {
        analyzedMessages,
        analyzedApprovals,
        analyzedObjectives,
        analyzedMarketing,
        analyzedEngagements,
        insights: rebuilt.length,
      },
      "dev: rebuilt founder memory",
    );
    res.json({
      ok: true,
      message: `Rebuilt ${rebuilt.length} insight(s) from ${analyzedMessages} message(s), ${analyzedApprovals} approval(s), ${analyzedObjectives} objective(s), ${analyzedMarketing} marketing decision(s), ${analyzedEngagements} exec engagement(s)`,
      affected: rebuilt.length,
    });
  } catch (err) {
    req.log.error({ err }, "dev: rebuild founder memory failed");
    res.status(500).json({ ok: false, message: "Failed to rebuild founder memory", affected: null });
  }
});

// 👥 Reset Executive Team: clear ONLY runtime state. Objectives, reports,
// memories, and the founder profile are preserved.
router.post("/mission-control/dev/reset-executive-team", async (req, res): Promise<void> => {
  const { execs, collab, tasks } = await db.transaction(async (tx) => {
    // Active work flags + stuck statuses → settle every executive to idle.
    const execs = await tx
      .update(aiExecutivesTable)
      .set({ status: "idle", statusMessage: null, updatedAt: new Date() })
      .returning({ id: aiExecutivesTable.id });
    // Collaboration sessions → clear all collab events.
    const collab = await tx.delete(execCollabEventsTable).returning({ id: execCollabEventsTable.id });
    // Stuck task statuses → return mid-flight work to the backlog.
    const tasks = await tx
      .update(agentTasksTable)
      .set({ status: "backlog", updatedAt: new Date() })
      .where(inArray(agentTasksTable.status, ["in_progress", "blocked", "review"]))
      .returning({ id: agentTasksTable.id });
    return { execs, collab, tasks };
  });
  // Temporary in-memory workload counters (in-flight command + workstream tracking).
  activeCommandTasks.clear();
  execWorkloadCount.clear();

  const affected = execs.length + collab.length + tasks.length;
  req.log.info(
    { execs: execs.length, collab: collab.length, tasks: tasks.length },
    "dev: reset executive team runtime state",
  );
  res.json({
    ok: true,
    message: `Reset runtime state: ${execs.length} executive(s) idled, ${collab.length} collab event(s) cleared, ${tasks.length} task(s) returned to backlog`,
    affected,
  });
});

// 🏢 Rebuild Executive Knowledge: force every capability-bearing executive to
// regenerate a fresh report reflecting current project state.
router.post("/mission-control/dev/rebuild-executive-knowledge", async (req, res): Promise<void> => {
  const execs = await db.select().from(aiExecutivesTable);
  let regenerated = 0;
  let failures = 0;
  for (const role of ROLES_WITH_CAPABILITY) {
    const exec = execs.find((e) => e.role === role);
    if (!exec) continue;
    try {
      const report = await runCapability(role);
      await generateAndStoreReport(exec, report);
      regenerated += 1;
    } catch (err) {
      failures += 1;
      req.log.error({ err, role }, "dev: capability run failed during knowledge rebuild");
    }
  }
  await recordActivity(
    "message",
    null,
    "Executive knowledge rebuilt — fresh reports generated",
    `${regenerated} report(s) regenerated${failures > 0 ? `, ${failures} failed` : ""}`,
  );
  req.log.info({ regenerated, failures }, "dev: rebuilt executive knowledge");
  const ok = regenerated > 0 || failures === 0;
  res.status(ok ? 200 : 503).json({
    ok,
    message: `Regenerated ${regenerated} executive report(s)${failures > 0 ? ` (${failures} failed)` : ""}`,
    affected: regenerated,
  });
});

// 🧠 Reset Quinn Reasoning Cache: clear Quinn's transient reasoning/runtime
// state. Founder profile, objectives, reports, and memory are preserved.
router.post("/mission-control/dev/reset-quinn-reasoning", async (req, res): Promise<void> => {
  const [quinn] = await db
    .update(aiExecutivesTable)
    .set({ status: "active", statusMessage: null, updatedAt: new Date() })
    .where(eq(aiExecutivesTable.role, "chief_of_staff"))
    .returning({ id: aiExecutivesTable.id });
  if (!quinn) {
    res.status(404).json({ ok: false, message: "Chief of Staff executive not found", affected: null });
    return;
  }
  // Drop any in-flight command / workstream tracking attributed to Quinn.
  activeCommandTasks.delete(quinn.id);
  execWorkloadCount.delete(quinn.id);
  req.log.info("dev: reset Quinn reasoning cache");
  res.json({ ok: true, message: "Quinn's reasoning cache cleared (profile, objectives, reports, memory preserved)", affected: null });
});

// 🌅 Simulate Tomorrow Morning: advance one virtual day without touching the
// system clock — overnight collaboration, fresh exec reports, founder briefing,
// daily COO briefing (which carries roadmap reprioritization).
router.post("/mission-control/dev/simulate-tomorrow", async (req, res): Promise<void> => {
  try {
    const virtualDate = dateUTCOffsetDays(1); // tomorrow's UTC date — clock untouched
    const execs = await db.select().from(aiExecutivesTable);
    const byRole = (role: string) => execs.find((e) => e.role === role) ?? null;

    // 1. Fresh executive reports.
    const inputs: { name: string; title: string; report: ExecutiveReport | null }[] = [];
    const reportByRole = new Map<string, ExecutiveReport>();
    let reportCount = 0;
    for (const role of ROLES_WITH_CAPABILITY) {
      const exec = byRole(role);
      if (!exec) continue;
      let report: ExecutiveReport | null = null;
      try {
        report = await runCapability(role);
        await generateAndStoreReport(exec, report);
        reportByRole.set(role, report);
        reportCount += 1;
      } catch (err) {
        req.log.error({ err, role }, "simulate-tomorrow: capability run failed");
        const existing = await latestReportFor(exec.id);
        if (existing) {
          report = {
            status: existing.status,
            headline: existing.headline,
            summary: existing.summary,
            metrics: existing.metrics,
            findings: existing.findings,
          };
        }
      }
      inputs.push({ name: exec.name, title: exec.title, report });
    }

    // 2. Overnight collaboration across active objectives, derived from the
    //    fresh reports (same persistence path as the live orchestrator).
    const activeObjectives = await db
      .select()
      .from(agentObjectivesTable)
      .where(inArray(agentObjectivesTable.status, ["planning", "in_progress", "needs_approval"]));
    let collabCount = 0;
    for (const objective of activeObjectives) {
      for (const [role, report] of reportByRole.entries()) {
        const sourceExec = byRole(role);
        if (!sourceExec) continue;
        const events = generateCollabEvents(
          role as Parameters<typeof generateCollabEvents>[0],
          report,
          objective.title,
        );
        for (const evt of events) {
          const targetExec = evt.toRole ? byRole(evt.toRole) : null;
          await db
            .insert(execCollabEventsTable)
            .values({
              id: randomUUID(),
              objectiveId: objective.id,
              fromExecutiveId: sourceExec.id,
              toExecutiveId: targetExec?.id ?? null,
              taskId: null,
              eventType: evt.eventType as CollabEventType,
              content: evt.content,
              metadata: evt.metadata,
            })
            .then(() => {
              collabCount += 1;
            })
            .catch((err: unknown) =>
              req.log.warn({ err }, "simulate-tomorrow: collab event insert failed"),
            );
        }
      }
    }

    // 3. Founder briefing (aggregated Chief of Staff report).
    const cos = byRole("chief_of_staff");
    let briefingOk = false;
    if (cos) {
      try {
        const briefing = aggregateChiefOfStaff(inputs);
        await generateAndStoreReport(cos, briefing);
        briefingOk = true;
      } catch (err) {
        req.log.error({ err }, "simulate-tomorrow: founder briefing failed");
      }
    }

    // 4. Daily COO briefing for the virtual next day — carries roadmap
    //    reprioritization. Today's briefing is left intact.
    let cooOk = false;
    try {
      await regenerateBriefingForDate(virtualDate);
      cooOk = true;
    } catch (err) {
      req.log.error({ err }, "simulate-tomorrow: COO briefing failed");
    }

    await recordActivity(
      "message",
      cos?.id ?? null,
      `Simulated tomorrow morning (${virtualDate}) — overnight cycle complete`,
      `${reportCount} report(s), ${collabCount} collab event(s), founder briefing ${briefingOk ? "✓" : "✗"}, COO briefing ${cooOk ? "✓" : "✗"}`,
    );
    req.log.info({ virtualDate, reportCount, collabCount, briefingOk, cooOk }, "dev: simulated tomorrow morning");
    res.json({
      ok: true,
      message: `Advanced one virtual day to ${virtualDate}: ${reportCount} report(s), ${collabCount} overnight collab event(s), founder briefing ${briefingOk ? "refreshed" : "skipped"}, COO briefing ${cooOk ? "refreshed" : "skipped"}`,
      affected: reportCount + collabCount,
    });
  } catch (err) {
    req.log.error({ err }, "dev: simulate tomorrow failed");
    res.status(500).json({ ok: false, message: "Failed to simulate tomorrow morning", affected: null });
  }
});

// 📈 Diagnostics: full system health snapshot for the Diagnostics page.
// ENGINEERING EXPANSION — Agent Registry. Read-only snapshot of every installed
// specialist, its owning executive, availability, and run-derived confidence.
router.get("/mission-control/specialists", async (req, res): Promise<void> => {
  try {
    const specialists = await getSpecialistRegistry();
    res.json({ specialists });
  } catch (err) {
    req.log.error({ err }, "specialists: registry snapshot failed");
    res.status(500).json({ error: "Failed to load specialist registry" });
  }
});

// ─── MARKETING AUTONOMY (Dario Sol) — learning-based content publishing ──────
// Dario drafts inside his own workflow, every founder decision becomes a
// learning signal, and Quinn monitors qualification/suspension of Trusted
// Marketing Mode. High-risk content always requires founder approval.

function serializeMarketingPost(row: {
  id: string;
  executiveId: string | null;
  objectiveId: string | null;
  topic: string;
  platform: string;
  contentType: string;
  riskLevel: string;
  status: string;
  originalDraft: string;
  finalContent: string;
  founderEdited: boolean;
  tone: string;
  lengthChars: number;
  cta: string;
  hashtags: string[];
  predictedConfidence: number;
  confidenceReasons: string[];
  predictionCorrect: boolean | null;
  autoPublished: boolean;
  engagement: { views: number; likes: number; shares: number; comments: number } | null;
  createdAt: Date;
  decidedAt: Date | null;
  postedAt: Date | null;
}): Record<string, unknown> {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    decidedAt: row.decidedAt?.toISOString() ?? null,
    postedAt: row.postedAt?.toISOString() ?? null,
  };
}

router.post("/mission-control/marketing/drafts", async (req, res): Promise<void> => {
  const parsed = CreateMarketingDraftPostBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid draft request", details: parsed.error.flatten() });
    return;
  }
  try {
    const result = await createMarketingDraft({
      topic: parsed.data.topic,
      platform: parsed.data.platform,
      contentType: parsed.data.contentType,
      objectiveId: parsed.data.objectiveId ?? null,
    });
    res.status(201).json({
      post: serializeMarketingPost(result.post),
      autoPublished: result.autoPublished,
    });
  } catch (err) {
    req.log.error({ err }, "marketing: draft creation failed");
    res.status(500).json({ error: "Failed to create marketing draft" });
  }
});

router.get("/mission-control/marketing/posts", async (req, res): Promise<void> => {
  const parsed = ListMarketingPostsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid query", details: parsed.error.flatten() });
    return;
  }
  try {
    const status = parsed.data.status;
    const rows = await db
      .select()
      .from(marketingPostsTable)
      .where(status ? eq(marketingPostsTable.status, status) : undefined)
      .orderBy(desc(marketingPostsTable.createdAt))
      .limit(100);
    res.json({ posts: rows.map(serializeMarketingPost) });
  } catch (err) {
    req.log.error({ err }, "marketing: list posts failed");
    res.status(500).json({ error: "Failed to list marketing posts" });
  }
});

router.post("/mission-control/marketing/posts/:postId/decision", async (req, res): Promise<void> => {
  const parsed = DecideMarketingPostRequestBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid decision", details: parsed.error.flatten() });
    return;
  }
  try {
    const result = await decideMarketingPost({
      postId: String(req.params.postId),
      decision: parsed.data.decision,
      editedContent: parsed.data.editedContent ?? null,
    });
    if (!result) {
      res.status(404).json({ error: "Post not found or already decided" });
      return;
    }
    // Learning: marketing decisions reveal approval habits and brand-voice
    // involvement. Fire-and-forget — never blocks the decision response.
    if (parsed.data.decision === "approved" || parsed.data.decision === "rejected") {
      void analyzeMarketingDecision(
        parsed.data.decision,
        result.post.platform,
        result.post.topic,
        result.post.founderEdited || Boolean(parsed.data.editedContent),
      ).catch((err: unknown) =>
        req.log.warn({ err }, "founder profile: marketing decision analysis failed"),
      );
    }
    res.json({
      post: serializeMarketingPost(result.post),
      qualificationChanged: result.qualificationChanged,
      suspension: result.suspension,
    });
  } catch (err) {
    req.log.error({ err }, "marketing: decision failed");
    res.status(500).json({ error: "Failed to record decision" });
  }
});

router.patch("/mission-control/marketing/posts/:postId/engagement", async (req, res): Promise<void> => {
  const parsed = UpdateMarketingEngagementBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid engagement metrics", details: parsed.error.flatten() });
    return;
  }
  try {
    const post = await updateEngagement(String(req.params.postId), parsed.data);
    if (!post) {
      res.status(404).json({ error: "Post not found" });
      return;
    }
    res.json(serializeMarketingPost(post));
  } catch (err) {
    req.log.error({ err }, "marketing: engagement update failed");
    res.status(500).json({ error: "Failed to update engagement" });
  }
});

router.get("/mission-control/marketing/intelligence", async (req, res): Promise<void> => {
  try {
    const intel = await getMarketingIntelligence();
    res.json(intel);
  } catch (err) {
    req.log.error({ err }, "marketing: intelligence snapshot failed");
    res.status(500).json({ error: "Failed to load marketing intelligence" });
  }
});

router.post("/mission-control/marketing/autonomy", async (req, res): Promise<void> => {
  const parsed = SetMarketingAutonomyBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid autonomy setting", details: parsed.error.flatten() });
    return;
  }
  try {
    const state = await setFounderAutonomy(parsed.data.founderDisabled);
    res.json({
      mode: state.mode,
      founderDisabled: state.founderDisabled,
      enabledAt: state.enabledAt?.toISOString() ?? null,
      suspendedAt: state.suspendedAt?.toISOString() ?? null,
      suspensionReason: state.suspensionReason,
      suspensionCount: state.suspensionCount,
    });
  } catch (err) {
    req.log.error({ err }, "marketing: autonomy update failed");
    res.status(500).json({ error: "Failed to update autonomy setting" });
  }
});

// ─── Social Command Center (Phase 3) ─────────────────────────────────────────
// Real platform data only. Every unconnected / unsupported platform returns an
// explicit unavailable descriptor so the UI can render honest connect states.

const SOCIAL_AGENTS: Array<{ id: string; name: string; role: string; description: string }> = [
  {
    id: "content_strategist",
    name: "Content Strategist",
    role: "Audience growth & content planning",
    description:
      "Analyzes your real connected-platform performance and recommends what to post next.",
  },
  {
    id: "community_manager",
    name: "Community Manager",
    role: "Engagement & inbox triage",
    description:
      "Reviews real comments/mentions from your connected platforms and drafts a response plan.",
  },
  {
    id: "growth_analyst",
    name: "Growth Analyst",
    role: "Metrics & trend analysis",
    description:
      "Reads your real audience metrics and VYBE content trends to surface growth opportunities.",
  },
];

function serializeSocialScheduledPost(row: SocialScheduledPostRow): Record<string, unknown> {
  return {
    id: row.id,
    platform: row.platform,
    oauthConnectionId: row.oauthConnectionId,
    clipId: row.clipId,
    title: row.title,
    content: row.content,
    mediaUrl: row.mediaUrl,
    hashtags: row.hashtags,
    scheduledAt: row.scheduledAt.toISOString(),
    status: row.status,
    requiresApproval: row.requiresApproval,
    approvedAt: row.approvedAt?.toISOString() ?? null,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    externalPostId: row.externalPostId,
    errorMessage: row.errorMessage,
    createdAt: row.createdAt.toISOString(),
  };
}

router.get("/mission-control/social/overview", async (req, res): Promise<void> => {
  try {
    const founder = await resolveFounderUser();
    const connections = founder
      ? await db
          .select()
          .from(oauthConnectionsTable)
          .where(eq(oauthConnectionsTable.userId, founder.id))
      : [];
    const byPlatform = new Map(connections.map((c) => [c.platform as string, c]));

    const platforms = ALL_PLATFORMS.map((id) => {
      const cap = PLATFORM_CAPABILITIES[id];
      const conn = byPlatform.get(id);
      const configured = cap.oauthSupported ? isSocialProviderConfigured(id) : false;
      const connected = Boolean(conn && conn.status !== "disconnected");

      let unavailable: { available: false; reason: string; message: string } | null = null;
      if (!cap.oauthSupported) {
        unavailable = { available: false, reason: "not_integrated", message: `${cap.label} is not integrated yet.` };
      } else if (!configured) {
        unavailable = { available: false, reason: "not_configured", message: `${cap.label} OAuth credentials are not configured in this environment.` };
      } else if (!connected) {
        unavailable = { available: false, reason: "not_connected", message: `${cap.label} is not connected.` };
      } else if (conn && (conn.status === "expired" || conn.status === "refresh_needed")) {
        unavailable = { available: false, reason: "reauth_needed", message: `${cap.label} session expired — reconnect required.` };
      }

      return {
        platform: id,
        label: cap.label,
        oauthSupported: cap.oauthSupported,
        publishSupported: cap.publishSupported,
        analyticsSupported: cap.analyticsSupported,
        inboxSupported: cap.inboxSupported,
        replySupported: cap.replySupported,
        connected,
        configured,
        status: conn?.status ?? null,
        accountName: conn?.accountName ?? null,
        profileImageUrl: conn?.profileImageUrl ?? null,
        tokenExpiresAt: conn?.tokenExpiresAt ? new Date(conn.tokenExpiresAt).toISOString() : null,
        unavailable,
      };
    });

    res.json({
      founder: founder
        ? {
            id: founder.id,
            email: founder.email,
            username: founder.username,
            displayName: founder.displayName,
            avatarUrl: founder.avatarUrl,
            role: founder.role,
            plan: founder.plan,
            followersCount: founder.followersCount,
          }
        : null,
      platforms,
    });
  } catch (err) {
    req.log.error({ err }, "social: overview failed");
    res.status(500).json({ error: "Failed to load social overview" });
  }
});

router.get("/mission-control/social/dashboard", async (req, res): Promise<void> => {
  try {
    const founder = await resolveFounderUser();
    if (!founder) {
      res.json({ totals: { followers: null, totalViews: null, contentCount: null, connectedCount: 0 }, platforms: [], recent: [] });
      return;
    }

    const analyticsPlatforms = ALL_PLATFORMS.filter((id) => PLATFORM_CAPABILITIES[id].analyticsSupported);
    const snapshots = await Promise.all(
      analyticsPlatforms.map((id) => getPlatformSnapshot(founder.id, id)),
    );

    let followers: number | null = null;
    let totalViews: number | null = null;
    let contentCount: number | null = null;
    let connectedCount = 0;
    const recent: PlatformSnapshot["recent"] = [];

    for (const snap of snapshots) {
      if (!snap.unavailable) connectedCount += 1;
      if (snap.stats) {
        if (snap.stats.followers != null) followers = (followers ?? 0) + snap.stats.followers;
        if (snap.stats.totalViews != null) totalViews = (totalViews ?? 0) + snap.stats.totalViews;
        if (snap.stats.contentCount != null) contentCount = (contentCount ?? 0) + snap.stats.contentCount;
      }
      recent.push(...snap.recent);
    }

    recent.sort((a, b) => {
      const ta = a.publishedAt ? Date.parse(a.publishedAt) : 0;
      const tb = b.publishedAt ? Date.parse(b.publishedAt) : 0;
      return tb - ta;
    });

    res.json({
      totals: { followers, totalViews, contentCount, connectedCount },
      platforms: snapshots,
      recent: recent.slice(0, 20),
    });
  } catch (err) {
    req.log.error({ err }, "social: dashboard failed");
    res.status(500).json({ error: "Failed to load social dashboard" });
  }
});

router.get("/mission-control/social/inbox", async (req, res): Promise<void> => {
  try {
    const founder = await resolveFounderUser();
    const items: unknown[] = [];
    const sources: Array<{ platform: string; label: string; available: boolean; message: string | null }> = [];

    const inboxPlatforms = ALL_PLATFORMS.filter((id) => PLATFORM_CAPABILITIES[id].inboxSupported);
    for (const id of inboxPlatforms) {
      const cap = PLATFORM_CAPABILITIES[id];
      if (!founder) {
        sources.push({ platform: id, label: cap.label, available: false, message: "No founder account resolved." });
        continue;
      }
      const tok = await getFounderToken(founder.id, id);
      if ("available" in tok) {
        sources.push({ platform: id, label: cap.label, available: false, message: tok.message });
        continue;
      }
      try {
        if (id === "instagram" || id === "facebook") {
          // Instagram exposes several engagement surfaces (comments, @-mentions,
          // story replies) and Facebook one sub-source per managed Page; each has
          // its own permission/availability, so both return items + sub-sources
          // we report honestly (missing Page tokens surface a reconnect state).
          const result =
            id === "instagram"
              ? await getInstagramInbox(tok.accessToken)
              : await getFacebookInbox(tok.accessToken);
          items.push(...result.items);
          for (const sub of result.sources) {
            sources.push({ platform: id, label: sub.label, available: sub.available, message: sub.message });
          }
        } else {
          let inbox: InboxItem[] | null = null;
          if (id === "youtube") inbox = await getYouTubeInbox(tok.accessToken);

          if (inbox) {
            items.push(...inbox);
            sources.push({ platform: id, label: cap.label, available: true, message: null });
          } else {
            sources.push({ platform: id, label: cap.label, available: false, message: `Inbox for ${cap.label} is not available yet.` });
          }
        }
      } catch (err) {
        req.log.warn({ err, platform: id }, "social: inbox fetch failed");
        sources.push({ platform: id, label: cap.label, available: false, message: `Failed to load live ${cap.label} inbox.` });
      }
    }

    // Also surface unsupported inbox platforms so the UI is honest about coverage.
    for (const id of ALL_PLATFORMS) {
      if (PLATFORM_CAPABILITIES[id].inboxSupported) continue;
      const cap = PLATFORM_CAPABILITIES[id];
      sources.push({ platform: id, label: cap.label, available: false, message: `Inbox for ${cap.label} is not available yet.` });
    }

    (items as Array<{ createdAt: string | null }>).sort((a, b) => {
      const ta = a.createdAt ? Date.parse(a.createdAt) : 0;
      const tb = b.createdAt ? Date.parse(b.createdAt) : 0;
      return tb - ta;
    });

    res.json({ items, sources });
  } catch (err) {
    req.log.error({ err }, "social: inbox failed");
    res.status(500).json({ error: "Failed to load social inbox" });
  }
});

router.post("/mission-control/social/inbox/reply", async (req, res): Promise<void> => {
  const outcome = await processInboxReply(req.body, {
    resolveFounderUser,
    getFounderToken,
    replyToYouTubeComment,
    replyToFacebookComment,
    replyToInstagramComment,
    logError: (err, platform) =>
      req.log.error({ err, platform }, "social: inbox reply failed"),
  });
  res.status(outcome.status).json(outcome.body);
});

router.get("/mission-control/social/agents", async (_req, res): Promise<void> => {
  res.json({ agents: SOCIAL_AGENTS });
});

router.post("/mission-control/social/agents/run", async (req, res): Promise<void> => {
  const parsed = RunSocialAgentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid agent request", details: parsed.error.flatten() });
    return;
  }
  const agent = SOCIAL_AGENTS.find((a) => a.id === parsed.data.agentId);
  if (!agent) {
    res.status(400).json({ error: "Unknown agent" });
    return;
  }

  try {
    const founder = await resolveFounderUser();

    // Assemble a REAL data scope from connected platforms + VYBE content.
    const analyticsPlatforms = ALL_PLATFORMS.filter((id) => PLATFORM_CAPABILITIES[id].analyticsSupported);
    const snapshots = founder
      ? await Promise.all(analyticsPlatforms.map((id) => getPlatformSnapshot(founder.id, id)))
      : [];
    const connected = snapshots.filter((s) => !s.unavailable);

    const [streamAgg] = founder
      ? await db.select({ total: count() }).from(streamsTable).where(eq(streamsTable.userId, founder.id))
      : [{ total: 0 }];
    const [clipAgg] = founder
      ? await db.select({ total: count() }).from(clipsTable).where(eq(clipsTable.userId, founder.id))
      : [{ total: 0 }];

    const scopeLines: string[] = [];
    if (founder) {
      scopeLines.push(`Founder: ${founder.displayName} (@${founder.username}), plan=${founder.plan}, VYBE followers=${founder.followersCount}.`);
    } else {
      scopeLines.push("No founder account is resolved yet.");
    }
    scopeLines.push(`VYBE streams: ${streamAgg?.total ?? 0}, VYBE clips: ${clipAgg?.total ?? 0}.`);
    if (connected.length === 0) {
      scopeLines.push("No external social platforms are connected with live data.");
    } else {
      for (const s of connected) {
        const st = s.stats;
        scopeLines.push(
          `${s.label}: followers=${st?.followers ?? "n/a"}, totalViews=${st?.totalViews ?? "n/a"}, content=${st?.contentCount ?? "n/a"}, recentPosts=${s.recent.length}.`,
        );
      }
    }
    const dataScope = scopeLines.join("\n");

    const ai = await completeWithFallback({
      task: "reasoning",
      modelHint: "standard",
      systemPrompt:
        `You are ${agent.name}, a social media ${agent.role} for VYBE LIVE. ` +
        `Analyze ONLY the real data provided. Never invent metrics or platforms that are not present. ` +
        `If little data is available, say so plainly and recommend connecting platforms. ` +
        `Respond as JSON: {"summary": string, "recommendations": string[]}. Keep 3-5 concrete recommendations.`,
      userContent:
        `REAL DATA SCOPE:\n${dataScope}\n\n` +
        (parsed.data.prompt ? `Founder focus: ${parsed.data.prompt}\n\n` : "") +
        `Produce your analysis.`,
      executiveId: "social-agent",
      executiveName: agent.name,
      executiveRole: agent.role,
      responseFormat: "json",
    });

    let summary = "";
    let recommendations: string[] = [];
    const parsedOut = ai.parsed as { summary?: unknown; recommendations?: unknown } | undefined;
    if (parsedOut && typeof parsedOut.summary === "string") summary = parsedOut.summary;
    if (parsedOut && Array.isArray(parsedOut.recommendations)) {
      recommendations = parsedOut.recommendations.filter((r): r is string => typeof r === "string");
    }

    if (!summary || recommendations.length === 0) {
      // Deterministic fallback grounded in the same real data scope.
      summary =
        connected.length === 0
          ? "No external platforms are connected with live data yet, so analysis is limited to your VYBE activity."
          : `Analysis based on ${connected.length} connected platform(s) and your VYBE content.`;
      recommendations = [
        connected.length === 0
          ? "Connect at least one platform (YouTube is fully supported) to unlock real analytics."
          : "Double down on the platform with the strongest recent view counts.",
        (clipAgg?.total ?? 0) > 0
          ? "Repurpose your existing VYBE clips into short-form posts across connected platforms."
          : "Create clips from your VYBE streams to fuel a content pipeline.",
        "Schedule posts consistently using the Scheduling Center to maintain cadence.",
      ];
    }

    res.json({
      agentId: agent.id,
      agentName: agent.name,
      summary,
      recommendations,
      usedAI: !ai.fromFallback,
      dataScope,
    });
  } catch (err) {
    req.log.error({ err }, "social: agent run failed");
    res.status(500).json({ error: "Failed to run social agent" });
  }
});

router.post("/mission-control/social/content/generate", async (req, res): Promise<void> => {
  const parsed = GenerateSocialContentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid content request", details: parsed.error.flatten() });
    return;
  }
  try {
    const result = await createMarketingDraft({
      topic: parsed.data.topic,
      platform: parsed.data.platform,
      contentType: parsed.data.contentType,
      objectiveId: null,
    });
    res.status(201).json({
      post: serializeMarketingPost(result.post),
      autoPublished: result.autoPublished,
    });
  } catch (err) {
    req.log.error({ err }, "social: content generation failed");
    res.status(500).json({ error: "Failed to generate social content" });
  }
});

/**
 * Start an OAuth connection for a platform from the Mission Control web console.
 *
 * Resolves the founder server-side (MC is unauthenticated + founder-scoped by
 * convention), builds a signed one-time authorization URL stamped origin="mc",
 * and 302-redirects the browser to the provider. On any failure it redirects
 * back to the Social console with a `connect_error` query param so the SPA can
 * surface it. The provider callback commits the connection and returns the
 * browser to `/mission-control/social?connected=<platform>`.
 */
router.get("/mission-control/social/oauth/:platform/init", async (req, res): Promise<void> => {
  const platform = String(req.params["platform"]);
  const socialBase = `${getAppBaseUrl()}/mission-control/social`;
  const back = (msg: string): void => {
    res.redirect(`${socialBase}?connect_error=${encodeURIComponent(msg)}&platform=${encodeURIComponent(platform)}`);
  };
  try {
    const founder = await resolveFounderUser();
    if (!founder) {
      back("No founder account resolved — cannot connect platforms.");
      return;
    }
    const result = buildOAuthInitUrl(founder.id, platform);
    if (!result.ok) {
      back(result.error);
      return;
    }
    res.redirect(result.url);
  } catch (err) {
    req.log.error({ err, platform }, "social: oauth init failed");
    back("Failed to start the connection. Please try again.");
  }
});

router.get("/mission-control/social/schedule", async (req, res): Promise<void> => {
  try {
    const founder = await resolveFounderUser();
    const rows = founder
      ? await db
          .select()
          .from(socialScheduledPostsTable)
          .where(eq(socialScheduledPostsTable.userId, founder.id))
          .orderBy(desc(socialScheduledPostsTable.scheduledAt))
          .limit(200)
      : [];
    res.json({ posts: rows.map(serializeSocialScheduledPost) });
  } catch (err) {
    req.log.error({ err }, "social: list schedule failed");
    res.status(500).json({ error: "Failed to list scheduled posts" });
  }
});

router.post("/mission-control/social/schedule", async (req, res): Promise<void> => {
  const parsed = CreateScheduledSocialPostBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid schedule request", details: parsed.error.flatten() });
    return;
  }
  try {
    const founder = await resolveFounderUser();
    if (!founder) {
      res.status(400).json({ error: "No founder account resolved — cannot schedule posts." });
      return;
    }

    const platform = parsed.data.platform as SocialPlatformId;
    const cap = PLATFORM_CAPABILITIES[platform];
    if (!cap) {
      res.status(400).json({ error: `Unknown platform "${parsed.data.platform}".` });
      return;
    }
    if (!cap.publishSupported) {
      res.status(422).json({
        error: `${cap.label} does not support publishing yet, so posts cannot be scheduled for it.`,
      });
      return;
    }
    const token = await getFounderToken(founder.id, platform);
    if (!("accessToken" in token)) {
      res.status(422).json({
        error: token.message,
        reason: token.reason,
      });
      return;
    }
    const oauthConnectionId = token.connection.id;

    const requiresApproval = parsed.data.requiresApproval ?? true;
    const [row] = await db
      .insert(socialScheduledPostsTable)
      .values({
        id: randomUUID(),
        userId: founder.id,
        platform,
        oauthConnectionId,
        clipId: parsed.data.clipId ?? null,
        title: parsed.data.title ?? "",
        content: parsed.data.content,
        mediaUrl: parsed.data.mediaUrl ?? null,
        hashtags: parsed.data.hashtags ?? [],
        scheduledAt: parsed.data.scheduledAt,
        status: requiresApproval ? "pending_approval" : "scheduled",
        requiresApproval,
        approvedAt: requiresApproval ? null : new Date(),
        createdBy: "founder",
      })
      .returning();
    res.status(201).json(serializeSocialScheduledPost(row));
  } catch (err) {
    req.log.error({ err }, "social: create schedule failed");
    res.status(500).json({ error: "Failed to schedule post" });
  }
});

router.post("/mission-control/social/schedule/:scheduleId/decision", async (req, res): Promise<void> => {
  const parsed = DecideScheduledSocialPostBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid decision", details: parsed.error.flatten() });
    return;
  }
  try {
    const founder = await resolveFounderUser();
    if (!founder) {
      res.status(404).json({ error: "Scheduled post not found" });
      return;
    }
    const id = String(req.params.scheduleId);
    const [existing] = await db
      .select()
      .from(socialScheduledPostsTable)
      .where(
        and(
          eq(socialScheduledPostsTable.id, id),
          eq(socialScheduledPostsTable.userId, founder.id),
        ),
      )
      .limit(1);
    if (!existing) {
      res.status(404).json({ error: "Scheduled post not found" });
      return;
    }
    const nextStatus = parsed.data.decision === "approve" ? "scheduled" : "cancelled";
    const [row] = await db
      .update(socialScheduledPostsTable)
      .set({
        status: nextStatus,
        approvedAt: parsed.data.decision === "approve" ? new Date() : existing.approvedAt,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(socialScheduledPostsTable.id, id),
          eq(socialScheduledPostsTable.userId, founder.id),
        ),
      )
      .returning();
    res.json(serializeSocialScheduledPost(row));
  } catch (err) {
    req.log.error({ err }, "social: schedule decision failed");
    res.status(500).json({ error: "Failed to update scheduled post" });
  }
});

router.post(
  "/mission-control/social/schedule/:scheduleId/reschedule",
  async (req, res): Promise<void> => {
    const parsed = RescheduleScheduledSocialPostBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid reschedule request", details: parsed.error.flatten() });
      return;
    }
    try {
      const founder = await resolveFounderUser();
      if (!founder) {
        res.status(404).json({ error: "Scheduled post not found" });
        return;
      }
      const id = String(req.params.scheduleId);
      const [existing] = await db
        .select()
        .from(socialScheduledPostsTable)
        .where(
          and(
            eq(socialScheduledPostsTable.id, id),
            eq(socialScheduledPostsTable.userId, founder.id),
          ),
        )
        .limit(1);
      if (!existing) {
        res.status(404).json({ error: "Scheduled post not found" });
        return;
      }
      // Only a post that has actually stopped (failed or cancelled) can be
      // requeued. Live/queued posts must be cancelled first — we never silently
      // reset an in-flight or already-published post.
      if (existing.status !== "failed" && existing.status !== "cancelled") {
        res.status(422).json({
          error: `Only failed or cancelled posts can be rescheduled (this one is "${existing.status}").`,
        });
        return;
      }
      // Derive the target status the same way creation does: a post that still
      // needs approval (never approved) must re-enter the approval gate rather
      // than jump straight to `scheduled` — otherwise the publisher's approval
      // filter would leave it permanently stuck. Only already-approved (or
      // no-approval-required) posts go directly back into the publish queue.
      const needsApproval = existing.requiresApproval && existing.approvedAt == null;
      const nextStatus = needsApproval ? "pending_approval" : "scheduled";
      const [row] = await db
        .update(socialScheduledPostsTable)
        .set({
          status: nextStatus,
          scheduledAt: parsed.data.scheduledAt,
          errorMessage: null,
          retryCount: 0,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(socialScheduledPostsTable.id, id),
            eq(socialScheduledPostsTable.userId, founder.id),
          ),
        )
        .returning();
      res.json(serializeSocialScheduledPost(row));
    } catch (err) {
      req.log.error({ err }, "social: reschedule failed");
      res.status(500).json({ error: "Failed to reschedule post" });
    }
  },
);

router.delete("/mission-control/social/schedule/:scheduleId", async (req, res): Promise<void> => {
  try {
    const founder = await resolveFounderUser();
    if (!founder) {
      res.status(404).json({ error: "Scheduled post not found" });
      return;
    }
    const id = String(req.params.scheduleId);
    const deleted = await db
      .delete(socialScheduledPostsTable)
      .where(
        and(
          eq(socialScheduledPostsTable.id, id),
          eq(socialScheduledPostsTable.userId, founder.id),
        ),
      )
      .returning({ id: socialScheduledPostsTable.id });
    if (deleted.length === 0) {
      res.status(404).json({ error: "Scheduled post not found" });
      return;
    }
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "social: delete schedule failed");
    res.status(500).json({ error: "Failed to delete scheduled post" });
  }
});

router.get("/mission-control/social/discovery", async (req, res): Promise<void> => {
  try {
    const founder = await resolveFounderUser();
    const rows = await db
      .select({
        id: usersTable.id,
        username: usersTable.username,
        displayName: usersTable.displayName,
        avatarUrl: usersTable.avatarUrl,
        bio: usersTable.bio,
        category: usersTable.category,
        followersCount: usersTable.followersCount,
        totalStreams: usersTable.totalStreams,
        locationCity: usersTable.locationCity,
        locationCountry: usersTable.locationCountry,
      })
      .from(usersTable)
      .where(and(eq(usersTable.accountStatus, "active"), founder ? sql`${usersTable.id} <> ${founder.id}` : undefined))
      .orderBy(desc(usersTable.followersCount))
      .limit(50);

    const [totalAgg] = await db
      .select({ total: count() })
      .from(usersTable)
      .where(eq(usersTable.accountStatus, "active"));

    res.json({
      creators: rows.map((r) => ({
        id: r.id,
        username: r.username,
        displayName: r.displayName,
        avatarUrl: r.avatarUrl,
        bio: r.bio,
        category: r.category,
        followersCount: r.followersCount,
        totalStreams: r.totalStreams,
        locationCity: r.locationCity,
        locationCountry: r.locationCountry,
      })),
      total: totalAgg?.total ?? 0,
    });
  } catch (err) {
    req.log.error({ err }, "social: discovery failed");
    res.status(500).json({ error: "Failed to load creator discovery" });
  }
});

router.get("/mission-control/social/trends", async (req, res): Promise<void> => {
  try {
    // Trends derived from REAL VYBE data: creator categories + streams, plus
    // marketing content-type distribution.
    const categoryRows = await db
      .select({ label: usersTable.category, count: count() })
      .from(usersTable)
      .where(and(eq(usersTable.accountStatus, "active"), sql`${usersTable.category} IS NOT NULL`))
      .groupBy(usersTable.category)
      .orderBy(desc(count()))
      .limit(12);

    const contentTypeRows = await db
      .select({ label: marketingPostsTable.contentType, count: count() })
      .from(marketingPostsTable)
      .groupBy(marketingPostsTable.contentType)
      .orderBy(desc(count()))
      .limit(12);

    const hashtagPosts = await db
      .select({ hashtags: marketingPostsTable.hashtags })
      .from(marketingPostsTable)
      .orderBy(desc(marketingPostsTable.createdAt))
      .limit(200);
    const tagCounts = new Map<string, number>();
    for (const p of hashtagPosts) {
      for (const tag of p.hashtags ?? []) {
        tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
      }
    }
    const hashtags = [...tagCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 15)
      .map(([label, c]) => ({ label, count: c, kind: "hashtag" }));

    res.json({
      categories: categoryRows
        .filter((r) => r.label)
        .map((r) => ({ label: String(r.label), count: r.count, kind: "category" })),
      contentTypes: contentTypeRows.map((r) => ({ label: r.label, count: r.count, kind: "content_type" })),
      hashtags,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    req.log.error({ err }, "social: trends failed");
    res.status(500).json({ error: "Failed to load trend intelligence" });
  }
});

router.get("/mission-control/social/vybe", async (req, res): Promise<void> => {
  try {
    const founder = await resolveFounderUser();
    if (!founder) {
      res.json({ streams: [], clips: [], totals: { totalStreams: 0, totalClips: 0, publishableClips: 0 } });
      return;
    }
    const streams = await db
      .select({
        id: streamsTable.id,
        title: streamsTable.title,
        status: streamsTable.status,
        peakViewers: streamsTable.peakViewers,
        createdAt: streamsTable.createdAt,
      })
      .from(streamsTable)
      .where(eq(streamsTable.userId, founder.id))
      .orderBy(desc(streamsTable.createdAt))
      .limit(20);
    const clips = await db
      .select({
        id: clipsTable.id,
        title: clipsTable.title,
        status: clipsTable.status,
        videoUrl: clipsTable.videoUrl,
        thumbnailUrl: clipsTable.thumbnailUrl,
        createdAt: clipsTable.createdAt,
      })
      .from(clipsTable)
      .where(eq(clipsTable.userId, founder.id))
      .orderBy(desc(clipsTable.createdAt))
      .limit(30);

    const [streamTotal] = await db.select({ total: count() }).from(streamsTable).where(eq(streamsTable.userId, founder.id));
    const [clipTotal] = await db.select({ total: count() }).from(clipsTable).where(eq(clipsTable.userId, founder.id));
    const [publishable] = await db
      .select({ total: count() })
      .from(clipsTable)
      .where(and(eq(clipsTable.userId, founder.id), eq(clipsTable.status, "ready")));

    res.json({
      streams: streams.map((s) => ({
        id: s.id,
        title: s.title,
        status: s.status,
        peakViewers: s.peakViewers,
        createdAt: s.createdAt.toISOString(),
      })),
      clips: clips.map((c) => ({
        id: c.id,
        title: c.title,
        status: c.status,
        videoUrl: c.videoUrl,
        thumbnailUrl: c.thumbnailUrl,
        createdAt: c.createdAt.toISOString(),
      })),
      totals: {
        totalStreams: streamTotal?.total ?? 0,
        totalClips: clipTotal?.total ?? 0,
        publishableClips: publishable?.total ?? 0,
      },
    });
  } catch (err) {
    req.log.error({ err }, "social: vybe failed");
    res.status(500).json({ error: "Failed to load VYBE integration data" });
  }
});

router.get("/mission-control/dev/diagnostics", async (req, res): Promise<void> => {
  const generatedAt = new Date().toISOString();

  // Database health (also doubles as the gate for the rest of the snapshot).
  let database: { status: "ok" | "degraded" | "down"; latencyMs: number | null; error: string | null } = {
    status: "down",
    latencyMs: null,
    error: null,
  };
  const dbStart = Date.now();
  try {
    await db.select({ n: count() }).from(aiExecutivesTable);
    database = { status: "ok", latencyMs: Date.now() - dbStart, error: null };
  } catch (err) {
    database = { status: "down", latencyMs: null, error: err instanceof Error ? err.message : "unknown" };
  }

  // AI providers.
  let ai: {
    status: "ok" | "degraded" | "down";
    active: string;
    model: string;
    providers: { name: string; available: boolean }[];
  };
  try {
    const ps = getProviderStatus();
    const providers = Object.entries(ps.available).map(([name, available]) => ({ name, available }));
    const anyReal = providers.some((p) => p.available && p.name.toLowerCase() !== "mock");
    ai = { status: anyReal ? "ok" : "degraded", active: ps.active, model: ps.model, providers };
  } catch {
    ai = { status: "down", active: "unknown", model: "unknown", providers: [] };
  }

  // Everything else needs the DB; short-circuit with safe defaults if down.
  if (database.status === "down") {
    res.status(200).json({
      generatedAt,
      api: { status: "degraded", uptimeSeconds: Math.round(process.uptime()) },
      database,
      ai,
      executives: { total: 0, items: [] },
      memoryEngine: { status: "empty", totalInsights: 0, totalMemories: 0, byConfidence: { low: 0, medium: 0, high: 0 } },
      reasoningEngine: { status: "empty", totalPredictions: 0, scoredPredictions: 0, accuracyPct: null },
      founderProfile: { categoriesCovered: 0, totalCategories: 10, completenessPct: 0 },
      objectives: { total: 0, byStatus: {} },
      tasks: { total: 0, byStatus: {} },
      approvals: { total: 0, pending: 0 },
      dailyBriefing: { status: "missing", date: null, generatedAt: null },
      latestErrors: [],
      portfolio: { totalAssets: 0, healthy: 0, attention: 0, critical: 0 },
      autonomy: { totalCycles: 0, lastTrigger: null, lastStatus: null, lastRunAt: null },
      learning: { totalLessons: 0, totalRetrospectives: 0, totalWeeklyReviews: 0, lastReviewWeekOf: null },
      living: { totalEvents: 0, openConversations: 0, pendingRecommendations: 0, lastEventAt: null, executiveMemories: 0, reasoningTraces: 0, linkedEvents: 0 },
      specialists: {
        total: SPECIALISTS.length,
        available: SPECIALISTS.filter((s) => isSpecialistAvailable(s)).length,
        items: SPECIALISTS.map((s) => ({
          id: s.id,
          name: s.name,
          kind: s.kind,
          ownerRole: s.ownerRole,
          ownerName: null,
          available: isSpecialistAvailable(s),
          ownerPresent: false,
          confidence: 60,
          runCount: 0,
          lastRunAt: null,
        })),
      },
    });
    return;
  }

  const [
    execRows,
    insights,
    memoryCountRows,
    decisionSummary,
    objectiveGroups,
    taskGroups,
    approvalCountRows,
    pendingApprovalRows,
    todayBriefing,
    failedCalls,
    portfolioSummary,
    recentCycles,
    cycleCountRows,
    learningTotals,
    lastReviewRows,
    livingCounts,
    openConversations,
    pendingRecommendations,
    executiveMemoryCount,
    reasoningTraceCount,
    linkedEventCount,
  ] = await Promise.all([
    db.select().from(aiExecutivesTable).orderBy(aiExecutivesTable.sortOrder),
    getAllInsights(),
    db.select({ n: count() }).from(agentMemoryTable),
    getDecisionModelSummary(),
    db.select({ status: agentObjectivesTable.status, n: count() }).from(agentObjectivesTable).groupBy(agentObjectivesTable.status),
    db.select({ status: agentTasksTable.status, n: count() }).from(agentTasksTable).groupBy(agentTasksTable.status),
    db.select({ n: count() }).from(agentApprovalsTable),
    db.select({ n: count() }).from(agentApprovalsTable).where(eq(agentApprovalsTable.status, "pending")),
    db.select().from(dailyCOOBriefingsTable).where(eq(dailyCOOBriefingsTable.date, generatedAt.slice(0, 10))).limit(1),
    db.select().from(aiUsageLogTable).where(eq(aiUsageLogTable.success, false)).orderBy(desc(aiUsageLogTable.createdAt)).limit(10),
    getPortfolioSummary(),
    getRecentCycles(1),
    db.select({ n: count() }).from(autonomyCyclesTable),
    getLearningTotals(),
    db.select({ weekOf: weeklyReviewsTable.weekOf }).from(weeklyReviewsTable).orderBy(desc(weeklyReviewsTable.weekOf)).limit(1),
    getLivingCounts(),
    getOpenConversationCount(),
    getPendingRecommendationCount(),
    getExecutiveMemoryCount(),
    getReasoningCount(),
    getLinkedEventCount(),
  ]);

  const byConfidence = { low: 0, medium: 0, high: 0 };
  const coveredCategories = new Set<string>();
  for (const i of insights) {
    if (i.confidence in byConfidence) byConfidence[i.confidence as keyof typeof byConfidence] += 1;
    coveredCategories.add(i.category);
  }

  const objByStatus: Record<string, number> = {};
  let objTotal = 0;
  for (const g of objectiveGroups) {
    objByStatus[g.status] = g.n;
    objTotal += g.n;
  }
  const taskByStatus: Record<string, number> = {};
  let taskTotal = 0;
  for (const g of taskGroups) {
    taskByStatus[g.status] = g.n;
    taskTotal += g.n;
  }

  const totalCategories = 10;
  const briefing = todayBriefing[0];

  // ENGINEERING EXPANSION — specialist bench availability (never blocks diagnostics).
  let specialistItems: Awaited<ReturnType<typeof getSpecialistRegistry>> = [];
  try {
    specialistItems = await getSpecialistRegistry();
  } catch (err) {
    req.log.warn({ err }, "diagnostics: specialist registry unavailable");
  }

  res.status(200).json({
    generatedAt,
    api: { status: "ok", uptimeSeconds: Math.round(process.uptime()) },
    database,
    ai,
    executives: {
      total: execRows.length,
      items: execRows.map((e) => ({
        id: e.id,
        name: e.name,
        role: e.role,
        status: e.status,
        statusMessage: e.statusMessage ?? null,
      })),
    },
    memoryEngine: {
      status: insights.length > 0 || (memoryCountRows[0]?.n ?? 0) > 0 ? "ok" : "empty",
      totalInsights: insights.length,
      totalMemories: memoryCountRows[0]?.n ?? 0,
      byConfidence,
    },
    reasoningEngine: {
      status: decisionSummary.totalPredictions > 0 ? "ok" : "empty",
      totalPredictions: decisionSummary.totalPredictions,
      scoredPredictions: decisionSummary.scoredPredictions,
      accuracyPct: decisionSummary.accuracyPct,
    },
    founderProfile: {
      categoriesCovered: coveredCategories.size,
      totalCategories,
      completenessPct: Math.round((coveredCategories.size / totalCategories) * 100),
    },
    objectives: { total: objTotal, byStatus: objByStatus },
    tasks: { total: taskTotal, byStatus: taskByStatus },
    approvals: { total: approvalCountRows[0]?.n ?? 0, pending: pendingApprovalRows[0]?.n ?? 0 },
    dailyBriefing: {
      status: briefing ? "present" : "missing",
      date: briefing?.date ?? null,
      generatedAt: briefing?.generatedAt?.toISOString() ?? null,
    },
    latestErrors: failedCalls.map((c) => ({
      source: `${c.provider}/${c.task}`,
      message: `AI call failed (${c.model})${c.fromFallback ? " — used fallback" : ""}`,
      at: c.createdAt.toISOString(),
    })),
    portfolio: {
      totalAssets: portfolioSummary.totalAssets,
      healthy: portfolioSummary.healthy,
      attention: portfolioSummary.attention,
      critical: portfolioSummary.critical,
    },
    autonomy: {
      totalCycles: cycleCountRows[0]?.n ?? 0,
      lastTrigger: recentCycles[0]?.trigger ?? null,
      lastStatus: recentCycles[0]?.status ?? null,
      lastRunAt: recentCycles[0]?.startedAt ? recentCycles[0].startedAt.toISOString() : null,
    },
    learning: {
      totalLessons: learningTotals.lessons,
      totalRetrospectives: learningTotals.retrospectives,
      totalWeeklyReviews: learningTotals.weeklyReviews,
      lastReviewWeekOf: lastReviewRows[0]?.weekOf ?? null,
    },
    living: {
      totalEvents: livingCounts.totalEvents,
      openConversations,
      pendingRecommendations,
      lastEventAt: livingCounts.lastEventAt ? livingCounts.lastEventAt.toISOString() : null,
      executiveMemories: executiveMemoryCount,
      reasoningTraces: reasoningTraceCount,
      linkedEvents: linkedEventCount,
    },
    specialists: {
      total: specialistItems.length,
      available: specialistItems.filter((s) => s.available).length,
      items: specialistItems.map((s) => ({
        id: s.id,
        name: s.name,
        kind: s.kind,
        ownerRole: s.ownerRole,
        ownerName: s.ownerName,
        available: s.available,
        ownerPresent: s.ownerPresent,
        confidence: s.confidence,
        runCount: s.runCount,
        lastRunAt: s.lastRunAt,
      })),
    },
  });
});

// ─── Engineering Intelligence Layer (V10) ─────────────────────────────────────
// All engineering surfaces read the single normalized snapshot — never the
// providers directly. Each route degrades gracefully: provider failures surface
// as "unavailable" diagnostics inside an otherwise well-formed snapshot.

// GET the active products (portfolio assets) monitored by Engineering Intelligence.
router.get("/mission-control/engineering/products", async (req, res): Promise<void> => {
  try {
    const products = await getActiveProducts();
    res.json({ products });
  } catch (err) {
    req.log.error({ err }, "engineering: products failed");
    res.status(500).json({ error: "Failed to load engineering products" });
  }
});

// GET the portfolio-wide engineering overview with aggregate launch readiness.
router.get("/mission-control/engineering/portfolio", async (req, res): Promise<void> => {
  try {
    const overview = await getPortfolioOverview();
    res.json(overview);
  } catch (err) {
    req.log.error({ err }, "engineering: portfolio failed");
    res.status(500).json({ error: "Failed to load engineering portfolio" });
  }
});

// GET recent typed Engineering Events for a product (defaults to the flagship).
router.get("/mission-control/engineering/events", async (req, res): Promise<void> => {
  try {
    const productId = req.query.productId ? String(req.query.productId) : null;
    const limitRaw = req.query.limit ? Number(req.query.limit) : 30;
    const limit = Number.isFinite(limitRaw) ? Math.min(100, Math.max(1, limitRaw)) : 30;
    const product = productId ? await getProductById(productId) : await getFlagshipProduct();
    if (!product) {
      res.status(404).json({ error: "Product not found" });
      return;
    }
    const events = await getRecentEvents(product.id, limit);
    res.json({ events });
  } catch (err) {
    req.log.error({ err }, "engineering: events failed");
    res.status(500).json({ error: "Failed to load engineering events" });
  }
});

// GET latest Engineering Snapshot for a product (collects a fresh one if stale).
// Defaults to the flagship product when no productId is supplied.
router.get("/mission-control/engineering/snapshot", async (req, res): Promise<void> => {
  try {
    const productId = req.query.productId ? String(req.query.productId) : null;
    const product = productId ? await getProductById(productId) : await getFlagshipProduct();
    if (!product) {
      res.status(404).json({ error: "Product not found" });
      return;
    }
    const snapshot = await getLatestSnapshot(product);
    res.json(snapshot);
  } catch (err) {
    req.log.error({ err }, "engineering: snapshot failed");
    res.status(500).json({ error: "Failed to load engineering snapshot" });
  }
});

// GET recent snapshots for a product (trend / build / deployment history).
router.get("/mission-control/engineering/history", async (req, res): Promise<void> => {
  try {
    const productId = req.query.productId ? String(req.query.productId) : null;
    const product = productId ? await getProductById(productId) : await getFlagshipProduct();
    if (!product) {
      res.status(404).json({ error: "Product not found" });
      return;
    }
    const snapshots = await getSnapshotHistory(product.id, 20);
    res.json({ snapshots });
  } catch (err) {
    req.log.error({ err }, "engineering: history failed");
    res.status(500).json({ error: "Failed to load engineering history" });
  }
});

// GET Engineering Intelligence diagnostics (provider connectivity, age, confidence).
router.get("/mission-control/engineering/diagnostics", async (req, res): Promise<void> => {
  try {
    const productId = req.query.productId ? String(req.query.productId) : null;
    const product = productId ? await getProductById(productId) : null;
    if (productId && !product) {
      res.status(404).json({ error: "Product not found" });
      return;
    }
    const diagnostics = await getEngineeringDiagnosticsData(product ?? undefined);
    res.json(diagnostics);
  } catch (err) {
    req.log.error({ err }, "engineering: diagnostics failed");
    res.status(500).json({ error: "Failed to load engineering diagnostics" });
  }
});

// GET a role-scoped slice of the snapshot for one executive.
router.get(
  "/mission-control/engineering/executive-view/:role",
  async (req, res): Promise<void> => {
    try {
      const role = String(req.params.role);
      const snapshot = await getFlagshipSnapshot();
      res.json(getExecutiveView(role, snapshot));
    } catch (err) {
      req.log.error({ err }, "engineering: executive view failed");
      res.status(500).json({ error: "Failed to load executive engineering view" });
    }
  },
);

// 🔧 Developer tool: force a fresh Engineering Snapshot collection now.
// Defaults to the flagship product; accepts ?productId= to target another.
router.post("/mission-control/dev/check-engineering", async (req, res): Promise<void> => {
  try {
    const productId = req.query.productId ? String(req.query.productId) : null;
    const product = productId ? await getProductById(productId) : await getFlagshipProduct();
    if (!product) {
      res.status(404).json({ error: "Product not found" });
      return;
    }
    const snapshot = await collectSnapshot(product);
    res.json(snapshot);
  } catch (err) {
    req.log.error({ err }, "dev: check engineering failed");
    res.status(500).json({ error: "Failed to collect engineering snapshot" });
  }
});

// ─── Autonomous Blocker Resolution Engine (V11.1) ────────────────────────────

// GET aggregate blocker counts by category and status.
router.get("/mission-control/blockers/summary", async (req, res): Promise<void> => {
  try {
    const summary = await getBlockerSummary();
    res.json(summary);
  } catch (err) {
    req.log.error({ err }, "blockers: summary failed");
    res.status(500).json({ error: "Failed to load blocker summary" });
  }
});

// POST run one resolution pass now (sync, reclassify, retry, close, learn).
router.post("/mission-control/blockers/run", async (req, res): Promise<void> => {
  try {
    const result = await runBlockerResolutionPass();
    res.json(result);
  } catch (err) {
    req.log.error({ err }, "blockers: run pass failed");
    res.status(500).json({ error: "Failed to run blocker resolution pass" });
  }
});

// GET list of blockers, optionally filtered by ?category and ?status.
router.get("/mission-control/blockers", async (req, res): Promise<void> => {
  try {
    const category = req.query.category ? String(req.query.category) : undefined;
    const status = req.query.status ? String(req.query.status) : undefined;
    const blockers = await listBlockers({
      category: category as never,
      status: status as never,
    });
    res.json({ blockers });
  } catch (err) {
    req.log.error({ err }, "blockers: list failed");
    res.status(500).json({ error: "Failed to load blockers" });
  }
});

// GET a single blocker with full resolution detail and retry history.
router.get("/mission-control/blockers/:blockerId", async (req, res): Promise<void> => {
  try {
    const blocker = await getBlockerById(String(req.params.blockerId));
    if (!blocker) {
      res.status(404).json({ error: "Blocker not found" });
      return;
    }
    res.json(blocker);
  } catch (err) {
    req.log.error({ err }, "blockers: get by id failed");
    res.status(500).json({ error: "Failed to load blocker" });
  }
});

// ─── Agent Zero: execution engine routes ────────────────────────────────────
// Agent Zero receives work only through Quinn (or the founder via this API on
// Quinn's behalf). It is an execution layer, never a strategist.

function serializeAgentZeroJob(job: AgentZeroJobRow): Record<string, unknown> {
  return {
    ...job,
    startedAt: job.startedAt?.toISOString() ?? null,
    finishedAt: job.finishedAt?.toISOString() ?? null,
    pausedAt: job.pausedAt?.toISOString() ?? null,
    createdAt: job.createdAt.toISOString(),
    updatedAt: job.updatedAt.toISOString(),
  };
}

function serializeAgentZeroStep(step: AgentZeroStepRow): Record<string, unknown> {
  return {
    ...step,
    startedAt: step.startedAt?.toISOString() ?? null,
    finishedAt: step.finishedAt?.toISOString() ?? null,
  };
}

router.post("/mission-control/agent-zero/jobs", async (req, res): Promise<void> => {
  const parsed = DispatchAgentZeroJobBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid dispatch request", details: parsed.error.flatten() });
    return;
  }
  try {
    const job = await createAgentZeroJob({
      commandType: parsed.data.commandType,
      instruction: parsed.data.instruction,
      title: parsed.data.title,
      objectiveId: parsed.data.objectiveId ?? null,
      priority: parsed.data.priority,
    });
    res.status(201).json({ job: serializeAgentZeroJob(job) });
  } catch (err) {
    req.log.error({ err }, "agent-zero: dispatch failed");
    res.status(500).json({ error: "Failed to dispatch Agent Zero job" });
  }
});

router.get("/mission-control/agent-zero/jobs", async (req, res): Promise<void> => {
  try {
    const status = typeof req.query.status === "string" ? req.query.status : "";
    const validStatuses = [
      "queued",
      "running",
      "paused",
      "waiting_approval",
      "completed",
      "failed",
      "cancelled",
    ] as const;
    const statusFilter = validStatuses.find((s) => s === status);
    const jobs = await db
      .select()
      .from(agentZeroJobsTable)
      .where(statusFilter ? eq(agentZeroJobsTable.status, statusFilter) : undefined)
      .orderBy(desc(agentZeroJobsTable.createdAt))
      .limit(50);
    res.json({ jobs: jobs.map(serializeAgentZeroJob) });
  } catch (err) {
    req.log.error({ err }, "agent-zero: list jobs failed");
    res.status(500).json({ error: "Failed to list Agent Zero jobs" });
  }
});

router.get("/mission-control/agent-zero/jobs/:jobId", async (req, res): Promise<void> => {
  try {
    const jobId = String(req.params.jobId);
    const [job] = await db.select().from(agentZeroJobsTable).where(eq(agentZeroJobsTable.id, jobId)).limit(1);
    if (!job) {
      res.status(404).json({ error: "Job not found" });
      return;
    }
    const steps = await db
      .select()
      .from(agentZeroStepsTable)
      .where(eq(agentZeroStepsTable.jobId, jobId))
      .orderBy(agentZeroStepsTable.seq);
    res.json({ job: serializeAgentZeroJob(job), steps: steps.map(serializeAgentZeroStep) });
  } catch (err) {
    req.log.error({ err }, "agent-zero: get job failed");
    res.status(500).json({ error: "Failed to load Agent Zero job" });
  }
});

router.post("/mission-control/agent-zero/jobs/:jobId/control", async (req, res): Promise<void> => {
  const parsed = ControlAgentZeroJobBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid control request", details: parsed.error.flatten() });
    return;
  }
  try {
    const job = await controlJob(String(req.params.jobId), parsed.data.action);
    if (!job) {
      res.status(404).json({ error: "Job not found" });
      return;
    }
    res.json({ job: serializeAgentZeroJob(job) });
  } catch (err) {
    req.log.error({ err }, "agent-zero: control failed");
    res.status(500).json({ error: "Failed to control Agent Zero job" });
  }
});

router.get("/mission-control/agent-zero/operations", async (req, res): Promise<void> => {
  try {
    const snapshot = await getOperationsSnapshot();
    res.json({
      ...snapshot,
      jobs: snapshot.jobs.map((j) => ({
        ...serializeAgentZeroJob(j),
        steps: j.steps.map(serializeAgentZeroStep),
      })),
    });
  } catch (err) {
    req.log.error({ err }, "agent-zero: operations snapshot failed");
    res.status(500).json({ error: "Failed to load Operations Center snapshot" });
  }
});

// ─── OS Event Bus API (Phase 2) ───────────────────────────────────────────────

/**
 * GET /api/mission-control/os/events
 * Returns recent events from the in-memory EventStore ring.
 *
 * Query params:
 *   limit  — max events to return (default 100, max 500)
 *   kind   — filter by event kind, e.g. "github.push"
 *   domain — filter by domain prefix, e.g. "github", "vybe"
 *   status — filter by status: pending | processed | failed
 *   correlationId — filter by correlation ID
 *   since  — ISO timestamp; only return events emitted at or after this time
 */
router.get("/mission-control/os/events", async (req, res): Promise<void> => {
  try {
    const { getEventStore } = await import("../services/os/index.js");
    const store = getEventStore();

    const limitRaw = Number(req.query.limit ?? 100);
    const limit = Math.min(isNaN(limitRaw) ? 100 : limitRaw, 500);
    const { kind, domain, status, correlationId, since } = req.query as Record<string, string | undefined>;

    let events = store.all();

    if (kind) events = events.filter((e) => e.kind === kind);
    else if (domain) events = events.filter((e) => e.kind.startsWith(`${domain}.`));

    if (status) events = events.filter((e) => e.status === status);
    if (correlationId) events = events.filter((e) => e.correlationId === correlationId);
    if (since) {
      const sinceDate = new Date(since);
      if (!isNaN(sinceDate.getTime())) {
        events = events.filter((e) => e.timestamp >= sinceDate);
      }
    }

    // Return newest first
    const page = events.slice(-limit).reverse();

    res.json({
      total: events.length,
      returned: page.length,
      storeCapacity: store.maxCapacity,
      storedCount: store.storedCount,
      events: page.map((e) => ({
        id: e.id,
        kind: e.kind,
        source: e.source,
        priority: e.priority,
        status: e.status,
        correlationId: e.correlationId ?? null,
        timestamp: e.timestamp.toISOString(),
        payload: e.payload,
      })),
    });
  } catch (err) {
    req.log.error({ err }, "os/events: list failed");
    res.status(500).json({ error: "Failed to list OS events" });
  }
});

/**
 * GET /api/mission-control/os/events/stats
 * Returns EventBus + EventStore statistics.
 * MUST be registered before /:eventId to avoid Express swallowing "stats" as a param.
 */
router.get("/mission-control/os/events/stats", async (req, res): Promise<void> => {
  try {
    const { getEventBus, getEventStore } = await import("../services/os/index.js");
    const bus = getEventBus();
    const store = getEventStore();

    const all = store.all();

    // Kind frequency map
    const kindCounts: Record<string, number> = {};
    const domainCounts: Record<string, number> = {};
    const statusCounts: Record<string, number> = { pending: 0, processed: 0, failed: 0 };
    const priorityCounts: Record<string, number> = { low: 0, normal: 0, high: 0, critical: 0 };

    for (const e of all) {
      kindCounts[e.kind] = (kindCounts[e.kind] ?? 0) + 1;
      const domain = e.kind.split(".")[0] ?? "unknown";
      domainCounts[domain] = (domainCounts[domain] ?? 0) + 1;
      statusCounts[e.status] = (statusCounts[e.status] ?? 0) + 1;
      priorityCounts[e.priority] = (priorityCounts[e.priority] ?? 0) + 1;
    }

    res.json({
      bus: {
        subscriptionCount: bus.subscriptionCount,
        totalEmitted: bus.emitCount,
      },
      store: {
        storedCount: store.storedCount,
        maxCapacity: store.maxCapacity,
        utilizationPercent: Math.round((store.storedCount / store.maxCapacity) * 100),
      },
      breakdown: {
        byDomain: domainCounts,
        byStatus: statusCounts,
        byPriority: priorityCounts,
        topKinds: Object.entries(kindCounts)
          .sort(([, a], [, b]) => b - a)
          .slice(0, 20)
          .map(([kind, count]) => ({ kind, count })),
      },
    });
  } catch (err) {
    req.log.error({ err }, "os/events/stats: failed");
    res.status(500).json({ error: "Failed to compute event stats" });
  }
});

/**
 * GET /api/mission-control/os/events/:eventId
 * Returns a single event by ID from the in-memory store.
 * NOTE: must be declared AFTER all static-path GET routes above.
 */
router.get("/mission-control/os/events/:eventId", async (req, res): Promise<void> => {
  try {
    const { getEventStore } = await import("../services/os/index.js");
    const event = getEventStore().get(String(req.params.eventId));
    if (!event) {
      res.status(404).json({ error: "Event not found in store" });
      return;
    }
    res.json({
      id: event.id,
      kind: event.kind,
      source: event.source,
      priority: event.priority,
      status: event.status,
      correlationId: event.correlationId ?? null,
      timestamp: event.timestamp.toISOString(),
      payload: event.payload,
    });
  } catch (err) {
    req.log.error({ err }, "os/events: get failed");
    res.status(500).json({ error: "Failed to get OS event" });
  }
});

/**
 * POST /api/mission-control/os/events/replay
 * Re-emits a selection of stored events through the EventBus.
 * Body: { correlationId?: string; kind?: string; since?: string; limit?: number }
 */
router.post("/mission-control/os/events/replay", async (req, res): Promise<void> => {
  try {
    const { getEventStore, getEventBus } = await import("../services/os/index.js");
    const store = getEventStore();
    const bus = getEventBus();

    const { correlationId, kind, since, limit = 50 } = req.body as {
      correlationId?: string;
      kind?: string;
      since?: string;
      limit?: number;
    };

    let events = store.all();
    if (correlationId) events = store.byCorrelationId(correlationId);
    else if (kind) events = store.byKind(kind as never, typeof limit === "number" ? limit : 50);
    else if (since) events = store.since(new Date(since), typeof limit === "number" ? limit : 50);
    else events = store.all(typeof limit === "number" ? limit : 50);

    const result = await store.replay(
      events,
      (k, payload, source, opts) => bus.emit(k as never, payload as never, source, opts),
      "os/replay-endpoint",
    );

    res.json({ replayed: result.replayed, failed: result.failed, total: events.length });
  } catch (err) {
    req.log.error({ err }, "os/events/replay: failed");
    res.status(500).json({ error: "Replay failed" });
  }
});

/**
 * POST /api/mission-control/os/events/sample
 * Emit synthetic sample events for one or all domains (demo / dev only).
 * Query: ?domain=github|replit|eas|stripe|missionControl|executives|objectives|agentZero|readyloq|vybeLive|all
 */
router.post("/mission-control/os/events/sample", async (req, res): Promise<void> => {
  try {
    const { emitSampleEvents, SAMPLE_DOMAINS } = await import("../services/os/index.js");
    const domainParam = String(req.query.domain ?? "all");
    const validDomains = ["all", ...Object.keys(SAMPLE_DOMAINS)];

    if (!validDomains.includes(domainParam)) {
      res.status(400).json({
        error: `Unknown domain '${domainParam}'. Valid: ${validDomains.join(", ")}`,
      });
      return;
    }

    const results = await emitSampleEvents(domainParam as "all");
    const totalEmitted = results.reduce((sum, r) => sum + r.emitted, 0);
    const errors = results.filter((r) => r.error !== null);

    req.log.info({ domain: domainParam, totalEmitted, domains: results.length }, "os/sample-events: emitted");

    res.json({
      domain: domainParam,
      totalEmitted,
      domainsProcessed: results.length,
      errors: errors.length,
      results,
    });
  } catch (err) {
    req.log.error({ err }, "os/events/sample: failed");
    res.status(500).json({ error: "Sample event emission failed" });
  }
});

// ─── Phase 3: Objective State Engine routes ───────────────────────────────────
// Base: /api/mission-control/os/state
//
// Route ordering: static paths must come BEFORE parameterised /:id paths.
//   /os/state                         GET   — list all objectives with rich state
//   /os/state/executive/:role         GET   — all objectives for an exec + system context
//   /os/state/context/:role           GET   — getSummaryText (prompt-injectable)
//   /os/state/:id                     GET   — single objective rich state
//   /os/state/:id/progress            PATCH
//   /os/state/:id/priority            PATCH
//   /os/state/:id/owner               PATCH
//   /os/state/:id/next-action         PATCH
//   /os/state/:id/retry               POST
//   /os/state/:id/execution-entry     POST
//   /os/state/:id/learning-entry      POST
//   /os/state/:id/dependency          POST
//   /os/state/:id/dependency/:depId   DELETE

/**
 * GET /api/mission-control/os/state
 * List all objectives with full rich state.
 * Query: ?status=planning|in_progress|needs_approval|completed|failed
 *        &ownerRole=<role>  &priority=low|medium|high|critical  &limit=<n>
 */
router.get("/mission-control/os/state", async (req, res): Promise<void> => {
  try {
    const { getObjectiveStateStore } = await import("../services/os/index.js");
    const store = getObjectiveStateStore();

    const status = req.query.status as string | undefined;
    const ownerRole = req.query.ownerRole as string | undefined;
    const priority = req.query.priority as string | undefined;
    const limit = Math.min(200, Math.max(1, Number(req.query.limit ?? 100)));

    const objectives = await store.getAll(
      {
        status: status as never,
        ownerRole,
        priority: priority as never,
      },
      limit,
    );

    res.json({ total: objectives.length, objectives });
  } catch (err) {
    req.log.error({ err }, "os/state: list failed");
    res.status(500).json({ error: "Failed to list objective states" });
  }
});

/**
 * GET /api/mission-control/os/state/executive/:role
 * Full operational context for an executive role — the Phase 3 replacement
 * for chat-history lookups. Returns all owned objectives + system state.
 */
router.get("/mission-control/os/state/executive/:role", async (req, res): Promise<void> => {
  try {
    const { getExecutiveStateReader } = await import("../services/os/index.js");
    const reader = getExecutiveStateReader();
    const role = String(req.params.role);

    const context = await reader.getContextForRole(role);
    res.json(context);
  } catch (err) {
    req.log.error({ err }, "os/state/executive: context fetch failed");
    res.status(500).json({ error: "Failed to get executive context" });
  }
});

/**
 * GET /api/mission-control/os/state/context/:role
 * Returns a plain-text summary of an executive's context, suitable for
 * injection into an LLM system prompt. Replaces chat-history summarisation.
 */
router.get("/mission-control/os/state/context/:role", async (req, res): Promise<void> => {
  try {
    const { getExecutiveStateReader } = await import("../services/os/index.js");
    const reader = getExecutiveStateReader();
    const role = String(req.params.role);

    const text = await reader.getSummaryText(role);
    res.type("text/plain").send(text);
  } catch (err) {
    req.log.error({ err }, "os/state/context: summary failed");
    res.status(500).json({ error: "Failed to get context summary" });
  }
});

/**
 * GET /api/mission-control/os/state/:id
 * Full rich state for a single objective.
 */
router.get("/mission-control/os/state/:id", async (req, res): Promise<void> => {
  try {
    const { getObjectiveStateStore } = await import("../services/os/index.js");
    const store = getObjectiveStateStore();
    const id = String(req.params.id);

    const objective = await store.get(id);
    if (!objective) {
      res.status(404).json({ error: "Objective not found" });
      return;
    }
    res.json(objective);
  } catch (err) {
    req.log.error({ err }, "os/state/:id: fetch failed");
    res.status(500).json({ error: "Failed to get objective state" });
  }
});

/**
 * PATCH /api/mission-control/os/state/:id/progress
 * Body: { progressPercent: number (0–100), source?: string }
 */
router.patch("/mission-control/os/state/:id/progress", async (req, res): Promise<void> => {
  try {
    const { getObjectiveStateStore } = await import("../services/os/index.js");
    const store = getObjectiveStateStore();
    const id = String(req.params.id);
    const { progressPercent, source = "api" } = req.body as {
      progressPercent: unknown;
      source?: string;
    };

    if (typeof progressPercent !== "number") {
      res.status(400).json({ error: "progressPercent must be a number" });
      return;
    }

    const ok = await store.updateProgress(id, progressPercent, source);
    if (!ok) {
      res.status(404).json({ error: "Objective not found or update failed" });
      return;
    }
    res.json({ ok: true, id, progressPercent: Math.max(0, Math.min(100, Math.round(progressPercent))) });
  } catch (err) {
    req.log.error({ err }, "os/state/:id/progress: update failed");
    res.status(500).json({ error: "Failed to update progress" });
  }
});

/**
 * PATCH /api/mission-control/os/state/:id/priority
 * Body: { priority: "low"|"medium"|"high"|"critical", source?: string }
 */
router.patch("/mission-control/os/state/:id/priority", async (req, res): Promise<void> => {
  try {
    const { getObjectiveStateStore } = await import("../services/os/index.js");
    const store = getObjectiveStateStore();
    const id = String(req.params.id);
    const { priority, source = "api" } = req.body as { priority: unknown; source?: string };

    const VALID_PRIORITIES = ["low", "medium", "high", "critical"];
    if (typeof priority !== "string" || !VALID_PRIORITIES.includes(priority)) {
      res.status(400).json({ error: `priority must be one of: ${VALID_PRIORITIES.join(", ")}` });
      return;
    }

    const ok = await store.updatePriority(id, priority as never, source);
    if (!ok) {
      res.status(404).json({ error: "Objective not found or update failed" });
      return;
    }
    res.json({ ok: true, id, priority });
  } catch (err) {
    req.log.error({ err }, "os/state/:id/priority: update failed");
    res.status(500).json({ error: "Failed to update priority" });
  }
});

/**
 * PATCH /api/mission-control/os/state/:id/owner
 * Body: { ownerRole: string, source?: string }
 */
router.patch("/mission-control/os/state/:id/owner", async (req, res): Promise<void> => {
  try {
    const { getObjectiveStateStore } = await import("../services/os/index.js");
    const store = getObjectiveStateStore();
    const id = String(req.params.id);
    const { ownerRole, source = "api" } = req.body as { ownerRole: unknown; source?: string };

    if (typeof ownerRole !== "string" || !ownerRole.trim()) {
      res.status(400).json({ error: "ownerRole must be a non-empty string" });
      return;
    }

    const ok = await store.updateOwner(id, ownerRole.trim(), source);
    if (!ok) {
      res.status(404).json({ error: "Objective not found or update failed" });
      return;
    }
    res.json({ ok: true, id, ownerRole: ownerRole.trim() });
  } catch (err) {
    req.log.error({ err }, "os/state/:id/owner: update failed");
    res.status(500).json({ error: "Failed to update owner" });
  }
});

/**
 * PATCH /api/mission-control/os/state/:id/next-action
 * Body: { action: NextActionDescriptor | null, source?: string }
 * Pass action: null to clear the current next-action recommendation.
 */
router.patch("/mission-control/os/state/:id/next-action", async (req, res): Promise<void> => {
  try {
    const { getObjectiveStateStore } = await import("../services/os/index.js");
    const store = getObjectiveStateStore();
    const id = String(req.params.id);
    const { action = null, source = "api" } = req.body as {
      action?: { kind: string; description: string; assignedTo?: string; requiredBy?: string; estimatedEffort?: string } | null;
      source?: string;
    };

    if (action !== null) {
      if (typeof action?.kind !== "string" || !action.kind.trim()) {
        res.status(400).json({ error: "action.kind must be a non-empty string" });
        return;
      }
      if (typeof action?.description !== "string" || !action.description.trim()) {
        res.status(400).json({ error: "action.description must be a non-empty string" });
        return;
      }
    }

    const ok = await store.setNextAction(id, action, source);
    if (!ok) {
      res.status(404).json({ error: "Objective not found or update failed" });
      return;
    }
    res.json({ ok: true, id, action });
  } catch (err) {
    req.log.error({ err }, "os/state/:id/next-action: update failed");
    res.status(500).json({ error: "Failed to update next action" });
  }
});

/**
 * POST /api/mission-control/os/state/:id/retry
 * Increment the retry counter. No body required.
 * Query: ?source=<string>
 */
router.post("/mission-control/os/state/:id/retry", async (req, res): Promise<void> => {
  try {
    const { getObjectiveStateStore } = await import("../services/os/index.js");
    const store = getObjectiveStateStore();
    const id = String(req.params.id);
    const source = String(req.query.source ?? req.body?.source ?? "api");

    const ok = await store.incrementRetryCount(id, source);
    if (!ok) {
      res.status(404).json({ error: "Objective not found or update failed" });
      return;
    }

    const updated = await store.get(id);
    res.json({ ok: true, id, retryCount: updated?.retryCount ?? null });
  } catch (err) {
    req.log.error({ err }, "os/state/:id/retry: failed");
    res.status(500).json({ error: "Failed to increment retry count" });
  }
});

/**
 * POST /api/mission-control/os/state/:id/execution-entry
 * Append one entry to the objective's execution history.
 * Body: { action, source, outcome, durationMs?, detail? }
 */
router.post("/mission-control/os/state/:id/execution-entry", async (req, res): Promise<void> => {
  try {
    const { getObjectiveStateStore } = await import("../services/os/index.js");
    const store = getObjectiveStateStore();
    const id = String(req.params.id);
    const { action, source = "api", outcome, durationMs, detail } = req.body as {
      action: unknown;
      source?: string;
      outcome: unknown;
      durationMs?: number;
      detail?: string;
    };

    const VALID_OUTCOMES = ["success", "failed", "skipped", "in_progress"];
    if (typeof action !== "string" || !action.trim()) {
      res.status(400).json({ error: "action must be a non-empty string" });
      return;
    }
    if (typeof outcome !== "string" || !VALID_OUTCOMES.includes(outcome)) {
      res.status(400).json({ error: `outcome must be one of: ${VALID_OUTCOMES.join(", ")}` });
      return;
    }

    const entry = await store.appendExecutionEntry(id, {
      action: action.trim(),
      source,
      outcome: outcome as never,
      durationMs,
      detail,
    });

    if (!entry) {
      res.status(404).json({ error: "Objective not found or append failed" });
      return;
    }
    res.status(201).json({ ok: true, entry });
  } catch (err) {
    req.log.error({ err }, "os/state/:id/execution-entry: failed");
    res.status(500).json({ error: "Failed to append execution entry" });
  }
});

/**
 * POST /api/mission-control/os/state/:id/learning-entry
 * Append one insight to the objective's learning history.
 * Body: { topic, insight, confidence (0–100), source }
 */
router.post("/mission-control/os/state/:id/learning-entry", async (req, res): Promise<void> => {
  try {
    const { getObjectiveStateStore } = await import("../services/os/index.js");
    const store = getObjectiveStateStore();
    const id = String(req.params.id);
    const { topic, insight, confidence, source = "api" } = req.body as {
      topic: unknown;
      insight: unknown;
      confidence: unknown;
      source?: string;
    };

    if (typeof topic !== "string" || !topic.trim()) {
      res.status(400).json({ error: "topic must be a non-empty string" });
      return;
    }
    if (typeof insight !== "string" || !insight.trim()) {
      res.status(400).json({ error: "insight must be a non-empty string" });
      return;
    }
    if (typeof confidence !== "number" || confidence < 0 || confidence > 100) {
      res.status(400).json({ error: "confidence must be a number between 0 and 100" });
      return;
    }

    const entry = await store.appendLearningEntry(id, {
      topic: topic.trim(),
      insight: insight.trim(),
      confidence,
      source,
    });

    if (!entry) {
      res.status(404).json({ error: "Objective not found or append failed" });
      return;
    }
    res.status(201).json({ ok: true, entry });
  } catch (err) {
    req.log.error({ err }, "os/state/:id/learning-entry: failed");
    res.status(500).json({ error: "Failed to append learning entry" });
  }
});

/**
 * POST /api/mission-control/os/state/:id/dependency
 * Add a dependency (another objective ID) to this objective.
 * Body: { dependencyId: string, source?: string }
 */
router.post("/mission-control/os/state/:id/dependency", async (req, res): Promise<void> => {
  try {
    const { getObjectiveStateStore } = await import("../services/os/index.js");
    const store = getObjectiveStateStore();
    const id = String(req.params.id);
    const { dependencyId, source = "api" } = req.body as {
      dependencyId: unknown;
      source?: string;
    };

    if (typeof dependencyId !== "string" || !dependencyId.trim()) {
      res.status(400).json({ error: "dependencyId must be a non-empty string" });
      return;
    }
    if (dependencyId.trim() === id) {
      res.status(400).json({ error: "An objective cannot depend on itself" });
      return;
    }

    const ok = await store.addDependency(id, dependencyId.trim(), source);
    if (!ok) {
      res.status(404).json({ error: "Objective not found or update failed" });
      return;
    }
    res.json({ ok: true, id, dependencyId: dependencyId.trim() });
  } catch (err) {
    req.log.error({ err }, "os/state/:id/dependency: failed");
    res.status(500).json({ error: "Failed to add dependency" });
  }
});

/**
 * DELETE /api/mission-control/os/state/:id/dependency/:depId
 * Remove a dependency from this objective. Idempotent.
 */
router.delete("/mission-control/os/state/:id/dependency/:depId", async (req, res): Promise<void> => {
  try {
    const { getObjectiveStateStore } = await import("../services/os/index.js");
    const store = getObjectiveStateStore();
    const id = String(req.params.id);
    const depId = String(req.params.depId);
    const source = String(req.query.source ?? "api");

    const ok = await store.removeDependency(id, depId, source);
    if (!ok) {
      res.status(404).json({ error: "Objective not found or update failed" });
      return;
    }
    res.json({ ok: true, id, removedDependencyId: depId });
  } catch (err) {
    req.log.error({ err }, "os/state/:id/dependency/:depId: failed");
    res.status(500).json({ error: "Failed to remove dependency" });
  }
});

// ─── Quinn Chief of Staff routes (Phase 4) ────────────────────────────────────
// Quinn coordinates the executive team: she prioritizes, assigns, monitors
// blocked work, escalates, and manages workload. She never writes code, never
// deploys, and only performs coordination actions.
//
// All four routes are unauthenticated by MC-router convention (no auth middleware).

/**
 * GET /api/mission-control/quinn/cos/status
 * Returns the runtime CoS status (last cycle, decision count, blocked count).
 * Zero I/O — reads from in-memory singleton state.
 */
router.get("/mission-control/quinn/cos/status", async (_req, res): Promise<void> => {
  const { getQuinnChiefOfStaff } = await import("../services/os/index.js");
  res.json(getQuinnChiefOfStaff().status);
});

/**
 * GET /api/mission-control/quinn/cos/workload
 * Returns per-executive objective workload breakdown.
 * Read-only — no mutations.
 */
router.get("/mission-control/quinn/cos/workload", async (req, res): Promise<void> => {
  try {
    const { getQuinnChiefOfStaff } = await import("../services/os/index.js");
    const workload = await getQuinnChiefOfStaff().assessWorkload();
    res.json({ ok: true, workload });
  } catch (err) {
    req.log.error({ err }, "quinn/cos/workload: failed");
    res.status(500).json({ ok: false, error: "Failed to assess workload" });
  }
});

/**
 * GET /api/mission-control/quinn/cos/blocked
 * Returns objectives flagged as blocked (no_owner, unmet_dependency, stalled_progress).
 * Read-only — no mutations.
 */
router.get("/mission-control/quinn/cos/blocked", async (req, res): Promise<void> => {
  try {
    const { getQuinnChiefOfStaff } = await import("../services/os/index.js");
    const blocked = await getQuinnChiefOfStaff().findBlockedObjectives();
    res.json({ ok: true, blocked, count: blocked.length });
  } catch (err) {
    req.log.error({ err }, "quinn/cos/blocked: failed");
    res.status(500).json({ ok: false, error: "Failed to find blocked objectives" });
  }
});

/**
 * POST /api/mission-control/quinn/cos/cycle
 * Triggers a full Chief of Staff coordination cycle:
 *   prioritize → assign → monitor → escalate → balance workload
 * Returns the full CoSCycleResult including decisions, workload, and blocked list.
 */
router.post("/mission-control/quinn/cos/cycle", async (req, res): Promise<void> => {
  try {
    const { getQuinnChiefOfStaff } = await import("../services/os/index.js");
    const result = await getQuinnChiefOfStaff().runCycle();
    res.json({ ok: true, result });
  } catch (err) {
    req.log.error({ err }, "quinn/cos/cycle: failed");
    res.status(500).json({ ok: false, error: "CoS cycle failed" });
  }
});

export default router;

