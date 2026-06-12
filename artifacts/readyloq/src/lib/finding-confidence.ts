export type EvidenceQuality = "excellent" | "good" | "fair";
export type VerificationStatus = "verified" | "pending" | "disputed";

export const EVIDENCE_QUALITY_LABEL: Record<EvidenceQuality, string> = {
  excellent: "Excellent",
  good: "Good",
  fair: "Additional photo recommended",
};

export const EVIDENCE_QUALITY_SHORT: Record<EvidenceQuality, string> = {
  excellent: "Excellent",
  good: "Good",
  fair: "Add another",
};

export const VERIFICATION_LABEL: Record<VerificationStatus, string> = {
  verified: "Verified",
  pending: "Pending",
  disputed: "Disputed",
};

interface FindingLike {
  evidenceQuality?: string | null;
  confidence?: number | null;
  imageUrl?: string | null;
}

/**
 * Evidence quality is STORED on the finding when available (backfilled / captured).
 * When absent, fall back to a conservative heuristic from supporting evidence so the
 * Report Confidence model always has a value. The stored value is intentionally
 * decorrelated from confidence — high confidence with only fair evidence is a real story.
 */
export function deriveEvidenceQuality(f: FindingLike): EvidenceQuality {
  if (f.evidenceQuality === "excellent" || f.evidenceQuality === "good" || f.evidenceQuality === "fair") {
    return f.evidenceQuality;
  }
  const conf = f.confidence ?? 0;
  if (f.imageUrl && conf >= 0.85) return "excellent";
  if (f.imageUrl || conf >= 0.8) return "good";
  return "fair";
}

/**
 * Verification status is always DERIVED (no per-finding write path exists).
 * Analysis context: the analysis-level feedbackStatus drives it.
 * Report context: a finalized report counts as verified; drafts/in-progress are pending.
 */
export function deriveVerificationStatus(opts: {
  feedbackStatus?: string | null;
  reportStatus?: string | null;
}): VerificationStatus {
  const { feedbackStatus, reportStatus } = opts;
  if (feedbackStatus === "confirmed") return "verified";
  if (feedbackStatus === "disputed") return "disputed";
  if (feedbackStatus === "needs-review") return "pending";
  if (reportStatus) {
    const s = reportStatus.toLowerCase();
    if (s === "draft" || s === "pending" || s === "in-progress") return "pending";
    return "verified";
  }
  return "pending";
}

export const evidenceQualityClasses: Record<EvidenceQuality, string> = {
  excellent: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  good: "bg-sky-500/15 text-sky-400 border-sky-500/30",
  fair: "bg-amber-500/15 text-amber-400 border-amber-500/30",
};

export const verificationClasses: Record<VerificationStatus, string> = {
  verified: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  pending: "bg-slate-500/15 text-slate-300 border-slate-500/30",
  disputed: "bg-red-500/15 text-red-400 border-red-500/30",
};
