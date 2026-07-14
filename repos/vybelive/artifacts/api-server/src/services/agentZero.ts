// ── Agent Zero — Mission Control's autonomous execution engine ───────────────
//
// Agent Zero is NOT an executive, NOT a planner, and makes NO strategy. It sits
// beneath Quinn and executes assigned work: long-running, multi-step,
// checkpointed jobs that reuse the existing Specialist Bench, executive
// capabilities, engineering/portfolio intelligence, and the marketing learning
// engine. Quinn decides WHAT happens; Agent Zero decides HOW to complete it.
//
// Autonomy contract:
//   • May execute autonomously: read-only operations, analysis, testing,
//     diagnostics, code review, documentation, research, monitoring.
//   • May NEVER execute autonomously: production deploys, app publishing,
//     spending money, deleting production data, legal communications, or
//     company-strategy changes. Those park the job in `waiting_approval` with
//     an agent_approvals row for the Founder (via Quinn).
//
// Recovery contract: retry with bounded attempts → classify root cause →
// consult the appropriate specialist → report findings to Quinn → escalate.
// Never loop forever.

import { randomUUID } from "node:crypto";
import os from "node:os";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  agentZeroJobsTable,
  agentZeroStepsTable,
  agentApprovalsTable,
  agentReportsTable,
  aiExecutivesTable,
  specialistRunsTable,
  agentObjectivesTable,
  type AgentZeroJobRow,
  type AgentZeroStepRow,
  type ReportFinding,
  type ObjectiveExecutionEntry,
} from "@workspace/db";
import { logger } from "../lib/logger";
import { SPECIALISTS, consultSpecialist } from "./specialistRegistry";
import { runCapability, ROLES_WITH_CAPABILITY } from "./executiveCapabilities/index";
import {
  collectSnapshot,
  computeLaunchReadiness,
  getFlagshipProduct,
} from "./engineering/engineeringIntelligence";
import { getPortfolioHealth } from "./portfolioMonitor";
import { getMarketingIntelligence } from "./marketingLearning";
import { recordEvent } from "./organizationMemory";

// ── Constants ─────────────────────────────────────────────────────────────────

const TICK_MS = 10_000;
const MAX_PARALLEL_JOBS = 2;
export const DEFAULT_MAX_ATTEMPTS = 3;

export type AgentZeroCommand =
  | "execute_objective"
  | "investigate_engineering_failure"
  | "prepare_release"
  | "run_specialist_review"
  | "monitor_deployment"
  | "execute_marketing_campaign"
  | "research_brand_partnerships"
  | "audit_database"
  | "generate_release_report"
  | "workspace_op"
  | "custom";

type StepPlan = {
  title: string;
  kind: AgentZeroStepRow["kind"];
  specialistId?: string;
  executiveRole?: string;
};

// Actions Agent Zero must NEVER take autonomously. Detection on the incoming
// instruction parks the job for founder approval before a single step runs.
// (Kept local — the wording intentionally differs from Quinn's conversational
// 5-bucket gate: this is the execution-layer hard line.)
const FORBIDDEN_AUTONOMOUS: ReadonlyArray<[RegExp, string]> = [
  [/\b(?:deploy|go live|push to production|ship to prod|release to production)\b/i, "production deploy"],
  [/\b(?:publish (?:the )?app|submit to (?:the )?(?:app store|google play|play store)|app store release)\b/i, "app publishing"],
  [/\b(?:spend|purchase|buy|payment|pay for|charge|refund|invoice|billing budget)\b/i, "spending money"],
  [/\b(?:delete|purge|wipe|drop table|destroy|erase)\b.*\b(?:prod|production|live|database|data)\b/i, "production data deletion"],
  [/\b(?:legal|cease and desist|terms of service change|privacy policy change|contract)\b/i, "legal communication"],
  [/\b(?:change (?:the )?(?:company )?strategy|pivot the company|reprioritize the company)\b/i, "strategy change"],
];

export function detectForbiddenAction(text: string): string | null {
  for (const [pattern, label] of FORBIDDEN_AUTONOMOUS) {
    if (pattern.test(text)) return label;
  }
  return null;
}

// Deterministic root-cause buckets used when a job exhausts its retries.
const ROOT_CAUSE_BUCKETS: ReadonlyArray<[RegExp, string, string]> = [
  [/\b(?:429|quota|rate limit)\b/i, "ai_quota_exhausted", "debugger"],
  [/\b(?:timeout|timed out|ETIMEDOUT|ECONNRESET|ECONNREFUSED|fetch failed|network)\b/i, "network_failure", "devops-engineer"],
  [/\b(?:relation|column|constraint|syntax error|database|drizzle)\b/i, "database_error", "database-architect"],
  [/\b(?:permission|unauthorized|forbidden|401|403)\b/i, "authorization_error", "devops-engineer"],
  [/\b(?:undefined|null|TypeError|not a function|cannot read)\b/i, "logic_error", "debugger"],
];

function classifyRootCause(error: string): { rootCause: string; specialistId: string } {
  for (const [pattern, bucket, specialistId] of ROOT_CAUSE_BUCKETS) {
    if (pattern.test(error)) return { rootCause: bucket, specialistId };
  }
  return { rootCause: "unknown_failure", specialistId: "debugger" };
}

// ── Command catalog: deterministic step planners ──────────────────────────────
// Every plan reuses existing Mission Control systems — no duplicated logic.

