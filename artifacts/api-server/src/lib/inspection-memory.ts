import type {
  CoverageSnapshot,
  Finding,
  InspectionMemory,
  MemoryBaitStation,
  MemoryEntryPoint,
  MemoryHighlight,
  MemoryNote,
  MemoryPestActivity,
} from "@workspace/db";

/**
 * Inspection Memory engine.
 *
 * Turns the analysis rows of PRIOR visits at the same address into remembered
 * context (previous pest activity, rodent monitoring / bait references, entry
 * points, recommendations, treatments) and compares that memory against what has
 * been captured on the CURRENT inspection so far to produce gap `highlights`.
 *
 * Pure and honest: every remembered value comes verbatim from a real prior
 * finding/recommendation. There is no enumerated bait-station entity, so bait
 * memory is grounded in real rodent detections / monitoring references and is
 * never numbered. The DB read that gathers `priorVisits` lives in the route; this
 * function takes already-fetched data so it stays pure and unit-testable.
 */

/** One prior visit: the latest complete analysis row of an earlier inspection. */
export interface PriorVisit {
  /** Visit date (the prior inspection's createdAt). */
  date: string | Date | null;
  findings: Finding[];
  recommendations: string[];
}

/** The current inspection's live state, as it exists on the analysis row. */
export interface CurrentState {
  coverage?: CoverageSnapshot | null;
  findings?: Finding[] | null;
  photoZones?: Record<string, string> | null;
}

const RODENT_KEYWORDS = ["rodent", "mouse", "mice", "rat"];
const BAIT_KEYWORDS = /bait|station|trap|monitor/i;
const ENTRY_KEYWORDS = /entry point|exclusion|gap|crack|hole|opening|seal|penetration/i;
const ACTIVITY_CATEGORY = /pest|rodent|roach|ant|termite|activity|infestation|dropping|gnaw|nest/i;

const MAX_LIST = 10;
const MAX_PESTS = 12;

const EMPTY_MEMORY: InspectionMemory = {
  hasPriorVisits: false,
  priorVisitCount: 0,
  lastVisitDate: null,
  pestActivity: [],
  baitStations: [],
  entryPoints: [],
  recommendations: [],
  treatments: [],
  highlights: [],
};

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

function millis(date: string | Date | null): number {
  if (!date) return 0;
  const t = new Date(date).getTime();
  return Number.isNaN(t) ? 0 : t;
}

function iso(date: string | Date | null): string | null {
  const t = millis(date);
  return t ? new Date(t).toISOString() : null;
}

function severityRank(sev: string | null | undefined): number {
  if (sev === "critical") return 4;
  if (sev === "high") return 3;
  if (sev === "medium") return 2;
  if (sev === "low") return 1;
  return 0;
}

function isRodent(f: Finding): boolean {
  const species = str(f.species).toLowerCase();
  const blob = `${str(f.description)} ${str(f.treatment)}`.toLowerCase();
  return (
    (species.length > 0 && RODENT_KEYWORDS.some((k) => species.includes(k))) ||
    RODENT_KEYWORDS.some((k) => blob.includes(k))
  );
}

function isActivity(f: Finding): boolean {
  if (str(f.species).length > 0) return true;
  return ACTIVITY_CATEGORY.test(str(f.category));
}

function isBaitRef(f: Finding): boolean {
  if (isRodent(f)) return true;
  return BAIT_KEYWORDS.test(`${str(f.description)} ${str(f.treatment)} ${str(f.harborage)}`);
}

function isEntryPoint(f: Finding): boolean {
  if (f.exclusionOpportunity === true) return true;
  if (str(f.structuralIssue).length > 0) return true;
  return ENTRY_KEYWORDS.test(`${str(f.category)} ${str(f.description)}`);
}

