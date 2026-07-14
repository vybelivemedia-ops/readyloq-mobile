// ─── Marketing Autonomy: learning-based content publishing (Dario Sol) ───────
//
// Dario (Marketing Director) drafts marketing content, learns the Founder's
// style from every decision, and — only after earning trust — auto-publishes
// low-risk content. Architecture rules (do NOT violate):
//   • NOT a standalone AI. Drafting lives inside Dario's workflow; Quinn
//     monitors the autonomy state and notifies the Founder.
//   • The learning profile is DERIVED from stored posts (no duplicate memory).
//   • The confidence engine is deterministic and explainable (reasons list).
//   • Trusted Marketing Mode gates: ≥50 founder-approved posts AND ≥95%
//     prediction accuracy AND founder has not disabled autonomy.
//   • High-risk content types NEVER auto-publish, in any mode.

import { randomUUID } from "node:crypto";
import { desc, eq, sql } from "drizzle-orm";
import {
  db,
  marketingPostsTable,
  marketingAutonomyStateTable,
  aiExecutivesTable,
  agentActivityTable,
  specialistRunsTable,
  type MarketingPostRow,
  type MarketingAutonomyStateRow,
  type MarketingEngagement,
} from "@workspace/db";
import { completeWithFallback } from "./ai/AIProviderFactory.js";
import type { AIRequest } from "./ai/AIProvider.js";
import { SPECIALISTS, loadSpecialistPrompt } from "./specialistRegistry.js";
import { recordEvent } from "./organizationMemory.js";
import { logger } from "../lib/logger.js";

// ─── Constants (the trust contract) ──────────────────────────────────────────

export const QUALIFY_MIN_APPROVED = 50;
export const QUALIFY_MIN_ACCURACY = 95;
export const SUSPEND_ACCURACY_BELOW = 90;
export const AUTO_PUBLISH_MIN_CONFIDENCE = 85;
/** Prediction = "founder will approve" when confidence ≥ this. */
export const PREDICT_APPROVE_AT = 70;
/** Suspend if ≥ this many of the last 10 decided posts were manually edited/overridden. */
export const SUSPEND_OVERRIDES_IN_LAST_10 = 3;
export const SUSPEND_BRAND_CONSISTENCY_BELOW = 60;
/** Engagement drop: recent avg < this fraction of the prior avg. */
export const SUSPEND_ENGAGEMENT_DROP_RATIO = 0.5;

const LOW_RISK_TYPES = new Set([
  "product_tip",
  "feature_highlight",
  "educational",
  "community_engagement",
  "creator_spotlight",
  "launch_countdown",
  "release_recap",
]);

export function riskLevelFor(contentType: string): "low" | "high" {
  return LOW_RISK_TYPES.has(contentType) ? "low" : "high";
}

const SINGLETON_ID = "singleton";

// ─── Autonomy state ───────────────────────────────────────────────────────────

export async function getAutonomyState(): Promise<MarketingAutonomyStateRow> {
  const [existing] = await db
    .select()
    .from(marketingAutonomyStateTable)
    .where(eq(marketingAutonomyStateTable.id, SINGLETON_ID))
    .limit(1);
  if (existing) return existing;
  const [created] = await db
    .insert(marketingAutonomyStateTable)
    .values({ id: SINGLETON_ID })
    .onConflictDoNothing()
    .returning();
  if (created) return created;
  const [again] = await db
    .select()
    .from(marketingAutonomyStateTable)
    .where(eq(marketingAutonomyStateTable.id, SINGLETON_ID))
    .limit(1);
  return again!;
}

async function getDario(): Promise<{ id: string; name: string; role: string } | null> {
  const [row] = await db
    .select({ id: aiExecutivesTable.id, name: aiExecutivesTable.name, role: aiExecutivesTable.role })
    .from(aiExecutivesTable)
    .where(eq(aiExecutivesTable.role, "marketing_director"))
    .limit(1);
  return row ?? null;
}

async function getQuinn(): Promise<{ id: string; name: string } | null> {
  const [row] = await db
    .select({ id: aiExecutivesTable.id, name: aiExecutivesTable.name })
    .from(aiExecutivesTable)
    .where(eq(aiExecutivesTable.role, "chief_of_staff"))
    .limit(1);
  return row ?? null;
}

