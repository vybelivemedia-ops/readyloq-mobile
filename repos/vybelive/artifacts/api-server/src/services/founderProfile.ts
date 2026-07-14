// ─── Founder Operating Profile Service ────────────────────────────────────────
//
// Quinn continuously learns how the Founder operates. This service:
//   1. Analyzes founder messages and approval decisions for behavioral signals
//   2. Merges signals into the persistent profile (never assumes, only observes)
//   3. Exposes the profile for injection into Quinn's reasoning context
//
// PRINCIPLE: Never assume. Learn only from repeated behavior or explicit statements.
// Confidence gates: low (1–2), medium (3–5), high (6+) observations.

import { randomUUID } from "node:crypto";
import {
  db,
  founderProfileInsightsTable,
  agentMemoryTable,
  aiExecutivesTable,
  type FounderProfileInsightRow,
} from "@workspace/db";
import { eq, and, desc, inArray } from "drizzle-orm";
import { completeWithFallback } from "./ai/AIProviderFactory.js";
import {
  formatOperatingProfileForQuinn,
  summarizeOperatingProfile,
} from "./founderOperatingProfile.js";
import { logger } from "../lib/logger.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ProfileCategory =
  | "communication_style"
  | "decision_patterns"
  | "risk_tolerance"
  | "release_philosophy"
  | "product_priorities"
  | "company_priorities"
  | "approval_habits"
  | "work_schedule"
  | "executive_trust"
  | "strategic_goals";

export type ProfileConfidence = "low" | "medium" | "high";
export type ProfileSource = "observed" | "explicit";

export type ExtractedSignal = {
  category: ProfileCategory;
  insight: string;
  isExplicit: boolean;
  evidence: string;
};

export type ProfileInsight = {
  id: string;
  category: ProfileCategory;
  insight: string;
  confidence: ProfileConfidence;
  source: ProfileSource;
  evidence: string[];
  observationCount: number;
  lastObservedAt: string;
};

export type ProfileByCategory = Record<ProfileCategory, ProfileInsight[]>;

// ─── Category display metadata ────────────────────────────────────────────────

export const CATEGORY_META: Record<ProfileCategory, { label: string; description: string; icon: string }> = {
  communication_style:  { label: "Communication Style",  description: "How the Founder prefers to send and receive information", icon: "MessageSquare" },
  decision_patterns:    { label: "Decision Patterns",     description: "How the Founder reaches and communicates decisions",       icon: "GitBranch" },
  risk_tolerance:       { label: "Risk Tolerance",        description: "How much uncertainty the Founder accepts before acting",   icon: "Shield" },
  release_philosophy:   { label: "Release Philosophy",    description: "How the Founder approaches shipping and launch timing",   icon: "Rocket" },
  product_priorities:   { label: "Product Priorities",    description: "What features and outcomes the Founder values most",      icon: "Star" },
  company_priorities:   { label: "Company Priorities",    description: "Overarching business goals and strategic focus areas",    icon: "Target" },
  approval_habits:      { label: "Approval Habits",       description: "When and how quickly the Founder approves proposals",     icon: "CheckCircle" },
  work_schedule:        { label: "Work Schedule",         description: "When the Founder is typically active and responsive",     icon: "Clock" },
  executive_trust:      { label: "Executive Trust Levels",description: "Which executives the Founder engages most and defers to", icon: "Users" },
  strategic_goals:      { label: "Strategic Goals",       description: "Long-term outcomes the Founder has stated or implied",    icon: "TrendingUp" },
};

const ALL_CATEGORIES = Object.keys(CATEGORY_META) as ProfileCategory[];

// ─── Confidence calculation ───────────────────────────────────────────────────

function calcConfidence(n: number): ProfileConfidence {
  if (n >= 6) return "high";
  if (n >= 3) return "medium";
  return "low";
}

// ─── AI signal extraction ─────────────────────────────────────────────────────