function prettifyZone(slug: string): string {
  return slug.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Prefer a coverage-provided label for a zone slug; fall back to prettifying. */
function zoneLabel(coverage: CoverageSnapshot | null | undefined, slug: string): string {
  const all = [
    ...(coverage?.requiredZones ?? []),
    ...(coverage?.suggested ?? []),
    ...(coverage?.coveredRequired ?? []),
    ...(coverage?.uncoveredRequired ?? []),
  ];
  return all.find((z) => z.slug === slug)?.label ?? prettifyZone(slug);
}

/** Zones with at least one covering signal on the CURRENT inspection today. */
function coveredTodayZones(current: CurrentState): Set<string> {
  const set = new Set<string>();
  for (const z of current.coverage?.coveredRequired ?? []) set.add(z.slug);
  for (const f of current.findings ?? []) {
    const z = str(f?.zone);
    if (z) set.add(z);
  }
  for (const v of Object.values(current.photoZones ?? {})) {
    if (typeof v === "string" && v) set.add(v);
  }
  return set;
}

interface Dated {
  key: string;
  _ts: number;
}

/** Keep newest per key, then order newest-first, cap, and drop the sort helper. */
function dedupeNewest<T extends Dated>(items: T[], cap: number): Omit<T, "_ts">[] {
  const byKey = new Map<string, T>();
  for (const it of items) {
    const existing = byKey.get(it.key);
    if (!existing || it._ts > existing._ts) byKey.set(it.key, it);
  }
  return Array.from(byKey.values())
    .sort((a, b) => b._ts - a._ts)
    .slice(0, cap)
    .map(({ _ts, ...rest }) => rest);
}

/**
 * Compute Inspection Memory from prior visits vs. the current state. Returns
 * empty memory (hasPriorVisits: false) when there is nothing to remember.
 */
export function computeInspectionMemory(
  priorVisits: PriorVisit[] | null | undefined,
  current: CurrentState,
): InspectionMemory {
  const visits = (Array.isArray(priorVisits) ? priorVisits : []).filter(
    (v) => v && Array.isArray(v.findings),
  );
  if (visits.length === 0) return { ...EMPTY_MEMORY };

  const covered = coveredTodayZones(current);

  const pestMap = new Map<string, MemoryPestActivity>();
  const baitList: (MemoryBaitStation & Dated)[] = [];
  const entryList: (MemoryEntryPoint & Dated)[] = [];
  const recList: (MemoryNote & Dated)[] = [];
  const treatList: (MemoryNote & Dated)[] = [];

  interface ZoneSignal {
    rodent: boolean;
    bait: boolean;
    activity: boolean;
    lastSeen: number;
  }
  const zoneSignals = new Map<string, ZoneSignal>();

  let lastVisit = 0;

  for (const visit of visits) {
    const vts = millis(visit.date);
    const vIso = iso(visit.date);
    if (vts > lastVisit) lastVisit = vts;

    for (const f of visit.findings ?? []) {
      if (!f) continue;
      const zone = str(f.zone) || null;

      // SHOW: pest activity aggregated by species.
      const species = str(f.species);
      if (species) {
        const key = species.toLowerCase();
        const cur = pestMap.get(key);
        if (cur) {
          cur.visits += 1;
          if (severityRank(f.severity) > severityRank(cur.severity)) {
            cur.severity = f.severity ?? cur.severity;
          }
          if (vts > millis(cur.lastSeen)) cur.lastSeen = vIso;
          if (!cur.zone && zone) cur.zone = zone;
        } else {
          pestMap.set(key, {
            key,
            label: species,
            zone,
            severity: f.severity ?? "low",
            visits: 1,
            lastSeen: vIso,
          });
        }
      }

      // SHOW: rodent monitoring / bait references (grounded, never numbered).
      if (isBaitRef(f)) {
        const description =
          str(f.description) || (species ? `${species} monitoring` : "Rodent monitoring");
        baitList.push({
          key: `${description.toLowerCase()}:${zone ?? ""}`,
          description,
          zone,
          lastSeen: vIso,
          _ts: vts,
        });
      }

      // SHOW: entry points / exclusion opportunities.
      if (isEntryPoint(f)) {
        const description =
          str(f.description) || str(f.structuralIssue) || "Entry point / exclusion opportunity";
        entryList.push({
          key: `${description.toLowerCase()}:${zone ?? ""}`,
          description,
          zone,
          lastSeen: vIso,
          _ts: vts,
        });
      }

      // SHOW: per-finding treatments.
      const treatment = str(f.treatment);
      if (treatment) {
        treatList.push({ key: treatment.toLowerCase(), text: treatment, lastSeen: vIso, _ts: vts });
      }

      // HIGHLIGHTS are driven only by ZONED prior findings — an unknown zone
      // cannot be proven un-inspected today.
      if (zone) {
        const sig = zoneSignals.get(zone) ?? {
          rodent: false,
          bait: false,
          activity: false,
          lastSeen: 0,
        };
        if (isRodent(f)) sig.rodent = true;
        if (isBaitRef(f)) sig.bait = true;
        if (isActivity(f)) sig.activity = true;
        if (vts > sig.lastSeen) sig.lastSeen = vts;
        zoneSignals.set(zone, sig);
      }
    }

    // SHOW: visit-level recommendations.
    for (const r of visit.recommendations ?? []) {
      const text = str(r);
      if (text) recList.push({ key: text.toLowerCase(), text, lastSeen: vIso, _ts: vts });
    }
  }

  // One highlight per uncovered zone, strongest signal wins:
  // rodent (not photographed) > bait (monitoring not re-documented) > activity.
  const highlights: MemoryHighlight[] = [];
  for (const [zone, sig] of zoneSignals) {
    if (covered.has(zone)) continue;
    const label = zoneLabel(current.coverage, zone);
    const lastSeen = sig.lastSeen ? new Date(sig.lastSeen).toISOString() : null;
    if (sig.rodent) {
      highlights.push({
        id: `rodent_area_not_photographed:${zone}`,
        type: "rodent_area_not_photographed",
        zone,
        label,
        lastSeen,
        message: `${label} had rodent activity on a previous visit and hasn't been photographed today.`,
      });
    } else if (sig.bait) {
      highlights.push({
        id: `bait_station_missing:${zone}`,
        type: "bait_station_missing",
        zone,
        label,
        lastSeen,
        message: `Rodent monitoring documented at ${label} previously hasn't been re-documented today.`,
      });
    } else if (sig.activity) {
      highlights.push({
        id: `area_not_inspected:${zone}`,
        type: "area_not_inspected",
        zone,
        label,
        lastSeen,
        message: `${label} had pest activity on a previous visit but hasn't been inspected today.`,
      });
    }
  }
  const typeRank: Record<MemoryHighlight["type"], number> = {
    rodent_area_not_photographed: 0,
    bait_station_missing: 1,
    area_not_inspected: 2,
  };
  highlights.sort(
    (a, b) => typeRank[a.type] - typeRank[b.type] || (a.zone ?? "").localeCompare(b.zone ?? ""),
  );

  const pestActivity = Array.from(pestMap.values())
    .sort((a, b) => b.visits - a.visits || severityRank(b.severity) - severityRank(a.severity))
    .slice(0, MAX_PESTS);

  return {
    hasPriorVisits: true,
    priorVisitCount: visits.length,
    lastVisitDate: lastVisit ? new Date(lastVisit).toISOString() : null,
    pestActivity,
    baitStations: dedupeNewest(baitList, MAX_LIST),
    entryPoints: dedupeNewest(entryList, MAX_LIST),
    recommendations: dedupeNewest(recList, MAX_LIST),
    treatments: dedupeNewest(treatList, MAX_LIST),
    highlights,
  };
}