async function activity(
  type: "message" | "approval" | "collaboration",
  executiveId: string | null,
  summary: string,
  detail: string | null,
): Promise<void> {
  try {
    await db.insert(agentActivityTable).values({ id: randomUUID(), type, executiveId, summary, detail });
  } catch (err) {
    logger.warn({ err }, "marketingLearning: failed to record activity");
  }
}

// ─── Learning profile (derived — improves after every approval) ──────────────

export type MarketingLearningProfile = {
  approvedCount: number;
  topTones: string[];
  topCtas: string[];
  topHashtags: string[];
  avgLengthChars: number;
  platformCounts: Record<string, number>;
  contentTypeCounts: Record<string, number>;
  cleanApprovalRate: number; // % of decided posts approved without edits
};

function topKeys(counts: Map<string, number>, n: number): string[] {
  return [...counts.entries()]
    .filter(([k]) => k.trim().length > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([k]) => k);
}

function bump(map: Map<string, number>, key: string): void {
  const k = key.trim().toLowerCase();
  if (!k) return;
  map.set(k, (map.get(k) ?? 0) + 1);
}

export function deriveLearningProfile(posts: MarketingPostRow[]): MarketingLearningProfile {
  const approved = posts.filter((p) => p.status === "approved");
  const decided = posts.filter((p) => p.status === "approved" || p.status === "rejected");
  const tones = new Map<string, number>();
  const ctas = new Map<string, number>();
  const tags = new Map<string, number>();
  const platforms: Record<string, number> = {};
  const contentTypes: Record<string, number> = {};
  let totalLen = 0;
  for (const p of approved) {
    bump(tones, p.tone);
    bump(ctas, p.cta);
    for (const h of p.hashtags) bump(tags, h);
    if (p.platform) platforms[p.platform] = (platforms[p.platform] ?? 0) + 1;
    contentTypes[p.contentType] = (contentTypes[p.contentType] ?? 0) + 1;
    totalLen += p.lengthChars;
  }
  const cleanApprovals = decided.filter((p) => p.status === "approved" && !p.founderEdited).length;
  return {
    approvedCount: approved.length,
    topTones: topKeys(tones, 3),
    topCtas: topKeys(ctas, 3),
    topHashtags: topKeys(tags, 5),
    avgLengthChars: approved.length > 0 ? Math.round(totalLen / approved.length) : 0,
    platformCounts: platforms,
    contentTypeCounts: contentTypes,
    cleanApprovalRate: decided.length > 0 ? Math.round((cleanApprovals / decided.length) * 100) : 100,
  };
}

async function loadAllPosts(): Promise<MarketingPostRow[]> {
  return db.select().from(marketingPostsTable).orderBy(desc(marketingPostsTable.createdAt));
}

// ─── Confidence engine (deterministic + explainable) ─────────────────────────

export type ConfidenceResult = { confidence: number; reasons: string[] };

export function computeConfidence(
  draft: {
    contentType: string;
    platform: string;
    tone: string;
    cta: string;
    hashtags: string[];
    lengthChars: number;
  },
  profile: MarketingLearningProfile,
  approvedPosts: MarketingPostRow[],
): ConfidenceResult {
  const reasons: string[] = [];
  let score = 45;
  const risk = riskLevelFor(draft.contentType);

  // Similarity to previously approved content (same content type + platform).
  const similar = approvedPosts.filter(
    (p) => p.contentType === draft.contentType || (p.platform && p.platform === draft.platform),
  );
  const sameType = approvedPosts.filter((p) => p.contentType === draft.contentType);
  if (sameType.length > 0) {
    score += Math.min(20, sameType.length * 4);
    reasons.push(
      `Similar to ${sameType.length} previously approved ${draft.contentType.replace(/_/g, " ")} post${sameType.length === 1 ? "" : "s"}`,
    );
  } else if (similar.length > 0) {
    score += Math.min(10, similar.length * 2);
    reasons.push(`Related to ${similar.length} previously approved post${similar.length === 1 ? "" : "s"}`);
  } else {
    reasons.push("No previously approved posts of this kind yet — learning");
  }

  // Brand voice consistency: tone matches the founder's preferred tones.
  if (draft.tone && profile.topTones.includes(draft.tone.trim().toLowerCase())) {
    score += 12;
    reasons.push(`Matches preferred tone ("${draft.tone}")`);
  } else if (profile.topTones.length > 0) {
    reasons.push(`Tone "${draft.tone || "unspecified"}" differs from preferred (${profile.topTones.join(", ")})`);
  }

  // CTA preference.
  if (draft.cta && profile.topCtas.includes(draft.cta.trim().toLowerCase())) {
    score += 8;
    reasons.push("Uses a preferred CTA");
  }

  // Hashtag overlap.
  const tagOverlap = draft.hashtags.filter((h) => profile.topHashtags.includes(h.trim().toLowerCase())).length;
  if (tagOverlap > 0) {
    score += Math.min(6, tagOverlap * 2);
    reasons.push(`${tagOverlap} preferred hashtag${tagOverlap === 1 ? "" : "s"}`);
  }

  // Length consistency (within ±40% of the founder's approved average).
  if (profile.avgLengthChars > 0 && draft.lengthChars > 0) {
    const ratio = draft.lengthChars / profile.avgLengthChars;
    if (ratio >= 0.6 && ratio <= 1.4) {
      score += 5;
      reasons.push("Length matches approved posts");
    }
  }

  // Risk level.
  if (risk === "high") {
    score -= 25;
    reasons.push("High-risk category — always requires Founder approval");
  }

  // Track record quality.
  if (profile.cleanApprovalRate >= 80 && profile.approvedCount >= 5) {
    score += 5;
    reasons.push(`Strong approval track record (${profile.cleanApprovalRate}% approved without edits)`);
  }

  return { confidence: Math.max(5, Math.min(99, Math.round(score))), reasons: reasons.slice(0, 6) };
}

