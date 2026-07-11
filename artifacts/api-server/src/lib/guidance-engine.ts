import type {
  CoverageSnapshot,
  Finding,
  GuidanceRecommendation,
  GuidanceSummary,
  MemoryHighlight,
} from "@workspace/db";

/**
 * Live Guidance Engine.
 *
 * Turns the current AI state (the analysis row's coverage snapshot + real
 * findings + analyzed-photo set) into a PROSPECTIVE, prioritized queue of "next
 * inspection task" recommendations, and surfaces the single highest-priority one
 * (`next`). Pure and derive-on-read — it is recomputed on every response from
 * data already on the row, so it is always fresh and never persisted.
 *
 * This is deliberately distinct from the row's `recommendations` (retrospective
 * corrective actions from `finding.treatment`, e.g. "install a door sweep"):
 * guidance tells the technician where to look NEXT, not what to fix later.
 *
 * Honesty note: there is no enumerated bait-station entity in the data model, so
 * the engine does NOT invent station numbers ("station #4"). Bait-station
 * guidance is grounded in real detected rodent evidence instead.
 */

/** Per-zone guidance: specialized category, imperative title, fixed priority. */
interface ZoneGuidance {
  category: GuidanceRecommendation["category"];
  title: string;
  priority: number;
}

/**
 * Fixed priorities (lower = more urgent) keyed by zone slug. Fixed weights make
 * the surfaced "next task" deterministic so it never flickers between live
 * re-runs. Exclusion/entry points, moisture, and conducive conditions lead
 * because they are the highest-signal, easiest-to-miss inspection targets.
 */
const ZONE_GUIDANCE: Record<string, ZoneGuidance> = {
  exterior_perimeter: {
    category: "missing_exclusion",
    title: "Inspect exterior perimeter & utility penetrations",
    priority: 10,
  },
  moisture_sources: {
    category: "missing_moisture",
    title: "Inspect moisture sources (plumbing, drains, leaks)",
    priority: 20,
  },
  structural_conducive: {
    category: "conducive",
    title: "Inspect structural voids & conducive conditions",
    priority: 30,
  },
  kitchen_sanitation: {
    category: "missing_room",
    title: "Inspect kitchen / food-prep & sanitation",
    priority: 40,
  },
  crawlspace_subfloor: {
    category: "missing_room",
    title: "Inspect crawlspace / subfloor / basement",
    priority: 45,
  },
  harborage_storage: {
    category: "missing_room",
    title: "Inspect harborage, clutter & storage",
    priority: 50,
  },
  attic_roofline: {
    category: "missing_room",
    title: "Inspect attic / roofline",
    priority: 55,
  },
  interior_areas: {
    category: "missing_room",
    title: "Inspect interior living / work areas",
    priority: 60,
  },
  waste_dumpster: {
    category: "missing_room",
    title: "Inspect waste & dumpster area",
    priority: 65,
  },
  loading_dock: {
    category: "missing_room",
    title: "Inspect loading dock / receiving",
    priority: 70,
  },
};

/** Fallback priority for an uncovered required zone not in the map above. */
const UNKNOWN_REQUIRED_PRIORITY = 75;
/** Priority for the photo-volume "thin documentation" prompt. */
const THIN_EVIDENCE_PRIORITY = 80;
/** Priority tail for recommended-but-not-required (suggested) zones. */
const SUGGESTED_PRIORITY = 90;
/** Priority for rodent monitoring — just below the exterior-perimeter task. */
const BAIT_STATION_PRIORITY = 15;

/**
 * Memory-driven tasks outrank every generic capture task: they are grounded in
 * REAL detections at this exact address on a prior visit, so re-checking them is
 * the single most valuable next action. Rodent-not-photographed is the strongest
 * signal, then un-re-documented monitoring, then a previously-active area.
 */
const MEMORY_GUIDANCE: Record<
  MemoryHighlight["type"],
  { category: GuidanceRecommendation["category"]; priority: number; title: (label: string) => string }
> = {
  rodent_area_not_photographed: {
    category: "memory_rodent",
    priority: 4,
    title: (label) => `Re-photograph ${label} — rodent activity last visit`,
  },
  bait_station_missing: {
    category: "memory_bait",
    priority: 6,
    title: (label) => `Re-check rodent monitoring at ${label}`,
  },
  area_not_inspected: {
    category: "memory_activity",
    priority: 8,
    title: (label) => `Re-inspect ${label} — active on last visit`,
  },
};

/** Substrings that mark a finding's free-text species as a rodent. */
const RODENT_KEYWORDS = ["rodent", "mouse", "mice", "rat"];

