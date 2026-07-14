// Static frontend knowledge base for Verification Suggestions (ReadyLoq V2).
// Pure data + a lookup helper — no storage, no API. Maps a finding category to a short
// checklist of corroborating evidence a technician can confirm in the field. This is a
// COACHING surface: it is gated by the coaching preference and never blocks.
//
// Keyed by the canonical finding categories. Lookup is case-insensitive and falls back to
// substring matching so future/variant category names still resolve to the closest list.

const CHECKS: Record<string, string[]> = {
  "Rodent Activity": [
    "Confirm droppings: fresh (dark, moist) vs. old (grey, crumbly)",
    "Photograph gnaw marks, grease/rub marks along runways",
    "Note burrow or nest openings and entry points",
    "Check for a musky odor in enclosed areas",
  ],
  "Cockroach Infestation": [
    "Identify species from egg cases (oothecae) if visible",
    "Photograph fecal spotting in cracks and crevices",
    "Check warm, moist harborage near plumbing and motors",
    "Note any live nymphs vs. adults for severity",
  ],
  "Bed Bug Activity": [
    "Photograph live bugs, shed skins, or blood/fecal staining",
    "Inspect mattress seams, headboards, and furniture joints",
    "Confirm clustering near sleeping/resting areas",
    "Document bites or complaints if reported by occupant",
  ],
  "Sanitation Concern": [
    "Photograph food debris, grease buildup, or standing trash",
    "Note proximity to food prep or storage areas",
    "Check drains and dumpster areas for conducive conditions",
    "Record whether issue is recurring vs. one-time",
  ],
  "Moisture Condition": [
    "Photograph water staining, leaks, or condensation source",
    "Use a moisture meter reading where possible",
    "Identify the source (plumbing, roof, grading, humidity)",
    "Note any mold or wood softening nearby",
  ],
  "Structural Deficiency": [
    "Photograph the gap, crack, or damaged barrier with scale",
    "Confirm it is an active pest entry/harborage point",
    "Measure opening size relative to target pest",
    "Note exterior vs. interior and weatherproofing status",
  ],
  "Termite Activity": [
    "Photograph mud tubes, damaged wood, or swarmers",
    "Tap suspect wood to check for hollow sound",
    "Identify subterranean vs. drywood indicators",
    "Note moisture and soil contact near the structure",
  ],
  "Ant Activity": [
    "Photograph trails and follow to nest/entry if possible",
    "Note species indicators (size, color, trailing pattern)",
    "Check for frass or displaced soil (carpenter ants)",
    "Identify attractant: food, moisture, or shelter",
  ],
  "Flea Activity": [
    "Confirm with flea comb or white-sock test results",
    "Photograph flea dirt on flooring or pet bedding",
    "Note presence of host animals (pets, rodents, wildlife)",
    "Check carpet edges, cracks, and pet resting areas",
  ],
};

const GENERIC: string[] = [
  "Capture a clear, well-lit photo with the issue in focus",
  "Add a wide shot showing the location/context",
  "Note exact location and extent in the finding",
];

export function getVerificationChecks(category: string | null | undefined): string[] {
  if (!category) return GENERIC;
  if (CHECKS[category]) return CHECKS[category];
  const lower = category.toLowerCase();
  const key = Object.keys(CHECKS).find(
    (k) => k.toLowerCase() === lower || lower.includes(k.toLowerCase()) || k.toLowerCase().includes(lower),
  );
  return key ? CHECKS[key] : GENERIC;
}
