// ─── Founder Decision Model (V6.8) ────────────────────────────────────────────
//
// Quinn does not just remember preferences — she learns how the Founder DECIDES.
// Before recommending, she asks internally: "What would the Founder likely
// choose?" This service answers that question from the evidence-based Founder
// Operating Profile (V6.5 insights) and gates on confidence:
//
//   • HIGH confidence  → Quinn acts on the predicted choice.
//   • LOW  confidence  → Quinn requests confirmation instead of assuming.
//
// Every prediction is recorded and later scored against the Founder's ACTUAL
// decision, so the model's self-knowledge (accuracy) improves continuously by
// observation — never by assumption.

import { randomUUID } from "node:crypto";
import {
  db,
  founderDecisionPredictionsTable,
  founderProfileInsightsTable,
  type FounderProfileInsightRow,
} from "@workspace/db";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { logger } from "../lib/logger.js";
import type { ProfileConfidence } from "./founderProfile.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export type DecisionChoice = "approve" | "reject" | "defer" | "uncertain";

export type DecisionPrediction = {
  predictedChoice: DecisionChoice;
  confidence: ProfileConfidence;
  rationale: string;
  basedOn: string[];
};

export type ApprovalLike = {
  id: string;
  objectiveId: string | null;
  title: string;
  detail: string | null;
  impact?: string | null;
};

// Decision-relevant categories, weighted by how directly they predict a choice.
const DECISION_CATEGORIES = [
  "approval_habits",
  "risk_tolerance",
  "release_philosophy",
  "decision_patterns",
  "executive_trust",
] as const;

// ─── Confidence ranking helpers ───────────────────────────────────────────────

const CONFIDENCE_RANK: Record<ProfileConfidence, number> = {
  low: 0,
  medium: 1,
  high: 2,
};

function maxConfidence(
  rows: FounderProfileInsightRow[],
): ProfileConfidence {
  let best: ProfileConfidence = "low";
  for (const r of rows) {
    const c = r.confidence as ProfileConfidence;
    if (CONFIDENCE_RANK[c] > CONFIDENCE_RANK[best]) best = c;
  }
  return best;
}

// ─── Deterministic prediction ─────────────────────────────────────────────────
//
// Rule-based and fully testable: read the decision-relevant insights and infer
// the most likely choice. Confidence is bounded by the strongest supporting
// insight — a prediction is never more confident than its evidence.

function inferChoiceFromInsights(
  rows: FounderProfileInsightRow[],
): { choice: DecisionChoice; basedOn: string[] } {
  const basedOn: string[] = [];
  let approveScore = 0;
  let rejectScore = 0;
  let deferScore = 0;

  for (const r of rows) {
    const text = r.insight.toLowerCase();
    const weight = CONFIDENCE_RANK[r.confidence as ProfileConfidence] + 1; // 1..3
    let matched = false;

    // Approval habits — the most direct signal.
    if (r.category === "approval_habits") {
      if (/\b(approve|approving|trusts?|defers? to|green[- ]?light|fast)\b/.test(text)) {
        approveScore += weight * 2;
        matched = true;
      } else if (/\b(scrutin|reject|push back|question|careful|review)\b/.test(text)) {
        rejectScore += weight * 2;
        matched = true;
      } else if (/\b(defer|later|wait|hold)\b/.test(text)) {
        deferScore += weight * 2;
        matched = true;
      }
    }

    // Risk tolerance — high tolerance leans approve, low leans reject/defer.
    if (r.category === "risk_tolerance") {
      if (/\b(high|aggressive|bold|speed|fast|ship|risk[- ]?tolerant|move fast)\b/.test(text)) {
        approveScore += weight;
        matched = true;
      } else if (/\b(low|cautious|conservative|careful|stable|risk[- ]?averse|safe)\b/.test(text)) {
        rejectScore += weight;
        matched = true;
      }
    }

    // Release philosophy — ship-fast vs stability-first.
    if (r.category === "release_philosophy") {
      if (/\b(ship|fast|early|iterate|launch|speed|momentum)\b/.test(text)) {
        approveScore += weight;
        matched = true;
      } else if (/\b(polish|stable|quality|thorough|careful|slow|test)\b/.test(text)) {
        rejectScore += weight;
        matched = true;
      }
    }

    // Decision patterns / executive trust — decisive + trusting leans approve.
    if (r.category === "decision_patterns" || r.category === "executive_trust") {
      if (/\b(decisive|quick|fast|trusts?|delegat|empower|autonom)\b/.test(text)) {
        approveScore += weight;
        matched = true;
      } else if (/\b(deliberate|slow|cautious|hands[- ]?on|double[- ]?check|verify)\b/.test(text)) {
        rejectScore += weight;
        matched = true;
      }
    }

    if (matched) basedOn.push(`${r.category}: ${r.insight}`);
  }

  const top = Math.max(approveScore, rejectScore, deferScore);
  let choice: DecisionChoice;
  if (top === 0) {
    choice = "uncertain";
  } else if (approveScore === top) {
    choice = "approve";
  } else if (rejectScore === top) {
    choice = "reject";
  } else {
    choice = "defer";
  }
  return { choice, basedOn };
}

