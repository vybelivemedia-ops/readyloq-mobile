import { openai } from "@workspace/integrations-openai-ai-server";
import {
  INTELLIGENCE_TAXONOMY,
  TAXONOMY_CATEGORY_SLUGS,
  type AiPrediction,
} from "@workspace/db";
import { ObjectStorageService } from "./objectStorage";

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

function userPrompt(): string {
  return [
    "Classify this pest-control field photo. Choose the single best category and",
    "subcategory from this taxonomy (use the exact slug strings shown):",
    "",
    taxonomyText(),
    "",
    "Return a JSON object with EXACTLY these keys:",
    '- "category": one taxonomy category slug, or null if unclear',
    '- "subcategory": one subcategory slug belonging to that category, or null',
    '- "confidence": a number from 0 to 1 (your confidence in the category)',
    '- "tags": array of 1-6 short lowercase keyword strings describing the image',
    '- "possiblePest": likely pest species/common name if any, else null',
    '- "possibleConduciveCondition": conducive condition observed, else null',
    '- "possibleEntryPoint": entry point observed, else null',
    '- "suggestedCorrectiveAction": one concise recommended corrective action, else null',
    '- "rationale": one short sentence explaining the classification',
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

function parsePrediction(raw: string): AiPrediction {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return fallbackPrediction();
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
  };
}

/**
 * Run the vision model against a stored object path (e.g.
 * `/objects/companies/5/uploads/abc`). Always resolves to a valid AiPrediction.
 */
export async function generateAiPrediction(
  objectPath: string,
): Promise<AiPrediction> {
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
            { type: "text", text: userPrompt() },
            { type: "image_url", image_url: { url: dataUrl } },
          ],
        },
      ],
    });
    const raw = completion.choices[0]?.message?.content;
    if (!raw) return fallbackPrediction();
    return parsePrediction(raw);
  } catch {
    return fallbackPrediction();
  }
}
