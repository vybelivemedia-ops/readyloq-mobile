// ─── V11.1: Autonomous Blocker Resolution Engine ─────────────────────────────
// Mission Control no longer merely reports blockers — it classifies, routes, and
// resolves them. Every autonomy cycle this engine:
//   1. SYNC      — scan every blocker source (blocked tasks, critical reports,
//                  engineering-snapshot blockers, critical portfolio dimensions),
//                  upsert into the canonical `blockers` registry (dedupe by
//                  sourceType+sourceRef), and close blockers whose source cleared.
//   2. CLASSIFY  — deterministically place each blocker in one of four buckets:
//                    • autonomous       — the exec team has everything it needs
//                    • connected        — a connected provider can resolve it
//                    • founder_approval — prep is done, one approval is required
//                    • human_required   — only the account owner can act (legal/
//                                         identity/connect-a-provider)
//   3. RESOLVE   — progress each blocker through a per-category lifecycle, retry
//                  transient failures (capped), and escalate ONLY when every
//                  autonomous path is exhausted.
//   4. LEARN     — record organization events on every transition and an
//                  executive lesson whenever a blocker is resolved or fails.
//
// Honesty principle: a blocker is only marked "resolved" when its underlying
// source genuinely clears. The one source the engine can clear itself is a
// blocked task (it unblocks it). For telemetry-derived blockers (engineering /
// portfolio / critical reports) the engine assigns and executes remediation
// work, but if the source persists after the retry cap it escalates as
// "no autonomous path left" rather than fabricating a resolution.

import {
  db,
  blockersTable,
  agentTasksTable,
  agentReportsTable,
  agentObjectivesTable,
  agentApprovalsTable,
  aiExecutivesTable,
  type AiExecutive,
  type BlockerRow,
  type BlockerRetryEntry,
} from "@workspace/db";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { logger } from "../../lib/logger.js";
import { recordEvent } from "../organizationMemory.js";
import { recordLesson } from "../executiveLearning.js";
import { runCapability, ROLES_WITH_CAPABILITY } from "../executiveCapabilities/index.js";
import {
  getActiveProducts,
  getLatestSnapshot,
  getFlagshipSnapshot,
} from "../engineering/engineeringIntelligence.js";
import { getPortfolioSummary } from "../portfolioMonitor.js";
import {
  detectConnectors,
  matchConnector,
  connectorLabel,
  type ConnectorProvider,
  type ConnectorStatus,
} from "./connectorRegistry.js";

const MAX_RETRIES = 3;

type Category = BlockerRow["category"];
type Status = BlockerRow["status"];
type Severity = BlockerRow["severity"];
type SourceType = BlockerRow["sourceType"];

// ─── Classification rules (deterministic, keyword-based) ─────────────────────

// Only the account owner can satisfy these — legal/identity/financial-KYC.
const HUMAN_REQUIRED_PATTERNS = [
  "identity verification",
  "verify your identity",
  "verify identity",
  "kyc",
  "know your customer",
  "tax",
  "w-9",
  "w9",
  "1099",
  "ein",
  "ssn",
  "banking",
  "bank account",
  "routing number",
  "legal agreement",
  "terms of service",
  "sign the contract",
  "contract signature",
  "sign contract",
  "notariz",
  "biometric",
  "government id",
  "proof of address",
  "business license",
];

// Work is ready but only the Founder may authorize it.
const FOUNDER_APPROVAL_PATTERNS = [
  "production deploy",
  "deploy to production",
  "publish to production",
  "go live",
  "public launch",
  "launch to the public",
  "app store",
  "play store",
  "submit for review",
  "paid ad",
  "ad spend",
  "advertising spend",
  "spend money",
  "spend budget",
  "budget approval",
  "purchase",
  "pricing change",
  "change pricing",
  "raise price",
  "increase price",
  "payment authorization",
  "sign off",
];

// ─── Owner-role routing ──────────────────────────────────────────────────────

function ownerRoleForWork(text: string, sourceType: SourceType): string {
  const t = text.toLowerCase();
  if (/(test|qa|coverage|flaky|regression|e2e|quality)/.test(t)) return "qa_director";
  if (/(deploy|release|rollout|ship|ci\/cd|pipeline|build pipeline|version)/.test(t))
    return "release_manager";
  if (/(roadmap|prioritiz|sequenc|backlog|scope|requirement|spec|planning)/.test(t))
    return "product_manager";
  if (/(brand|asset|design|logo|visual|copywrit|creative|ui polish|illustration)/.test(t))
    return "creative_director";
  if (/(campaign|marketing|growth|waitlist|seo|social|launch plan|audience|press)/.test(t))
    return "marketing_director";
  if (sourceType === "engineering") return "cto";
  if (/(code|bug|refactor|schema|api|build|runtime|crash|error|migration|performance)/.test(t))
    return "cto";
  return "cto";
}

