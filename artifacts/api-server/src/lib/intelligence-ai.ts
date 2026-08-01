import { openai } from "@workspace/integrations-openai-ai-server";
import {
  INTELLIGENCE_TAXONOMY,
  TAXONOMY_CATEGORY_SLUGS,
  type AiPrediction,
} from "@workspace/db";
import { ObjectStorageService } from "./objectStorage";
import { ZONE_SLUGS, normalizeZone } from "./zone-coverage";

/**
 * Real vision-model suggestion step for the Intelligence Dataset.
 *
 * Given a company-private object-storage image, ask a vision model to suggest a
 * structured field-intelligence label (category, subcategory, confidence, tags,
 * possible pest / conducive condition / entry point, corrective action). The
 * technician then confirms or corrects this; the delta between the AI suggestion
 * and the human label is the training signal we persist.
 *
 * Failure is explicit, never silent-but-wrong: any storage/model/parse error
 * yields `fallbackPrediction()` (confidence 0, empty labels) so the caller always
 * gets a well-formed, clearly-low-confidence suggestion to hand to the technician.
 */

const MODEL = "gpt-5.4";
const storage = new ObjectStorageService();

export function fallbackPrediction(): AiPrediction {
  return {
    category: null,
    subcategory: null,
    confidence: 0,
    tags: [],
    possiblePest: null,
    possibleConduciveCondition: null,
    possibleEntryPoint: null,
    suggestedCorrectiveAction: null,
    rationale: null,
    possibleLifeStage: null,
    possibleHarborage: null,
    possibleMoistureIssue: null,
    possibleStructuralIssue: null,
    zone: null,
    pestCandidates: [],
  };
}

async function objectToDataUrl(objectPath: string): Promise<string> {
  const file = await storage.getObjectEntityFile(objectPath);
  const [buffer] = await file.download();
  const [metadata] = await file.getMetadata();
  const contentType = (metadata.contentType as string) || "image/jpeg";
  return `data:${contentType};base64,${buffer.toString("base64")}`;
}

function taxonomyText(): string {
  return INTELLIGENCE_TAXONOMY.map((group) => {
    const subs = group.subcategories.map((s) => s.slug).join(", ");
    return `- ${group.slug} (${group.label}): ${group.description}\n    subcategories: ${subs}`;
  }).join("\n");
}

const SYSTEM_PROMPT =
  "You are a senior pest-control field-intelligence analyst. You examine a single " +
  "field photo taken by a technician and produce a precise, structured assessment " +
  "for a training dataset. Be conservative: when the image is ambiguous, lower your " +
  "confidence rather than guessing. Respond with a single JSON object only.";

function userPrompt(technicianNote?: string | null): string {
  const noteClause = technicianNote
    ? [
        "",
        `Technician note for this photo: "${technicianNote.trim()}"`,
        "Use this note as additional context when classifying — the technician was on-site and",
        "may have spotted something not immediately obvious in the image. Do NOT simply repeat",
        "the note verbatim; ground your response in what is visually present.",
      ]
    : [];
  return [
    "Classify this pest-control field photo. Choose the single best category and",
    "subcategory from this taxonomy (use the exact slug strings shown):",
    "",
    taxonomyText(),
    "",
    "Return a JSON object with EXACTLY these keys:",
    '- "category": one taxonomy category slug, or null if unclear',
    '- "subcategory": one subcategory slug belonging to that category, or null',
    '- "confidence": a number from 0 to 1 (your confidence in the single best pest/category identification)',
    '- "tags": array of 1-6 short lowercase keyword strings describing the image',
    '- "possiblePest": the single most likely pest species/common name if any, else null',
    '- "pestCandidates": array of up to 3 candidate pest species sorted by confidence descending.',
    '  Each entry: {"species":"<common name>","confidence":<0-1>}.',
    '  Include only candidates genuinely plausible in this image; use [] when no pest is visible.',
    '  Example: [{"species":"Bed Bug","confidence":0.72},{"species":"Spider Beetle","confidence":0.18},{"species":"Carpet Beetle","confidence":0.10}]',
    '- "possibleLifeStage": pest life stage VISIBLE in the image (e.g. egg, larva, nymph, pupa, adult, juvenile), else null',
    '- "possibleConduciveCondition": conducive condition observed, else null',
    '- "possibleHarborage": harborage (nesting/shelter site) observed, else null',
    '- "possibleMoistureIssue": moisture problem observed (leak, standing water, damp material, condensation), else null',
    '- "possibleStructuralIssue": structural deficiency observed (gap, crack, hole, damaged material, failed seal), else null',
    '- "possibleEntryPoint": entry point observed, else null',
    '- "suggestedCorrectiveAction": one concise recommended corrective action, else null',
    '- "rationale": one short sentence explaining the classification',
    `- "zone": the single inspection zone this photo depicts, one of: ${ZONE_SLUGS.join(", ")}; or null if the scene is unclear`,
    "",
    "Only report what is actually visible in THIS image. Every field must be",
    "grounded in visible evidence — when the image shows no such evidence,",
    "return null for that field rather than guessing.",
    ...noteClause,
  ].join("\n");
}