const EXTRACT_SYSTEM = `You are a behavioral analyst extracting operating patterns from a founder's messages and actions. Your job is to identify behavioral signals — patterns that reveal how this person operates, not just what they said.

RULES:
- NEVER fabricate signals. Only extract what is genuinely present.
- Focus on PATTERNS not content: HOW they communicate, not WHAT they said.
- Explicit statements (e.g. "I prefer X") → source: explicit
- Inferred from style/tone/structure → source: observed
- Be specific and falsifiable: "Uses 1–3 word directives" not "is direct"
- If there is no clear behavioral signal, return an empty array.
- Extract 0–3 signals maximum. Quality over quantity.

OUTPUT (JSON only, no markdown):
{
  "signals": [
    {
      "category": "communication_style" | "decision_patterns" | "risk_tolerance" | "release_philosophy" | "product_priorities" | "company_priorities" | "approval_habits" | "work_schedule" | "executive_trust" | "strategic_goals",
      "insight": "<specific, falsifiable behavioral pattern — max 15 words>",
      "isExplicit": true | false,
      "evidence": "<exact quote or action that supports this — max 30 words>"
    }
  ]
}`;

async function extractSignals(
  contextDescription: string,
  content: string,
): Promise<ExtractedSignal[]> {
  const userContent = `CONTEXT: ${contextDescription}\n\nCONTENT TO ANALYZE:\n${content}`;

  try {
    const response = await completeWithFallback({
      task: "profile_analysis",
      modelHint: "fast",
      systemPrompt: EXTRACT_SYSTEM,
      userContent,
      maxTokens: 400,
      responseFormat: "json",
      executiveId: "system",
      executiveName: "System",
      executiveRole: "profile_analysis",
    });

    if (response.fromFallback || !response.parsed) return [];
    const signals = Array.isArray(response.parsed?.signals) ? response.parsed.signals : [];
    return signals
      .filter(
        (s: unknown): s is ExtractedSignal =>
          s !== null &&
          typeof s === "object" &&
          typeof (s as Record<string, unknown>).category === "string" &&
          ALL_CATEGORIES.includes((s as Record<string, unknown>).category as ProfileCategory) &&
          typeof (s as Record<string, unknown>).insight === "string" &&
          ((s as Record<string, unknown>).insight as string).trim().length > 0,
      )
      .slice(0, 3);
  } catch (err) {
    logger.warn({ err }, "founder profile: signal extraction failed — skipping");
    return [];
  }
}

// ─── Signal → profile merge ───────────────────────────────────────────────────

/**
 * Checks if two insight strings are likely the same pattern.
 * Uses word-overlap as a simple heuristic (no AI call needed for dedup).
 */
function isSimilarInsight(a: string, b: string): boolean {
  const stopWords = new Set(["the", "a", "an", "is", "are", "was", "were", "to", "of", "and", "or", "in", "on", "at", "for", "with"]);
  const tokenize = (s: string) =>
    s.toLowerCase().split(/\W+/).filter((w) => w.length > 3 && !stopWords.has(w));
  const ta = new Set(tokenize(a));
  const tb = new Set(tokenize(b));
  const overlap = [...ta].filter((w) => tb.has(w)).length;
  return overlap >= 2;
}

