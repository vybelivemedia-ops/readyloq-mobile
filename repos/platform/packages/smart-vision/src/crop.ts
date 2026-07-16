/**
 * @platform/smart-vision — smart crop contracts.
 *
 * Smart crop selects the best sub-region of a frame for output based on
 * subject positions and composition rules. All rules and constraints are
 * caller-configured; no domain knowledge is embedded here.
 *
 * GOVERNANCE: See repos/platform/GOVERNANCE.md.
 */

import type { BoundingBox } from "./tracking";

// ─── Aspect ratio ─────────────────────────────────────────────────────────────

/**
 * Rational aspect ratio expressed as integer parts (width : height).
 *
 * Examples:
 *   { w: 16, h: 9 }  — widescreen
 *   { w: 4,  h: 3 }  — legacy video
 *   { w: 1,  h: 1 }  — square
 *   { w: 9,  h: 16 } — vertical / portrait
 */
export interface AspectRatio {
  w: number;
  h: number;
}

// ─── Crop rectangle ───────────────────────────────────────────────────────────

/**
 * Normalised crop region in [0, 1] coordinates — the sub-region of the full
 * frame to retain. Structurally equivalent to BoundingBox; named separately
 * so call sites are self-documenting.
 */
export type CropRect = BoundingBox;

// ─── Crop rules ───────────────────────────────────────────────────────────────

/**
 * Composition rule used to derive the crop rectangle from tracked subjects.
 *
 * "subject_centered" — primary subject centred in the crop window.
 * "rule_of_thirds"   — primary subject placed on a power-of-thirds intersection.
 * "tight"            — crop tightly around all detected subjects (minimal padding).
 * "loose"            — leave comfortable padding around all subjects.
 * "full"             — no crop; return the full frame as-is.
 * "custom"           — caller supplies an explicit CropRect via SmartCropper.suggest.
 */
export type CropRule =
  | "subject_centered"
  | "rule_of_thirds"
  | "tight"
  | "loose"
  | "full"
  | "custom";

// ─── Crop constraints ─────────────────────────────────────────────────────────

export interface CropConstraints {
  /**
   * Minimum crop area as a fraction of the full frame area [0, 1].
   * Prevents over-cropping on small subjects.
   */
  minAreaFraction: number;
  /** Lock the output to this aspect ratio. Null = free aspect ratio. */
  aspectRatio: AspectRatio | null;
  /**
   * Padding to add outside the subject bounding box before cropping.
   * Values in normalised frame units [0, 1].
   */
  padding: {
    top: number;
    right: number;
    bottom: number;
    left: number;
  };
}

// ─── Crop suggestion ──────────────────────────────────────────────────────────

export interface CropSuggestion {
  rect: CropRect;
  rule: CropRule;
  /**
   * Composition score for this suggestion: 0–100.
   * Higher = better framed. Used to rank multiple alternatives.
   */
  score: number;
  /**
   * Human-readable explanation of why this crop was chosen.
   * Intended for debugging and adaptive UI hints; not for end-user display.
   */
  rationale?: string;
}

// ─── Smart cropper ────────────────────────────────────────────────────────────

/**
 * Suggests the best crop rectangle given tracked subject positions and the
 * requested composition rule.
 *
 * `suggest` may return multiple alternatives sorted by descending score.
 * Callers take `result[0]` for the primary recommendation. The result array
 * always contains at least one element.
 */
export interface SmartCropper {
  readonly constraints: CropConstraints;
  /**
   * Compute crop suggestions.
   *
   * @param primarySubject  The main composition anchor. Null for full-frame rules.
   * @param otherSubjects   Additional regions included in tight/loose calculations.
   * @param rule            Which composition rule to apply.
   * @returns Non-empty array of suggestions, ordered by descending score.
   */
  suggest(
    primarySubject: BoundingBox | null,
    otherSubjects: readonly BoundingBox[],
    rule: CropRule,
  ): [CropSuggestion, ...CropSuggestion[]];
}
