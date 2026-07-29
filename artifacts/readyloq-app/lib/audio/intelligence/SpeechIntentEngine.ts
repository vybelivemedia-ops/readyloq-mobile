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
 * Filler words and hesitations that Whisper commonly transcribes but carry
 * no semantic meaning in a pest-control inspection context.
 * Stripped before alias resolution so they don't pollute entity matching.
 */
const FILLER_RE =
  /\b(um+|uh+|er+|hmm+|okay\s*,?|ok\s*,?|hey\s*,?|so\s*,?|well\s*,?|like\s*,?|you know|alright\s*,?|right\s*,?|let me see|let's see|actually\s*,?|i mean\s*,?)\s*/gi;

/**
 * Regex-based phonetic normalization applied before alias lookup.
 *
 * Handles:
 *  - Whisper compound-word splits ("cock roach" → "cockroaches")
 *  - Common accent phonetics ("moskeeto", "gorman cockroach")
 *  - Singular → plural normalization so the dictionary matches reliably
 *  - Homophones that recur in bilingual (Spanish/English) field speech
 *
 * Each pair is [pattern, replacement].  Applied in order — earlier rules
 * take precedence, so more specific patterns come first.
 */
const PHONETIC_PATTERNS: Array<[RegExp, string]> = [
  // ── Whisper compound-word split quirks ──────────────────────────────────
  [/\bcock\s+roach(es)?\b/gi,        "cockroaches"],
  [/\bbed\s+bug(s)?\b/gi,            "bed bugs"],
  [/\bfruit\s+fl(y|ies)\b/gi,        "fruit flies"],
  [/\bdrain\s+fl(y|ies)\b/gi,        "drain flies"],
  [/\bcar\s*pen\s*ter\s+ant(s)?\b/gi,"carpenter ants"],
  [/\brod\s*ent(s)?\b/gi,            "rodents"],
  [/\bbait\s+station(s)?\b/gi,       "bait station"],

  // ── Accent phonetics ────────────────────────────────────────────────────
  // "gorman" / "jar man" ≈ "German" with certain regional accents
  [/\bgorman\b/gi,                   "german"],
  [/\bjar\s*man\b/gi,                "german"],
  // mosquito variations
  [/\bmos[ck]?i?i?to(e?s)?\b/gi,    "mosquitoes"],
  // "rouches" / "rochez" — phonetic cockroach variants
  [/\bro[uo]ch(e[sz]|s)?\b/gi,      "cockroaches"],
  // "cucaracha" singular (plural already in aliases)
  [/\bcucaracha\b/gi,                "cucarachas"],
  // "rato" / "raton" — Spanish singular for rodent
  [/\brat[oó]n?\b/gi,               "ratones"],
  // "mosca" singular
  [/\bmosca\b/gi,                    "moscas"],
  // "hormiga" singular
  [/\bhormiga\b/gi,                  "hormigas"],
  // "chinche" singular
  [/\bchinche\b/gi,                  "chinches"],
  // "pulga" singular
  [/\bpulga\b/gi,                    "pulgas"],
  // "avispa" singular
  [/\bavispa\b/gi,                   "avispas"],

  // ── Singular → plural (so findMatch works against the pests list) ────────
  [/\bant\b(?!s)/gi,                 "ants"],
  [/\bfly\b/gi,                      "flies"],
  [/\bwasp\b(?!s)/gi,                "wasps"],
  [/\bflea\b(?!s)/gi,                "fleas"],
  [/\brat\b(?!s)/gi,                 "rats"],
  [/\bmouse\b/gi,                    "mice"],
  [/\broach(es)?\b/gi,               "cockroaches"],
];

/**
 * Resolves aliases, normalizes the transcript (filler stripping + phonetic
 * normalization), then delegates entity extraction to InspectionCommandParser.
 * Merges visionContext for context-relative phrases like "seal this",
 * "another bait station here", "same pest as before".
 */
export class SpeechIntentEngine {
  private readonly parser = new InspectionCommandParser();

  parse(
    rawText: string,
    baseConfidence: number,
    visionContext?: VisionContext,
  ): StructuredInspectionEvent {
    // 1. Lowercase
    let normalized = rawText.toLowerCase();

    // 2. Strip filler words — prevents "um german cockroaches" from missing
    //    a field-prefix match or creating noise in entity extraction.
    normalized = normalized.replace(FILLER_RE, " ").replace(/\s{2,}/g, " ").trim();

    // 3. Phonetic normalization — handle accent variants, Whisper quirks,
    //    compound-word splits, and singular→plural before alias lookup.
    for (const [pattern, replacement] of PHONETIC_PATTERNS) {
      normalized = normalized.replace(pattern, replacement);
    }

    // 4. Alias expansion — map informal / multilingual terms to canonical
    //    dictionary entries (e.g., "cucarachas" → "German Cockroaches").
    for (const [alias, formal] of Object.entries(INSPECTION_DICTIONARY.aliases)) {
      normalized = normalized.replaceAll(alias.toLowerCase(), formal.toLowerCase());
    }

    // 5. Parse entities
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