// ─── Drafting (inside Dario's workflow) ───────────────────────────────────────

function fallbackDraft(topic: string, contentType: string, profile: MarketingLearningProfile) {
  const tone = profile.topTones[0] ?? "energetic";
  const cta = profile.topCtas[0] ?? "Join the waitlist";
  const hashtags = profile.topHashtags.length > 0 ? profile.topHashtags.slice(0, 3) : ["vybelive", "povstreaming"];
  const content = `${topic}\n\nVYBE LIVE puts your point of view live — phone, GoPro, or smart glasses, streaming everywhere at once.\n\n${cta} → vybe.live\n\n${hashtags.map((h) => `#${h.replace(/^#/, "")}`).join(" ")}`;
  return { content, tone, cta, hashtags };
}

export type DraftResult = {
  post: MarketingPostRow;
  autoPublished: boolean;
};

export async function createMarketingDraft(opts: {
  topic: string;
  platform: string;
  contentType: string;
  objectiveId?: string | null;
}): Promise<DraftResult> {
  const { topic, platform, contentType } = opts;
  const dario = await getDario();
  const posts = await loadAllPosts();
  const profile = deriveLearningProfile(posts);
  const approvedPosts = posts.filter((p) => p.status === "approved");
  const state = await getAutonomyState();

  // Draft with the content-creator skill on Dario's bench (AI w/ deterministic fallback).
  const spec = SPECIALISTS.find((s) => s.id === "content-creator");
  const skillPrompt = spec ? loadSpecialistPrompt(spec) : null;
  let draft = fallbackDraft(topic, contentType, profile);
  let usedAI = false;

  if (dario) {
    const styleBrief =
      profile.approvedCount > 0
        ? `FOUNDER STYLE PROFILE (learned from ${profile.approvedCount} approved posts): ` +
          `preferred tones: ${profile.topTones.join(", ") || "unknown"}; ` +
          `preferred CTAs: ${profile.topCtas.join(", ") || "unknown"}; ` +
          `favorite hashtags: ${profile.topHashtags.join(", ") || "unknown"}; ` +
          `target length ≈ ${profile.avgLengthChars} characters.`
        : "No founder style profile yet — write clean, on-brand copy for VYBE LIVE (POV wearable livestreaming).";
    const system =
      `${(skillPrompt ?? "").slice(0, 3500)}\n\n━━━ MISSION CONTROL INTEGRATION ━━━\n` +
      `You are the content-creator skill on ${dario.name}'s (Marketing Director) bench at VYBE LIVE. ` +
      `Draft ONE ${contentType.replace(/_/g, " ")} post for ${platform || "social media"}. ${styleBrief} ` +
      `Respond ONLY with JSON: {"content": string (the full post text incl. hashtags), ` +
      `"tone": string (one or two words), "cta": string (the call to action used, short), ` +
      `"hashtags": [string] (without #, max 5)}.`;
    const request: AIRequest = {
      task: "reasoning",
      modelHint: "fast",
      systemPrompt: system,
      userContent: `Topic / brief:\n${topic}`,
      executiveId: dario.id,
      executiveName: dario.name,
      executiveRole: dario.role,
      objectiveId: opts.objectiveId ?? undefined,
      maxTokens: 700,
      responseFormat: "json",
    };
    try {
      const response = await completeWithFallback(request);
      const parsed = response.parsed as Record<string, unknown> | null;
      if (parsed && typeof parsed.content === "string" && parsed.content.trim().length > 0) {
        draft = {
          content: parsed.content.trim().slice(0, 4000),
          tone: typeof parsed.tone === "string" ? parsed.tone.trim().slice(0, 60) : draft.tone,
          cta: typeof parsed.cta === "string" ? parsed.cta.trim().slice(0, 200) : draft.cta,
          hashtags: Array.isArray(parsed.hashtags)
            ? parsed.hashtags.filter((h): h is string => typeof h === "string").slice(0, 5)
            : draft.hashtags,
        };
        usedAI = true;
      }
    } catch (err) {
      logger.warn({ err }, "marketingLearning: AI draft failed — using deterministic fallback");
    }
  }

  const risk = riskLevelFor(contentType);
  const { confidence, reasons } = computeConfidence(
    {
      contentType,
      platform,
      tone: draft.tone,
      cta: draft.cta,
      hashtags: draft.hashtags,
      lengthChars: draft.content.length,
    },
    profile,
    approvedPosts,
  );

  // Auto-publish gate: trusted mode + founder allows + low risk + high confidence.
  const autoPublish =
    state.mode === "trusted" &&
    !state.founderDisabled &&
    risk === "low" &&
    confidence >= AUTO_PUBLISH_MIN_CONFIDENCE;

  const id = randomUUID();
  const now = new Date();
  const [post] = await db
    .insert(marketingPostsTable)
    .values({
      id,
      executiveId: dario?.id ?? null,
      objectiveId: opts.objectiveId ?? null,
      topic: topic.slice(0, 2000),
      platform: platform.slice(0, 60),
      contentType: contentType as MarketingPostRow["contentType"],
      riskLevel: risk,
      status: autoPublish ? "auto_published" : "pending_approval",
      originalDraft: draft.content,
      finalContent: autoPublish ? draft.content : "",
      founderEdited: false,
      tone: draft.tone,
      lengthChars: draft.content.length,
      cta: draft.cta,
      hashtags: draft.hashtags,
      creativeAssets: [],
      predictedConfidence: confidence,
      confidenceReasons: reasons,
      autoPublished: autoPublish,
      postedAt: autoPublish ? now : null,
    })
    .returning();

  // Run ledger: this drafting run used the content-creator skill.
  if (spec && dario) {
    try {
      await db.insert(specialistRunsTable).values({
        id: randomUUID(),
        specialistId: spec.id,
        executiveId: dario.id,
        objectiveId: opts.objectiveId ?? null,
        trigger: `Draft ${contentType} for ${platform || "social"}: ${topic.slice(0, 300)}`,
        success: usedAI,
        confidence,
        summary: usedAI ? "Draft generated with learned founder style." : "AI unavailable — deterministic fallback draft.",
      });
    } catch (err) {
      logger.warn({ err }, "marketingLearning: failed to record specialist run");
    }
  }

  await activity(
    autoPublish ? "message" : "approval",
    dario?.id ?? null,
    autoPublish
      ? `Dario auto-published a ${contentType.replace(/_/g, " ")} post (${confidence}% confidence, Trusted Marketing Mode)`
      : `Dario drafted a ${contentType.replace(/_/g, " ")} post — awaiting Founder approval (${confidence}% predicted approval)`,
    draft.content.slice(0, 500),
  );
  if (autoPublish) {
    await recordEvent({
      type: "milestone",
      title: "Auto-published marketing post",
      summary: `Trusted Marketing Mode: ${contentType.replace(/_/g, " ")} for ${platform || "social"} at ${confidence}% confidence.`,
      actorExecutiveId: dario?.id ?? null,
      refType: "marketing_post",
      refId: id,
      importance: "normal",
      keywords: ["marketing", "autonomy"],
    });
  }

  return { post: post!, autoPublished: autoPublish };
}

