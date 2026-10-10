import type { CoverageSnapshot, CoverageZone, Finding } from "@workspace/db";

/**
 * Live inspection completeness scoring.
 *
 * The taxonomy is a fixed set of 10 inspection zones. For each of 5 normalized
 * property types a zone is Required (`R`), recommended (`r`), or not applicable
 * (`-`). Pest-specific overlays PROMOTE certain zones to Required when that pest
 * is in scope (a rodent job makes the attic/crawlspace mandatory, etc.).
 *
 * Completeness is deliberately conservative: ONLY required zones drive the
 * percentage, a zone counts as covered only when a real photo maps to it, and an
 * unclear scene simply doesn't count. Coverage therefore fails toward
 * understatement — it can never invent progress the technician didn't make.
 */

export type PropertyType =
  | "Single Family"
  | "Multifamily"
  | "Commercial"
  | "Restaurant"
  | "Warehouse";

export const PROPERTY_TYPES: readonly PropertyType[] = [
  "Single Family",
  "Multifamily",
  "Commercial",
  "Restaurant",
  "Warehouse",
];

type Requirement = "R" | "r" | "-";

interface ZoneDef {
  slug: string;
  label: string;
  /** Requirement level per property type. */
  matrix: Record<PropertyType, Requirement>;
}

// Zone requirement matrix. Columns: Single Family (SF), Multifamily (MF),
// Commercial (Com), Restaurant (Rest), Warehouse (WH).
export const ZONES: readonly ZoneDef[] = [
  {
    slug: "exterior_perimeter",
    label: "Exterior perimeter & entry points",
    matrix: { "Single Family": "R", Multifamily: "R", Commercial: "R", Restaurant: "R", Warehouse: "R" },
  },
  {
    slug: "interior_areas",
    label: "Interior living / work areas",
    matrix: { "Single Family": "R", Multifamily: "R", Commercial: "R", Restaurant: "r", Warehouse: "r" },
  },
  {
    slug: "kitchen_sanitation",
    label: "Kitchen / food-prep & sanitation",
    matrix: { "Single Family": "R", Multifamily: "R", Commercial: "r", Restaurant: "R", Warehouse: "-" },
  },
  {
    slug: "moisture_sources",
    label: "Moisture sources (plumbing, drains, leaks)",
    matrix: { "Single Family": "R", Multifamily: "R", Commercial: "R", Restaurant: "R", Warehouse: "R" },
  },
  {
    slug: "harborage_storage",
    label: "Harborage, clutter & storage",
    matrix: { "Single Family": "R", Multifamily: "R", Commercial: "R", Restaurant: "R", Warehouse: "R" },
  },
  {
    slug: "structural_conducive",
    label: "Structural voids & conducive conditions",
    matrix: { "Single Family": "R", Multifamily: "R", Commercial: "R", Restaurant: "R", Warehouse: "R" },
  },
  {
    slug: "attic_roofline",
    label: "Attic / roofline",
    matrix: { "Single Family": "r", Multifamily: "r", Commercial: "r", Restaurant: "-", Warehouse: "R" },
  },
  {
    slug: "crawlspace_subfloor",
    label: "Crawlspace / subfloor / basement",
    matrix: { "Single Family": "R", Multifamily: "r", Commercial: "r", Restaurant: "r", Warehouse: "r" },
  },
  {
    slug: "waste_dumpster",
    label: "Waste & dumpster area",
    matrix: { "Single Family": "-", Multifamily: "R", Commercial: "R", Restaurant: "R", Warehouse: "R" },
  },
  {
    slug: "loading_dock",
    label: "Loading dock / receiving",
    matrix: { "Single Family": "-", Multifamily: "-", Commercial: "r", Restaurant: "R", Warehouse: "R" },
  },
];

export const ZONE_SLUGS: readonly string[] = ZONES.map((z) => z.slug);

const ZONE_BY_SLUG = new Map<string, ZoneDef>(ZONES.map((z) => [z.slug, z]));

/**
 * Pest overlays: substrings matched (case-insensitive) against the free-text
 * pest types on the inspection. Any match promotes its zones to Required.
 */
const PEST_OVERLAYS: ReadonlyArray<{ keywords: string[]; zones: string[] }> = [
  { keywords: ["rodent", "mouse", "mice", "rat"], zones: ["attic_roofline", "crawlspace_subfloor"] },
  { keywords: ["roach", "cockroach"], zones: ["kitchen_sanitation", "moisture_sources", "harborage_storage"] },
  { keywords: ["ant"], zones: ["exterior_perimeter", "moisture_sources"] },
  { keywords: ["termite", "wood-destroying", "wood destroying", "wdo"], zones: ["structural_conducive", "crawlspace_subfloor", "moisture_sources"] },
  { keywords: ["bed bug", "bedbug"], zones: ["interior_areas", "harborage_storage"] },
  { keywords: ["fly", "flies"], zones: ["waste_dumpster", "kitchen_sanitation", "moisture_sources"] },
  { keywords: ["stored product", "stored-product", "pantry"], zones: ["harborage_storage", "kitchen_sanitation"] },
];

