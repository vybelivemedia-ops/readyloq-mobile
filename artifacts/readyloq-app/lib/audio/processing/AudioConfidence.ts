export enum ConfidenceAction {
  AUTO_COMMIT = "AUTO_COMMIT",
  CONFIRM = "CONFIRM",
  ASK_AGAIN = "ASK_AGAIN",
}

/**
 * Maps a raw transcription confidence score to a dispatch action.
 *
 * > 0.92 → AUTO_COMMIT  — commit the finding immediately, no UI prompt needed.
 * ≥ 0.70 → CONFIRM      — show a brief confirm banner; one tap to accept.
 * < 0.70 → ASK_AGAIN    — re-prompt or flag for manual review.
 */
export class AudioConfidence {
  static evaluate(score: number): ConfidenceAction {
    if (score > 0.92) return ConfidenceAction.AUTO_COMMIT;
    if (score >= 0.7) return ConfidenceAction.CONFIRM;
    return ConfidenceAction.ASK_AGAIN;
  }

  static label(action: ConfidenceAction): string {
    switch (action) {
      case ConfidenceAction.AUTO_COMMIT: return "High confidence";
      case ConfidenceAction.CONFIRM: return "Needs confirmation";
      case ConfidenceAction.ASK_AGAIN: return "Low confidence — re-record";
    }
  }
}
