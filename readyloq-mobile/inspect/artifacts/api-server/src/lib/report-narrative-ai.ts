import { openai } from "@workspace/integrations-openai-ai-server";
import type { AiReportNarrative, Finding } from "@workspace/db";

/**
 * AI narrative report generator.
 *
 * Turns the data already collected for an inspection (findings, technician
 * notes, voice transcripts, photo labels, pest selections, property metadata)
 * into a professional, multi-section pest-control inspection report via a
 * single text-model call. Photos are NOT re-sent to the model: the vision
 * findings already encode the photo analysis, so a single text completion is
 * fast (well under the 10s target) and avoids contradicting the findings.
 *
 * Failure is explicit, never silent-but-wrong: if the model call fails or
 * returns no content, this throws so the route can return an error. Partial
 * (but parseable) model output is normalized so the report/PDF never has to
 * guard for missing sections.
 */

const MODEL = "gpt-5.4";

const MAX_FINDINGS = 40;
const MAX_RECOMMENDATIONS = 30;
const MAX_VOICE = 30;
const MAX_PHOTO_LABELS = 40;
const MAX_FIELD = 4000;
const MAX_LINE = 600;

export interface NarrativeInput {
  title: string;
  siteAddress: string;
  clientName: string | null;
  technicianName: string;
  inspectionDate: string;
  severity: string | null;
  propertyType: string;
  inspectionType: string | null;
  pestTypes: string[];
  fieldNotes: string | null;
  treatmentNotes: string | null;
  findings: Finding[];
  recommendations: string[];
  voiceTranscripts: string[];
  photoLabels: string[];
  photoCount: number;
  riskLevel: string | null;
}

function trunc(value: string, max = MAX_LINE): string {
  const t = value.trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

function asString(value: unknown, fallback = ""): string {
  if (typeof value !== "string") return fallback;
  const t = value.trim();
  return t.length === 0 || t.toLowerCase() === "null" ? fallback : t;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => (typeof v === "string" ? v.trim() : ""))
    .filter((v) => v.length > 0)
    .map((v) => trunc(v, MAX_LINE));
}

const SECTION_KEYS = [
  "executiveSummary",
  "inspectionFindings",
  "evidenceObserved",
  "pestActivityAssessment",
  "structuralDeficiencies",
  "sanitationConcerns",
  "followUpSchedule",
  "technicianNotes",
  "managerReviewNotes",
] as const;

const SYSTEM_PROMPT =
  "You are a senior pest-control inspector writing the formal written report for a " +
  "completed field inspection. Write in professional, objective, client-ready prose " +
  "using correct pest-control industry terminology (e.g. harborage, conducive " +
  "conditions, exclusion, sanitation deficiencies, IPM, monitoring devices, " +
  "structural exclusion). Tailor language and recommendations to the property type " +
  "(multi-family housing, commercial facility, or food-service/restaurant — including " +
  "relevant health-code and food-safety considerations for restaurants). Ground every " +
  "statement strictly in the supplied data: never invent findings, pests, locations, or " +
  "evidence that are not present in the inputs. If a section has no supporting data, say " +
  "so plainly and professionally rather than fabricating detail. Respond with a single " +
  "JSON object only.";

