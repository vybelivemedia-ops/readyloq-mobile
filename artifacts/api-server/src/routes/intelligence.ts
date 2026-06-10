import { Router } from "express";
import { db } from "@workspace/db";
import { inspectionsTable, analysisResultsTable, callbacksTable, type Finding } from "@workspace/db";

const router = Router();

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function propertyTypeFor(clientName: string | null, siteAddress: string): string {
  const s = `${clientName ?? ""} ${siteAddress}`.toLowerCase();
  if (s.includes("warehouse") || s.includes("industrial")) return "Warehouse";
  if (s.includes("restaurant") || s.includes("bakery") || s.includes("cafe") || s.includes("kitchen")) return "Restaurant";
  if (s.includes("apartment") || s.includes("hoa") || s.includes("residence hall") || s.includes("campus")) return "Multifamily";
  if (s.includes("office") || s.includes("commerce") || s.includes("square")) return "Commercial";
  if (s.includes("residence") || s.includes("home") || s.includes("house")) return "Single Family";
  return "Commercial";
}

type OppType = "exclusion" | "structural" | "sanitation" | "moisture" | "follow_up";

const OPP_LABEL: Record<OppType, string> = {
  exclusion: "Exclusion",
  structural: "Structural Repair",
  sanitation: "Sanitation",
  moisture: "Moisture Correction",
  follow_up: "Follow-Up Inspection",
};

const OPP_RECOMMENDATION: Record<OppType, string> = {
  exclusion: "Exclusion Assessment Recommended",
  structural: "Door Sweep / Structural Repair Recommended",
  sanitation: "Sanitation Improvement Recommended",
  moisture: "Moisture Correction Recommended",
  follow_up: "Follow-Up Inspection Recommended",
};

// Keywords that, if present in the documented recommendations, mean the
// opportunity was already reported. Intentionally specific to avoid false
// "documented" matches (e.g. generic "repair" is excluded).
const OPP_KEYWORDS: Record<OppType, string[]> = {
  exclusion: ["seal", "exclusion", "exclude", "copper mesh", "steel wool", "entry point", "escutcheon", "hardware cloth"],
  structural: ["door sweep", "structural", "replace", "soffit", "fascia"],
  moisture: ["moisture", "leak", "dehumidif", "drain", "standing water", "water damage", "dry out", "ventilation"],
  sanitation: ["sanitation", "sanitize", "degreas", "food storage", "harborage removal", "waste"],
  follow_up: ["follow-up", "follow up", "re-inspect", "reinspect", "inspect all", "monitoring", "monitor", "preventive"],
};

// Explicit category -> opportunity type map (no keyword fuzzing on category).
const CATEGORY_OPP: Record<string, OppType> = {
  "Structural Deficiency": "structural",
  "Moisture Condition": "moisture",
  "Sanitation Concern": "sanitation",
  "Rodent Activity": "follow_up",
  "Cockroach Infestation": "follow_up",
  "Bed Bug Activity": "follow_up",
};

function deriveOppType(f: Finding): OppType | null {
  const text = `${f.description ?? ""} ${f.treatment ?? ""}`.toLowerCase();
  if (f.exclusionOpportunity) return "exclusion";
  if (text.includes("door sweep")) return "structural";
  if (/(moisture|leak|standing water|water damage)/.test(text)) return "moisture";
  return CATEGORY_OPP[f.category] ?? null;
}

function isDocumented(type: OppType, recommendations: string[]): boolean {
  const recs = recommendations.map((r) => r.toLowerCase());
  return OPP_KEYWORDS[type].some((k) => recs.some((r) => r.includes(k)));
}

// Property-risk condition detection (per finding)
function conditionsForFinding(f: Finding): string[] {
  const text = `${f.description ?? ""} ${f.treatment ?? ""}`.toLowerCase();
  const out: string[] = [];
  if (f.exclusionOpportunity || f.category === "Structural Deficiency" || /(penetration|gap|crack|opening)/.test(text)) {
    out.push("Utility / Structural Penetration");
  }
  if (text.includes("door sweep")) out.push("Missing Door Sweep");
  if (f.category === "Moisture Condition" || /(moisture|leak|standing water|water damage)/.test(text)) {
    out.push("Moisture Condition");
  }
  if (f.category === "Sanitation Concern" || /(grease|food residue|food debris|waste|harborage)/.test(text)) {
    out.push("Sanitation Issue");
  }
  return out;
}

interface HighRiskProperty {
  inspectionId: number;
  siteAddress: string;
  propertyType: string;
  riskScore: number;
  conditions: string[];
  findingCount: number;
}

