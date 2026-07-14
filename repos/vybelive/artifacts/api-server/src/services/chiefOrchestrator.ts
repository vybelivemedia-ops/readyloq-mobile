// ─── Chief of Staff orchestrator (hybrid: deterministic facts + AI narrative) ──
// The Chief decomposes a founder objective into per-executive workstreams and,
// once the team has reported, composes a single aggregated briefing.
//
// HYBRID rule: deterministic inspectors produce the FACTS (reports, metrics,
// findings). The model is used ONLY for (a) decomposing a free-text objective
// into structured assignments and (b) sharpening the briefing narrative. Every
// model call has a deterministic fallback, so orchestration never blocks on the
// AI being slow, unavailable, or returning garbage. No secrets are ever sent —
// only the founder's objective text, role descriptions, and report headlines.

import OpenAI from "openai";
import type { ReportRecommendation } from "@workspace/db";
import {
  ROLES_WITH_CAPABILITY,
  aggregateChiefOfStaff,
  CAPABILITY_INFO,
  type CapabilityRole,
  type ExecutiveReport,
} from "./executiveCapabilities/index.js";
import type { ReportInput } from "./executiveCapabilities/chiefOfStaff.js";
import { logger } from "../lib/logger.js";
import {
  matchesLaunchStrategy,
  getLaunchStrategyCollaborators,
  getDecompositionMethodExcerpt,
} from "./specialistRegistry.js";

// ─── Enriched reports ─────────────────────────────────────────────────────────

export type EnrichedReport = ExecutiveReport & {
  confidence: number;
  recommendations: ReportRecommendation[];
  followUps: string[];
  estimatedEffort: string | null;
};

/**
 * Deterministically derive confidence, recommendations, follow-ups, and an
 * effort estimate from a base inspector report. High-impact recommendations are
 * later escalated into the approval workflow. Kept rule-based so the facts behind
 * an approval gate are never invented by a model.
 */
export function enrichReport(base: ExecutiveReport): EnrichedReport {
  const criticals = base.findings.filter((f) => f.severity === "critical");
  const warnings = base.findings.filter((f) => f.severity === "warning");

  let confidence = base.status === "healthy" ? 90 : base.status === "attention" ? 75 : 60;
  confidence -= criticals.length * 5 + warnings.length * 2;
  confidence = Math.max(40, Math.min(95, confidence));

  const recommendations: ReportRecommendation[] = [];
  for (const f of criticals) recommendations.push({ text: `Resolve: ${f.text}`, impact: "high" });
  for (const f of warnings.slice(0, 3)) recommendations.push({ text: `Address: ${f.text}`, impact: "medium" });
  if (recommendations.length === 0) {
    recommendations.push({
      text: "Maintain the current trajectory and keep monitoring for regressions.",
      impact: "low",
    });
  }

  const followUps = base.findings
    .filter((f) => f.severity !== "info")
    .slice(0, 3)
    .map((f) => f.text);
  if (followUps.length === 0) followUps.push("No follow-ups required at this time.");

  const estimatedEffort =
    base.status === "critical" ? "3-5 days" : base.status === "attention" ? "1-2 days" : "< 1 day";

  return { ...base, confidence, recommendations, followUps, estimatedEffort };
}

// ─── AI client (optional, never required) ─────────────────────────────────────

const AI_MODEL = process.env.AI_INTEGRATIONS_OPENAI_MODEL ?? "gpt-5.4";
const AI_TIMEOUT_MS = 20_000;

let cachedClient: OpenAI | null | undefined;
function getClient(): OpenAI | null {
  if (cachedClient !== undefined) return cachedClient;
  const apiKey = process.env.AI_INTEGRATIONS_OPENAI_API_KEY;
  const baseURL = process.env.AI_INTEGRATIONS_OPENAI_BASE_URL;
  cachedClient = apiKey && baseURL ? new OpenAI({ apiKey, baseURL }) : null;
  if (!cachedClient) {
    logger.info("Chief orchestrator: OpenAI not configured — using deterministic planning");
  }
  return cachedClient;
}

