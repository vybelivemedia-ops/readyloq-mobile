import type { Finding } from "@workspace/db";

// Shared property-intelligence helpers. These are the single source of truth for
// how a free-text site address is collapsed into a stable matching key and how a
// property type is inferred. Both intelligence.ts and the properties routes
// import from here so grouping never diverges.

const STREET_SUFFIXES: Record<string, string> = {
  street: "st", st: "st",
  avenue: "ave", ave: "ave",
  boulevard: "blvd", blvd: "blvd",
  road: "rd", rd: "rd",
  drive: "dr", dr: "dr",
  lane: "ln", ln: "ln",
  court: "ct", ct: "ct",
  place: "pl", pl: "pl",
  parkway: "pkwy", pkwy: "pkwy",
  highway: "hwy", hwy: "hwy",
};

const UNIT_TOKENS = new Set(["suite", "ste", "unit", "apt", "apartment", "fl", "floor", "bldg", "building"]);

/**
 * Normalize a free-text site address into a stable matching key so the same
 * physical property typed slightly differently across visits still matches.
 * Lowercases, strips punctuation, normalizes common street suffixes, drops
 * unit/suite designators, and collapses whitespace.
 */
export function normalizeAddressKey(siteAddress: string): string {
  if (!siteAddress) return "";
  const cleaned = siteAddress
    .toLowerCase()
    .replace(/[.,#]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const tokens = cleaned.split(" ");
  const out: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (!t) continue;
    // Drop a unit designator and the token that follows it (e.g. "ste 200").
    if (UNIT_TOKENS.has(t)) {
      i++; // skip the unit value too
      continue;
    }
    out.push(STREET_SUFFIXES[t] ?? t);
  }
  // URL-safe slug so the key can be used directly as a path segment.
  return out
    .join("-")
    .replace(/[^a-z0-9-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function propertyTypeFor(clientName: string | null, siteAddress: string): string {
  const s = `${clientName ?? ""} ${siteAddress}`.toLowerCase();
  if (s.includes("warehouse") || s.includes("industrial")) return "Warehouse";
  if (s.includes("restaurant") || s.includes("bakery") || s.includes("cafe") || s.includes("kitchen")) return "Restaurant";
  if (s.includes("apartment") || s.includes("hoa") || s.includes("residence hall") || s.includes("campus")) return "Multifamily";
  if (s.includes("office") || s.includes("commerce") || s.includes("square")) return "Commercial";
  if (s.includes("residence") || s.includes("home") || s.includes("house")) return "Single Family";
  return "Commercial";
}

export function severityRank(sev: string | null | undefined): number {
  if (sev === "critical") return 4;
  if (sev === "high") return 3;
  if (sev === "medium") return 2;
  if (sev === "low") return 1;
  return 0;
}

/**
 * Derive recurring issues for a property by grouping findings (already cleanly
 * categorized) by category across all of its inspections. Returns most-frequent
 * first, carrying the highest severity seen and the last-seen timestamp.
 */
export interface RecurringIssue {
  category: string;
  count: number;
  severity: string;
  lastSeen: string | null;
  sampleDescription: string | null;
}

export function deriveRecurringIssues(
  entries: Array<{ findings: Finding[]; date: Date | string | null }>,
): RecurringIssue[] {
  const map = new Map<string, { count: number; severity: string; lastSeen: number | null; sample: string | null }>();
  for (const entry of entries) {
    const ts = entry.date ? new Date(entry.date).getTime() : null;
    for (const f of entry.findings ?? []) {
      const cat = f.category || "Observation";
      const cur = map.get(cat) ?? { count: 0, severity: f.severity ?? "low", lastSeen: ts, sample: f.description ?? null };
      cur.count += 1;
      if (severityRank(f.severity) > severityRank(cur.severity)) cur.severity = f.severity ?? cur.severity;
      if (ts !== null && (cur.lastSeen === null || ts > cur.lastSeen)) cur.lastSeen = ts;
      if (!cur.sample && f.description) cur.sample = f.description;
      map.set(cat, cur);
    }
  }
  return Array.from(map.entries())
    .map(([category, v]) => ({
      category,
      count: v.count,
      severity: v.severity,
      lastSeen: v.lastSeen !== null ? new Date(v.lastSeen).toISOString() : null,
      sampleDescription: v.sample,
    }))
    .sort((a, b) => b.count - a.count || severityRank(b.severity) - severityRank(a.severity));
}