// For founder-approval blockers, the exec who owns the prep work.
function approvalOwnerRole(text: string): string {
  const t = text.toLowerCase();
  if (/(deploy|release|rollout|go live|app store|play store|submit)/.test(t))
    return "release_manager";
  if (/(pricing|price|paid ad|ad spend|advertising|budget|spend|purchase|payment)/.test(t))
    return "marketing_director";
  if (/(launch|public)/.test(t)) return "marketing_director";
  return "product_manager";
}

// ─── Classification ──────────────────────────────────────────────────────────

export interface Classification {
  category: Category;
  ownerRole: string | null;
  rootCause: string;
  resolutionPlan: string;
  connectorProvider: ConnectorProvider | null;
  estimatedCompletion: string;
  humanAction: string;
}

export function classifyBlocker(input: {
  title: string;
  detail: string;
  sourceType: SourceType;
  severity: Severity;
  connectors: Record<ConnectorProvider, ConnectorStatus>;
}): Classification {
  const text = `${input.title} ${input.detail}`.toLowerCase();

  // 1) Human-required — legal/identity/financial actions only the owner can do.
  if (HUMAN_REQUIRED_PATTERNS.some((p) => text.includes(p))) {
    return {
      category: "human_required",
      ownerRole: "chief_of_staff",
      rootCause: "Requires a legal, identity, or financial action that only the account owner can perform.",
      resolutionPlan:
        "Quinn will explain exactly what is needed, why automation cannot proceed, the ETA, and what work continues in parallel.",
      connectorProvider: null,
      estimatedCompletion: "Depends on the Founder",
      humanAction: deriveHumanAction(text),
    };
  }

  // 2) Founder-approval — work is ready but needs authorization.
  if (FOUNDER_APPROVAL_PATTERNS.some((p) => text.includes(p))) {
    return {
      category: "founder_approval",
      ownerRole: approvalOwnerRole(text),
      rootCause: "The work can be fully prepared autonomously but requires Founder authorization to execute.",
      resolutionPlan:
        "Complete all preparation, then present a single approval with a summary, expected impact, and a rollback plan.",
      connectorProvider: null,
      estimatedCompletion: "Ready — pending your approval",
      humanAction: "",
    };
  }

  // 3) Connected — a provider keyword matched.
  const matched = matchConnector(text);
  if (matched) {
    const status = input.connectors[matched.provider];
    if (status?.available) {
      return {
        category: "connected",
        ownerRole: ownerRoleForWork(text, input.sourceType),
        rootCause: `Resolvable through the connected ${matched.label} integration.`,
        resolutionPlan: `Route to ${matched.label}; retry transient failures automatically before any escalation.`,
        connectorProvider: matched.provider,
        estimatedCompletion: "This cycle (provider-dependent)",
        humanAction: "",
      };
    }
    // Provider keyword matched but the connector is not wired up — only the owner
    // can connect it. This flips back to "connected" automatically once the
    // credentials/integration appear (reclassified every pass).
    return {
      category: "human_required",
      ownerRole: "chief_of_staff",
      rootCause: `Needs the ${matched.label} integration, which is not connected (${status?.reason ?? "unavailable"}).`,
      resolutionPlan: `Quinn will request that ${matched.label} be connected; resolution resumes automatically once it is available.`,
      connectorProvider: matched.provider,
      estimatedCompletion: "Once the provider is connected",
      humanAction: `Connect ${matched.label} to Mission Control.`,
    };
  }

  // 4) Autonomous — the exec team has everything it needs.
  return {
    category: "autonomous",
    ownerRole: ownerRoleForWork(text, input.sourceType),
    rootCause: "Internal work the executive team can plan and execute without outside dependencies.",
    resolutionPlan:
      "Create the remediation work, assign the responsible executive, and execute this cycle — never waiting on the Founder.",
    connectorProvider: null,
    estimatedCompletion: "This cycle",
    humanAction: "",
  };
}

function deriveHumanAction(text: string): string {
  if (/(kyc|identity|government id|biometric|proof of address)/.test(text))
    return "Complete identity verification with the platform.";
  if (/(tax|w-9|w9|1099|ein|ssn)/.test(text)) return "Provide the required tax information.";
  if (/(bank|routing|payout)/.test(text)) return "Add and verify a bank account / payout method.";
  if (/(legal|terms|contract|notariz|license)/.test(text))
    return "Review and sign the required legal agreement.";
  return "Complete the required account-owner action.";
}

function severityRank(s: Severity): number {
  return { critical: 3, high: 2, medium: 1, low: 0 }[s];
}

// ─── Source scanning ─────────────────────────────────────────────────────────