export const COMMAND_CATALOG: Record<AgentZeroCommand, { label: string; describe: string }> = {
  execute_objective: { label: "Execute Objective", describe: "Decompose and drive an objective's execution workstreams" },
  investigate_engineering_failure: { label: "Investigate Engineering Failure", describe: "Root-cause an engineering failure with the debugger bench" },
  prepare_release: { label: "Prepare Release", describe: "Run release readiness across engineering, QA and DevOps" },
  run_specialist_review: { label: "Run Specialist Review", describe: "Run a focused specialist review on demand" },
  monitor_deployment: { label: "Monitor Deployment", describe: "Watch portfolio + engineering health and report anomalies" },
  execute_marketing_campaign: { label: "Execute Marketing Campaign", describe: "Prepare campaign analysis via the marketing learning engine" },
  research_brand_partnerships: { label: "Research Brand Partnerships", describe: "Research partnership opportunities for the brand" },
  audit_database: { label: "Audit Database", describe: "Read-only database audit with the database architect" },
  generate_release_report: { label: "Generate Release Report", describe: "Compile a release status report" },
  workspace_op: { label: "Workspace Operation", describe: "Execute a Replit workspace operation (read/write files, run tests, deploy preview)" },
  custom: { label: "Custom Execution", describe: "Free-form execution instruction from Quinn" },
};

function planSteps(commandType: AgentZeroCommand, instruction: string): StepPlan[] {
  switch (commandType) {
    case "execute_objective":
      return [
        { title: "Decompose the objective into execution workstreams", kind: "specialist", specialistId: "task-decomposition-expert" },
        { title: "Collect engineering snapshot for grounding", kind: "engineering_snapshot" },
        { title: "Synthesize workstream execution findings", kind: "analysis" },
        { title: "Report results to Quinn", kind: "report" },
      ];
    case "investigate_engineering_failure":
      return [
        { title: "Collect engineering snapshot", kind: "engineering_snapshot" },
        { title: "Debugger root-cause analysis", kind: "specialist", specialistId: "debugger" },
        { title: "Architect review of the failure surface", kind: "specialist", specialistId: "architect-review" },
        { title: "Report findings to Quinn", kind: "report" },
      ];
    case "prepare_release":
      return [
        { title: "Collect engineering snapshot + launch readiness", kind: "engineering_snapshot" },
        { title: "Release Manager readiness inspection", kind: "capability", executiveRole: "release_manager" },
        { title: "QA Director quality inspection", kind: "capability", executiveRole: "qa_director" },
        { title: "DevOps release pipeline review", kind: "specialist", specialistId: "devops-engineer" },
        { title: "Report release readiness to Quinn", kind: "report" },
      ];
    case "run_specialist_review":
      return [
        { title: "Run the requested specialist review", kind: "specialist", specialistId: pickSpecialistFor(instruction) },
        { title: "Report review to Quinn", kind: "report" },
      ];
    case "monitor_deployment":
      return [
        { title: "Portfolio health check", kind: "portfolio_health" },
        { title: "Engineering snapshot + readiness", kind: "engineering_snapshot" },
        { title: "Runtime diagnostics", kind: "diagnostics" },
        { title: "Report monitoring status to Quinn", kind: "report" },
      ];
    case "execute_marketing_campaign":
      return [
        { title: "Marketing intelligence snapshot", kind: "marketing_intelligence" },
        { title: "Marketing Director inspection", kind: "capability", executiveRole: "marketing_director" },
        { title: "Content creator campaign guidance", kind: "specialist", specialistId: "content-creator" },
        { title: "Report campaign plan to Quinn", kind: "report" },
      ];
    case "research_brand_partnerships":
      return [
        { title: "Marketing intelligence snapshot", kind: "marketing_intelligence" },
        { title: "Launch strategy partnership research", kind: "specialist", specialistId: "launch-strategy" },
        { title: "Synthesize partnership research", kind: "analysis" },
        { title: "Report research to Quinn", kind: "report" },
      ];
    case "audit_database":
      return [
        { title: "Read-only database introspection", kind: "diagnostics" },
        { title: "Database Architect audit", kind: "specialist", specialistId: "database-architect" },
        { title: "Report audit to Quinn", kind: "report" },
      ];
    case "generate_release_report":
      return [
        { title: "Collect engineering snapshot + readiness", kind: "engineering_snapshot" },
        { title: "Release Manager status inspection", kind: "capability", executiveRole: "release_manager" },
        { title: "Report release status to Quinn", kind: "report" },
      ];
    case "workspace_op": {
      const parsed = (() => {
        try { return JSON.parse(instruction); } catch { return {}; }
      })() as Record<string, unknown>;
      const op = typeof parsed.op === "string" ? parsed.op : "stream_logs";
      const stepKind = ("replit_" + op) as AgentZeroStepRow["kind"];
      return [
        { title: `Replit workspace: ${op}`, kind: stepKind },
        { title: "Report workspace operation result to Quinn", kind: "report" },
      ];
    }
    case "custom":
    default:
      return [
        { title: "Analyze the instruction against workspace intelligence", kind: "analysis" },
        { title: "Report results to Quinn", kind: "report" },
      ];
  }
}

// ── Objective execution entry ─────────────────────────────────────────────────

async function appendObjectiveExecutionEntry(
  objectiveId: string | null,
  entry: Omit<ObjectiveExecutionEntry, "id" | "timestamp">,
): Promise<void> {
  if (!objectiveId) return;
  const full: ObjectiveExecutionEntry = {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    ...entry,
  };
  await db
    .update(agentObjectivesTable)
    .set({
      executionHistory: sql`COALESCE(${agentObjectivesTable.executionHistory}, '[]'::jsonb) || ${JSON.stringify([full])}::jsonb`,
      updatedAt: new Date(),
    })
    .where(eq(agentObjectivesTable.id, objectiveId))
    .catch((err: unknown) => logger.warn({ err, objectiveId }, "agentZero: appendObjectiveExecutionEntry failed"));
}