/**
 * Predict how the Founder would decide on a pending approval, grounded only in
 * evidence-based profile insights. Confidence is bounded by the strongest
 * supporting insight, and capped at "low" when the signal is thin or conflicting.
 */
export async function predictApprovalDecision(
  approval: ApprovalLike,
): Promise<DecisionPrediction> {
  const rows = await db
    .select()
    .from(founderProfileInsightsTable)
    .where(
      and(
        eq(founderProfileInsightsTable.isActive, true),
        inArray(founderProfileInsightsTable.category, [...DECISION_CATEGORIES]),
      ),
    )
    .orderBy(desc(founderProfileInsightsTable.observationCount));

  if (rows.length === 0) {
    return {
      predictedChoice: "uncertain",
      confidence: "low",
      rationale:
        "No decision history yet — Quinn has not observed enough of how you decide to predict this.",
      basedOn: [],
    };
  }

  const { choice, basedOn } = inferChoiceFromInsights(rows);

  // Confidence is the strongest supporting insight, but never high unless at
  // least two distinct signals agree (single-signal predictions stay medium).
  const supportingRows = rows.filter((r) =>
    basedOn.some((b) => b.endsWith(r.insight)),
  );
  let confidence = maxConfidence(supportingRows);
  if (choice === "uncertain") confidence = "low";
  if (confidence === "high" && supportingRows.length < 2) confidence = "medium";

  const rationale =
    choice === "uncertain"
      ? "Your observed decision patterns don't clearly point one way on this — confirm before acting."
      : `Based on your decision model, you'd likely ${choice} this. ${
          basedOn[0] ? `Grounded in — ${basedOn[0]}.` : ""
        }`;

  return { predictedChoice: choice, confidence, rationale, basedOn: basedOn.slice(0, 4) };
}

// ─── Recording & scoring (the continuous-improvement loop) ─────────────────────

/** Record a prediction so it can be scored once the Founder actually decides. */
export async function recordPrediction(
  approval: ApprovalLike,
  prediction: DecisionPrediction,
): Promise<void> {
  await db
    .insert(founderDecisionPredictionsTable)
    .values({
      id: randomUUID(),
      approvalId: approval.id,
      objectiveId: approval.objectiveId ?? null,
      context: approval.title + (approval.detail ? ` — ${approval.detail.slice(0, 200)}` : ""),
      predictedChoice: prediction.predictedChoice,
      confidence: prediction.confidence,
      rationale: prediction.rationale,
      basedOn: prediction.basedOn,
    })
    .catch((err: unknown) => {
      logger.warn({ err, approvalId: approval.id }, "decision model: failed to record prediction");
    });
}

/**
 * Score the most recent unscored prediction for an approval against the
 * Founder's actual decision. Returns whether the prediction was correct (or
 * null if there was no prediction to score).
 */
export async function scorePrediction(
  approvalId: string,
  actualOutcome: "approved" | "rejected" | "deferred",
): Promise<boolean | null> {
  // Find the latest prediction for this approval that hasn't been scored yet.
  const [prediction] = await db
    .select()
    .from(founderDecisionPredictionsTable)
    .where(
      and(
        eq(founderDecisionPredictionsTable.approvalId, approvalId),
        isNull(founderDecisionPredictionsTable.decidedAt),
      ),
    )
    .orderBy(desc(founderDecisionPredictionsTable.createdAt))
    .limit(1);

  if (!prediction) return null;

  const outcomeToChoice: Record<string, DecisionChoice> = {
    approved: "approve",
    rejected: "reject",
    deferred: "defer",
  };
  const actualChoice = outcomeToChoice[actualOutcome];
  // "uncertain" predictions are never counted as correct or incorrect — they
  // explicitly asked for confirmation, so they neither help nor hurt accuracy.
  const wasCorrect =
    prediction.predictedChoice === "uncertain"
      ? null
      : prediction.predictedChoice === actualChoice;

  await db
    .update(founderDecisionPredictionsTable)
    .set({
      actualOutcome,
      wasCorrect,
      decidedAt: new Date(),
    })
    .where(eq(founderDecisionPredictionsTable.id, prediction.id))
    .catch((err: unknown) => {
      logger.warn({ err, approvalId }, "decision model: failed to score prediction");
    });

  return wasCorrect;
}