interface ScannedBlocker {
  sourceType: SourceType;
  sourceRef: string;
  dedupeKey: string;
  productId: string;
  taskId: string | null;
  title: string;
  detail: string;
  severity: Severity;
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

async function scanSources(): Promise<ScannedBlocker[]> {
  const found: ScannedBlocker[] = [];

  // a) Blocked tasks.
  try {
    const tasks = await db
      .select({ id: agentTasksTable.id, title: agentTasksTable.title, description: agentTasksTable.description })
      .from(agentTasksTable)
      .where(eq(agentTasksTable.status, "blocked"));
    for (const t of tasks) {
      found.push({
        sourceType: "task",
        sourceRef: t.id,
        dedupeKey: `task:${t.id}`,
        productId: "",
        taskId: t.id,
        title: t.title,
        detail: t.description ?? "",
        severity: "high",
      });
    }
  } catch (err) {
    logger.warn({ err }, "blockers: scan blocked tasks failed");
  }

  // b) Critical reports.
  try {
    const reports = await db
      .select({ id: agentReportsTable.id, headline: agentReportsTable.headline, summary: agentReportsTable.summary })
      .from(agentReportsTable)
      .where(eq(agentReportsTable.status, "critical"))
      .orderBy(desc(agentReportsTable.createdAt))
      .limit(50);
    for (const r of reports) {
      found.push({
        sourceType: "report",
        sourceRef: r.id,
        dedupeKey: `report:${r.id}`,
        productId: "",
        taskId: null,
        title: r.headline,
        detail: r.summary,
        severity: "critical",
      });
    }
  } catch (err) {
    logger.warn({ err }, "blockers: scan critical reports failed");
  }

  // c) Engineering-snapshot blockers (per active product).
  try {
    const products = await getActiveProducts();
    for (const product of products) {
      const snap = await getLatestSnapshot(product).catch(() => null);
      if (!snap) continue;
      for (const text of snap.blockers ?? []) {
        found.push({
          sourceType: "engineering",
          sourceRef: `${product.id}:${slug(text)}`,
          dedupeKey: `engineering:${product.id}:${slug(text)}`,
          productId: product.id,
          taskId: null,
          title: text,
          detail: `Engineering blocker on ${product.name} (health ${snap.healthScore}/100).`,
          severity: snap.healthScore < 50 ? "critical" : "high",
        });
      }
    }
  } catch (err) {
    logger.warn({ err }, "blockers: scan engineering blockers failed");
  }

  // d) Critical portfolio dimensions.
  try {
    const portfolio = await getPortfolioSummary();
    for (const asset of portfolio.assets) {
      for (const dim of asset.dimensions) {
        if (dim.status !== "critical") continue;
        found.push({
          sourceType: "portfolio",
          sourceRef: `${asset.slug}:${dim.key}`,
          dedupeKey: `portfolio:${asset.slug}:${dim.key}`,
          productId: asset.slug,
          taskId: null,
          title: `${asset.name} — ${dim.label} is critical`,
          detail: dim.detail ?? "",
          severity: "critical",
        });
      }
    }
  } catch (err) {
    logger.warn({ err }, "blockers: scan portfolio dimensions failed");
  }

  return found;
}

// ─── Sync ────────────────────────────────────────────────────────────────────

interface SyncResult {
  created: number;
  reopened: number;
  closed: number;
}

async function syncBlockers(): Promise<SyncResult> {
  const scanned = await scanSources();
  const present = new Set(scanned.map((s) => s.dedupeKey));
  let created = 0;
  let reopened = 0;
  let closed = 0;

  // Upsert every currently-present source.
  for (const s of scanned) {
    const existing = await db
      .select()
      .from(blockersTable)
      .where(eq(blockersTable.dedupeKey, s.dedupeKey))
      .limit(1);

    if (existing.length === 0) {
      await db.insert(blockersTable).values({
        id: randomUUID(),
        sourceType: s.sourceType,
        sourceRef: s.sourceRef,
        dedupeKey: s.dedupeKey,
        productId: s.productId,
        taskId: s.taskId,
        title: s.title,
        detail: s.detail,
        severity: s.severity,
        category: "unclassified",
        status: "open",
      });
      created += 1;
      continue;
    }

    const row = existing[0];
    // The source is still present. If we previously marked it resolved, the
    // resolution didn't hold — reopen so the engine re-attempts (this is what
    // drives telemetry blockers toward the retry cap / escalation).
    if (row.status === "resolved") {
      await db
        .update(blockersTable)
        .set({
          status: "open",
          resolvedAt: null,
          title: s.title,
          detail: s.detail,
          severity: s.severity,
          retryHistory: appendRetry(row.retryHistory, {
            action: "Source reappeared",
            outcome: "pending",
            detail: "Underlying source is still present — reopening for another resolution attempt.",
          }),
          updatedAt: new Date(),
        })
        .where(eq(blockersTable.id, row.id));
      reopened += 1;
    } else {
      // Refresh descriptive fields without disturbing the lifecycle.
      await db
        .update(blockersTable)
        .set({ title: s.title, detail: s.detail, severity: s.severity, updatedAt: new Date() })
        .where(eq(blockersTable.id, row.id));
    }
  }

  // Close blockers whose source has cleared (source-derived only; never manual).
  // "failed" is included: even an exhausted blocker must close when its source
  // actually clears — status truth must track source truth (the honesty rule).
  const active = await db
    .select()
    .from(blockersTable)
    .where(
      and(
        inArray(blockersTable.status, [
          "open",
          "in_progress",
          "awaiting_approval",
          "awaiting_human",
          "failed",
        ]),
        inArray(blockersTable.sourceType, ["task", "report", "engineering", "portfolio"]),
      ),
    );
  for (const row of active) {
    if (present.has(row.dedupeKey)) continue;
    await db
      .update(blockersTable)
      .set({
        status: "resolved",
        resolvedAt: new Date(),
        retryHistory: appendRetry(row.retryHistory, {
          action: "Source cleared",
          outcome: "success",
          detail: "The underlying source is no longer present — blocker resolved.",
        }),
        updatedAt: new Date(),
      })
      .where(eq(blockersTable.id, row.id));
    closed += 1;
    await recordEvent({
      type: "milestone",
      title: `Blocker resolved: ${row.title}`,
      summary: "The underlying source cleared and Mission Control closed the blocker.",
      refType: "blocker",
      refId: row.id,
      importance: "normal",
      keywords: ["blocker", "resolved", row.category],
    }).catch(() => {});
    if (row.ownerExecutiveId) {
      await recordLessonForRole(
        row,
        "successful_decision",
        `Resolved blocker "${row.title}" — the remediation cleared the underlying source.`,
      );
    }
  }

  return { created, reopened, closed };
}

function appendRetry(
  history: BlockerRetryEntry[],
  entry: Omit<BlockerRetryEntry, "at">,
): BlockerRetryEntry[] {
  const next = [...(history ?? []), { ...entry, at: new Date().toISOString() }];
  // Keep the history bounded.
  return next.slice(-20);
}

async function recordLessonForRole(row: BlockerRow, kind: "successful_decision" | "lesson_learned", content: string) {
  let role = "chief_of_staff";
  if (row.ownerExecutiveId) {
    const exec = await db
      .select({ role: aiExecutivesTable.role })
      .from(aiExecutivesTable)
      .where(eq(aiExecutivesTable.id, row.ownerExecutiveId))
      .limit(1);
    if (exec.length > 0) role = exec[0].role;
  }
  await recordLesson(role, kind, content, "manual", row.objectiveId).catch(() => {});
}

// ─── Resolution ──────────────────────────────────────────────────────────────

interface ResolutionContext {
  quinn: AiExecutive;
  execsByRole: Map<string, AiExecutive>;
  connectors: Record<ConnectorProvider, ConnectorStatus>;
}

interface PassStats {
  scanned: number;
  created: number;
  reopened: number;
  closed: number;
  resolved: number;
  escalatedToFounder: number;
  humanRequired: number;
  failed: number;
  byCategory: Record<Category, number>;
}

// Re-classify a blocker using current connector availability and persist any
// changes to its routing fields.
async function reclassify(row: BlockerRow, ctx: ResolutionContext): Promise<BlockerRow> {
  const c = classifyBlocker({
    title: row.title,
    detail: row.detail,
    sourceType: row.sourceType,
    severity: row.severity,
    connectors: ctx.connectors,
  });
  const ownerExec = c.ownerRole ? ctx.execsByRole.get(c.ownerRole) ?? null : null;
  const ownerExecutiveId =
    ownerExec && ROLES_WITH_CAPABILITY.includes(ownerExec.role as never)
      ? ownerExec.id
      : ownerExec?.role === "chief_of_staff"
        ? ctx.quinn.id
        : (ownerExec?.id ?? null);

  const changed =
    row.category !== c.category ||
    row.connectorProvider !== c.connectorProvider ||
    row.ownerExecutiveId !== ownerExecutiveId;

  await db
    .update(blockersTable)
    .set({
      category: c.category,
      rootCause: c.rootCause,
      resolutionPlan: c.resolutionPlan,
      connectorProvider: c.connectorProvider,
      estimatedCompletion: c.estimatedCompletion,
      humanAction: c.humanAction,
      ownerExecutiveId,
      updatedAt: new Date(),
    })
    .where(eq(blockersTable.id, row.id));

  if (changed && row.category !== "unclassified") {
    await recordEvent({
      type: "recommendation",
      title: `Blocker reclassified: ${row.title}`,
      summary: `Now "${c.category}"${c.connectorProvider ? ` via ${connectorLabel(c.connectorProvider)}` : ""}.`,
      refType: "blocker",
      refId: row.id,
      importance: "low",
      keywords: ["blocker", "reclassified", c.category],
    }).catch(() => {});
  }

  return { ...row, ...{
    category: c.category,
    rootCause: c.rootCause,
    resolutionPlan: c.resolutionPlan,
    connectorProvider: c.connectorProvider,
    estimatedCompletion: c.estimatedCompletion,
    humanAction: c.humanAction,
    ownerExecutiveId,
  } } as BlockerRow;
}

// Run the owner executive's capability so the remediation produces grounded,
// real work output (best-effort — never throws into the pass).
async function executeOwnerWork(row: BlockerRow, ctx: ResolutionContext): Promise<string> {
  if (!row.ownerExecutiveId) return "No owner assigned.";
  const exec = ctx.execsByRole.get(execRole(row.ownerExecutiveId, ctx) ?? "");
  const role = exec?.role ?? "";
  if (!role || !ROLES_WITH_CAPABILITY.includes(role as never)) {
    return "Owner coordinated remediation (no inspector capability).";
  }
  try {
    const report = await runCapability(role);
    return `Ran ${role} capability: ${report.headline}`;
  } catch (err) {
    logger.warn({ err, role }, "blockers: executeOwnerWork capability failed");
    return `Attempted ${role} remediation (capability unavailable this cycle).`;
  }
}

function execRole(execId: string, ctx: ResolutionContext): string | null {
  for (const [role, exec] of ctx.execsByRole) if (exec.id === execId) return role;
  return null;
}

async function patch(id: string, set: Partial<BlockerRow>): Promise<void> {
  await db
    .update(blockersTable)
    .set({ ...set, updatedAt: new Date() })
    .where(eq(blockersTable.id, id));
}

// Resolve a single blocker according to its category lifecycle. Returns the
// terminal-ish status reached this pass.
async function resolveBlocker(row: BlockerRow, ctx: ResolutionContext): Promise<Status> {
  switch (row.category) {
    case "autonomous":
      return resolveAutonomous(row, ctx);
    case "connected":
      return resolveConnected(row, ctx);
    case "founder_approval":
      return resolveFounderApproval(row, ctx);
    case "human_required":
      return resolveHumanRequired(row, ctx);
    default:
      return row.status;
  }
}

/** Max times a blocker's remediation objective can be retried before founder escalation. */
const MAX_OBJECTIVE_RETRIES = 3;

async function ensureRemediationObjective(row: BlockerRow, ctx: ResolutionContext): Promise<string> {
  // Stable dedup key: the blocker's own dedupeKey is already unique and stable across resyncs.
  const dedupKey = `blocker:${row.dedupeKey}`;

  // 1. If this blocker row already references an objective, check it's still live.
  if (row.objectiveId) {
    const linked = await db
      .select({ status: agentObjectivesTable.status })
      .from(agentObjectivesTable)
      .where(eq(agentObjectivesTable.id, row.objectiveId))
      .limit(1);
    if (linked.length > 0 && linked[0].status !== "failed" && linked[0].status !== "completed") {
      return row.objectiveId; // Still active — nothing to do.
    }
    // The linked objective failed or was cancelled; fall through to dedup check.
  }

  // 2. Look for any existing objective for this blocker (catches re-synced blocker rows
  //    whose objectiveId was cleared, or cases where the linked objective failed).
  const existing = await db
    .select({
      id: agentObjectivesTable.id,
      status: agentObjectivesTable.status,
      retryCount: agentObjectivesTable.retryCount,
      title: agentObjectivesTable.title,
    })
    .from(agentObjectivesTable)
    .where(
      and(
        sql`"dedup_key" = ${dedupKey}`,
        inArray(agentObjectivesTable.status, ["planning", "in_progress", "needs_approval", "failed"]),
      ),
    )
    .orderBy(desc(agentObjectivesTable.createdAt))
    .limit(1);

  if (existing.length > 0) {
    const obj = existing[0];
    if (obj.status === "failed") {
      if (obj.retryCount >= MAX_OBJECTIVE_RETRIES) {
        // Exhausted — surface one approval, never create another objective for this blocker.
        const alreadyPending = await db
          .select({ id: agentApprovalsTable.id })
          .from(agentApprovalsTable)
          .where(
            and(eq(agentApprovalsTable.objectiveId, obj.id), eq(agentApprovalsTable.status, "pending")),
          )
          .limit(1);
        if (alreadyPending.length === 0) {
          await db.insert(agentApprovalsTable).values({
            id: randomUUID(),
            objectiveId: obj.id,
            executiveId: ctx.quinn.id,
            taskId: null,
            title: `Blocker objective exhausted retries: ${row.title}`.slice(0, 200),
            detail: `Objective for blocker "${row.title}" has failed ${obj.retryCount} time(s) and cannot proceed autonomously. Founder decision required: abandon, reassign, or manually resolve?`,
            impact: "high",
            status: "pending",
          });
        }
        await patch(row.id, { objectiveId: obj.id });
        return obj.id;
      }
      // Under the retry cap — reset for another attempt.
      await db
        .update(agentObjectivesTable)
        .set({ status: "in_progress", retryCount: obj.retryCount + 1, updatedAt: new Date() })
        .where(eq(agentObjectivesTable.id, obj.id));
    }
    await patch(row.id, { objectiveId: obj.id });
    return obj.id;
  }

  // 3. No existing objective — create a new one (with dedup key so future cycles don't duplicate it).
  const objectiveId = randomUUID();
  await db.insert(agentObjectivesTable).values({
    id: objectiveId,
    title: `Resolve blocker: ${row.title}`.slice(0, 200),
    request: row.detail || row.title,
    dedupKey,
    status: "in_progress",
    summary: row.resolutionPlan,
    createdByExecutiveId: ctx.quinn.id,
  });
  const ownerId = row.ownerExecutiveId ?? ctx.quinn.id;
  await db.insert(agentTasksTable).values({
    id: randomUUID(),
    executiveId: ownerId,
    title: `Remediate: ${row.title}`.slice(0, 200),
    description: row.resolutionPlan,
    status: "in_progress",
    priority: row.severity === "critical" ? "critical" : "high",
    origin: "agent",
    createdByExecutiveId: ctx.quinn.id,
    objectiveId,
  });
  await patch(row.id, { objectiveId });
  return objectiveId;
}

async function resolveAutonomous(row: BlockerRow, ctx: ResolutionContext): Promise<Status> {
  await ensureRemediationObjective(row, ctx);
  const work = await executeOwnerWork(row, ctx);
  const ownerName = ownerLabel(row, ctx);

  // Task-sourced blockers are the one source the engine can genuinely clear: it
  // unblocks the task so the next sync confirms resolution.
  if (row.sourceType === "task" && row.taskId) {
    await db
      .update(agentTasksTable)
      .set({ status: "in_progress" })
      .where(and(eq(agentTasksTable.id, row.taskId), eq(agentTasksTable.status, "blocked")))
      .catch(() => {});
    await patch(row.id, {
      status: "in_progress",
      retryHistory: appendRetry(row.retryHistory, {
        action: `Unblocked task; ${ownerName} executing remediation`,
        outcome: "success",
        detail: work,
      }),
    });
    await recordEvent({
      type: "milestone",
      title: `Autonomous remediation underway: ${row.title}`,
      summary: `${ownerName} is resolving this without Founder involvement.`,
      refType: "blocker",
      refId: row.id,
      actorExecutiveId: row.ownerExecutiveId,
      importance: "normal",
      keywords: ["blocker", "autonomous", "in_progress"],
    }).catch(() => {});
    return "in_progress";
  }

  // Telemetry-derived blockers: attempt, retry, and escalate at the cap.
  const nextRetry = row.retryCount + 1;
  if (nextRetry >= MAX_RETRIES) {
    await patch(row.id, {
      status: "failed",
      retryCount: nextRetry,
      retryHistory: appendRetry(row.retryHistory, {
        action: `${ownerName} exhausted autonomous remediation`,
        outcome: "failed",
        detail: `${work} — source persists after ${nextRetry} attempts; no autonomous path remains.`,
      }),
    });
    await recordLessonForRole(
      row,
      "lesson_learned",
      `Blocker "${row.title}" could not be resolved autonomously after ${nextRetry} attempts.`,
    );
    return "failed";
  }
  await patch(row.id, {
    status: "in_progress",
    retryCount: nextRetry,
    retryHistory: appendRetry(row.retryHistory, {
      action: `${ownerName} remediation attempt ${nextRetry}`,
      outcome: "pending",
      detail: work,
    }),
  });
  return "in_progress";
}

async function resolveConnected(row: BlockerRow, ctx: ResolutionContext): Promise<Status> {
  const label = row.connectorProvider
    ? connectorLabel(row.connectorProvider as ConnectorProvider)
    : "the provider";
  await ensureRemediationObjective(row, ctx);
  const work = await executeOwnerWork(row, ctx);

  // Task-sourced: unblock (engine-controlled clear).
  if (row.sourceType === "task" && row.taskId) {
    await db
      .update(agentTasksTable)
      .set({ status: "in_progress" })
      .where(and(eq(agentTasksTable.id, row.taskId), eq(agentTasksTable.status, "blocked")))
      .catch(() => {});
    await patch(row.id, {
      status: "in_progress",
      retryHistory: appendRetry(row.retryHistory, {
        action: `Routed to ${label}; task unblocked`,
        outcome: "success",
        detail: work,
      }),
    });
    return "in_progress";
  }

  const nextRetry = row.retryCount + 1;
  if (nextRetry >= MAX_RETRIES) {
    await patch(row.id, {
      status: "failed",
      retryCount: nextRetry,
      retryHistory: appendRetry(row.retryHistory, {
        action: `${label} could not resolve after ${nextRetry} retries`,
        outcome: "failed",
        detail: `${work} — escalating; the connected provider did not clear the source.`,
      }),
    });
    return "failed";
  }
  await patch(row.id, {
    status: "in_progress",
    retryCount: nextRetry,
    retryHistory: appendRetry(row.retryHistory, {
      action: `Retrying via ${label} (attempt ${nextRetry})`,
      outcome: "pending",
      detail: work,
    }),
  });
  return "in_progress";
}

async function resolveFounderApproval(row: BlockerRow, ctx: ResolutionContext): Promise<Status> {
  // If an approval already exists, react to its decision.
  if (row.approvalId) {
    const appr = await db
      .select({ status: agentApprovalsTable.status })
      .from(agentApprovalsTable)
      .where(eq(agentApprovalsTable.id, row.approvalId))
      .limit(1);
    const status = appr[0]?.status;
    if (status === "approved") {
      // Authorized — execute the prepared work like an autonomous remediation.
      const work = await executeOwnerWork(row, ctx);
      await patch(row.id, {
        status: "in_progress",
        retryHistory: appendRetry(row.retryHistory, {
          action: "Founder approved — executing prepared work",
          outcome: "success",
          detail: work,
        }),
      });
      return "in_progress";
    }
    if (status === "rejected") {
      await patch(row.id, {
        status: "failed",
        retryHistory: appendRetry(row.retryHistory, {
          action: "Founder rejected the approval",
          outcome: "failed",
          detail: "The approval was declined; the blocker cannot proceed on this path.",
        }),
      });
      return "failed";
    }
    return "awaiting_approval"; // still pending/deferred
  }

  // First time: finish prep, then raise exactly one approval.
  const work = await executeOwnerWork(row, ctx);
  const title = `Approve: ${row.title}`.slice(0, 200);
  // Dedupe against any pending approval with the same title.
  const existing = await db
    .select({ id: agentApprovalsTable.id })
    .from(agentApprovalsTable)
    .where(and(eq(agentApprovalsTable.title, title), eq(agentApprovalsTable.status, "pending")))
    .limit(1);
  let approvalId = existing[0]?.id ?? null;
  if (!approvalId) {
    approvalId = randomUUID();
    await db.insert(agentApprovalsTable).values({
      id: approvalId,
      objectiveId: row.objectiveId,
      executiveId: ctx.quinn.id,
      taskId: null,
      title,
      detail: [
        `Summary: ${row.resolutionPlan}`,
        `Preparation: ${work}`,
        `Root cause: ${row.rootCause}`,
        `Rollback: revert the change and restore the prior configuration; no irreversible action is taken before approval.`,
      ].join("\n"),
      impact: row.severity === "critical" ? "critical" : "high",
      status: "pending",
    });
  }
  await patch(row.id, {
    approvalId,
    status: "awaiting_approval",
    retryHistory: appendRetry(row.retryHistory, {
      action: "Prepared package; requested Founder approval",
      outcome: "pending",
      detail: "All preparation complete; presented a single approval with summary, impact, and rollback.",
    }),
  });
  await recordEvent({
    type: "approval",
    title: `Founder approval requested: ${row.title}`,
    summary: "Prep complete — one approval is pending.",
    refType: "blocker",
    refId: row.id,
    actorExecutiveId: ctx.quinn.id,
    importance: "high",
    keywords: ["blocker", "approval", "founder"],
  }).catch(() => {});
  return "awaiting_approval";
}

async function resolveHumanRequired(row: BlockerRow, ctx: ResolutionContext): Promise<Status> {
  if (row.status !== "awaiting_human") {
    await patch(row.id, {
      status: "awaiting_human",
      retryHistory: appendRetry(row.retryHistory, {
        action: "Escalated to the Founder (human action required)",
        outcome: "deferred",
        detail: row.humanAction || "An account-owner action is required before automation can continue.",
      }),
    });
    await recordEvent({
      type: "recommendation",
      title: `Human action required: ${row.title}`,
      summary: row.humanAction || "Only the account owner can resolve this.",
      refType: "blocker",
      refId: row.id,
      actorExecutiveId: ctx.quinn.id,
      importance: "high",
      keywords: ["blocker", "human_required"],
    }).catch(() => {});
  }
  return "awaiting_human";
}

function ownerLabel(row: BlockerRow, ctx: ResolutionContext): string {
  if (!row.ownerExecutiveId) return "The team";
  for (const exec of ctx.execsByRole.values()) {
    if (exec.id === row.ownerExecutiveId) return exec.name;
  }
  return "The team";
}

// ─── Public: the resolution pass ─────────────────────────────────────────────

export interface BlockerPassResult {
  ranAt: string;
  sync: SyncResult;
  resolvedThisPass: number;
  escalatedToFounder: number;
  humanRequired: number;
  failed: number;
  active: number;
  byCategory: Record<Category, number>;
}

export async function runBlockerResolutionPass(): Promise<BlockerPassResult> {
  const execs = await db.select().from(aiExecutivesTable);
  const execsByRole = new Map(execs.map((e) => [e.role, e]));
  const quinn = execs.find((e) => e.role === "chief_of_staff") ?? execs[0];
  if (!quinn) {
    return {
      ranAt: new Date().toISOString(),
      sync: { created: 0, reopened: 0, closed: 0 },
      resolvedThisPass: 0,
      escalatedToFounder: 0,
      humanRequired: 0,
      failed: 0,
      active: 0,
      byCategory: emptyByCategory(),
    };
  }

  // Detect connectors from env + the latest flagship snapshot's providers.
  const snap = await getFlagshipSnapshot().catch(() => null);
  const connectors = detectConnectors({
    env: process.env,
    engineeringProviders: snap?.providers ?? [],
  });

  const ctx: ResolutionContext = { quinn, execsByRole, connectors };

  const sync = await syncBlockers();

  // Progress every active blocker.
  const activeRows = await db
    .select()
    .from(blockersTable)
    .where(inArray(blockersTable.status, ["open", "in_progress", "awaiting_approval", "awaiting_human"]));

  let escalatedToFounder = 0;
  let humanRequired = 0;
  let failed = 0;
  for (const raw of activeRows) {
    const row = await reclassify(raw, ctx);
    const status = await resolveBlocker(row, ctx);
    if (status === "awaiting_approval") escalatedToFounder += 1;
    if (status === "awaiting_human") humanRequired += 1;
    if (status === "failed") failed += 1;
  }

  const summary = await getBlockerSummary();

  await recordEvent({
    type: "reflection",
    title: "Blocker resolution pass complete",
    summary: `${sync.created} new, ${sync.closed} resolved, ${summary.active} active (${escalatedToFounder} awaiting approval, ${humanRequired} need a human).`,
    actorExecutiveId: quinn.id,
    refType: "blocker_pass",
    importance: sync.closed > 0 || escalatedToFounder > 0 ? "normal" : "low",
    keywords: ["blocker", "autonomy", "resolution"],
  }).catch(() => {});

  return {
    ranAt: new Date().toISOString(),
    sync,
    resolvedThisPass: sync.closed,
    escalatedToFounder,
    humanRequired,
    failed,
    active: summary.active,
    byCategory: summary.byCategory,
  };
}

function emptyByCategory(): Record<Category, number> {
  return { autonomous: 0, connected: 0, founder_approval: 0, human_required: 0, unclassified: 0 };
}

// ─── Public: reads for the Blocker Center ────────────────────────────────────

export interface BlockerSummary {
  total: number;
  active: number;
  resolved: number;
  failed: number;
  byCategory: Record<Category, number>;
  byStatus: Record<Status, number>;
}

export async function getBlockerSummary(): Promise<BlockerSummary> {
  const rows = await db
    .select({ category: blockersTable.category, status: blockersTable.status })
    .from(blockersTable);
  const byCategory = emptyByCategory();
  const byStatus: Record<Status, number> = {
    open: 0,
    in_progress: 0,
    awaiting_approval: 0,
    awaiting_human: 0,
    resolved: 0,
    failed: 0,
  };
  let active = 0;
  let resolved = 0;
  let failed = 0;
  for (const r of rows) {
    byStatus[r.status] += 1;
    if (r.status === "resolved") resolved += 1;
    else if (r.status === "failed") failed += 1;
    else {
      active += 1;
      byCategory[r.category] += 1;
    }
  }
  return { total: rows.length, active, resolved, failed, byCategory, byStatus };
}

export interface BlockerView {
  id: string;
  title: string;
  detail: string;
  category: Category;
  status: Status;
  severity: Severity;
  sourceType: SourceType;
  productId: string;
  ownerExecutiveId: string | null;
  ownerName: string | null;
  rootCause: string;
  resolutionPlan: string;
  connectorProvider: string | null;
  estimatedCompletion: string;
  humanAction: string;
  retryCount: number;
  retryHistory: BlockerRetryEntry[];
  objectiveId: string | null;
  approvalId: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
}

function toView(row: BlockerRow, ownerName: string | null): BlockerView {
  return {
    id: row.id,
    title: row.title,
    detail: row.detail,
    category: row.category,
    status: row.status,
    severity: row.severity,
    sourceType: row.sourceType,
    productId: row.productId,
    ownerExecutiveId: row.ownerExecutiveId,
    ownerName,
    rootCause: row.rootCause,
    resolutionPlan: row.resolutionPlan,
    connectorProvider: row.connectorProvider,
    estimatedCompletion: row.estimatedCompletion,
    humanAction: row.humanAction,
    retryCount: row.retryCount,
    retryHistory: row.retryHistory ?? [],
    objectiveId: row.objectiveId,
    approvalId: row.approvalId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    resolvedAt: row.resolvedAt ? row.resolvedAt.toISOString() : null,
  };
}

export async function listBlockers(filter?: { category?: Category; status?: Status }): Promise<BlockerView[]> {
  const conditions = [];
  if (filter?.category) conditions.push(eq(blockersTable.category, filter.category));
  if (filter?.status) conditions.push(eq(blockersTable.status, filter.status));
  const rows = await db
    .select()
    .from(blockersTable)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(blockersTable.updatedAt));

  const execs = await db.select({ id: aiExecutivesTable.id, name: aiExecutivesTable.name }).from(aiExecutivesTable);
  const nameById = new Map(execs.map((e) => [e.id, e.name]));
  const sorted = rows.sort((a, b) => severityRank(b.severity) - severityRank(a.severity));
  return sorted.map((r) => toView(r, r.ownerExecutiveId ? (nameById.get(r.ownerExecutiveId) ?? null) : null));
}

export async function getBlockerById(id: string): Promise<BlockerView | null> {
  const rows = await db.select().from(blockersTable).where(eq(blockersTable.id, id)).limit(1);
  if (rows.length === 0) return null;
  const row = rows[0];
  let ownerName: string | null = null;
  if (row.ownerExecutiveId) {
    const exec = await db
      .select({ name: aiExecutivesTable.name })
      .from(aiExecutivesTable)
      .where(eq(aiExecutivesTable.id, row.ownerExecutiveId))
      .limit(1);
    ownerName = exec[0]?.name ?? null;
  }
  return toView(row, ownerName);
}