// Call the model for a JSON object. Returns null on any failure so callers fall
// back to deterministic logic.
async function callJSON(system: string, user: string): Promise<Record<string, unknown> | null> {
  const client = getClient();
  if (!client) return null;
  try {
    const completion = await client.chat.completions.create(
      {
        model: AI_MODEL,
        max_completion_tokens: 1500,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      },
      { timeout: AI_TIMEOUT_MS },
    );
    const text = completion.choices[0]?.message?.content;
    if (!text) return null;
    const parsed: unknown = JSON.parse(text);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch (err) {
    logger.warn({ err }, "Chief orchestrator: AI call failed — falling back to deterministic logic");
    return null;
  }
}

// ─── Objective decomposition ──────────────────────────────────────────────────

export type TaskPriority = "low" | "medium" | "high" | "critical";

export type ObjectiveAssignment = {
  role: CapabilityRole;
  focus: string;
  priority: TaskPriority;
};

export type ObjectivePlan = {
  title: string;
  rationale: string;
  assignments: ObjectiveAssignment[];
};

export type ExecutiveBrief = { role: string; name: string; title: string };

const PRIORITIES: TaskPriority[] = ["low", "medium", "high", "critical"];

// Keyword → role hints for the deterministic fallback planner.
const ROLE_KEYWORDS: Record<CapabilityRole, string[]> = {
  cto: ["architecture", "infra", "scale", "performance", "backend", "api", "engineering", "system", "database", "security"],
  qa_director: ["test", "quality", "bug", "regression", "qa", "coverage", "stability", "reliability"],
  release_manager: ["release", "deploy", "ship", "launch", "rollout", "version", "build", "changelog"],
  product_manager: ["product", "roadmap", "feature", "backlog", "prioritize", "user", "creator", "discovery"],
  creative_director: ["design", "brand", "ui", "ux", "visual", "motion", "creative", "look", "feel"],
  marketing_director: ["marketing", "growth", "campaign", "audience", "acquisition", "retention", "content", "positioning"],
};

function clampPriority(p: unknown): TaskPriority {
  return typeof p === "string" && (PRIORITIES as string[]).includes(p) ? (p as TaskPriority) : "medium";
}

function deriveTitle(request: string): string {
  const clean = request.trim().replace(/\s+/g, " ");
  if (!clean) return "New objective";
  const firstSentence = clean.split(/[.!?\n]/)[0]!.trim();
  const title = firstSentence.length > 0 ? firstSentence : clean;
  return title.length > 90 ? `${title.slice(0, 87)}…` : title;
}

function deterministicPlan(request: string, execs: ExecutiveBrief[]): ObjectivePlan {
  const lower = request.toLowerCase();
  const available = new Set(execs.map((e) => e.role));
  const matched: CapabilityRole[] = [];
  for (const role of ROLES_WITH_CAPABILITY) {
    if (!available.has(role)) continue;
    if (ROLE_KEYWORDS[role].some((kw) => lower.includes(kw))) matched.push(role);
  }
  // No keyword hits → engage the whole capability bench so nothing is missed.
  const roles = matched.length > 0 ? matched : ROLES_WITH_CAPABILITY.filter((r) => available.has(r));

  const assignments: ObjectiveAssignment[] = roles.map((role) => ({
    role,
    focus: `${CAPABILITY_INFO[role]?.responsibility ?? "Assess your area"} as it relates to: ${deriveTitle(request)}`,
    priority: role === "cto" || role === "qa_director" ? "high" : "medium",
  }));

  return {
    title: deriveTitle(request),
    rationale:
      `Decomposed the objective across ${assignments.length} executive${assignments.length === 1 ? "" : "s"} ` +
      `based on the areas it touches. Each will inspect their domain and report findings for consolidation.`,
    assignments,
  };
}

/**
 * Decompose a founder objective into per-executive assignments. Tries the model
 * for sharper routing/rationale, but always validates against the real roster
 * and falls back to deterministic keyword routing.
 */
// ENGINEERING EXPANSION — shared launch-strategy skill.
// When the objective is launch-related, guarantee Marketing + Product + Release
// all collaborate on it, regardless of what the model picked. This is the
// deterministic activation of the shared `launch-strategy` skill.
function applyLaunchStrategySkill(
  plan: ObjectivePlan,
  request: string,
  execs: ExecutiveBrief[],
): ObjectivePlan {
  if (!matchesLaunchStrategy(request)) return plan;
  const validRoles = new Set(execs.map((e) => e.role));
  const assigned = new Set(plan.assignments.map((a) => a.role as string));
  for (const role of getLaunchStrategyCollaborators()) {
    if (assigned.has(role)) continue;
    if (!validRoles.has(role) || !(ROLES_WITH_CAPABILITY as readonly string[]).includes(role)) continue;
    plan.assignments.push({
      role: role as CapabilityRole,
      focus: `Apply the launch-strategy playbook to your domain for: ${deriveTitle(request)}`,
      priority: "high",
    });
    assigned.add(role);
  }
  return plan;
}

export async function decomposeObjective(
  request: string,
  execs: ExecutiveBrief[],
): Promise<ObjectivePlan> {
  const fallback = applyLaunchStrategySkill(deterministicPlan(request, execs), request, execs);
  const roster = execs
    .filter((e) => (ROLES_WITH_CAPABILITY as readonly string[]).includes(e.role))
    .map((e) => `- ${e.role} (${e.name}, ${e.title}): ${CAPABILITY_INFO[e.role]?.responsibility ?? ""}`)
    .join("\n");

  // ENGINEERING EXPANSION — sharpen decomposition with the task-decomposition-
  // expert method (Quinn's own specialist). This augments the existing prompt;
  // it is NOT a separate planner or router.
  const methodExcerpt = getDecompositionMethodExcerpt();
  const system =
    "You are the Chief of Staff of an AI executive team for VYBE LIVE, a livestreaming platform. " +
    "Decompose the founder's objective into focused workstreams, each owned by exactly one executive. " +
    "Only use executives from the roster. Respond ONLY with a JSON object of the form " +
    '{"title": string, "rationale": string, "assignments": [{"role": string, "focus": string, "priority": "low"|"medium"|"high"|"critical"}]}. ' +
    "Assign only the executives whose domain is genuinely relevant (1 to 6). Keep focus to one sentence." +
    (methodExcerpt
      ? `\n\nApply this decomposition method when splitting the objective:\n${methodExcerpt}`
      : "");
  const user = `Executive roster:\n${roster}\n\nFounder objective:\n"""${request}"""`;

  const json = await callJSON(system, user);
  if (!json) return fallback;

  const rawAssignments = Array.isArray(json.assignments) ? json.assignments : [];
  const validRoles = new Set(execs.map((e) => e.role));
  const seen = new Set<string>();
  const assignments: ObjectiveAssignment[] = [];
  for (const a of rawAssignments) {
    if (!a || typeof a !== "object") continue;
    const rec = a as Record<string, unknown>;
    const role = typeof rec.role === "string" ? rec.role : "";
    if (
      !(ROLES_WITH_CAPABILITY as readonly string[]).includes(role) ||
      !validRoles.has(role) ||
      seen.has(role)
    ) {
      continue;
    }
    seen.add(role);
    const focus =
      typeof rec.focus === "string" && rec.focus.trim()
        ? rec.focus.trim()
        : `Assess your area for: ${deriveTitle(request)}`;
    assignments.push({ role: role as CapabilityRole, focus, priority: clampPriority(rec.priority) });
  }
  if (assignments.length === 0) return fallback;

  const title = typeof json.title === "string" && json.title.trim() ? json.title.trim() : fallback.title;
  const rationale =
    typeof json.rationale === "string" && json.rationale.trim() ? json.rationale.trim() : fallback.rationale;
  return applyLaunchStrategySkill(
    { title: title.length > 90 ? `${title.slice(0, 87)}…` : title, rationale, assignments },
    request,
    execs,
  );
}

// ─── Briefing composition ─────────────────────────────────────────────────────

export type BriefingContext = {
  title: string;
  request: string;
  inputs: { name: string; title: string; role: string; report: EnrichedReport | null }[];
  collaborationCount: number;
  approvalsResolved: number;
};

/**
 * Compose the Chief's aggregated briefing for a completed objective. Facts come
 * from deterministic aggregation; the model is used only to sharpen the headline
 * and summary narrative, with a deterministic fallback.
 */
export async function composeBriefing(ctx: BriefingContext): Promise<EnrichedReport> {
  const reportInputs: ReportInput[] = ctx.inputs.map((i) => ({
    name: i.name,
    title: i.title,
    report: i.report,
  }));
  const base = aggregateChiefOfStaff(reportInputs);

  // Aggregate recommendations/follow-ups from the team, attributed.
  const recommendations: ReportRecommendation[] = [];
  const followUps: string[] = [];
  let confidenceSum = 0;
  let confidenceN = 0;
  for (const i of ctx.inputs) {
    if (!i.report) continue;
    confidenceSum += i.report.confidence;
    confidenceN += 1;
    for (const r of i.report.recommendations) {
      if (r.impact !== "low") recommendations.push({ text: `${i.title}: ${r.text}`, impact: r.impact });
    }
    for (const f of i.report.followUps.slice(0, 1)) followUps.push(`${i.title}: ${f}`);
  }
  if (recommendations.length === 0) {
    recommendations.push({ text: "No high-impact decisions outstanding.", impact: "low" });
  }
  if (followUps.length === 0) followUps.push("No cross-team follow-ups outstanding.");

  const confidence = confidenceN > 0 ? Math.round(confidenceSum / confidenceN) : 70;
  const estimatedEffort = base.status === "critical" ? "3-5 days" : base.status === "attention" ? "1-2 days" : "< 1 day";

  let headline = base.headline;
  let summary = base.summary;

  const digest = ctx.inputs
    .map((i) => `- ${i.title} (${i.report?.status ?? "no report"}): ${i.report?.headline ?? "n/a"}`)
    .join("\n");
  const system =
    "You are the Chief of Staff of an AI executive team. Write a crisp, honest briefing for the founder " +
    "consolidating the team's findings on one objective. Be specific and direct; do not invent facts beyond " +
    'the digest. Respond ONLY with JSON of the form {"headline": string, "summary": string}. ' +
    "Headline <= 90 chars; summary 2-4 sentences.";
  const user =
    `Objective: ${ctx.title}\nFounder request: """${ctx.request}"""\n` +
    `Overall posture: ${base.status}\nCollaborations: ${ctx.collaborationCount}\nApprovals resolved: ${ctx.approvalsResolved}\n\n` +
    `Executive digest:\n${digest}`;

  const json = await callJSON(system, user);
  if (json) {
    if (typeof json.headline === "string" && json.headline.trim()) {
      const h = json.headline.trim();
      headline = h.length > 90 ? `${h.slice(0, 87)}…` : h;
    }
    if (typeof json.summary === "string" && json.summary.trim()) summary = json.summary.trim();
  }

  return {
    status: base.status,
    headline,
    summary,
    metrics: base.metrics,
    findings: base.findings,
    confidence,
    recommendations: recommendations.slice(0, 8),
    followUps: followUps.slice(0, 6),
    estimatedEffort,
  };
}