// ─── Founder decisions + prediction scoring ───────────────────────────────────

export type DecisionResult = {
  post: MarketingPostRow;
  qualificationChanged: boolean;
  suspension: { suspended: boolean; reason: string } | null;
};

export async function decideMarketingPost(opts: {
  postId: string;
  decision: "approved" | "rejected";
  editedContent?: string | null;
}): Promise<DecisionResult | null> {
  const [existing] = await db
    .select()
    .from(marketingPostsTable)
    .where(eq(marketingPostsTable.id, opts.postId))
    .limit(1);
  if (!existing) return null;
  if (existing.status !== "pending_approval" && existing.status !== "auto_published") return null;

  const wasAutoPublished = existing.status === "auto_published";
  const edited =
    typeof opts.editedContent === "string" &&
    opts.editedContent.trim().length > 0 &&
    opts.editedContent.trim() !== existing.originalDraft.trim();
  const finalContent =
    opts.decision === "approved"
      ? edited
        ? opts.editedContent!.trim().slice(0, 4000)
        : existing.originalDraft
      : existing.finalContent;

  // Prediction scoring: predicted approve iff confidence ≥ PREDICT_APPROVE_AT.
  const predictedApprove = existing.predictedConfidence >= PREDICT_APPROVE_AT;
  const predictionCorrect = predictedApprove === (opts.decision === "approved");
  const now = new Date();

  const [post] = await db
    .update(marketingPostsTable)
    .set({
      status: opts.decision,
      finalContent,
      founderEdited: edited || (wasAutoPublished && opts.decision === "rejected") || existing.founderEdited,
      lengthChars: opts.decision === "approved" ? finalContent.length : existing.lengthChars,
      predictionCorrect,
      decidedAt: now,
      postedAt: opts.decision === "approved" && !existing.postedAt ? now : existing.postedAt,
    })
    .where(eq(marketingPostsTable.id, opts.postId))
    .returning();

  await activity(
    "approval",
    existing.executiveId,
    `Founder ${opts.decision} a marketing post${edited ? " (with edits)" : ""}${wasAutoPublished ? " — manual override of auto-published content" : ""}`,
    existing.topic.slice(0, 300),
  );

  const evalResult = await evaluateAutonomy(wasAutoPublished && opts.decision === "rejected");
  return { post: post!, qualificationChanged: evalResult.changed, suspension: evalResult.suspension };
}