/** Pick the best-matching bench specialist for a free-form review request
 *  using the registry's own deterministic trigger keywords. */
function pickSpecialistFor(instruction: string): string {
  const lower = instruction.toLowerCase();
  for (const spec of SPECIALISTS) {
    if (spec.triggers.some((t) => lower.includes(t.toLowerCase()))) return spec.id;
  }
  return "architect-review";
}

// ── Quinn lookup ──────────────────────────────────────────────────────────────

async function getQuinn(): Promise<{ id: string; name: string; role: string } | null> {
  const [quinn] = await db
    .select({ id: aiExecutivesTable.id, name: aiExecutivesTable.name, role: aiExecutivesTable.role })
    .from(aiExecutivesTable)
    .where(eq(aiExecutivesTable.role, "chief_of_staff"))
    .limit(1);
  return quinn ?? null;
}

// ── Job creation (Quinn's only entry point) ───────────────────────────────────

export async function createAgentZeroJob(input: {
  commandType: AgentZeroCommand;
  instruction: string;
  title?: string;
  objectiveId?: string | null;
  priority?: number;
}): Promise<AgentZeroJobRow> {
  const quinn = await getQuinn();
  const jobId = randomUUID();
  const catalog = COMMAND_CATALOG[input.commandType] ?? COMMAND_CATALOG.custom;
  const title = input.title?.trim() || `${catalog.label}: ${input.instruction.slice(0, 120)}`;
  const forbidden = detectForbiddenAction(input.instruction);

  let approvalId: string | null = null;
  if (forbidden && quinn) {
    approvalId = randomUUID();
    await db.insert(agentApprovalsTable).values({
      id: approvalId,
      objectiveId: input.objectiveId ?? null,
      executiveId: quinn.id,
      title: `Agent Zero needs approval: ${catalog.label}`,
      detail:
        `The instruction "${input.instruction.slice(0, 300)}" involves a protected action (${forbidden}). ` +
        `Agent Zero never executes this autonomously — founder sign-off is required before the job starts.`,
      impact: "high",
      status: "pending",
    });
  }

  const steps = planSteps(input.commandType, input.instruction);
  const [job] = await db
    .insert(agentZeroJobsTable)
    .values({
      id: jobId,
      commandType: input.commandType,
      title,
      instruction: input.instruction,
      objectiveId: input.objectiveId ?? null,
      requestedBy: quinn?.id ?? null,
      status: approvalId ? "waiting_approval" : "queued",
      priority: input.priority ?? 5,
      maxAttempts: DEFAULT_MAX_ATTEMPTS,
      approvalId,
    })
    .returning();

  await db.insert(agentZeroStepsTable).values(
    steps.map((s, i) => ({
      id: randomUUID(),
      jobId,
      seq: i,
      title: s.title,
      kind: s.kind,
      specialistId: s.specialistId ?? "",
      executiveRole: s.executiveRole ?? "",
    })),
  );

  await recordEvent({
    type: "milestone",
    title: approvalId
      ? `Agent Zero job parked for approval: ${title.slice(0, 120)}`
      : `Quinn dispatched Agent Zero: ${title.slice(0, 120)}`,
    summary: approvalId
      ? `Protected action detected (${forbidden}) — waiting on founder approval.`
      : catalog.describe,
    actorExecutiveId: quinn?.id ?? null,
    refType: "agent_zero_job",
    refId: jobId,
    importance: approvalId ? "high" : "normal",
    keywords: ["agent-zero", input.commandType],
  });

  return job!;
}

// ── Job controls: pause / resume / retry / cancel ─────────────────────────────

// Every transition below is a conditional UPDATE (CAS) gated on the set of
// statuses the action is valid from — a job that reached a terminal state
// between our read and write can never be overwritten. Lease invalidation on
// resume/retry/cancel guarantees a stale in-flight runner aborts at its next
// lease check and can never write to the re-claimed job.
export async function controlJob(
  jobId: string,
  action: "pause" | "resume" | "retry" | "cancel",
): Promise<AgentZeroJobRow | null> {
  const [job] = await db.select().from(agentZeroJobsTable).where(eq(agentZeroJobsTable.id, jobId)).limit(1);
  if (!job) return null;

  if (action === "pause") {
    await db
      .update(agentZeroJobsTable)
      .set({ status: "paused", pausedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(agentZeroJobsTable.id, jobId), inArray(agentZeroJobsTable.status, ["queued", "running"])));
  } else if (action === "resume" && (job.status === "paused" || job.status === "waiting_approval")) {
    // Founder resuming a waiting_approval job counts as explicit sign-off only
    // when the linked approval was approved; otherwise resume is refused.
    if (job.status === "waiting_approval" && job.approvalId) {
      const [approval] = await db
        .select({ status: agentApprovalsTable.status })
        .from(agentApprovalsTable)
        .where(eq(agentApprovalsTable.id, job.approvalId))
        .limit(1);
      if (!approval || approval.status !== "approved") return job;
    }
    await db
      .update(agentZeroJobsTable)
      .set({ status: "queued", pausedAt: null, leaseToken: null, updatedAt: new Date() })
      .where(
        and(eq(agentZeroJobsTable.id, jobId), inArray(agentZeroJobsTable.status, ["paused", "waiting_approval"])),
      );
  } else if (action === "retry") {
    // Flip the job first (CAS from a terminal state) so a stale runner can
    // never interleave with the step reset below.
    const flipped = await db
      .update(agentZeroJobsTable)
      .set({
        status: "queued",
        attempts: 0,
        lastError: "",
        rootCause: "",
        finishedAt: null,
        leaseToken: null,
        updatedAt: new Date(),
      })
      .where(and(eq(agentZeroJobsTable.id, jobId), inArray(agentZeroJobsTable.status, ["failed", "cancelled"])))
      .returning({ id: agentZeroJobsTable.id });
    if (flipped.length > 0) {
      await db
        .update(agentZeroStepsTable)
        .set({ status: "pending", summary: "", startedAt: null, finishedAt: null })
        .where(and(eq(agentZeroStepsTable.jobId, jobId), inArray(agentZeroStepsTable.status, ["failed", "running"])));
    }
  } else if (action === "cancel") {
    await db
      .update(agentZeroJobsTable)
      .set({ status: "cancelled", finishedAt: new Date(), leaseToken: null, updatedAt: new Date() })
      .where(
        and(
          eq(agentZeroJobsTable.id, jobId),
          inArray(agentZeroJobsTable.status, ["queued", "running", "paused", "waiting_approval"]),
        ),
      );
  }

  const [updated] = await db.select().from(agentZeroJobsTable).where(eq(agentZeroJobsTable.id, jobId)).limit(1);
  return updated ?? null;
}