// ─── Summary / accuracy (for Quinn's context + the UI) ─────────────────────────

export type DecisionModelSummary = {
  totalPredictions: number;
  scoredPredictions: number;
  correctPredictions: number;
  accuracyPct: number | null; // null when nothing scored yet
  byConfidence: Record<ProfileConfidence, { total: number; correct: number }>;
  recent: Array<{
    context: string;
    predictedChoice: string;
    confidence: ProfileConfidence;
    actualOutcome: string | null;
    wasCorrect: boolean | null;
    createdAt: string;
  }>;
};

export async function getDecisionModelSummary(): Promise<DecisionModelSummary> {
  const rows = await db
    .select()
    .from(founderDecisionPredictionsTable)
    .orderBy(desc(founderDecisionPredictionsTable.createdAt));

  const byConfidence: DecisionModelSummary["byConfidence"] = {
    low: { total: 0, correct: 0 },
    medium: { total: 0, correct: 0 },
    high: { total: 0, correct: 0 },
  };
  let scored = 0;
  let correct = 0;
  for (const r of rows) {
    const c = r.confidence as ProfileConfidence;
    if (r.wasCorrect !== null) {
      scored += 1;
      byConfidence[c].total += 1;
      if (r.wasCorrect) {
        correct += 1;
        byConfidence[c].correct += 1;
      }
    }
  }

  return {
    totalPredictions: rows.length,
    scoredPredictions: scored,
    correctPredictions: correct,
    accuracyPct: scored > 0 ? Math.round((correct / scored) * 100) : null,
    byConfidence,
    recent: rows.slice(0, 8).map((r) => ({
      context: r.context,
      predictedChoice: r.predictedChoice,
      confidence: r.confidence as ProfileConfidence,
      actualOutcome: r.actualOutcome,
      wasCorrect: r.wasCorrect,
      createdAt: r.createdAt.toISOString(),
    })),
  };
}

/**
 * Compact decision-model block for injection into Quinn's reasoning context.
 * Includes the current model accuracy and, for any pending approvals, the
 * predicted choice + confidence so Quinn can act (high) or confirm (low).
 * Returns null when there is nothing useful to inject.
 */
export async function formatDecisionModelForQuinn(
  pendingApprovals: ApprovalLike[],
): Promise<string | null> {
  const summary = await getDecisionModelSummary();
  const lines: string[] = [];

  if (summary.scoredPredictions > 0 && summary.accuracyPct !== null) {
    lines.push(
      `Model accuracy so far: ${summary.accuracyPct}% (${summary.correctPredictions}/${summary.scoredPredictions} past predictions matched the Founder's actual decision).`,
    );
  }

  if (pendingApprovals.length > 0) {
    const predictions = await Promise.all(
      pendingApprovals.slice(0, 5).map(async (a) => {
        const p = await predictApprovalDecision(a);
        const gate =
          p.confidence === "high"
            ? "ACT — high confidence, recommend this proactively"
            : p.confidence === "medium"
              ? "LEAN — medium confidence, recommend but note the uncertainty"
              : "CONFIRM — low confidence, ask the Founder before assuming";
        return `• "${a.title}" → predicted: ${p.predictedChoice.toUpperCase()} (${p.confidence}) → ${gate}`;
      }),
    );
    if (predictions.length > 0) {
      lines.push("Pending-decision predictions:");
      lines.push(...predictions);
    }
  }

  if (lines.length === 0) return null;

  return [
    "━━━ FOUNDER DECISION MODEL (what the Founder would likely choose) ━━━",
    ...lines,
    "",
    "DECISION GATE: Before recommending, predict the Founder's choice. HIGH confidence → act on it decisively. LOW confidence → request confirmation instead of assuming. Only count evidence, never guess.",
  ].join("\n");
}
