import { INSPECTION_DICTIONARY } from "./VocabularyRegistry";
import type { StructuredInspectionEvent, VisionContext } from "../types/intent.types";

// Build a fast lowercase lookup for equipment names + aliases.
const EQUIPMENT_CANONICAL: Map<string, string> = new Map(
  INSPECTION_DICTIONARY.equipment.map((e) => [e.toLowerCase(), e]),
);
// Add alias → canonical mappings from the shared alias dict that map to equipment.
for (const [alias, canonical] of Object.entries(INSPECTION_DICTIONARY.aliases)) {
  if (INSPECTION_DICTIONARY.equipment.includes(canonical)) {
    EQUIPMENT_CANONICAL.set(alias.toLowerCase(), canonical);
  }
}

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
    const equipment = this.detectEquipment(lower);

    return {
      action,
      product,
      pest,
      evidence,
      room,
      confidence: baseConfidence,
      severity,
      capturePhoto,
      equipment,
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

  /**
   * Detects application equipment mentions in the transcript.
   *
   * Matches when:
   *  a) One of the equipment phrases ("using my", "with the", ...) precedes a
   *     known equipment term or alias, OR
   *  b) The transcript consists almost entirely of an equipment name/alias
   *     (standalone utterance like "B&G sprayer" or "bait gun").
   *
   * Returns the canonical equipment name (from INSPECTION_DICTIONARY.equipment)
   * or undefined when no equipment is detected.
   */
  private detectEquipment(text: string): string | undefined {
    // Check each canonical equipment entry and its aliases.
    for (const [lowercaseKey, canonical] of EQUIPMENT_CANONICAL) {
      if (!text.includes(lowercaseKey)) continue;

      // Condition (b): standalone — text is just the equipment name (±10 chars of filler).
      if (text.trim().replace(/[.,!?]/g, "").length <= lowercaseKey.length + 10) {
        return canonical;
      }

      // Condition (a): an equipment phrase precedes the equipment name in the text.
      const triggered = INSPECTION_DICTIONARY.equipmentPhrases.some((phrase) => {
        const phraseIdx = text.indexOf(phrase.toLowerCase());
        if (phraseIdx === -1) return false;
        return text.indexOf(lowercaseKey) >= phraseIdx;
      });
      if (triggered) return canonical;
    }

    return undefined;
  }

  private findMatch(text: string, terms: string[]): string | undefined {
    return terms.find((term) => text.includes(term.toLowerCase()));
  }
}