export async function updateEngagement(postId: string, engagement: MarketingEngagement): Promise<MarketingPostRow | null> {
  const [post] = await db
    .update(marketingPostsTable)
    .set({ engagement })
    .where(eq(marketingPostsTable.id, postId))
    .returning();
  if (post) await evaluateAutonomy(false);
  return post ?? null;
}

// ─── Metrics ──────────────────────────────────────────────────────────────────

function approvalAccuracy(posts: MarketingPostRow[]): { accuracy: number; scored: number } {
  const scored = posts.filter((p) => p.predictionCorrect !== null);
  if (scored.length === 0) return { accuracy: 100, scored: 0 };
  const correct = scored.filter((p) => p.predictionCorrect === true).length;
  return { accuracy: Math.round((correct / scored.length) * 1000) / 10, scored: scored.length };
}

function brandConsistencyScore(posts: MarketingPostRow[]): number {
  const decided = posts
    .filter((p) => p.status === "approved" || p.status === "rejected")
    .slice(0, 20);
  if (decided.length === 0) return 100;
  const clean = decided.filter((p) => p.status === "approved" && !p.founderEdited).length;
  return Math.round((clean / decided.length) * 100);
}

function engagementDrop(posts: MarketingPostRow[]): boolean {
  const withEngagement = posts
    .filter((p) => p.engagement !== null && (p.status === "approved" || p.status === "auto_published"))
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  if (withEngagement.length < 6) return false;
  const score = (e: MarketingEngagement) => e.views + e.likes * 5 + e.shares * 10 + e.comments * 5;
  const recent = withEngagement.slice(0, 3);
  const prior = withEngagement.slice(3, 9);
  const avg = (rows: MarketingPostRow[]) =>
    rows.reduce((s, p) => s + score(p.engagement!), 0) / Math.max(1, rows.length);
  const recentAvg = avg(recent);
  const priorAvg = avg(prior);
  return priorAvg > 0 && recentAvg < priorAvg * SUSPEND_ENGAGEMENT_DROP_RATIO;
}

// ─── Quinn's monitor: qualification + suspension ──────────────────────────────

export type AutonomyEvaluation = {
  changed: boolean;
  suspension: { suspended: boolean; reason: string } | null;
};

