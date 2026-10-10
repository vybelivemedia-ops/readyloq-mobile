import { openai } from "@workspace/integrations-openai-ai-server";
import type { Finding } from "@workspace/db";

/**
 * Customer Summary generator — an AI REPHRASE, never an AI author.
 *
 * The model receives ONLY the stored verified findings/recommendations and
 * rewrites them in homeowner-friendly language. Fidelity gates reject the
 * output entirely (throw) rather than patching it:
 * - dollar figures / pricing language → rejected (the AI has no pricing data)
 * - empty or trivially short output → rejected
 * The caller decides how to surface a rejection; nothing invalid is stored.
 */

const MODEL = "gpt-5.4";

const SYSTEM_PROMPT =
  "You rewrite pest-control inspection results into a clear, warm, plain-language " +
  "summary for the property owner. You work ONLY from the findings and recommendations " +
  "provided — never add observations, never exaggerate, never speculate, and NEVER " +
  "mention prices, costs, or dollar amounts. Structure: a short opening sentence about " +
  "the visit, what was found (grouped simply), what the technician recommends, and a " +
  "reassuring closing line. No headings, no markdown, no bullet symbols — plain " +
  "paragraphs a homeowner can read in under a minute. " +
  'Respond with a single JSON object: { "summary": "..." }.';

export class SummaryFidelityError extends Error {}

export async function generateCustomerSummaryBody(input: {
  siteAddress: string;
  technicianName: string;
  inspectionDate: Date;
  findings: Finding[];
  recommendations: string[];
}): Promise<string> {
  const userPrompt = [
    `Inspection at: ${input.siteAddress}`,
    `Technician: ${input.technicianName}`,
    `Date: ${input.inspectionDate.toISOString().slice(0, 10)}`,
    "",
    "VERIFIED FINDINGS (the only facts you may use):",
    JSON.stringify(
      input.findings.map((f) => ({
        category: f.category,
        description: f.description,
        severity: f.severity,
        location: f.location ?? null,
        treatment: f.treatment ?? null,
      })),
    ),
    "",
    "DOCUMENTED RECOMMENDATIONS:",
    JSON.stringify(input.recommendations),
    "",
    input.findings.length === 0
      ? "No issues were found — write a brief, positive all-clear summary."
      : "Summarize these findings for the property owner.",
  ].join("\n");

  const completion = await openai.chat.completions.create({
    model: MODEL,
    max_completion_tokens: 2048,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ],
  });
  const raw = completion.choices[0]?.message?.content;
  if (!raw) throw new SummaryFidelityError("Empty model response");

  let summary = "";
  try {
    const parsed = JSON.parse(raw) as { summary?: unknown };
    summary = typeof parsed.summary === "string" ? parsed.summary.trim() : "";
  } catch {
    throw new SummaryFidelityError("Model response was not valid JSON");
  }

  if (summary.length < 40) throw new SummaryFidelityError("Summary too short");
  if (summary.length > 4000) summary = summary.slice(0, 4000);
  // Anti-fabrication: any pricing language means invented numbers — reject,
  // don't strip (a summary built around fabricated pricing isn't trustworthy).
  if (/\$\s*\d|\d+\s*(?:dollars|usd)\b|price|pricing|quote|estimate of/i.test(summary)) {
    throw new SummaryFidelityError("Summary contained pricing language");
  }
  return summary;
}