/**
 * Map any human-readable property-type string (mobile's 8-value picker, or the
 * looser strings from {@link derivePropertyType}) onto one of the 5 matrix
 * columns. Order is by specificity; unknown strings fall back to Commercial.
 */
export function normalizePropertyType(raw: string | null | undefined): PropertyType {
  const t = (raw ?? "").toLowerCase();
  if (/warehouse|industrial|distribution|logistics/.test(t)) return "Warehouse";
  if (/restaurant|food.?service|cafe|caf\u00e9|bakery|diner|bar & grill|food prep/.test(t)) return "Restaurant";
  if (/multi.?family|apartment|hoa|condo|housing|duplex|tenant/.test(t)) return "Multifamily";
  if (/commercial|office|retail|school|health.?care|hospital|clinic|hospitality|hotel|motel|facility|store|mall/.test(t))
    return "Commercial";
  if (/single.?family|residential|residence|home|house|dwelling/.test(t)) return "Single Family";
  return "Commercial";
}

/** Validate a raw zone value from the model against the taxonomy. */
export function normalizeZone(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const slug = raw.trim().toLowerCase();
  return ZONE_BY_SLUG.has(slug) ? slug : null;
}

const toCoverageZone = (slug: string): CoverageZone => ({
  slug,
  label: ZONE_BY_SLUG.get(slug)?.label ?? slug,
});

/**
 * Attribute-derived zones from a real finding, used to widen recall so a finding
 * still counts toward coverage even when the model didn't classify the scene.
 * Includes the finding's own `zone` when present.
 */
export function zonesFromFinding(finding: Finding): string[] {
  const zones = new Set<string>();
  const own = normalizeZone(finding.zone);
  if (own) zones.add(own);
  if (finding.exclusionOpportunity) zones.add("exterior_perimeter");
  if (finding.moisture) zones.add("moisture_sources");
  if (finding.harborage) zones.add("harborage_storage");
  if (finding.structuralIssue || finding.conduciveCondition) zones.add("structural_conducive");
  if (finding.species) zones.add("interior_areas");
  return [...zones];
}

export interface ComputeCoverageInput {
  /** Raw property-type string (normalized internally). */
  propertyType: string | null | undefined;
  /** Free-text pest types in scope for the inspection. */
  pestTypes: string[];
  /** All zone slugs covered by real evidence (photos + findings); may be messy. */
  coveredZoneSlugs: string[];
}

/**
 * Compute the completeness snapshot. Only Required zones (base matrix + pest
 * overlays) drive `completenessPct`; recommended-but-uncovered zones surface as
 * softer `suggested` hints.
 */
export function computeCoverage(input: ComputeCoverageInput): CoverageSnapshot {
  const propertyType = normalizePropertyType(input.propertyType);

  // Base requirement per zone for this property type.
  const level = new Map<string, Requirement>();
  for (const zone of ZONES) level.set(zone.slug, zone.matrix[propertyType]);

  // Pest overlays promote matched zones to Required.
  const pestText = (input.pestTypes ?? []).map((p) => (p ?? "").toLowerCase());
  for (const overlay of PEST_OVERLAYS) {
    const active = overlay.keywords.some((kw) => pestText.some((p) => p.includes(kw)));
    if (!active) continue;
    for (const slug of overlay.zones) level.set(slug, "R");
  }

  const covered = new Set<string>();
  for (const slug of input.coveredZoneSlugs) {
    const norm = normalizeZone(slug);
    if (norm) covered.add(norm);
  }

  const requiredZones: CoverageZone[] = [];
  const coveredRequired: CoverageZone[] = [];
  const uncoveredRequired: CoverageZone[] = [];
  const suggested: CoverageZone[] = [];

  for (const zone of ZONES) {
    const req = level.get(zone.slug) ?? "-";
    if (req === "R") {
      const cz = toCoverageZone(zone.slug);
      requiredZones.push(cz);
      if (covered.has(zone.slug)) coveredRequired.push(cz);
      else uncoveredRequired.push(cz);
    } else if (req === "r" && !covered.has(zone.slug)) {
      suggested.push(toCoverageZone(zone.slug));
    }
  }

  const completenessPct =
    requiredZones.length === 0
      ? 100
      : Math.round((coveredRequired.length / requiredZones.length) * 100);

  return {
    propertyType,
    completenessPct,
    requiredZones,
    coveredRequired,
    uncoveredRequired,
    suggested,
  };
}
