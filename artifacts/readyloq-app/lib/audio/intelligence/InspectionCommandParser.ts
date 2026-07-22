import { INSPECTION_DICTIONARY } from "./VocabularyRegistry";
import type { StructuredInspectionEvent, VisionContext } from "../types/intent.types";

/**
 * Low-level keyword scanner over a normalized transcript.
 * Used by SpeechIntentEngine after alias resolution.
 *
 * Extracts:
 *  - action / product / pest / evidence / room  (existing entity detection)
 *  - severity  — maps natural-language severity terms to a canonical level
 *  - capturePhoto  — set when the tech says "take a photo", "snap", etc.
 *  - targetField / fieldValue  — explicit field routing via prefix phrases
 *    ("client name is…", "site address is…") so commands bypass the notes
 *    append and write directly to the correct form field.
 */
export class InspectionCommandParser {
  parse(
    normalizedText: string,
    baseConfidence: number,
    visionContext?: VisionContext,
  ): Partial<StructuredInspectionEvent> {
    const lower = normalizedText.toLowerCase();

    const fieldMatch = this.detectFieldPrefix(lower, normalizedText);

    const product = this.findMatch(lower, INSPECTION_DICTIONARY.products)
      ?? visionContext?.detectedProduct;

    const pest = this.findMatch(lower, INSPECTION_DICTIONARY.pests)
      ?? visionContext?.detectedPest;

    const evidence = this.findMatch(lower, INSPECTION_DICTIONARY.evidence);

    const room = this.findMatch(lower, INSPECTION_DICTIONARY.rooms)
      ?? visionContext?.detectedRoom;

    const action = this.findMatch(lower, INSPECTION_DICTIONARY.actions) ?? "inspected";

    const severity = this.detectSeverity(lower);
    const capturePhoto = this.detectCaptureCommand(lower);

    return {
      action,
      product,
      pest,
      evidence,
      room,
      confidence: baseConfidence,
      severity,
      capturePhoto,
      targetField: fieldMatch?.field,
      fieldValue: fieldMatch?.value,
    };
  }

  private detectSeverity(
    text: string,
  ): "low" | "medium" | "high" | "critical" | undefined {
    const sev = INSPECTION_DICTIONARY.severity;
    if (sev.critical.some((t) => text.includes(t))) return "critical";
    if (sev.high.some((t) => text.includes(t))) return "high";
    if (sev.medium.some((t) => text.includes(t))) return "medium";
    if (sev.low.some((t) => text.includes(t))) return "low";
    return undefined;
  }

  private detectCaptureCommand(text: string): boolean {
    return INSPECTION_DICTIONARY.captureCommands.some((cmd) => text.includes(cmd));
  }

  private detectFieldPrefix(
    lower: string,
    original: string,
  ): { field: StructuredInspectionEvent["targetField"]; value: string } | null {
    const prefixes = INSPECTION_DICTIONARY.fieldPrefixes;

    for (const [fieldKey, phrases] of Object.entries(prefixes)) {
      const matched = phrases
        .slice()
        .sort((a, b) => b.length - a.length)
        .find((phrase) => lower.startsWith(phrase.toLowerCase()));

      if (matched) {
        const value = original.slice(matched.length).trim();
        return {
          field: fieldKey as StructuredInspectionEvent["targetField"],
          value,
        };
      }
    }

    if (INSPECTION_DICTIONARY.baitStationTriggers.some((t) => lower.includes(t))) {
      return { field: "baitStation", value: original };
    }

    return null;
  }

  private findMatch(text: string, terms: string[]): string | undefined {
    return terms.find((term) => text.includes(term.toLowerCase()));
  }
}
