// ─── Specialist Agent Registry — Engineering Expansion ───────────────────────
//
// Mission Control's registry of installed specialist agents (claude-code
// templates under `.claude/agents/` + shared skills under `.claude/skills/`).
//
// Architecture rules (do NOT violate):
//   • Specialists are NOT standalone chatbots. They are expertise modules that
//     an OWNING EXECUTIVE consults while doing their existing work. The Founder
//     never picks a specialist — Quinn routes through the owning executive.
//   • No duplicate routing: matching happens inside the existing orchestration
//     seams (objective decomposition + executive inspection), not a new router.
//   • No duplicate memory: specialist output merges into the existing executive
//     report → approval → briefing pipeline. Only the run ledger is new.
//   • All AI access goes through the provider factory (completeWithFallback),
//     exactly like Quinn and the executives. Deterministic pipelines never
//     block on a specialist — failures degrade to the base inspector report.

import { readFileSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import {
  db,
  specialistRunsTable,
  aiExecutivesTable,
  type ReportFinding,
} from "@workspace/db";
import { completeWithFallback } from "./ai/AIProviderFactory.js";
import type { AIRequest } from "./ai/AIProvider.js";
import { logger } from "../lib/logger.js";

// ─── Registry definition ──────────────────────────────────────────────────────

export type SpecialistKind = "agent" | "skill";

export type SpecialistDef = {
  /** Stable registry id (matches the installed template name). */
  id: string;
  name: string;
  kind: SpecialistKind;
  /** One-line purpose. */
  purpose: string;
  /** Executive role that owns this specialist. "shared" skills list collaborators. */
  ownerRole: string;
  /** Roles that collaborate when a shared skill activates. */
  collaboratorRoles: string[];
  /** When Quinn (via the owner) invokes this specialist. */
  invocationRules: string;
  expectedInputs: string;
  expectedOutputs: string;
  /** Deterministic trigger keywords used at the existing routing seams. */
  triggers: string[];
  /** Prompt source, relative to the repo root. */
  promptFile: string;
};

export const SPECIALISTS: SpecialistDef[] = [
  {
    id: "architect-review",
    name: "Architect Review",
    kind: "agent",
    purpose: "Review code and system changes for architectural consistency, SOLID compliance, and maintainability.",
    ownerRole: "cto",
    collaboratorRoles: [],
    invocationRules:
      "Ada Reeves consults this specialist when an assignment focuses on architecture, structural review, refactors, service boundaries, or system design health.",
    expectedInputs: "Assignment focus + the CTO's deterministic codebase inspection digest.",
    expectedOutputs: "Architectural findings (severity-tagged), risks, and recommendations merged into Ada's report.",
    triggers: ["architecture", "architectural", "refactor", "structure", "design pattern", "solid", "coupling", "boundaries", "tech debt", "scalab", "system design", "code review"],
    promptFile: ".claude/agents/architect-review.md",
  },
  {
    id: "database-architect",
    name: "Database Architect",
    kind: "agent",
    purpose: "Design and evaluate data models, schema evolution, indexing, and database scalability.",
    ownerRole: "cto",
    collaboratorRoles: [],
    invocationRules:
      "Ada Reeves consults this specialist when an assignment involves the database, schema design, migrations, data modeling, or query scalability.",
    expectedInputs: "Assignment focus + the CTO's inspection digest (schema/table facts).",
    expectedOutputs: "Schema/data-model findings and migration-safety recommendations merged into Ada's report.",
    triggers: ["database", "schema", "migration", "data model", "index", "postgres", "sql", "query performance", "drizzle", "table"],
    promptFile: ".claude/agents/database-architect.md",
  },
  {
    id: "debugger",
    name: "Debugger",
    kind: "agent",
    purpose: "Root-cause analysis of failures, crashes, regressions, and anomalous system behavior.",
    ownerRole: "cto",
    collaboratorRoles: [],
    invocationRules:
      "Ada Reeves consults this specialist when an assignment involves a bug, crash, production failure, error investigation, or root-cause analysis.",
    expectedInputs: "Assignment focus + error/log signals from the CTO's inspection digest.",
    expectedOutputs: "Ranked hypotheses, root-cause findings, and fix recommendations merged into Ada's report.",
    triggers: ["bug", "debug", "crash", "error", "failure", "broken", "root cause", "regression", "not working", "investigate", "stack trace", "exception"],
    promptFile: ".claude/agents/debugger.md",
  },
  {
    id: "mobile-developer",
    name: "Mobile Developer",
    kind: "agent",
    purpose: "Cross-platform mobile expertise: React Native/Expo performance, native modules, offline, store readiness.",
    ownerRole: "cto",
    collaboratorRoles: [],
    invocationRules:
      "Ada Reeves consults this specialist when an assignment involves the mobile app, Expo/React Native, app performance, push, deep links, or store submission.",
    expectedInputs: "Assignment focus + mobile-relevant facts from the CTO's inspection digest.",
    expectedOutputs: "Mobile-specific findings and optimization recommendations merged into Ada's report.",
    triggers: ["mobile", "expo", "react native", "ios", "android", "app store", "play store", "push notification", "deep link", "eas", "cold start", "battery"],
    promptFile: ".claude/agents/mobile-developer.md",
  },
  {
    id: "devops-engineer",
    name: "DevOps Engineer",
    kind: "agent",
    purpose: "CI/CD, deployment automation, infrastructure, rollout/rollback strategy, and operational monitoring.",
    ownerRole: "release_manager",
    collaboratorRoles: [],
    invocationRules:
      "Theo Vance consults this specialist when an assignment involves deployments, pipelines, infrastructure, rollouts, rollbacks, or production operations.",
    expectedInputs: "Assignment focus + the Release Manager's build/deploy inspection digest.",
    expectedOutputs: "Deployment/infra findings and rollout-safety recommendations merged into Theo's report.",
    triggers: ["deploy", "deployment", "ci/cd", "pipeline", "infrastructure", "rollout", "rollback", "downtime", "monitoring", "incident", "ops", "publish"],
    promptFile: ".claude/agents/devops-engineer.md",
  },
  {
    id: "task-decomposition-expert",
    name: "Task Decomposition Expert",
    kind: "agent",
    purpose: "Break complex founder objectives into dependency-aware workstreams with clear executive handoffs.",
    ownerRole: "chief_of_staff",
    collaboratorRoles: [],
    invocationRules:
      "Quinn Harlow applies this specialist's method whenever decomposing a founder objective into executive assignments (it sharpens the existing decomposition prompt — it is not a separate planner).",
    expectedInputs: "The founder's objective text + the executive roster.",
    expectedOutputs: "A sharper ObjectivePlan: workstreams, owners, priorities, and rationale.",
    triggers: [],
    promptFile: ".claude/agents/task-decomposition-expert.md",
  },
  {
    id: "content-creator",
    name: "Content Creator",
    kind: "skill",
    purpose: "Marketing content drafting playbook: brand voice, content frameworks, and platform optimization for Dario's learning-based publishing system.",
    ownerRole: "marketing_director",
    collaboratorRoles: [],
    invocationRules:
      "Dario Sol applies this skill every time he drafts marketing content. Drafts are scored by the confidence engine, learn from every Founder decision, and only auto-publish low-risk content once Trusted Marketing Mode is earned.",
    expectedInputs: "A content brief (topic, platform, content type) + the learned Founder style profile.",
    expectedOutputs: "A platform-ready draft (content, tone, CTA, hashtags) stored in the marketing learning ledger with a Founder-approval confidence prediction.",
    triggers: ["marketing content", "social post", "content calendar", "copywriting", "post draft", "caption", "marketing copy"],
    promptFile: ".claude/skills/content-creator/SKILL.md",
  },
  {
    id: "launch-strategy",
    name: "Launch Strategy",
    kind: "skill",
    purpose: "Shared launch playbook: phased launches, channel strategy, and go-to-market momentum.",
    ownerRole: "shared",
    collaboratorRoles: ["marketing_director", "product_manager", "release_manager"],
    invocationRules:
      "Quinn activates this shared skill when an objective concerns launching, go-to-market, beta/early access, or announcements — it guarantees Marketing + Product + Release collaborate on the objective.",
    expectedInputs: "The launch-related objective text.",
    expectedOutputs: "Marketing, Product, and Release all assigned to the objective; their reports carry launch-phase framing.",
    triggers: ["launch", "go-to-market", "go to market", "product hunt", "beta launch", "early access", "waitlist", "announcement", "release strategy", "gtm"],
    promptFile: ".claude/skills/launch-strategy/SKILL.md",
  },
];

export const EXCLUDED_TEMPLATES = ["ai-specialists/hackathon-ai-strategist"];

// ─── Prompt loading ───────────────────────────────────────────────────────────

/** Walk up from cwd to find the repo root containing `.claude/`. */
function findRepoRoot(): string | null {
  let dir = resolve(process.cwd());
  for (let i = 0; i < 6; i++) {
    if (existsSync(join(dir, ".claude"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

const promptCache = new Map<string, string | null>();

/** Load a specialist's system prompt (front matter stripped, size-capped). */
export function loadSpecialistPrompt(spec: SpecialistDef): string | null {
  if (promptCache.has(spec.id)) return promptCache.get(spec.id) ?? null;
  let prompt: string | null = null;
  try {
    const root = findRepoRoot();
    if (root) {
      const full = join(root, spec.promptFile);
      if (existsSync(full)) {
        let raw = readFileSync(full, "utf8");
        // Strip YAML front matter.
        if (raw.startsWith("---")) {
          const end = raw.indexOf("\n---", 3);
          if (end !== -1) raw = raw.slice(end + 4);
        }
        prompt = raw.trim().slice(0, 6000);
        if (!prompt) prompt = null;
      }
    }
  } catch (err) {
    logger.warn({ err, specialist: spec.id }, "specialist registry: failed to load prompt");
    prompt = null;
  }
  promptCache.set(spec.id, prompt);
  return prompt;
}

export function isSpecialistAvailable(spec: SpecialistDef): boolean {
  return loadSpecialistPrompt(spec) !== null;
}

// ─── Deterministic matching (used at existing routing seams only) ────────────

/**
 * Which specialists should the owning executive consult for this focus text?
 * Constrained to the executive's own bench — Quinn routes via owners, so a
 * specialist can never be invoked outside its owner's workstream.
 */
export function matchSpecialistsForRole(role: string, focusText: string): SpecialistDef[] {
  const lower = focusText.toLowerCase();
  return SPECIALISTS.filter(
    (s) =>
      s.kind === "agent" &&
      s.ownerRole === role &&
      s.triggers.length > 0 &&
      s.triggers.some((t) => lower.includes(t)),
  ).slice(0, 2);
}

/** Does this objective text activate the shared launch-strategy skill? */
export function matchesLaunchStrategy(text: string): boolean {
  const skill = SPECIALISTS.find((s) => s.id === "launch-strategy");
  if (!skill || !isSpecialistAvailable(skill)) return false;
  const lower = text.toLowerCase();
  return skill.triggers.some((t) => lower.includes(t));
}

export function getLaunchStrategyCollaborators(): string[] {
  return SPECIALISTS.find((s) => s.id === "launch-strategy")?.collaboratorRoles ?? [];
}

/** Excerpt of the task-decomposition-expert method for Quinn's decomposition prompt. */
export function getDecompositionMethodExcerpt(): string | null {
  const spec = SPECIALISTS.find((s) => s.id === "task-decomposition-expert");
  if (!spec) return null;
  const prompt = loadSpecialistPrompt(spec);
  if (!prompt) return null;
  return prompt.slice(0, 1500);
}

// ─── Specialist consultation (invoked BY the owning executive) ────────────────

export type SpecialistConsultation = {
  specialistId: string;
  specialistName: string;
  summary: string;
  confidence: number;
  findings: ReportFinding[];
  recommendations: string[];
};

const VALID_SEVERITIES = new Set(["info", "warning", "critical"]);

/**
 * Run one specialist against an assignment focus. All output is merged by the
 * caller into the owning executive's report — nothing is stored separately
 * except the run ledger row. Returns null on any failure (never throws).
 */
export async function consultSpecialist(opts: {
  specialist: SpecialistDef;
  focus: string;
  contextDigest: string;
  executive: { id: string; name: string; role: string };
  objectiveId?: string;
  taskId?: string;
}): Promise<SpecialistConsultation | null> {
  const { specialist, focus, contextDigest, executive, objectiveId, taskId } = opts;
  const prompt = loadSpecialistPrompt(specialist);
  const runId = randomUUID();

  const recordRun = async (success: boolean, confidence: number, summary: string): Promise<void> => {
    try {
      await db.insert(specialistRunsTable).values({
        id: runId,
        specialistId: specialist.id,
        executiveId: executive.id,
        objectiveId: objectiveId ?? null,
        taskId: taskId ?? null,
        trigger: focus.slice(0, 500),
        success,
        confidence,
        summary: summary.slice(0, 1000),
      });
    } catch (err) {
      logger.warn({ err, specialist: specialist.id }, "specialist registry: failed to record run");
    }
  };

  if (!prompt) {
    await recordRun(false, 0, "Specialist prompt unavailable — template not installed or unreadable.");
    return null;
  }

  const system =
    `${prompt}\n\n` +
    `━━━ MISSION CONTROL INTEGRATION ━━━\n` +
    `You are the "${specialist.name}" specialist on ${executive.name}'s bench inside Mission Control ` +
    `(VYBE LIVE's executive operating system). ${executive.name} is consulting you on one focused workstream. ` +
    `You do NOT talk to the founder and you do NOT execute changes — you analyze and advise. ` +
    `Ground every statement in the provided context digest; do not invent facts. ` +
    `Respond ONLY with a JSON object: {"summary": string (2-3 sentences), ` +
    `"confidence": number 0-100 (how confident you are in this analysis given the evidence), ` +
    `"findings": [{"severity": "info"|"warning"|"critical", "text": string}] (max 4), ` +
    `"recommendations": [string] (max 3, concrete and actionable)}.`;

  const user = `Workstream focus:\n${focus}\n\nContext digest (deterministic facts from ${executive.name}'s inspection):\n${contextDigest.slice(0, 4000)}`;

  const request: AIRequest = {
    task: "reasoning",
    modelHint: "reasoning",
    systemPrompt: system,
    userContent: user,
    executiveId: executive.id,
    executiveName: executive.name,
    executiveRole: executive.role,
    objectiveId,
    maxTokens: 900,
    responseFormat: "json",
  };

  try {
    const response = await completeWithFallback(request);
    const parsed = response.parsed;
    if (!parsed || typeof parsed !== "object") {
      await recordRun(false, 0, "Specialist returned unparseable output.");
      return null;
    }
    const summary =
      typeof parsed.summary === "string" && parsed.summary.trim()
        ? parsed.summary.trim()
        : `${specialist.name} completed its analysis.`;
    const rawConfidence = typeof parsed.confidence === "number" ? parsed.confidence : 60;
    const confidence = Math.max(0, Math.min(100, Math.round(rawConfidence)));

    const findings: ReportFinding[] = [];
    if (Array.isArray(parsed.findings)) {
      for (const f of parsed.findings.slice(0, 4)) {
        if (!f || typeof f !== "object") continue;
        const rec = f as Record<string, unknown>;
        const severity = typeof rec.severity === "string" && VALID_SEVERITIES.has(rec.severity) ? rec.severity : "info";
        const text = typeof rec.text === "string" ? rec.text.trim() : "";
        if (text) findings.push({ severity: severity as ReportFinding["severity"], text: `[${specialist.name}] ${text}` });
      }
    }
    const recommendations: string[] = Array.isArray(parsed.recommendations)
      ? parsed.recommendations.filter((r): r is string => typeof r === "string" && r.trim().length > 0).slice(0, 3)
      : [];

    await recordRun(true, confidence, summary);
    return { specialistId: specialist.id, specialistName: specialist.name, summary, confidence, findings, recommendations };
  } catch (err) {
    logger.warn({ err, specialist: specialist.id }, "specialist registry: consultation failed — degrading to base report");
    await recordRun(false, 0, err instanceof Error ? err.message : "Consultation failed.");
    return null;
  }
}

// ─── Registry snapshot (API / diagnostics / Quinn discovery) ──────────────────

export type SpecialistStatusEntry = {
  id: string;
  name: string;
  kind: SpecialistKind;
  purpose: string;
  ownerRole: string;
  ownerName: string | null;
  collaboratorRoles: string[];
  invocationRules: string;
  expectedInputs: string;
  expectedOutputs: string;
  triggers: string[];
  promptFile: string;
  available: boolean;
  ownerPresent: boolean;
  /** Derived from run history: avg run confidence, or 60 baseline when unproven. */
  confidence: number;
  runCount: number;
  successCount: number;
  lastRunAt: string | null;
  lastRunSummary: string | null;
};

/** Full registry snapshot with owner presence, availability, and run-derived confidence. */
export async function getSpecialistRegistry(): Promise<SpecialistStatusEntry[]> {
  const execs = await db.select().from(aiExecutivesTable);
  const byRole = new Map(execs.map((e) => [e.role as string, e.name]));

  const entries: SpecialistStatusEntry[] = [];
  for (const spec of SPECIALISTS) {
    const runs = await db
      .select()
      .from(specialistRunsTable)
      .where(eq(specialistRunsTable.specialistId, spec.id))
      .orderBy(desc(specialistRunsTable.createdAt))
      .limit(50);
    const successes = runs.filter((r) => r.success);
    const confidence =
      successes.length > 0
        ? Math.round(successes.reduce((s, r) => s + r.confidence, 0) / successes.length)
        : 60; // unproven baseline
    const ownerPresent =
      spec.ownerRole === "shared"
        ? spec.collaboratorRoles.every((r) => byRole.has(r))
        : byRole.has(spec.ownerRole);
    entries.push({
      id: spec.id,
      name: spec.name,
      kind: spec.kind,
      purpose: spec.purpose,
      ownerRole: spec.ownerRole,
      ownerName:
        spec.ownerRole === "shared"
          ? spec.collaboratorRoles.map((r) => byRole.get(r)).filter(Boolean).join(", ") || null
          : byRole.get(spec.ownerRole) ?? null,
      collaboratorRoles: spec.collaboratorRoles,
      invocationRules: spec.invocationRules,
      expectedInputs: spec.expectedInputs,
      expectedOutputs: spec.expectedOutputs,
      triggers: spec.triggers,
      promptFile: spec.promptFile,
      available: isSpecialistAvailable(spec),
      ownerPresent,
      confidence,
      runCount: runs.length,
      successCount: successes.length,
      lastRunAt: runs[0]?.createdAt.toISOString() ?? null,
      lastRunSummary: runs[0]?.summary || null,
    });
  }
  return entries;
}

/** Compact bench brief injected into Quinn's conversation context for discovery. */
export function getSpecialistBenchBrief(): string {
  const lines = SPECIALISTS.map((s) => {
    const owner =
      s.ownerRole === "shared" ? `shared skill (${s.collaboratorRoles.join(" + ")})` : `owned by ${s.ownerRole}`;
    const avail = isSpecialistAvailable(s) ? "" : " [UNAVAILABLE — template missing]";
    return `- ${s.name} (${owner})${avail}: ${s.purpose}`;
  });
  return (
    `SPECIALIST BENCH (you route these through their owning executive — the founder never picks a specialist):\n` +
    lines.join("\n") +
    `\nWhen a workstream matches a specialist's domain, the owning executive automatically consults them and their findings appear inside that executive's report.`
  );
}