// ── Step executors — each one reuses an existing Mission Control system ───────

type StepResult = { summary: string; output: Record<string, unknown> };

async function executeStep(
  job: AgentZeroJobRow,
  step: AgentZeroStepRow,
  priorSummaries: string[],
): Promise<StepResult> {
  const contextDigest =
    `Agent Zero job "${job.title}" (command: ${job.commandType}).\n` +
    `Instruction from Quinn: ${job.instruction}\n` +
    (priorSummaries.length ? `Prior step findings:\n${priorSummaries.map((s, i) => `${i + 1}. ${s}`).join("\n")}` : "");

  switch (step.kind) {
    case "specialist": {
      const spec = SPECIALISTS.find((s) => s.id === step.specialistId);
      if (!spec) throw new Error(`Specialist not registered: ${step.specialistId}`);
      const quinn = await getQuinn();
      if (!quinn) throw new Error("Chief of Staff executive not found");
      const consultation = await consultSpecialist({
        specialist: spec,
        focus: `${step.title} — ${job.instruction.slice(0, 400)}`,
        contextDigest,
        executive: quinn,
        objectiveId: job.objectiveId ?? undefined,
      });
      if (!consultation) throw new Error(`Specialist run failed: ${spec.id}`);
      return {
        summary: `${consultation.specialistName} (confidence ${consultation.confidence}): ${consultation.summary}`,
        output: {
          specialistId: consultation.specialistId,
          confidence: consultation.confidence,
          findings: consultation.findings,
          recommendations: consultation.recommendations,
        },
      };
    }
    case "capability": {
      const role = step.executiveRole;
      if (!ROLES_WITH_CAPABILITY.includes(role as (typeof ROLES_WITH_CAPABILITY)[number])) {
        throw new Error(`No capability for role: ${role}`);
      }
      const report = await runCapability(role);
      return {
        summary: `${role} capability (${report.status}): ${report.headline} — ${report.summary.slice(0, 300)}`,
        output: { status: report.status, headline: report.headline, metrics: report.metrics, findings: report.findings },
      };
    }
    case "engineering_snapshot": {
      const product = await getFlagshipProduct();
      const snapshot = await collectSnapshot(product);
      const readiness = computeLaunchReadiness(snapshot);
      const watchFactors = readiness.factors
        .filter((f) => f.state === "at_risk" || f.state === "watch")
        .map((f) => f.label)
        .slice(0, 4);
      return {
        summary:
          `Engineering snapshot for ${product.name}: launch readiness ${readiness.score}/100 (${readiness.state}).` +
          (watchFactors.length ? ` Watch: ${watchFactors.join(", ")}.` : ""),
        output: { readiness: readiness as unknown as Record<string, unknown> },
      };
    }
    case "portfolio_health": {
      const health = await getPortfolioHealth();
      const assetLine = health.assets
        .map((a) => `${(a as { name?: string; slug?: string }).name ?? (a as { slug?: string }).slug ?? "asset"}: ${(a as { status?: string }).status ?? "unknown"}`)
        .slice(0, 6)
        .join(", ");
      return {
        summary: `Portfolio health across ${health.assets.length} assets — ${assetLine || "no active assets"}.`,
        output: { health: health as unknown as Record<string, unknown> },
      };
    }
    case "marketing_intelligence": {
      const intel = await getMarketingIntelligence();
      return {
        summary:
          `Marketing intelligence: ${intel.postsDrafted} drafted, ${intel.postsApproved} approved, ` +
          `accuracy ${intel.approvalAccuracy}%, autonomy mode ${intel.autonomy.mode}.`,
        output: { intelligence: intel as unknown as Record<string, unknown> },
      };
    }
    case "diagnostics": {
      if (job.commandType === "audit_database") {
        const tables = await db.execute(sql`
          SELECT relname AS table_name, n_live_tup AS live_rows, n_dead_tup AS dead_rows
          FROM pg_stat_user_tables ORDER BY n_live_tup DESC LIMIT 25`);
        const rows = tables.rows as Array<Record<string, unknown>>;
        const totalDead = rows.reduce((acc, r) => acc + Number(r.dead_rows ?? 0), 0);
        return {
          summary: `Database introspection (read-only): ${rows.length} busiest tables inspected, ${totalDead} total dead rows across them. Top: ${rows
            .slice(0, 5)
            .map((r) => `${r.table_name}(${r.live_rows})`)
            .join(", ")}.`,
          output: { tables: rows },
        };
      }
      const started = Date.now();
      await db.execute(sql`SELECT 1`);
      const dbLatencyMs = Date.now() - started;
      const load = os.loadavg()[0] ?? 0;
      const heapMb = Math.round(process.memoryUsage().heapUsed / 1024 / 1024);
      return {
        summary: `Runtime diagnostics: DB round-trip ${dbLatencyMs}ms, load ${load.toFixed(2)}, heap ${heapMb}MB.`,
        output: { dbLatencyMs, load, heapMb },
      };
    }
    case "analysis": {
      const summary = priorSummaries.length
        ? `Synthesis of ${priorSummaries.length} workstream findings: ${priorSummaries.join(" | ").slice(0, 900)}`
        : `Instruction analyzed: "${job.instruction.slice(0, 300)}". No prior workstream data — recorded as research note for Quinn.`;
      return { summary, output: { priorFindings: priorSummaries } };
    }
    case "report": {
      const quinn = await getQuinn();
      const body = priorSummaries.length
        ? priorSummaries.map((s, i) => `${i + 1}. ${s}`).join("\n")
        : "No step output was produced.";
      if (quinn) {
        await db.insert(agentReportsTable).values({
          id: randomUUID(),
          executiveId: quinn.id,
          objectiveId: job.objectiveId ?? null,
          status: "healthy",
          headline: `Agent Zero completed: ${job.title.slice(0, 140)}`,
          summary: body.slice(0, 3000),
          metrics: [],
          findings: [],
        });
      }
      return { summary: `Results reported to Quinn (${priorSummaries.length} findings).`, output: { reported: true } };
    }
    default:
      throw new Error(`Unknown step kind: ${String(step.kind)}`);
  }
}