function clampConfidence(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function asStringOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length === 0 || trimmed.toLowerCase() === "null"
    ? null
    : trimmed;
}

function parsePrediction(raw: string): AiPrediction | null {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }

  let category = asStringOrNull(parsed.category);
  if (category && !TAXONOMY_CATEGORY_SLUGS.includes(category)) {
    // The model returned something outside our taxonomy; keep the tag/pest
    // detail it surfaced but don't assert an invalid category.
    category = null;
  }
  let subcategory = asStringOrNull(parsed.subcategory);
  if (category) {
    const group = INTELLIGENCE_TAXONOMY.find((g) => g.slug === category);
    if (
      subcategory &&
      !group?.subcategories.some((s) => s.slug === subcategory)
    ) {
      subcategory = null;
    }
  } else {
    subcategory = null;
  }

  const tags = Array.isArray(parsed.tags)
    ? parsed.tags
        .filter((t): t is string => typeof t === "string")
        .map((t) => t.trim().toLowerCase())
        .filter((t) => t.length > 0)
        .slice(0, 6)
    : [];

  const pestCandidates = Array.isArray(parsed.pestCandidates)
    ? (parsed.pestCandidates as unknown[])
        .filter(
          (c): c is { species: string; confidence: number } =>
            c !== null &&
            typeof c === "object" &&
            typeof (c as Record<string, unknown>).species === "string" &&
            typeof (c as Record<string, unknown>).confidence === "number",
        )
        .map((c) => ({
          species: c.species.trim(),
          confidence: clampConfidence(c.confidence),
        }))
        .filter((c) => c.species.length > 0)
        .slice(0, 3)
    : [];

  return {
    category,
    subcategory,
    confidence: clampConfidence(parsed.confidence),
    tags,
    possiblePest: asStringOrNull(parsed.possiblePest),
    possibleConduciveCondition: asStringOrNull(parsed.possibleConduciveCondition),
    possibleEntryPoint: asStringOrNull(parsed.possibleEntryPoint),
    suggestedCorrectiveAction: asStringOrNull(parsed.suggestedCorrectiveAction),
    rationale: asStringOrNull(parsed.rationale),
    possibleLifeStage: asStringOrNull(parsed.possibleLifeStage),
    possibleHarborage: asStringOrNull(parsed.possibleHarborage),
    possibleMoistureIssue: asStringOrNull(parsed.possibleMoistureIssue),
    possibleStructuralIssue: asStringOrNull(parsed.possibleStructuralIssue),
    zone: normalizeZone(parsed.zone),
    pestCandidates,
  };
}

/**
 * Run the vision model against a stored object path (e.g.
 * `/objects/companies/5/uploads/abc`).
 *
 * Returns `null` when the analysis genuinely FAILED — a storage/model/parse
 * error or an empty model response. A successfully parsed result (even a
 * conservative, low-/zero-confidence one) is returned as-is. Callers that must
 * distinguish "analysis failed" from "analysis found nothing notable" should
 * use this directly; callers that just want a well-formed suggestion should use
 * {@link generateAiPrediction}.
 */
export async function analyzePhoto(
  objectPath: string,
  technicianNote?: string | null,
): Promise<AiPrediction | null> {
  try {
    const dataUrl = await objectToDataUrl(objectPath);
    const completion = await openai.chat.completions.create({
      model: MODEL,
      max_completion_tokens: 8192,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            { type: "text", text: userPrompt(technicianNote) },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        },
      ],
    });
    const raw = completion.choices[0]?.message?.content;
    if (!raw) return null;
    return parsePrediction(raw);
  } catch {
    return null;
  }
}

/**
 * Never-failing wrapper around {@link analyzePhoto}: any failure yields
 * `fallbackPrediction()` (confidence 0, empty labels) so the Intelligence
 * Dataset contribution flow always gets a well-formed, clearly-low-confidence
 * suggestion to hand to the technician.
 */
export async function generateAiPrediction(
  objectPath: string,
): Promise<AiPrediction> {
  return (await analyzePhoto(objectPath)) ?? fallbackPrediction();
}

/**
 * Variant of {@link analyzePhoto} that accepts a raw base64-encoded JPEG
 * directly (e.g. from a Meta Live AI webhook frame) instead of an object-
 * storage path.  No file I/O — the data URL is constructed in memory.
 */
export async function analyzePhotoFromBase64(
  base64Jpeg: string,
): Promise<AiPrediction | null> {
  try {
    const dataUrl = `data:image/jpeg;base64,${base64Jpeg}`;
    const completion = await openai.chat.completions.create({
      model: MODEL,
      max_completion_tokens: 8192,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        {
          role: "user",
          content: [
            { type: "text", text: userPrompt() },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        },
      ],
    });
    const raw = completion.choices[0]?.message?.content;
    if (!raw) return null;
    return parsePrediction(raw);
  } catch {
    return null;
  }
}
