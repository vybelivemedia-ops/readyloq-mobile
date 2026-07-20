import { INSPECTION_DICTIONARY } from "./VocabularyRegistry";
import type { StructuredInspectionEvent, VisionContext } from "../types/intent.types";

/**
 * Low-level keyword scanner over a normalized transcript.
 * Used by SpeechIntentEngine after alias resolution.
 */
export class InspectionCommandParser {
  parse(
    normalizedText: string,
    baseConfidence: number,
    visionContext?: VisionContext,
  ): Partial<StructuredInspectionEvent> {
    const lower = normalizedText.toLowerCase();

    const product = this.findMatch(lower, INSPECTION_DICTIONARY.products)
      ?? visionContext?.detectedProduct;

    const pest = this.findMatch(lower, INSPECTION_DICTIONARY.pests)
      ?? visionContext?.detectedPest;

    const evidence = this.findMatch(lower, INSPECTION_DICTIONARY.evidence);

    const room = this.findMatch(lower, INSPECTION_DICTIONARY.rooms)
      ?? visionContext?.detectedRoom;

    const action = this.findMatch(lower, INSPECTION_DICTIONARY.actions) ?? "inspected";

    return { action, product, pest, evidence, room, confidence: baseConfidence };
  }

  private findMatch(text: string, terms: string[]): string | undefined {
    return terms.find((term) => text.includes(term.toLowerCase()));
  }
}