// ── The worker ────────────────────────────────────────────────────────────────

let workerTimer: NodeJS.Timeout | null = null;
let lastTickAt: Date | null = null;
let tickInFlight = false;
const runningJobs = new Set<string>();

export function getWorkerHealth(): { healthy: boolean; lastTickAt: string | null; runningJobs: number } {
  const healthy = lastTickAt !== null && Date.now() - lastTickAt.getTime() < TICK_MS * 4;
  return { healthy, lastTickAt: lastTickAt?.toISOString() ?? null, runningJobs: runningJobs.size };
}

export function startAgentZeroWorker(): void {
  if (workerTimer) return;
  workerTimer = setInterval(() => {
    void tick();
  }, TICK_MS);
  workerTimer.unref();
  logger.info({ tickMs: TICK_MS, maxParallel: MAX_PARALLEL_JOBS }, "Agent Zero worker started");
  void tick();
}

async function tick(): Promise<void> {
  if (tickInFlight) return;
  tickInFlight = true;
  lastTickAt = new Date();
  try {
    await releaseApprovedJobs();
    await recoverStaleRunningJobs();
    await claimAndRun();
  } catch (err) {
    logger.warn({ err }, "Agent Zero tick failed");
  } finally {
    tickInFlight = false;
  }
}

/** waiting_approval jobs whose approval was decided: approved → queued, rejected → cancelled. */
async function releaseApprovedJobs(): Promise<void> {
  const waiting = await db
    .select()
    .from(agentZeroJobsTable)
    .where(eq(agentZeroJobsTable.status, "waiting_approval"));
  for (const job of waiting) {
    if (!job.approvalId) continue;
    const [approval] = await db
      .select({ status: agentApprovalsTable.status })
      .from(agentApprovalsTable)
      .where(eq(agentApprovalsTable.id, job.approvalId))
      .limit(1);
    if (!approval) continue;
    if (approval.status === "approved") {
      await db
        .update(agentZeroJobsTable)
        .set({ status: "queued", updatedAt: new Date() })
        .where(and(eq(agentZeroJobsTable.id, job.id), eq(agentZeroJobsTable.status, "waiting_approval")));
    } else if (approval.status === "rejected") {
      await db
        .update(agentZeroJobsTable)
        .set({
          status: "cancelled",
          finishedAt: new Date(),
          resultSummary: "Founder rejected the protected action — job cancelled.",
          updatedAt: new Date(),
        })
        .where(and(eq(agentZeroJobsTable.id, job.id), eq(agentZeroJobsTable.status, "waiting_approval")));
    }
  }
}

// Jobs stuck in "running" with no live runner (process crash, unhandled error)
// would otherwise wedge forever. A running job whose row hasn't been touched
// for STALE_RUNNING_MS and which no in-process runner owns is re-queued —
// checkpointed steps mean the re-claim resumes where it left off.
const STALE_RUNNING_MS = 10 * 60 * 1000;

async function recoverStaleRunningJobs(): Promise<void> {
  const cutoff = new Date(Date.now() - STALE_RUNNING_MS);
  const stale = await db
    .select({ id: agentZeroJobsTable.id, updatedAt: agentZeroJobsTable.updatedAt })
    .from(agentZeroJobsTable)
    .where(eq(agentZeroJobsTable.status, "running"));
  for (const row of stale) {
    if (runningJobs.has(row.id)) continue; // a live runner in this process owns it
    if (row.updatedAt > cutoff) continue;
    const requeued = await db
      .update(agentZeroJobsTable)
      .set({ status: "queued", leaseToken: null, currentStep: "", updatedAt: new Date() })
      .where(and(eq(agentZeroJobsTable.id, row.id), eq(agentZeroJobsTable.status, "running")))
      .returning({ id: agentZeroJobsTable.id });
    if (requeued.length > 0) {
      logger.warn({ jobId: row.id }, "Agent Zero recovered a stale running job (re-queued from checkpoint)");
    }
  }
}