function hasRodentEvidence(findings: Finding[]): boolean {
  return findings.some((f) => {
    const species = typeof f?.species === "string" ? f.species.toLowerCase() : "";
    return species.length > 0 && RODENT_KEYWORDS.some((k) => species.includes(k));
  });
}

const EMPTY_GUIDANCE: GuidanceSummary = { next: null, queue: [], remaining: 0 };

/**
 * Compute the live guidance queue. All inputs come straight off the analysis
 * row. Returns empty guidance when there is no coverage snapshot yet (no
 * analysis has run, or a legacy/web row without live coverage).
 */
export function computeGuidance(
  coverage: CoverageSnapshot | null | undefined,
  findings: Finding[] | null | undefined,
  analyzedImagePaths?: string[] | null,
  memoryHighlights?: MemoryHighlight[] | null,
): GuidanceSummary {
  if (!coverage) return { next: null, queue: [], remaining: 0 };

  const safeFindings = Array.isArray(findings) ? findings : [];
  const queue: GuidanceRecommendation[] = [];

  // 0) Inspection Memory gaps — grounded in real prior-visit detections at this
  //    address. Highest priority: they are the most valuable next actions and are
  //    already deduped to one highlight per zone by the memory engine. When no
  //    memory is passed (unfiltered list, feedback, web POST) this is a no-op and
  //    guidance is byte-identical to the memory-free behavior.
  for (const h of Array.isArray(memoryHighlights) ? memoryHighlights : []) {
    const g = MEMORY_GUIDANCE[h.type];
    if (!g) continue;
    const label = h.label || h.zone || "prior area";
    queue.push({
      id: `${g.category}:${h.zone ?? h.id}`,
      category: g.category,
      priority: g.priority,
      title: g.title(label),
      reason: h.message,
      zone: h.zone ?? null,
    });
  }

  // 1) Uncovered REQUIRED zones -> specialized "go inspect" tasks.
  for (const zone of coverage.uncoveredRequired ?? []) {
    const g = ZONE_GUIDANCE[zone.slug];
    if (g) {
      queue.push({
        id: `${g.category}:${zone.slug}`,
        category: g.category,
        priority: g.priority,
        title: g.title,
        reason: "Required area not yet captured.",
        zone: zone.slug,
      });
    } else {
      queue.push({
        id: `missing_room:${zone.slug}`,
        category: "missing_room",
        priority: UNKNOWN_REQUIRED_PRIORITY,
        title: `Capture ${zone.label}`,
        reason: "Required area not yet captured.",
        zone: zone.slug,
      });
    }
  }

  // 2) Rodent monitoring. Grounded in a real rodent species detection — not an
  //    enumerated station. Emitted at most once.
  if (hasRodentEvidence(safeFindings)) {
    queue.push({
      id: "bait_stations:rodent",
      category: "bait_stations",
      priority: BAIT_STATION_PRIORITY,
      title: "Set and inspect rodent bait stations along the exterior perimeter",
      reason: "Rodent activity detected — monitoring not yet documented.",
      zone: null,
    });
  }

  // 3) Thin documentation. Keyed on ANALYZED-PHOTO volume, not finding count, so
  //    a genuinely clean property (few findings by design) is never nagged: only
  //    prompt when required coverage is complete yet fewer photos were reviewed
  //    than there are required zones.
  const analyzedCount = Array.isArray(analyzedImagePaths) ? analyzedImagePaths.length : 0;
  const requiredCount = (coverage.requiredZones ?? []).length;
  if (
    (coverage.uncoveredRequired ?? []).length === 0 &&
    requiredCount > 0 &&
    analyzedCount < requiredCount
  ) {
    queue.push({
      id: "missing_evidence:documentation",
      category: "missing_evidence",
      priority: THIN_EVIDENCE_PRIORITY,
      title: "Capture more supporting evidence before finalizing",
      reason: "Required areas are covered but documentation is thin.",
      zone: null,
    });
  }

  // 4) Suggested (recommended-not-required) zones -> low-priority tail, so
  //    guidance never goes silent while useful suggestions remain.
  for (const zone of coverage.suggested ?? []) {
    queue.push({
      id: `suggested_room:${zone.slug}`,
      category: "suggested_room",
      priority: SUGGESTED_PRIORITY,
      title: `Consider capturing ${zone.label}`,
      reason: "Recommended for this property type.",
      zone: zone.slug,
    });
  }

  // Deterministic order: priority asc, then id for a stable tiebreak.
  queue.sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));

  if (queue.length === 0) return EMPTY_GUIDANCE;
  return { next: queue[0], queue, remaining: queue.length - 1 };
}
