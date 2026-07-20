import { INSPECTION_DICTIONARY } from "./VocabularyRegistry";
import { InspectionCommandParser } from "./InspectionCommandParser";
import type { StructuredInspectionEvent, VisionContext } from "../types/intent.types";

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

    return {
      rawText,
      action: parsed.action ?? "inspected",
      product: parsed.product,
      pest: parsed.pest,
      evidence: parsed.evidence,
      room: parsed.room,
      confidence: baseConfidence,
    };
  }
}
