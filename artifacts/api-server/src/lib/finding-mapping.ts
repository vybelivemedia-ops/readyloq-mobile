import type { Finding } from "@workspace/db";

/**
 * Deterministic finding → service-opportunity mapping shared by the
 * management intelligence routes and the scorecard engine. Pure functions
 * over verified findings — no AI anywhere in this file.
 */

export type OppType = "exclusion" | "structural" | "sanitation" | "moisture" | "follow_up";

export const OPP_LABEL: Record<OppType, string> = {
  exclusion: "Exclusion",
  structural: "Structural Repair",
  sanitation: "Sanitation",
  moisture: "Moisture Correction",
  follow_up: "Follow-Up Inspection",
};

export const OPP_RECOMMENDATION: Record<OppType, string> = {
  exclusion: "Exclusion Assessment Recommended",
  structural: "Door Sweep / Structural Repair Recommended",
  sanitation: "Sanitation Improvement Recommended",
  moisture: "Moisture Correction Recommended",
  follow_up: "Follow-Up Inspection Recommended",
};

// Keywords that, if present in the documented recommendations, mean the
// opportunity was already reported. Intentionally specific to avoid false
// "documented" matches (e.g. generic "repair" is excluded).
export const OPP_KEYWORDS: Record<OppType, string[]> = {
  exclusion: ["seal", "exclusion", "exclude", "copper mesh", "steel wool", "entry point", "escutcheon", "hardware cloth"],
  structural: ["door sweep", "structural", "replace", "soffit", "fascia"],
  moisture: ["moisture", "leak", "dehumidif", "drain", "standing water", "water damage", "dry out", "ventilation"],
  sanitation: ["sanitation", "sanitize", "degreas", "food storage", "harborage removal", "waste"],
  follow_up: ["follow-up", "follow up", "re-inspect", "reinspect", "inspect all", "monitoring", "monitor", "preventive"],
};

// Explicit category -> opportunity type map (no keyword fuzzing on category).
export const CATEGORY_OPP: Record<string, OppType> = {
  "Structural Deficiency": "structural",
  "Moisture Condition": "moisture",
  "Sanitation Concern": "sanitation",
  "Rodent Activity": "follow_up",
  "Cockroach Infestation": "follow_up",
  "Bed Bug Activity": "follow_up",
};

export function deriveOppType(f: Finding): OppType | null {
  const text = `${f.description ?? ""} ${f.treatment ?? ""}`.toLowerCase();
  if (f.exclusionOpportunity) return "exclusion";
  if (text.includes("door sweep")) return "structural";
  if (/(moisture|leak|standing water|water damage)/.test(text)) return "moisture";
  return CATEGORY_OPP[f.category] ?? null;
}

export function isDocumented(type: OppType, recommendations: string[]): boolean {
  const recs = recommendations.map((r) => r.toLowerCase());
  return OPP_KEYWORDS[type].some((k) => recs.some((r) => r.includes(k)));
}