async function claimAndRun(): Promise<void> {
  while (runningJobs.size < MAX_PARALLEL_JOBS) {
    const [candidate] = await db
      .select({ id: agentZeroJobsTable.id })
      .from(agentZeroJobsTable)
      .where(eq(agentZeroJobsTable.status, "queued"))
      .orderBy(desc(agentZeroJobsTable.priority), agentZeroJobsTable.createdAt)
      .limit(1);
    if (!candidate) return;
    // Conditional-UPDATE CAS claim — safe against a second worker instance.
    // The fresh lease token invalidates any stale runner from a prior claim.
    const lease = randomUUID();
    const claimed = await db
      .update(agentZeroJobsTable)
      .set({
        status: "running",
        leaseToken: lease,
        startedAt: sql`COALESCE(${agentZeroJobsTable.startedAt}, now())`,
        updatedAt: new Date(),
      })
      .where(and(eq(agentZeroJobsTable.id, candidate.id), eq(agentZeroJobsTable.status, "queued")))
      .returning();
    if (claimed.length === 0) continue;
    const job = claimed[0]!;
    runningJobs.add(job.id);
    void runJob(job, lease)
      .catch(async (err) => {
        // Fail-safe: an unexpected throw outside the per-step retry path must
        // never leave the job wedged in "running". CAS on status+lease so we
        // never clobber a state someone else already moved the job to.
        logger.error({ err, jobId: job.id }, "Agent Zero job crashed");
        const message = err instanceof Error ? err.message : String(err);
        await db
          .update(agentZeroJobsTable)
          .set({
            status: "failed",
            lastError: `Unexpected engine error: ${message}`.slice(0, 1000),
            rootCause: "engine_error",
            resultSummary: `Job crashed outside step execution: ${message}`.slice(0, 2000),
            finishedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(agentZeroJobsTable.id, job.id),
              eq(agentZeroJobsTable.status, "running"),
              eq(agentZeroJobsTable.leaseToken, lease),
            ),
          )
          .catch((e) => logger.error({ err: e, jobId: job.id }, "Agent Zero fail-safe transition failed"));
      })
      .finally(() => runningJobs.delete(job.id));
  }
}