function buildUserPrompt(input: NarrativeInput): string {
  const findings = input.findings.slice(0, MAX_FINDINGS).map((f, i) => {
    const parts = [
      `#${i + 1}`,
      f.category ? `category=${trunc(String(f.category), 80)}` : "",
      f.severity ? `severity=${f.severity}` : "",
      f.location ? `location=${trunc(String(f.location), 80)}` : "",
      typeof f.confidence === "number"
        ? `confidence=${Math.round(f.confidence * 100)}%`
        : "",
      f.evidenceQuality ? `evidence=${f.evidenceQuality}` : "",
      f.exclusionOpportunity ? "exclusionOpportunity=yes" : "",
      f.description ? `desc=${trunc(String(f.description), 200)}` : "",
      f.treatment ? `treatment=${trunc(String(f.treatment), 160)}` : "",
    ].filter(Boolean);
    return `- ${parts.join(" | ")}`;
  });

  const recommendations = input.recommendations
    .slice(0, MAX_RECOMMENDATIONS)
    .map((r) => `- ${trunc(r, 200)}`);

  const voice = input.voiceTranscripts
    .slice(0, MAX_VOICE)
    .map((v) => `- ${trunc(v, MAX_LINE)}`);

  const photoLabels = input.photoLabels
    .slice(0, MAX_PHOTO_LABELS)
    .map((p) => `- ${trunc(p, 160)}`);

  return [
    "Write a complete pest-control inspection report from the data below.",
    "",
    "=== PROPERTY & INSPECTION ===",
    `Property type: ${input.propertyType}`,
    input.inspectionType ? `Inspection type: ${input.inspectionType}` : "",
    `Site address: ${input.siteAddress}`,
    input.clientName ? `Client: ${input.clientName}` : "",
    `Technician: ${input.technicianName}`,
    `Inspection date: ${input.inspectionDate}`,
    input.severity ? `Overall severity: ${input.severity}` : "",
    input.riskLevel ? `Assessed risk level: ${input.riskLevel}` : "",
    input.pestTypes.length
      ? `Pest types selected: ${input.pestTypes.join(", ")}`
      : "Pest types selected: none recorded",
    `Photos captured: ${input.photoCount}`,
    "",
    "=== FINDINGS (from photo + voice analysis) ===",
    findings.length ? findings.join("\n") : "No structured findings were recorded.",
    "",
    "=== EXISTING RECOMMENDATIONS ===",
    recommendations.length ? recommendations.join("\n") : "None recorded.",
    "",
    "=== PHOTO EVIDENCE LABELS ===",
    photoLabels.length ? photoLabels.join("\n") : "No labeled photos.",
    "",
    "=== TECHNICIAN VOICE NOTES (transcripts) ===",
    voice.length ? voice.join("\n") : "No voice notes recorded.",
    "",
    "=== TECHNICIAN FIELD NOTES ===",
    input.fieldNotes ? trunc(input.fieldNotes, MAX_FIELD) : "None recorded.",
    "",
    "=== TREATMENT NOTES ===",
    input.treatmentNotes ? trunc(input.treatmentNotes, MAX_FIELD) : "None recorded.",
    "",
    "Return a JSON object with EXACTLY these keys (all strings unless noted):",
    '- "executiveSummary": 2-4 sentence high-level overview of the inspection and overall condition',
    '- "inspectionFindings": narrative paragraph(s) summarizing what was inspected and the key findings',
    '- "evidenceObserved": describe the physical evidence observed (droppings, gnaw marks, live/dead specimens, photos), grounded only in the supplied findings/photos/voice notes',
    '- "pestActivityAssessment": assessment of pest activity by type and severity, with industry terminology',
    '- "structuralDeficiencies": structural/exclusion deficiencies (entry points, gaps, door sweeps); state if none were noted',
    '- "sanitationConcerns": sanitation/conducive conditions (moisture, clutter, food debris); for restaurants include food-safety relevance; state if none were noted',
    '- "recommendedCorrectiveActions": ARRAY of concise, actionable corrective-action strings (most important first)',
    '- "monitoringRecommendations": ARRAY of ongoing monitoring/IPM recommendation strings (e.g. device placement, inspection cadence)',
    '- "followUpSchedule": recommended follow-up timing and what the next visit should verify',
    '- "technicianNotes": a clean, professional synthesis of the technician\'s field and voice notes',
    '- "managerReviewNotes": brief notes for a manager reviewing this report (callback risk, account attention, upsell/exclusion opportunities)',
  ]
    .filter((line) => line !== "")
    .join("\n");
}

function normalize(
  parsed: Record<string, unknown>,
  input: NarrativeInput,
): AiReportNarrative {
  const sections = {} as Record<(typeof SECTION_KEYS)[number], string>;
  for (const key of SECTION_KEYS) {
    sections[key] = asString(parsed[key]);
  }
  return {
    ...sections,
    recommendedCorrectiveActions: asStringArray(parsed.recommendedCorrectiveActions),
    monitoringRecommendations: asStringArray(parsed.monitoringRecommendations),
    propertyType: input.propertyType,
    model: MODEL,
    generatedAt: new Date().toISOString(),
  };
}

/**
 * Generate the AI narrative for a report. Resolves to a fully-normalized
 * AiReportNarrative on success; throws on model/parse failure so the caller
 * can surface an explicit error to the technician.
 */
export async function generateReportNarrative(
  input: NarrativeInput,
): Promise<AiReportNarrative> {
  const completion = await openai.chat.completions.create({
    model: MODEL,
    max_completion_tokens: 8192,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: buildUserPrompt(input) },
    ],
  });

  const raw = completion.choices[0]?.message?.content;
  if (!raw) throw new Error("Report narrative generation returned no content");

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new Error("Report narrative generation returned invalid JSON");
  }

  return normalize(parsed, input);
}

/** Derive a human-readable property type from an inspection's setup notes. */
export function derivePropertyType(notes: string | null | undefined): string {
  const text = (notes ?? "").toLowerCase();
  const match = (notes ?? "").match(/property type:\s*([^|]+)/i);
  if (match) return match[1].trim();
  if (/restaurant|food.?service|kitchen|commercial kitchen/.test(text))
    return "Restaurant / Food Service";
  if (/multi.?family|apartment|hoa|condo|housing/.test(text))
    return "Multi-Family";
  if (/commercial|warehouse|office|retail|facility/.test(text))
    return "Commercial";
  return "Commercial / Residential";
}
