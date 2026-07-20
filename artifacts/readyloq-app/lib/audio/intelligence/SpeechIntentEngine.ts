import { INSPECTION_DICTIONARY } from "./VocabularyRegistry";
import { InspectionCommandParser } from "./InspectionCommandParser";
import type { StructuredInspectionEvent, VisionContext } from "../types/intent.types";

/**
 * Deictic/spatial indicator patterns.
 * When a command contains these words the technician is pointing at something
 * currently visible in the camera frame, so detectedObject from visionContext
 * should be merged into the event as visionTarget.
 */
const SPATIAL_RE =
  /\b(this|these|that|those|here|right here|over here|this one|that one|another one|seal this|found (another|one) here)\b/;

/**
 * Resolves aliases, normalizes the transcript, then delegates entity extraction
 * to InspectionCommandParser.  Merges visionContext for context-relative phrases
 * like "seal this", "another bait station here", "same pest as before".
 */
export class SpeechIntentEngine {
  private readonly parser = new InspectionCommandParser();

  parse(
    rawText: string,
    baseConfidence: number,
    visionContext?: VisionContext,
  ): StructuredInspectionEvent {
    let normalized = rawText.toLowerCase();

    for (const [alias, formal] of Object.entries(INSPECTION_DICTIONARY.aliases)) {
      normalized = normalized.replaceAll(alias, formal.toLowerCase());
    }

    const parsed = this.parser.parse(normalized, baseConfidence, visionContext);
    const isSpatial = SPATIAL_RE.test(normalized);

    return {
      rawText,
      action: parsed.action ?? "inspected",
      product: parsed.product,
      pest: parsed.pest,
      evidence: parsed.evidence,
      room: parsed.room,
      confidence: baseConfidence,
      isSpatial,
      // Fold the vision-identified object into the event only for spatial commands.
      visionTarget: isSpatial ? visionContext?.detectedObject : undefined,
    };
  }
}