function severityWeight(sev: string | null): number {
  if (sev === "critical") return 30;
  if (sev === "high") return 18;
  if (sev === "medium") return 8;
  return 3;
}

function computeHighRiskProperties(
  inspections: (typeof inspectionsTable.$inferSelect)[],
  analyses: (typeof analysisResultsTable.$inferSelect)[],
): HighRiskProperty[] {
  const result: HighRiskProperty[] = [];
  for (const a of analyses) {
    const findings = (a.findings ?? []) as Finding[];
    if (findings.length === 0) continue;
    const insp = inspections.find((i) => i.id === a.inspectionId);
    if (!insp) continue;

    const conditionSet = new Set<string>();
    for (const f of findings) for (const c of conditionsForFinding(f)) conditionSet.add(c);

    // Repeated activity conditions (spec calls out rodent + cockroach specifically)
    const rodentCount = findings.filter((f) => f.category === "Rodent Activity").length;
    const roachCount = findings.filter((f) => f.category === "Cockroach Infestation").length;
    if (rodentCount >= 2) conditionSet.add("Repeated Rodent Activity");
    if (roachCount >= 2) conditionSet.add("Repeated Cockroach Activity");

    const conditions = Array.from(conditionSet);
    const sevScore = findings.reduce((s, f) => s + severityWeight(f.severity), 0);
    const riskScore = Math.min(100, Math.round(sevScore + conditions.length * 5));

    result.push({
      inspectionId: insp.id,
      siteAddress: insp.siteAddress,
      propertyType: propertyTypeFor(insp.clientName, insp.siteAddress),
      riskScore,
      conditions,
      findingCount: findings.length,
    });
  }
  return result.sort((a, b) => b.riskScore - a.riskScore);
}

function monthBuckets(count: number) {
  const now = new Date();
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (count - 1 - i), 1);
    return {
      key: d.toISOString().slice(0, 7),
      label: d.toLocaleDateString("en-US", { month: "short" }),
      year: d.getFullYear(),
      month: d.getMonth(),
    };
  });
}

// Callback finding normalization for "recurring findings"
function findingBucket(finding: string, pestType: string): string {
  const t = finding.toLowerCase();
  if (/(rodent|mouse|mice|rat)/.test(t)) return "Rodent Activity";
  if (/cockroach/.test(t)) return "Cockroach Activity";
  if (/bed bug/.test(t)) return "Bed Bug Activity";
  if (/termite/.test(t)) return "Termite Activity";
  if (/(fly|flies|drain fly|fruit fly)/.test(t)) return "Fly Activity";
  if (/ant/.test(t)) return "Ant Activity";
  if (/flea/.test(t)) return "Flea Activity";
  if (/(moisture|standing water|water)/.test(t)) return "Moisture Condition";
  if (/(penetration|entry|gap|opening)/.test(t)) return "Entry Point / Penetration";
  if (/(soffit|wildlife|raccoon)/.test(t)) return "Wildlife Access";
  return `${pestType} Activity`;
}

const CAUSE_LABEL: Record<string, string> = {
  missing_exclusion: "Missing Exclusion Recommendation",
  undocumented_entry: "Undocumented Entry Point",
  recurring_moisture: "Recurring Moisture Condition",
  repeated_rodent: "Repeated Rodent Activity",
  repeated_cockroach: "Repeated Cockroach Activity",
  sanitation_gap: "Sanitation Gap",
  adjacent_spread: "Adjacent-Unit Spread",
};

const OUTCOME_LABEL: Record<string, string> = {
  activity_reduced: "Activity Reduced",
  resolved: "Resolved",
  callback_occurred: "Callback Occurred",
  pending: "Pending",
};