/**
 * Quinn's continuous monitor. Called after every founder decision and
 * engagement update. Enables Trusted Marketing Mode when BOTH thresholds are
 * met; suspends it (back to Learning Mode) when performance drops.
 */
export async function evaluateAutonomy(manualOverrideJustHappened: boolean): Promise<AutonomyEvaluation> {
  const state = await getAutonomyState();
  const posts = await loadAllPosts();
  const approvedCount = posts.filter((p) => p.status === "approved").length;
  const { accuracy, scored } = approvalAccuracy(posts);
  const quinn = await getQuinn();

  if (state.mode === "learning") {
    const qualifies =
      !state.founderDisabled && approvedCount >= QUALIFY_MIN_APPROVED && scored >= QUALIFY_MIN_APPROVED && accuracy >= QUALIFY_MIN_ACCURACY;
    if (!qualifies) return { changed: false, suspension: null };
    await db
      .update(marketingAutonomyStateTable)
      .set({ mode: "trusted", enabledAt: new Date(), suspensionReason: "", updatedAt: new Date() })
      .where(eq(marketingAutonomyStateTable.id, SINGLETON_ID));
    const summary = `Dario qualified for Trusted Marketing Mode: ${approvedCount} approved posts, ${accuracy}% prediction accuracy. Low-risk content will now auto-publish; high-risk always needs Founder approval.`;
    await activity("message", quinn?.id ?? null, "Quinn enabled Trusted Marketing Mode for Dario", summary);
    await recordEvent({
      type: "milestone",
      title: "Trusted Marketing Mode enabled",
      summary,
      actorExecutiveId: quinn?.id ?? null,
      importance: "high",
      keywords: ["marketing", "autonomy", "milestone"],
    });
    return { changed: true, suspension: null };
  }

  // Trusted mode: check suspension conditions.
  const reasons: string[] = [];
  if (scored >= 10 && accuracy < SUSPEND_ACCURACY_BELOW) {
    reasons.push(`prediction accuracy fell to ${accuracy}% (below ${SUSPEND_ACCURACY_BELOW}%)`);
  }
  const recentDecided = posts
    .filter((p) => p.status === "approved" || p.status === "rejected")
    .slice(0, 10);
  // Rejected auto-published posts already carry founderEdited=true (set at decision time).
  const overrides = recentDecided.filter((p) => p.founderEdited).length;
  if (overrides >= SUSPEND_OVERRIDES_IN_LAST_10) {
    reasons.push(`${overrides} of the last ${recentDecided.length} posts were manually edited or overridden`);
  }
  const brand = brandConsistencyScore(posts);
  if (brand < SUSPEND_BRAND_CONSISTENCY_BELOW) {
    reasons.push(`brand consistency fell to ${brand}%`);
  }
  if (engagementDrop(posts)) {
    reasons.push("engagement dropped significantly versus prior posts");
  }
  if (state.founderDisabled) {
    reasons.push("the Founder disabled marketing autonomy");
  }
  if (reasons.length === 0) return { changed: false, suspension: null };

  const reason = `Trusted Marketing Mode suspended — ${reasons.join("; ")}. Returning to Learning Mode.`;
  await db
    .update(marketingAutonomyStateTable)
    .set({
      mode: "learning",
      suspendedAt: new Date(),
      suspensionReason: reason,
      suspensionCount: sql`${marketingAutonomyStateTable.suspensionCount} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(marketingAutonomyStateTable.id, SINGLETON_ID));
  await activity("message", quinn?.id ?? null, "Quinn suspended Trusted Marketing Mode", reason);
  await recordEvent({
    type: "milestone",
    title: "Trusted Marketing Mode suspended",
    summary: reason,
    actorExecutiveId: quinn?.id ?? null,
    importance: "high",
    keywords: ["marketing", "autonomy", "suspension"],
  });
  return { changed: true, suspension: { suspended: true, reason } };
}

/** Founder kill-switch. Disabling while trusted suspends immediately. */
export async function setFounderAutonomy(disabled: boolean): Promise<MarketingAutonomyStateRow> {
  await getAutonomyState();
  await db
    .update(marketingAutonomyStateTable)
    .set({ founderDisabled: disabled, updatedAt: new Date() })
    .where(eq(marketingAutonomyStateTable.id, SINGLETON_ID));
  if (disabled) await evaluateAutonomy(false);
  return getAutonomyState();
}

// ─── Marketing Intelligence Dashboard ─────────────────────────────────────────

export type MarketingIntelligence = {
  postsDrafted: number;
  postsApproved: number;
  postsRejected: number;
  postsAutoPublished: number;
  founderEditRate: number;
  approvalAccuracy: number;
  brandConsistencyScore: number;
  averageEngagement: number | null;
  confidenceTrend: { at: string; confidence: number }[];
  autonomy: {
    mode: "learning" | "trusted";
    founderDisabled: boolean;
    enabledAt: string | null;
    suspendedAt: string | null;
    suspensionReason: string;
    suspensionCount: number;
  };
  learningProgress: {
    approvedPosts: number;
    requiredApprovals: number;
    predictionAccuracy: number;
    requiredAccuracy: number;
    remainingApprovals: number;
  };
  profile: MarketingLearningProfile;
};

export async function getMarketingIntelligence(): Promise<MarketingIntelligence> {
  const posts = await loadAllPosts();
  const state = await getAutonomyState();
  const profile = deriveLearningProfile(posts);
  const decided = posts.filter((p) => p.status === "approved" || p.status === "rejected");
  const edited = decided.filter((p) => p.founderEdited).length;
  const { accuracy } = approvalAccuracy(posts);
  const withEngagement = posts.filter((p) => p.engagement !== null);
  const avgEngagement =
    withEngagement.length > 0
      ? Math.round(
          withEngagement.reduce(
            (s, p) => s + p.engagement!.views + p.engagement!.likes + p.engagement!.shares + p.engagement!.comments,
            0,
          ) / withEngagement.length,
        )
      : null;
  const approvedCount = posts.filter((p) => p.status === "approved").length;

  return {
    postsDrafted: posts.length,
    postsApproved: approvedCount,
    postsRejected: posts.filter((p) => p.status === "rejected").length,
    postsAutoPublished: posts.filter((p) => p.autoPublished).length,
    founderEditRate: decided.length > 0 ? Math.round((edited / decided.length) * 100) : 0,
    approvalAccuracy: accuracy,
    brandConsistencyScore: brandConsistencyScore(posts),
    averageEngagement: avgEngagement,
    confidenceTrend: posts
      .slice(0, 15)
      .reverse()
      .map((p) => ({ at: p.createdAt.toISOString(), confidence: p.predictedConfidence })),
    autonomy: {
      mode: state.mode,
      founderDisabled: state.founderDisabled,
      enabledAt: state.enabledAt?.toISOString() ?? null,
      suspendedAt: state.suspendedAt?.toISOString() ?? null,
      suspensionReason: state.suspensionReason,
      suspensionCount: state.suspensionCount,
    },
    learningProgress: {
      approvedPosts: approvedCount,
      requiredApprovals: QUALIFY_MIN_APPROVED,
      predictionAccuracy: accuracy,
      requiredAccuracy: QUALIFY_MIN_ACCURACY,
      remainingApprovals: Math.max(0, QUALIFY_MIN_APPROVED - approvedCount),
    },
    profile,
  };
}

/** One-paragraph brief Quinn injects into her conversation context. */
export async function getMarketingAutonomyBrief(): Promise<string> {
  try {
    const intel = await getMarketingIntelligence();
    const lines = [
      "MARKETING AUTONOMY (Dario Sol — monitored by you, Quinn):",
      `• Mode: ${intel.autonomy.mode === "trusted" ? "TRUSTED (low-risk content auto-publishes; high-risk always needs the Founder)" : "LEARNING (every post needs Founder approval)"}${intel.autonomy.founderDisabled ? " — Founder has DISABLED autonomy" : ""}`,
      `• Learning progress: ${intel.learningProgress.approvedPosts}/${intel.learningProgress.requiredApprovals} approvals, ${intel.learningProgress.predictionAccuracy}% prediction accuracy (needs ≥${intel.learningProgress.requiredAccuracy}%)`,
      `• Drafted ${intel.postsDrafted}, approved ${intel.postsApproved}, rejected ${intel.postsRejected}, auto-published ${intel.postsAutoPublished}; edit rate ${intel.founderEditRate}%; brand consistency ${intel.brandConsistencyScore}%`,
    ];
    if (intel.autonomy.suspensionReason) lines.push(`• Last suspension: ${intel.autonomy.suspensionReason}`);
    return lines.join("\n");
  } catch {
    return "";
  }
}
