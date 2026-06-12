import type { EvidenceQuality } from "./finding-confidence";

// Live evidence-quality heuristic for photo capture (ReadyLoq V2).
// Pure function of the camera signals available at capture time. It NEVER blocks capture —
// it only grades the shot and (optionally) returns coaching tips. Phase 2 will replace this
// with a richer multi-evidence model; keep the signal shape stable so callers don't churn.

export interface CaptureSignals {
  confidence: number;
  lowLight: boolean;
  stabilized: boolean;
  intelligent: boolean;
}

export interface CaptureGrade {
  quality: EvidenceQuality;
  tips: string[];
}

export function gradeCaptureQuality(s: CaptureSignals): CaptureGrade {
  let quality: EvidenceQuality;
  if (s.confidence >= 0.9 && !s.lowLight) {
    quality = "excellent";
  } else if (s.confidence >= 0.8 || (s.intelligent && s.stabilized && s.confidence >= 0.7)) {
    quality = "good";
  } else {
    quality = "fair";
  }

  const tips: string[] = [];
  if (s.lowLight) tips.push("Lighting was low — add a light source or use the flash for a sharper shot.");
  if (s.confidence < 0.85) tips.push("Move closer and center the subject so the detail fills the frame.");
  if (!s.intelligent) tips.push("Hold steady for a moment to let the camera lock focus.");
  if (quality !== "excellent" && tips.length === 0) {
    tips.push("Add a second photo from another angle to corroborate the finding.");
  }
  return { quality, tips };
}