// ---------------------------------------------------------------------------
// GET /intelligence/opportunities
// Evidence-based opportunities derived from documented findings.
// ---------------------------------------------------------------------------
router.get("/opportunities", async (req, res) => {
  try {
    const inspections = await db.select().from(inspectionsTable);
    const analyses = await db.select().from(analysisResultsTable);

    interface OppItem {
      id: string;
      inspectionId: number;
      siteAddress: string;
      propertyType: string;
      type: OppType;
      typeLabel: string;
      category: string;
      finding: string;
      location: string | null;
      imageUrl: string | null;
      severity: string;
      confidence: number;
      recommendation: string;
      documented: boolean;
    }

    const opportunities: OppItem[] = [];

    for (const a of analyses) {
      if (a.status !== "complete") continue;
      const findings = (a.findings ?? []) as Finding[];
      const recommendations = (a.recommendations ?? []) as string[];
      const insp = inspections.find((i) => i.id === a.inspectionId);
      if (!insp) continue;

      for (const f of findings) {
        const type = deriveOppType(f);
        if (!type) continue;
        const documented = isDocumented(type, recommendations);
        opportunities.push({
          id: `insp-${a.inspectionId}-find-${f.id}`,
          inspectionId: a.inspectionId,
          siteAddress: insp.siteAddress,
          propertyType: propertyTypeFor(insp.clientName, insp.siteAddress),
          type,
          typeLabel: OPP_LABEL[type],
          category: f.category,
          finding: f.description,
          location: f.location,
          imageUrl: f.imageUrl,
          severity: f.severity,
          confidence: f.confidence,
          recommendation: OPP_RECOMMENDATION[type],
          documented,
        });
      }
    }

    const byTypeMap: Record<OppType, number> = { exclusion: 0, structural: 0, sanitation: 0, moisture: 0, follow_up: 0 };
    for (const o of opportunities) byTypeMap[o.type]++;
    const byType = (Object.keys(byTypeMap) as OppType[]).map((t) => ({ type: t, label: OPP_LABEL[t], count: byTypeMap[t] }));

    const highRiskProperties = computeHighRiskProperties(inspections, analyses).filter((p) => p.riskScore >= 60);

    res.json({
      totalOpportunities: opportunities.length,
      exclusionCount: byTypeMap.exclusion,
      structuralCount: byTypeMap.structural,
      sanitationCount: byTypeMap.sanitation,
      moistureCount: byTypeMap.moisture,
      followUpCount: byTypeMap.follow_up,
      unreportedCount: opportunities.filter((o) => !o.documented).length,
      highRiskPropertyCount: highRiskProperties.length,
      byType,
      opportunities,
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to get opportunity intelligence" });
  }
});

// ---------------------------------------------------------------------------
// GET /intelligence/callbacks
// Callback Intelligence from the callbacks table (chains + patterns).
// ---------------------------------------------------------------------------
router.get("/callbacks", async (req, res) => {
  try {
    const all = await db.select().from(callbacksTable);

    const totalChains = all.length;
    const occurred = all.filter((c) => c.outcome === "callback_occurred");
    const totalCallbacks = occurred.length;
    const resolvedCount = all.filter((c) => c.outcome === "resolved").length;
    const activityReducedCount = all.filter((c) => c.outcome === "activity_reduced").length;
    const callbackRate = totalChains > 0 ? Math.round((totalCallbacks / totalChains) * 100) : 0;

    // Top causes (only callbacks that occurred carry a cause)
    const causeMap: Record<string, number> = {};
    for (const c of occurred) {
      if (!c.callbackCause) continue;
      causeMap[c.callbackCause] = (causeMap[c.callbackCause] ?? 0) + 1;
    }
    const topCauses = Object.entries(causeMap)
      .map(([cause, count]) => ({ cause, label: CAUSE_LABEL[cause] ?? cause, count }))
      .sort((a, b) => b.count - a.count);

    // Recurring findings (normalized buckets)
    const findingMap: Record<string, number> = {};
    for (const c of all) {
      const bucket = findingBucket(c.finding, c.pestType);
      findingMap[bucket] = (findingMap[bucket] ?? 0) + 1;
    }
    const recurringFindings = Object.entries(findingMap)
      .map(([finding, count]) => ({ finding, count }))
      .filter((f) => f.count >= 2)
      .sort((a, b) => b.count - a.count);

    // By property type
    const propMap: Record<string, { total: number; callbacks: number }> = {};
    for (const c of all) {
      propMap[c.propertyType] ??= { total: 0, callbacks: 0 };
      propMap[c.propertyType].total++;
      if (c.outcome === "callback_occurred") propMap[c.propertyType].callbacks++;
    }
    const byPropertyType = Object.entries(propMap)
      .map(([propertyType, v]) => ({ propertyType, total: v.total, callbacks: v.callbacks }))
      .sort((a, b) => b.callbacks - a.callbacks);

    // By pest type
    const pestMap: Record<string, { total: number; callbacks: number }> = {};
    for (const c of all) {
      pestMap[c.pestType] ??= { total: 0, callbacks: 0 };
      pestMap[c.pestType].total++;
      if (c.outcome === "callback_occurred") pestMap[c.pestType].callbacks++;
    }
    const byPestType = Object.entries(pestMap)
      .map(([pestType, v]) => ({ pestType, total: v.total, callbacks: v.callbacks }))
      .sort((a, b) => b.callbacks - a.callbacks);
    const pestRecurrence = byPestType
      .map((p) => ({ pestType: p.pestType, count: p.total, recurrenceRate: p.total > 0 ? Math.round((p.callbacks / p.total) * 100) : 0 }))
      .sort((a, b) => b.recurrenceRate - a.recurrenceRate);

    // Trend (6 months)
    const buckets = monthBuckets(6);
    const trend = buckets.map((b) => {
      const inMonth = all.filter((c) => {
        const d = new Date(c.createdAt);
        return d.getFullYear() === b.year && d.getMonth() === b.month;
      });
      return {
        month: b.key,
        label: b.label,
        total: inMonth.length,
        callbacks: inMonth.filter((c) => c.outcome === "callback_occurred").length,
      };
    });

    // Conducive conditions
    const condMap: Record<string, number> = {};
    for (const c of all) {
      if (!c.conduciveCondition) continue;
      condMap[c.conduciveCondition] = (condMap[c.conduciveCondition] ?? 0) + 1;
    }
    const conduciveConditions = Object.entries(condMap)
      .map(([condition, count]) => ({ condition, count }))
      .sort((a, b) => b.count - a.count);

    // Chains (most recent first) — Finding -> Recommendation -> Follow-Up -> Outcome
    const chains = [...all]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .map((c) => ({
        id: c.id,
        finding: c.finding,
        recommendation: c.recommendation,
        followUpVisit: c.followUpVisit,
        outcome: c.outcome,
        outcomeLabel: OUTCOME_LABEL[c.outcome] ?? c.outcome,
        propertyType: c.propertyType,
        pestType: c.pestType,
        callbackCause: c.callbackCause,
        callbackCauseLabel: c.callbackCause ? (CAUSE_LABEL[c.callbackCause] ?? c.callbackCause) : null,
        createdAt: new Date(c.createdAt).toISOString(),
      }));

    res.json({
      totalChains,
      totalCallbacks,
      callbackRate,
      resolvedCount,
      activityReducedCount,
      topCauses,
      recurringFindings,
      byPropertyType,
      byPestType,
      pestRecurrence,
      trend,
      conduciveConditions,
      chains,
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to get callback intelligence" });
  }
});

// ---------------------------------------------------------------------------
// GET /intelligence/property-risk
// Property risk insights derived from documented findings.
// ---------------------------------------------------------------------------
router.get("/property-risk", async (req, res) => {
  try {
    const inspections = await db.select().from(inspectionsTable);
    const analyses = await db.select().from(analysisResultsTable);
    const callbacks = await db.select().from(callbacksTable);

    // Per-property condition sets
    const propertyConditions: { conditions: string[] }[] = [];
    for (const a of analyses) {
      const findings = (a.findings ?? []) as Finding[];
      if (findings.length === 0) continue;
      const set = new Set<string>();
      for (const f of findings) for (const c of conditionsForFinding(f)) set.add(c);
      if (findings.filter((f) => f.category === "Rodent Activity").length >= 2) set.add("Repeated Rodent Activity");
      if (findings.filter((f) => f.category === "Cockroach Infestation").length >= 2) set.add("Repeated Cockroach Activity");
      propertyConditions.push({ conditions: Array.from(set) });
    }

    // Risk indicators = number of properties exhibiting each condition
    const indicatorMap: Record<string, number> = {};
    for (const p of propertyConditions) for (const c of p.conditions) indicatorMap[c] = (indicatorMap[c] ?? 0) + 1;
    const riskIndicators = Object.entries(indicatorMap)
      .map(([condition, count]) => ({ condition, count }))
      .sort((a, b) => b.count - a.count);

    // Recurring conditions = present at 2+ properties
    const recurringConditions = riskIndicators.filter((r) => r.count >= 2);

    const highRiskProperties = computeHighRiskProperties(inspections, analyses);

    // Risk trend = conducive conditions observed over time (from callbacks)
    const buckets = monthBuckets(6);
    const riskTrend = buckets.map((b) => {
      const value = callbacks.filter((c) => {
        if (!c.conduciveCondition) return false;
        const d = new Date(c.createdAt);
        return d.getFullYear() === b.year && d.getMonth() === b.month;
      }).length;
      return { month: b.key, label: b.label, value };
    });

    res.json({
      riskIndicators,
      recurringConditions,
      highRiskProperties,
      riskTrend,
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to get property risk insights" });
  }
});

export default router;