async function runJob(job: AgentZeroJobRow, lease: string): Promise<void> {
  // Every job-row write below is gated on (status = running AND leaseToken =
  // lease). If the founder cancels/retries/pauses, or a stale-recovery re-queue
  // hands the job to a new runner, this runner's lease no longer matches and
  // all of its writes become no-ops — it aborts at the next lease check.
  const leaseGuard = and(
    eq(agentZeroJobsTable.id, job.id),
    eq(agentZeroJobsTable.status, "running"),
    eq(agentZeroJobsTable.leaseToken, lease),
  );

  const steps = await db
    .select()
    .from(agentZeroStepsTable)
    .where(eq(agentZeroStepsTable.jobId, job.id))
    .orderBy(agentZeroStepsTable.seq);
  const total = steps.length || 1;
  // Checkpoint recovery: completed steps are never re-executed.
  const priorSummaries: string[] = steps
    .filter((s) => s.status === "completed" && s.summary)
    .map((s) => s.summary);

  for (const step of steps) {
    if (step.status === "completed" || step.status === "skipped") continue;

    // Respect external controls between steps — and verify we still hold the
    // execution lease before touching anything.
    const [current] = await db
      .select({ status: agentZeroJobsTable.status, leaseToken: agentZeroJobsTable.leaseToken })
      .from(agentZeroJobsTable)
      .where(eq(agentZeroJobsTable.id, job.id))
      .limit(1);
    if (!current || current.status !== "running" || current.leaseToken !== lease) return;

    const marked = await db
      .update(agentZeroJobsTable)
      .set({ currentStep: step.title, updatedAt: new Date() })
      .where(leaseGuard)
      .returning({ id: agentZeroJobsTable.id });
    if (marked.length === 0) return; // lost the lease between check and write
    await db
      .update(agentZeroStepsTable)
      .set({ status: "running", startedAt: new Date() })
      .where(eq(agentZeroStepsTable.id, step.id));

    let lastError = "";
    let done = false;
    for (let attempt = step.attempts; attempt < job.maxAttempts && !done; attempt++) {
      try {
        const result = await executeStep(job, step, priorSummaries);
        await db
          .update(agentZeroStepsTable)
          .set({
            status: "completed",
            summary: result.summary.slice(0, 2000),
            output: result.output,
            attempts: attempt + 1,
            finishedAt: new Date(),
          })
          .where(eq(agentZeroStepsTable.id, step.id));
        priorSummaries.push(result.summary);
        done = true;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        logger.warn({ jobId: job.id, step: step.title, attempt: attempt + 1, err: lastError }, "Agent Zero step failed");
        await db
          .update(agentZeroStepsTable)
          .set({ attempts: attempt + 1 })
          .where(eq(agentZeroStepsTable.id, step.id));
        await db
          .update(agentZeroJobsTable)
          .set({ attempts: sql`${agentZeroJobsTable.attempts} + 1`, lastError: lastError.slice(0, 1000), updatedAt: new Date() })
          .where(leaseGuard);
      }
    }

    if (!done) {
      await db
        .update(agentZeroStepsTable)
        .set({ status: "failed", summary: `Failed after ${job.maxAttempts} attempts: ${lastError.slice(0, 500)}`, finishedAt: new Date() })
        .where(eq(agentZeroStepsTable.id, step.id));
      await failJob(job, step, lastError, priorSummaries, lease);
      return;
    }

    const completedCount = priorSummaries.length;
    await db
      .update(agentZeroJobsTable)
      .set({ progress: Math.min(100, Math.round((completedCount / total) * 100)), updatedAt: new Date() })
      .where(leaseGuard);
  }

  const resultSummary = priorSummaries.length
    ? priorSummaries[priorSummaries.length - 1]!.slice(0, 1500)
    : "Job completed with no output.";
  const completed = await db
    .update(agentZeroJobsTable)
    .set({
      status: "completed",
      progress: 100,
      currentStep: "",
      leaseToken: null,
      resultSummary,
      finishedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(leaseGuard)
    .returning({ id: agentZeroJobsTable.id });
  if (completed.length === 0) return; // someone else moved the job — don't record a completion event
  void appendObjectiveExecutionEntry(job.objectiveId ?? null, {
    action: `Agent Zero completed: ${job.title.slice(0, 120)}`,
    source: "agent_zero",
    outcome: "success",
    durationMs: job.startedAt ? Date.now() - new Date(job.startedAt).getTime() : undefined,
    detail: resultSummary.slice(0, 400),
  });
  // Advance objective progress: +20% per successful AZ run, capped at 95%.
  // 100% is reserved for explicit completion via maybeFinalizeObjective.
  if (job.objectiveId) {
    await db
      .update(agentObjectivesTable)
      .set({
        progressPercent: sql`LEAST(95, ${agentObjectivesTable.progressPercent} + 20)`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(agentObjectivesTable.id, job.objectiveId),
          inArray(agentObjectivesTable.status, ["planning", "in_progress"]),
        ),
      )
      .catch((err: unknown) => logger.warn({ err, objectiveId: job.objectiveId }, "agentZero: progress advance failed"));
  }
  await recordEvent({
    type: "milestone",
    title: `Agent Zero completed: ${job.title.slice(0, 120)}`,
    summary: resultSummary.slice(0, 400),
    actorExecutiveId: job.requestedBy,
    refType: "agent_zero_job",
    refId: job.id,
    importance: "normal",
    keywords: ["agent-zero", job.commandType, "completed"],
  });
}

/** Terminal failure: classify → consult the right specialist → report to Quinn. */
async function failJob(
  job: AgentZeroJobRow,
  step: AgentZeroStepRow,
  error: string,
  priorSummaries: string[],
  lease: string,
): Promise<void> {
  const { rootCause, specialistId } = classifyRootCause(error);
  let specialistNote = "";
  try {
    const spec = SPECIALISTS.find((s) => s.id === specialistId);
    const quinn = await getQuinn();
    if (spec && quinn) {
      const consultation = await consultSpecialist({
        specialist: spec,
        focus: `Agent Zero job "${job.title}" failed at step "${step.title}". Error: ${error.slice(0, 400)}. Classify and advise.`,
        contextDigest: priorSummaries.join("\n").slice(0, 2000) || "No prior step output.",
        executive: quinn,
        objectiveId: job.objectiveId ?? undefined,
      });
      if (consultation) specialistNote = `${consultation.specialistName}: ${consultation.summary}`;
    }
  } catch {
    // best-effort — never let recovery consultation crash the failure path
  }

  const resultSummary =
    `Failed at "${step.title}" (root cause: ${rootCause}). ${error.slice(0, 300)}` +
    (specialistNote ? ` — ${specialistNote.slice(0, 400)}` : "");
  // CAS on status+lease: if the founder cancelled/retried while the recovery
  // consultation ran, this runner lost the job — skip the terminal write AND
  // the escalation report so Quinn never gets a duplicate/stale escalation.
  const failed = await db
    .update(agentZeroJobsTable)
    .set({
      status: "failed",
      rootCause,
      lastError: error.slice(0, 1000),
      resultSummary: resultSummary.slice(0, 2000),
      currentStep: step.title,
      leaseToken: null,
      finishedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(agentZeroJobsTable.id, job.id),
        eq(agentZeroJobsTable.status, "running"),
        eq(agentZeroJobsTable.leaseToken, lease),
      ),
    )
    .returning({ id: agentZeroJobsTable.id });
  if (failed.length === 0) return;
  void appendObjectiveExecutionEntry(job.objectiveId ?? null, {
    action: `Agent Zero failed: ${step.title.slice(0, 120)}`,
    source: "agent_zero",
    outcome: "failed",
    detail: resultSummary.slice(0, 400),
  });

  const quinn = await getQuinn();
  if (quinn) {
    const findings: ReportFinding[] = [
      { severity: "critical", text: `Agent Zero job failed: ${job.title.slice(0, 200)} — root cause ${rootCause}.` },
    ];
    if (specialistNote) findings.push({ severity: "info", text: specialistNote.slice(0, 400) });
    await db.insert(agentReportsTable).values({
      id: randomUUID(),
      executiveId: quinn.id,
      objectiveId: job.objectiveId ?? null,
      status: "attention",
      headline: `Agent Zero escalation: ${job.title.slice(0, 140)}`,
      summary: resultSummary.slice(0, 3000),
      metrics: [],
      findings,
    });
  }
  await recordEvent({
    type: "milestone",
    title: `Agent Zero escalated a failure: ${job.title.slice(0, 120)}`,
    summary: resultSummary.slice(0, 400),
    actorExecutiveId: job.requestedBy,
    refType: "agent_zero_job",
    refId: job.id,
    importance: "high",
    keywords: ["agent-zero", job.commandType, "failed", rootCause],
  });
}

// ── Operations snapshot + Quinn brief ─────────────────────────────────────────

export async function getOperationsSnapshot(): Promise<{
  worker: { healthy: boolean; lastTickAt: string | null; runningJobs: number };
  counts: Record<string, number>;
  avgRuntimeSeconds: number;
  totalRetries: number;
  executionConfidence: number;
  systemLoad: { load1: number; heapUsedMb: number; rssMb: number };
  jobs: Array<AgentZeroJobRow & { steps: AgentZeroStepRow[] }>;
  commands: Array<{ commandType: string; label: string; describe: string }>;
}> {
  const jobs = await db
    .select()
    .from(agentZeroJobsTable)
    .orderBy(desc(agentZeroJobsTable.createdAt))
    .limit(40);
  const jobIds = jobs.map((j) => j.id);
  const steps = jobIds.length
    ? await db
        .select()
        .from(agentZeroStepsTable)
        .where(inArray(agentZeroStepsTable.jobId, jobIds))
        .orderBy(agentZeroStepsTable.seq)
    : [];
  const stepsByJob = new Map<string, AgentZeroStepRow[]>();
  for (const s of steps) {
    const list = stepsByJob.get(s.jobId) ?? [];
    list.push(s);
    stepsByJob.set(s.jobId, list);
  }

  const countRows = await db
    .select({ status: agentZeroJobsTable.status, total: sql<number>`count(*)::int` })
    .from(agentZeroJobsTable)
    .groupBy(agentZeroJobsTable.status);
  const counts: Record<string, number> = {
    queued: 0,
    running: 0,
    paused: 0,
    waiting_approval: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
  };
  for (const row of countRows) counts[row.status] = row.total;

  const [runtime] = await db
    .select({
      avgSeconds: sql<number>`COALESCE(AVG(EXTRACT(EPOCH FROM (${agentZeroJobsTable.finishedAt} - ${agentZeroJobsTable.startedAt}))), 0)::float`,
    })
    .from(agentZeroJobsTable)
    .where(and(eq(agentZeroJobsTable.status, "completed")));
  const [retries] = await db
    .select({ total: sql<number>`COALESCE(SUM(${agentZeroJobsTable.attempts}), 0)::int` })
    .from(agentZeroJobsTable);

  // Execution confidence: blend of job success rate and specialist bench confidence.
  const decided = counts.completed! + counts.failed!;
  const jobSuccessRate = decided > 0 ? Math.round((counts.completed! / decided) * 100) : 100;
  const [specConf] = await db
    .select({ avg: sql<number>`COALESCE(AVG(${specialistRunsTable.confidence}), 75)::float` })
    .from(specialistRunsTable)
    .where(eq(specialistRunsTable.success, true));
  const executionConfidence = Math.round(jobSuccessRate * 0.6 + (specConf?.avg ?? 75) * 0.4);

  const mem = process.memoryUsage();
  return {
    worker: getWorkerHealth(),
    counts,
    avgRuntimeSeconds: Math.round((runtime?.avgSeconds ?? 0) * 10) / 10,
    totalRetries: Math.max(0, (retries?.total ?? 0) - decided - counts.running! - counts.cancelled!),
    executionConfidence,
    systemLoad: {
      load1: Math.round((os.loadavg()[0] ?? 0) * 100) / 100,
      heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
      rssMb: Math.round(mem.rss / 1024 / 1024),
    },
    jobs: jobs.map((j) => ({ ...j, steps: stepsByJob.get(j.id) ?? [] })),
    commands: (Object.keys(COMMAND_CATALOG) as AgentZeroCommand[]).map((c) => ({
      commandType: c,
      label: COMMAND_CATALOG[c].label,
      describe: COMMAND_CATALOG[c].describe,
    })),
  };
}

/** Public alias so ReplitProvider and external callers can dispatch without importing the full type. */
export { createAgentZeroJob as dispatchJob };

/** Compact execution-layer status for Quinn's conversation context. */
export async function getAgentZeroBrief(): Promise<string> {
  try {
    const countRows = await db
      .select({ status: agentZeroJobsTable.status, total: sql<number>`count(*)::int` })
      .from(agentZeroJobsTable)
      .groupBy(agentZeroJobsTable.status);
    const counts = new Map(countRows.map((r) => [r.status, r.total]));
    const recent = await db
      .select({
        title: agentZeroJobsTable.title,
        status: agentZeroJobsTable.status,
        resultSummary: agentZeroJobsTable.resultSummary,
      })
      .from(agentZeroJobsTable)
      .orderBy(desc(agentZeroJobsTable.updatedAt))
      .limit(3);
    const worker = getWorkerHealth();
    const lines = [
      `Worker: ${worker.healthy ? "healthy" : "not ticking"} (${worker.runningJobs} running now).`,
      `Jobs — running: ${counts.get("running") ?? 0}, queued: ${counts.get("queued") ?? 0}, waiting approval: ${counts.get("waiting_approval") ?? 0}, completed: ${counts.get("completed") ?? 0}, failed: ${counts.get("failed") ?? 0}.`,
    ];
    for (const r of recent) {
      lines.push(`• [${r.status}] ${r.title.slice(0, 100)}${r.resultSummary ? ` — ${r.resultSummary.slice(0, 120)}` : ""}`);
    }
    return lines.join("\n");
  } catch {
    return "";
  }
}