async function mergeSignalIntoProfile(signal: ExtractedSignal): Promise<void> {
  // Load existing insights in this category
  const existing = await db
    .select()
    .from(founderProfileInsightsTable)
    .where(
      and(
        eq(founderProfileInsightsTable.category, signal.category),
        eq(founderProfileInsightsTable.isActive, true),
      ),
    )
    .orderBy(desc(founderProfileInsightsTable.observationCount));

  // Try to find a similar insight
  const match = existing.find((row) => isSimilarInsight(row.insight, signal.insight));

  if (match) {
    // Update existing — increment count, add evidence, upgrade confidence, update text if confidence improves
    const newCount = match.observationCount + 1;
    const newConfidence = calcConfidence(newCount);
    const newEvidence = [...(match.evidence as string[]), signal.evidence].slice(-8); // keep last 8
    // Prefer the insight text from the higher-confidence version
    const newInsight = newCount >= 6 ? signal.insight : match.insight;

    await db
      .update(founderProfileInsightsTable)
      .set({
        insight: newInsight,
        confidence: newConfidence,
        source: signal.isExplicit ? "explicit" : match.source,
        evidence: newEvidence,
        observationCount: newCount,
        lastObservedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(founderProfileInsightsTable.id, match.id));
  } else {
    // Insert new insight
    await db.insert(founderProfileInsightsTable).values({
      id: randomUUID(),
      category: signal.category,
      insight: signal.insight,
      confidence: "low",
      source: signal.isExplicit ? "explicit" : "observed",
      evidence: [signal.evidence],
      observationCount: 1,
      isActive: true,
    });
  }
}

// ─── Deterministic signal helpers ─────────────────────────────────────────────
// AI extraction is intentionally conservative ("never fabricate"), which means
// sparse histories produce almost nothing. These deterministic signals learn
// from the ACTION itself — the founder created an objective, decided an
// approval, corrected Quinn — which is always a genuine behavioral observation.

/** Correction cues: the founder is redirecting/overriding previous output. */
const CORRECTION_RE =
  /^(no[,.\s]|no\b.*\b(that|this|it)\b|that'?s (not|wrong)|actually[,\s]|instead[,\s]|not what i|wrong[,.\s]|stop[,.\s]|don'?t (do|use|make)|undo\b|revert\b|i said\b|i meant\b|you misunderstood|change (that|this|it)\b|redo\b)/i;

export function detectCorrection(message: string): boolean {
  return CORRECTION_RE.test(message.trim());
}

/** Release-related approval titles feed the release_philosophy category. */
const RELEASE_RE = /\b(deploy|release|publish|launch|ship|production|rollout|app store|play store|go.?live)\b/i;

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Fire-and-forget: analyze a founder message for behavioral signals.
 * Call this after Quinn responds — it must not block the response.
 */
export async function analyzeFounderMessage(
  message: string,
  priorContext: string,
  messageHour?: number, // 0–23, local server time
): Promise<void> {
  if (message.trim().length < 4) return; // too short to extract anything meaningful

  const contextDescription =
    `Founder message to Quinn (Chief of Staff AI). Prior context: ${priorContext.slice(0, 200)}` +
    (messageHour !== undefined ? ` Sent at hour ${messageHour} (24h).` : "");

  const signals = await extractSignals(contextDescription, message);

  // Deterministic: founder corrections are a strong decision-pattern signal
  // that the conservative AI extractor frequently misses on short messages.
  if (detectCorrection(message)) {
    signals.push({
      category: "decision_patterns",
      insight: "Corrects course directly and immediately when output misses expectations",
      isExplicit: false,
      evidence: `Correction: "${message.slice(0, 60)}"`,
    });
  }

  // Deterministic: message length is a measurable communication-style trait.
  const trimmed = message.trim();
  if (trimmed.length > 0 && trimmed.length <= 80) {
    signals.push({
      category: "communication_style",
      insight: "Communicates in short, direct messages — no preamble",
      isExplicit: false,
      evidence: `${trimmed.length}-char message: "${trimmed.slice(0, 50)}"`,
    });
  } else if (trimmed.length >= 400) {
    signals.push({
      category: "communication_style",
      insight: "Writes detailed, thorough instructions when briefing the team",
      isExplicit: false,
      evidence: `${trimmed.length}-char message: "${trimmed.slice(0, 50)}"`,
    });
  }

  // Also extract schedule signal from hour
  if (messageHour !== undefined && signals.length < 3) {
    const bucket =
      messageHour < 6 ? "late night (before 6am)"
      : messageHour < 9 ? "early morning (6–9am)"
      : messageHour < 12 ? "morning (9am–12pm)"
      : messageHour < 17 ? "afternoon (12–5pm)"
      : messageHour < 21 ? "evening (5–9pm)"
      : "late evening (after 9pm)";
    signals.push({
      category: "work_schedule",
      insight: `Typically active in the ${bucket}`,
      isExplicit: false,
      evidence: `Message sent during ${bucket} window`,
    });
  }

  for (const signal of signals) {
    await mergeSignalIntoProfile(signal).catch((err) => {
      logger.warn({ err, signal }, "founder profile: failed to merge signal");
    });
  }

  // Self-heal: when a priority-bearing signal lands, retire any inferred insight
  // that now contradicts the declared priorities. Fire-and-forget; never blocks.
  // The autonomous loop only touches the REVERSIBLE inferred-insights table
  // (soft isActive=false). Executive memory is canonical and is never deleted
  // autonomously — that runs only via the explicit reconcileFounderPriorities().
  if (signals.some((s) => RECONCILE_CATEGORIES.includes(s.category))) {
    void reconcileInsightsWithOperatingProfile().catch((err) => {
      logger.warn({ err }, "founder profile: post-merge reconciliation failed");
    });
  }
}

/**
 * Fire-and-forget: analyze an approval decision for behavioral signals.
 */
export async function analyzeApprovalDecision(
  title: string,
  detail: string | null,
  decision: "approved" | "rejected" | "deferred",
  responseTimeMs?: number,
): Promise<void> {
  const contextDescription =
    `Founder approval decision. Title: "${title}". Decision: ${decision}.` +
    (responseTimeMs !== undefined ? ` Response time: ${Math.round(responseTimeMs / 1000 / 60)} minutes.` : "") +
    ` Detail: ${detail?.slice(0, 150) ?? "none"}`;

  const signals = await extractSignals(
    "Founder approval decision on an executive recommendation",
    contextDescription,
  );

  // Always add an approval_habits signal from the decision itself
  const habitSignal: ExtractedSignal = {
    category: "approval_habits",
    insight:
      decision === "approved" ? "Tends to approve executive recommendations"
      : decision === "rejected" ? "Scrutinizes proposals before approving"
      : "Sometimes defers decisions — comfortable with 'decide later'",
    isExplicit: false,
    evidence: `${decision} "${title.slice(0, 60)}"`,
  };
  signals.unshift(habitSignal);

  // Deterministic: release-related approvals reveal release philosophy.
  if (RELEASE_RE.test(title)) {
    signals.push({
      category: "release_philosophy",
      insight:
        decision === "approved"
          ? "Green-lights releases once preparation is done — trusts the process"
          : decision === "rejected"
            ? "Blocks releases that have not met the bar — quality over speed"
            : "Holds release timing decisions until the moment feels right",
      isExplicit: false,
      evidence: `${decision} release-related: "${title.slice(0, 60)}"`,
    });
  }

  // Deterministic: decision speed is a decision-pattern observation.
  if (responseTimeMs !== undefined && responseTimeMs >= 0) {
    const minutes = responseTimeMs / 60000;
    if (minutes <= 30) {
      signals.push({
        category: "decision_patterns",
        insight: "Decides on approvals quickly — usually within minutes",
        isExplicit: false,
        evidence: `Decided "${title.slice(0, 50)}" in ${Math.max(1, Math.round(minutes))} min`,
      });
    } else if (minutes >= 24 * 60) {
      signals.push({
        category: "decision_patterns",
        insight: "Lets approval decisions sit before deciding — deliberate pace",
        isExplicit: false,
        evidence: `Decided "${title.slice(0, 50)}" after ${Math.round(minutes / 60)} hours`,
      });
    }
  }

  for (const signal of signals.slice(0, 5)) {
    await mergeSignalIntoProfile(signal).catch((err) => {
      logger.warn({ err, signal }, "founder profile: approval signal failed");
    });
  }
}

/**
 * Fire-and-forget: the founder directed Quinn to launch an objective.
 * The objective itself is an explicit statement of what matters right now.
 */
export async function analyzeObjectiveDirective(title: string, request: string): Promise<void> {
  const signals: ExtractedSignal[] = [
    {
      category: "strategic_goals",
      insight: `Actively driving: ${title.slice(0, 70)}`,
      isExplicit: true,
      evidence: `Launched objective: "${request.slice(0, 80)}"`,
    },
    {
      category: "decision_patterns",
      insight: "Initiates work through direct objectives rather than open-ended discussion",
      isExplicit: false,
      evidence: `Directive: "${request.slice(0, 60)}"`,
    },
  ];

  // AI pass over the request text can surface product/company priorities.
  const extracted = await extractSignals(
    "Founder launched a new objective for the executive team. Look for product priorities, company priorities, risk tolerance, or strategic goals.",
    request,
  );
  signals.push(...extracted);

  for (const signal of signals.slice(0, 5)) {
    await mergeSignalIntoProfile(signal).catch((err) => {
      logger.warn({ err, signal }, "founder profile: objective signal failed");
    });
  }
}

/**
 * Fire-and-forget: the founder engaged a specific executive directly.
 * Direct engagement is the observable form of executive trust.
 */
export async function analyzeExecutiveEngagement(
  execName: string,
  execTitle: string,
  message: string,
): Promise<void> {
  const signals: ExtractedSignal[] = [
    {
      category: "executive_trust",
      insight: `Engages ${execName} (${execTitle}) directly with requests`,
      isExplicit: false,
      evidence: `To ${execName}: "${message.slice(0, 60)}"`,
    },
  ];
  if (detectCorrection(message)) {
    signals.push({
      category: "decision_patterns",
      insight: "Corrects course directly and immediately when output misses expectations",
      isExplicit: false,
      evidence: `Correction to ${execName}: "${message.slice(0, 50)}"`,
    });
  }
  for (const signal of signals) {
    await mergeSignalIntoProfile(signal).catch((err) => {
      logger.warn({ err, signal }, "founder profile: exec engagement signal failed");
    });
  }
}

/**
 * Fire-and-forget: the founder decided a marketing post (approve/reject/edit).
 */
export async function analyzeMarketingDecision(
  decision: "approved" | "rejected",
  platform: string,
  topic: string,
  founderEdited: boolean,
): Promise<void> {
  const signals: ExtractedSignal[] = [
    {
      category: "approval_habits",
      insight:
        decision === "approved"
          ? "Personally reviews marketing content before it publishes"
          : "Rejects marketing content that misses the brand mark",
      isExplicit: false,
      evidence: `${decision} ${platform || "marketing"} post: "${topic.slice(0, 50)}"`,
    },
  ];
  if (founderEdited) {
    signals.push({
      category: "communication_style",
      insight: "Hands-on with copy — edits marketing drafts before approving",
      isExplicit: false,
      evidence: `Edited ${platform || "marketing"} draft: "${topic.slice(0, 50)}"`,
    });
  }
  for (const signal of signals) {
    await mergeSignalIntoProfile(signal).catch((err) => {
      logger.warn({ err, signal }, "founder profile: marketing signal failed");
    });
  }
}

// ─── Read API ─────────────────────────────────────────────────────────────────

export async function getAllInsights(): Promise<FounderProfileInsightRow[]> {
  return db
    .select()
    .from(founderProfileInsightsTable)
    .where(eq(founderProfileInsightsTable.isActive, true))
    .orderBy(desc(founderProfileInsightsTable.observationCount));
}

export function groupByCategory(rows: FounderProfileInsightRow[]): ProfileByCategory {
  const result = {} as ProfileByCategory;
  for (const cat of ALL_CATEGORIES) {
    result[cat] = rows
      .filter((r) => r.category === cat)
      .map((r) => ({
        id: r.id,
        category: r.category as ProfileCategory,
        insight: r.insight,
        confidence: r.confidence as ProfileConfidence,
        source: r.source as ProfileSource,
        evidence: r.evidence as string[],
        observationCount: r.observationCount,
        lastObservedAt: r.lastObservedAt.toISOString(),
      }));
  }
  return result;
}

/**
 * Returns a compact profile string suitable for injection into Quinn's
 * system prompt context. Only includes medium+ confidence insights.
 * Returns null if the profile is empty.
 */
export async function formatProfileForQuinn(): Promise<string | null> {
  const rows = await db
    .select()
    .from(founderProfileInsightsTable)
    .where(
      and(
        eq(founderProfileInsightsTable.isActive, true),
        inArray(founderProfileInsightsTable.confidence, ["medium", "high"]),
      ),
    )
    .orderBy(desc(founderProfileInsightsTable.observationCount));

  if (rows.length === 0) return null;

  const lines: string[] = [];
  const byCategory = new Map<string, FounderProfileInsightRow[]>();
  for (const row of rows) {
    const arr = byCategory.get(row.category) ?? [];
    arr.push(row);
    byCategory.set(row.category, arr);
  }

  for (const [cat, catRows] of byCategory.entries()) {
    const meta = CATEGORY_META[cat as ProfileCategory];
    if (!meta) continue;
    const top = catRows.slice(0, 2); // max 2 insights per category
    for (const row of top) {
      const confidenceTag = row.confidence === "high" ? "★★★" : "★★";
      const sourceTag = row.source === "explicit" ? "[stated]" : "[observed]";
      lines.push(
        `• ${meta.label}: ${row.insight} ${confidenceTag} ${sourceTag} (${row.observationCount} obs.)`,
      );
    }
  }

  if (lines.length === 0) return null;

  return [
    "━━━ FOUNDER OPERATING PROFILE (evidence-based, never assumed) ━━━",
    ...lines,
    "",
    "PROFILE REFERENCE RULE: When making recommendations, cite the specific profile insight that influenced your reasoning.",
    `Example: "I recommend X because your profile shows you consistently prefer Y (observed ${rows[0]?.observationCount ?? "N"} times)."`,
    "Only reference profile insights that are directly relevant. Never invent profile data.",
  ].join("\n");
}

// ─── V11 Tier 1: unified Founder reasoning preamble ───────────────────────────
//
// The single source of truth for the Founder-context preamble fed into every
// Quinn reasoning path (chat, briefing, autonomy). The explicit, Founder-authored
// operating profile (Tier 0) is ALWAYS present and authoritative; the
// evidence-based inferred insights (medium+ confidence) follow as supplementary,
// observed signals. Both forms compose the same two sources so no path duplicates
// this assembly logic.

/**
 * Full Founder-context preamble for conversational/strategic reasoning.
 * Operating profile (authoritative) + inferred insights (supplementary, may be
 * absent until enough behavior is observed).
 */
export async function getFounderProfilePreamble(): Promise<string> {
  const inferred = await formatProfileForQuinn().catch(() => null);
  return [formatOperatingProfileForQuinn(), inferred].filter(Boolean).join("\n\n");
}

/**
 * Compact one-block Founder-context summary for high-density surfaces (e.g. the
 * morning briefing). Accepts already-fetched insight rows to avoid a redundant
 * query; falls back to fetching when none are supplied.
 */
export async function getFounderProfileSummary(
  insights?: FounderProfileInsightRow[],
): Promise<string> {
  const rows = insights ?? (await getAllInsights().catch(() => []));
  const highConfidence = rows.filter(
    (p) => p.confidence === "high" || p.confidence === "medium",
  );
  const observed =
    highConfidence.length > 0
      ? highConfidence
          .slice(0, 5)
          .map((p) => `[${p.category}] ${p.insight}`)
          .join("; ")
      : "No observed profile signals yet.";
  return `${summarizeOperatingProfile()} Observed: ${observed}`;
}

// ─── V11 Tier 1: reconcile inferred insights vs. declared priorities ──────────
//
// The explicit, Founder-authored operating profile (Tier 0) is authoritative.
// Inferred insights are supplementary and CAN drift out of date — e.g. an old
// "top priority is creator retention" signal survives after the Founder declares
// a launch-first priority order. At reasoning time Tier 0 already outranks these,
// but a stale signal still pollutes retrieval and can be cited. This routine
// retires inferred insights that DIRECTLY CONTRADICT the declared priorities so
// the profile self-heals instead of waiting to decay.
//
// Only priority-asserting categories are eligible. Explicit (Founder-stated)
// insights are never auto-retired — only observed ones. Safe-by-default: any AI
// failure retires nothing.

const RECONCILE_CATEGORIES: ProfileCategory[] = [
  "company_priorities",
  "product_priorities",
  "strategic_goals",
  "release_philosophy",
];

export type RetiredInsight = {
  id: string;
  category: ProfileCategory;
  insight: string;
  reason: string;
};

const RECONCILE_SYSTEM = `You are auditing a founder's INFERRED behavioral insights against their EXPLICIT, authoritative operating profile. The explicit profile always wins.

Your job: flag ONLY inferred insights that DIRECTLY CONTRADICT the declared priorities — e.g. they name a DIFFERENT single top priority, or assert a focus the founder has explicitly deprioritized or moved to "later".

NOT a contradiction (keep these): insights that merely add nuance, describe communication/work style, or are compatible with the declared priorities even if narrower.

Be conservative. When in doubt, KEEP. Retiring a real signal is worse than leaving a harmless one.

OUTPUT (JSON only, no markdown):
{
  "retire": [
    { "id": "<insight id>", "reason": "<why it directly contradicts the declared priorities — max 20 words>" }
  ]
}`;

/**
 * Compare active, observed, priority-asserting inferred insights against the
 * declared operating profile and retire (isActive=false) the ones that directly
 * contradict it. Returns the retired insights. Never throws.
 */
export async function reconcileInsightsWithOperatingProfile(): Promise<RetiredInsight[]> {
  try {
    const candidates = await db
      .select()
      .from(founderProfileInsightsTable)
      .where(
        and(
          eq(founderProfileInsightsTable.isActive, true),
          eq(founderProfileInsightsTable.source, "observed"),
          inArray(founderProfileInsightsTable.category, RECONCILE_CATEGORIES),
        ),
      )
      .orderBy(desc(founderProfileInsightsTable.observationCount));

    if (candidates.length === 0) return [];

    const declared = summarizeOperatingProfile();
    const list = candidates
      .map((r) => `- id: ${r.id} | [${r.category}] ${r.insight}`)
      .join("\n");
    const userContent = `DECLARED OPERATING PROFILE (authoritative):\n${declared}\n\nINFERRED INSIGHTS TO AUDIT:\n${list}`;

    const response = await completeWithFallback({
      task: "profile_analysis",
      modelHint: "fast",
      systemPrompt: RECONCILE_SYSTEM,
      userContent,
      maxTokens: 400,
      responseFormat: "json",
      executiveId: "system",
      executiveName: "System",
      executiveRole: "profile_reconciliation",
    });

    if (response.fromFallback || !response.parsed) return [];
    const retire = Array.isArray(response.parsed?.retire) ? response.parsed.retire : [];

    const byId = new Map(candidates.map((c) => [c.id, c]));
    const retired: RetiredInsight[] = [];

    for (const entry of retire) {
      if (entry === null || typeof entry !== "object") continue;
      const id = (entry as Record<string, unknown>).id;
      const reason = (entry as Record<string, unknown>).reason;
      if (typeof id !== "string") continue;
      const row = byId.get(id);
      if (!row) continue; // only retire ids we actually surfaced

      const reasonText =
        typeof reason === "string" && reason.trim().length > 0
          ? reason.trim()
          : "Conflicts with declared launch-first priorities";

      await db
        .update(founderProfileInsightsTable)
        .set({
          isActive: false,
          evidence: [
            ...(row.evidence as string[]),
            `[retired ${new Date().toISOString().slice(0, 10)}] reconciled against operating profile: ${reasonText}`,
          ].slice(-8),
          updatedAt: new Date(),
        })
        .where(eq(founderProfileInsightsTable.id, id));

      retired.push({
        id,
        category: row.category as ProfileCategory,
        insight: row.insight,
        reason: reasonText,
      });
    }

    if (retired.length > 0) {
      logger.info(
        { count: retired.length, retired: retired.map((r) => r.id) },
        "founder profile: retired inferred insights conflicting with declared priorities",
      );
    }
    return retired;
  } catch (err) {
    logger.warn({ err }, "founder profile: reconciliation failed — retired nothing");
    return [];
  }
}

// ─── V11 Tier 1: reconcile founder-priority MEMORY vs. declared priorities ─────
//
// Quinn's conversation context also surfaces "Founder priorities on record" from
// executive memory (agent_memory rows of kind directive/preference). A seeded or
// stale directive that asserts a DIFFERENT top priority than the declared profile
// (e.g. "the founder's top priority is creator retention") directly contradicts
// the launch-first order and pollutes every conversation. agent_memory has no
// soft-delete column, so retiring such a row means deleting it; the deleted
// content is logged for traceability and can be re-seeded.
//
// Conservative: only directive/preference rows are eligible, and only those that
// assert a FOUNDER/COMPANY PRIORITY that contradicts the declared order are
// retired. Domain operating rules (reliability, QA gates, autonomy rails) and
// compatible nuance are kept. Safe-by-default: any AI failure retires nothing.

export type RetiredMemoryItem = {
  id: string;
  executiveId: string;
  kind: string;
  content: string;
  reason: string;
};

export type FlaggedMemoryItem = RetiredMemoryItem & { pinned: true };

export type MemoryReconciliation = {
  retired: RetiredMemoryItem[]; // non-pinned rows that were deleted
  flaggedForReview: FlaggedMemoryItem[]; // pinned rows surfaced, never auto-deleted
};

const RECONCILE_MEMORY_SYSTEM = `You are auditing an AI company's stored "founder priority" MEMORY against the founder's EXPLICIT, authoritative operating profile. The explicit profile always wins.

Each memory item is an executive's recorded directive/preference. Flag ONLY items that assert a FOUNDER or COMPANY PRIORITY which DIRECTLY CONTRADICTS the declared priority order — e.g. it names a DIFFERENT single top/overall priority, or elevates something the founder has explicitly deprioritized above the declared #1.

KEEP (do NOT flag): executive domain operating rules (reliability, QA/release gates, autonomy/approval rails), communication-style preferences, and any priority nuance that is COMPATIBLE with the declared order (e.g. "retention over acquisition" as a growth detail is compatible with a launch-first top priority).

Be conservative. When in doubt, KEEP. Deleting a real directive is worse than leaving a harmless one.

OUTPUT (JSON only, no markdown):
{
  "retire": [
    { "id": "<memory id>", "reason": "<why it directly contradicts the declared priority order — max 20 words>" }
  ]
}`;

/**
 * Audit founder-priority memory (agent_memory directive/preference rows) against
 * the declared operating profile and delete the rows that directly contradict it.
 * Returns the retired items. Never throws.
 */
export async function reconcileFounderPriorityMemory(): Promise<MemoryReconciliation> {
  const empty: MemoryReconciliation = { retired: [], flaggedForReview: [] };
  try {
    const candidates = await db
      .select({
        id: agentMemoryTable.id,
        executiveId: agentMemoryTable.executiveId,
        kind: agentMemoryTable.kind,
        content: agentMemoryTable.content,
        pinned: agentMemoryTable.pinned,
        execName: aiExecutivesTable.name,
      })
      .from(agentMemoryTable)
      .leftJoin(aiExecutivesTable, eq(aiExecutivesTable.id, agentMemoryTable.executiveId))
      .where(inArray(agentMemoryTable.kind, ["directive", "preference"]));

    if (candidates.length === 0) return empty;

    const declared = summarizeOperatingProfile();
    const list = candidates
      .map((r) => `- id: ${r.id} | ${r.execName ?? "?"} [${r.kind}] ${r.content}`)
      .join("\n");
    const userContent = `DECLARED OPERATING PROFILE (authoritative):\n${declared}\n\nFOUNDER-PRIORITY MEMORY TO AUDIT:\n${list}`;

    const response = await completeWithFallback({
      task: "profile_analysis",
      modelHint: "fast",
      systemPrompt: RECONCILE_MEMORY_SYSTEM,
      userContent,
      maxTokens: 400,
      responseFormat: "json",
      executiveId: "system",
      executiveName: "System",
      executiveRole: "profile_reconciliation",
    });

    if (response.fromFallback || !response.parsed) return empty;
    const retire = Array.isArray(response.parsed?.retire) ? response.parsed.retire : [];

    const byId = new Map(candidates.map((c) => [c.id, c]));
    const result: MemoryReconciliation = { retired: [], flaggedForReview: [] };

    for (const entry of retire) {
      if (entry === null || typeof entry !== "object") continue;
      const id = (entry as Record<string, unknown>).id;
      const reason = (entry as Record<string, unknown>).reason;
      if (typeof id !== "string") continue;
      const row = byId.get(id);
      if (!row) continue; // only act on ids we actually surfaced (kind-restricted)

      const reasonText =
        typeof reason === "string" && reason.trim().length > 0
          ? reason.trim()
          : "Conflicts with declared launch-first priority order";

      // SAFETY: pinned memory is canonical. An AI classifier must never delete it
      // autonomously — irreversible loss on a misclassification is unacceptable.
      // Surface it for explicit founder/operator review instead.
      if (row.pinned) {
        result.flaggedForReview.push({
          id,
          executiveId: row.executiveId,
          kind: row.kind,
          content: row.content,
          reason: reasonText,
          pinned: true,
        });
        continue;
      }

      await db.delete(agentMemoryTable).where(eq(agentMemoryTable.id, id));
      result.retired.push({
        id,
        executiveId: row.executiveId,
        kind: row.kind,
        content: row.content,
        reason: reasonText,
      });
    }

    if (result.retired.length > 0 || result.flaggedForReview.length > 0) {
      logger.info(
        {
          retiredCount: result.retired.length,
          flaggedCount: result.flaggedForReview.length,
          retired: result.retired,
          flagged: result.flaggedForReview,
        },
        "founder profile: founder-priority memory reconciliation result",
      );
    }
    return result;
  } catch (err) {
    logger.warn({ err }, "founder profile: memory reconciliation failed — retired nothing");
    return empty;
  }
}

export type ReconciliationResult = {
  insights: RetiredInsight[];
  memory: MemoryReconciliation;
};

/**
 * Single entry point: reconcile BOTH founder-context sources that can carry stale
 * priority claims (inferred insights + founder-priority memory) against the
 * declared operating profile. Runs both audits in parallel. Never throws.
 *
 * Note: this is an EXPLICITLY-invoked maintenance operation. The autonomous
 * learning loop only self-heals the reversible inferred-insights table (soft
 * isActive=false); it never autonomously deletes executive memory. Pinned
 * canonical memory is never auto-deleted here either — it is surfaced for review.
 */
export async function reconcileFounderPriorities(): Promise<ReconciliationResult> {
  const [insights, memory] = await Promise.all([
    reconcileInsightsWithOperatingProfile(),
    reconcileFounderPriorityMemory(),
  ]);
  return { insights, memory };
}
