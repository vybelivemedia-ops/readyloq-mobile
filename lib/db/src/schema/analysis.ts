import { pgTable, serial, integer, text, real, jsonb, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { inspectionsTable } from "./inspections";
import { companiesTable } from "./companies";

export const analysisResultsTable = pgTable("analysis_results", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companiesTable.id),
  inspectionId: integer("inspection_id").notNull().references(() => inspectionsTable.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("pending"), // "pending" | "complete" | "failed"
  findings: jsonb("findings").$type<Finding[]>().default([]),
  recommendations: jsonb("recommendations").$type<string[]>().default([]),
  // Video evidence attached to the inspection. We record video metadata here so
  // the analysis result is an honest, complete picture of the evidence reviewed,
  // but we DELIBERATELY do not derive findings from video yet. `frameAnalysisStatus`
  // is the forward hook for future per-frame video analysis.
  videoEvidence: jsonb("video_evidence").$type<VideoEvidence[]>().default([]),
  // Storage paths of photos the vision model has ALREADY assessed in this run
  // (including clean photos that produced no finding). Lets the live-inspection
  // flow re-run analysis cheaply: previously-assessed photos are carried over
  // instead of re-sent to the model. Failed photos are NOT recorded so they
  // retry on the next run.
  analyzedImagePaths: jsonb("analyzed_image_paths").$type<string[]>().default([]),
  // Per-photo zone classification (storage path -> zone slug) from the vision
  // model's scene detection. Carried forward across live re-runs like findings,
  // so clean photos (which produce no finding) still count toward zone coverage.
  photoZones: jsonb("photo_zones").$type<Record<string, string>>().default({}),
  // Live inspection completeness snapshot: covered zones vs. the property-type +
  // pest-overlay required set. Recomputed on every analyze and at finalization.
  // Null until the first analysis runs.
  coverage: jsonb("coverage").$type<CoverageSnapshot | null>(),
  overallConfidence: real("overall_confidence"),
  riskLevel: text("risk_level"),
  technicianFeedback: text("technician_feedback"),
  feedbackStatus: text("feedback_status"),
  // Count of photos that failed AI analysis in the most recent analyze run
  // (storage/model/parse errors). Null = pre-migration row or no run yet;
  // 0 = run completed with zero failures; >0 = partial failure.
  analysisErrors: integer("analysis_errors"),
  // Human-readable reason the analysis was skipped or failed, set by the
  // server pipeline when it cannot complete analysis (e.g. "Image resolution
  // too low", "Service temporarily unavailable"). Null = no specific reason
  // provided or analysis succeeded.
  failureReason: text("failure_reason"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export interface Finding {
  id: number;
  category: string;
  description: string;
  confidence: number;
  severity: string;
  location: string | null;
  imageUrl: string | null;
  treatment: string | null;
  exclusionOpportunity: boolean | null;
  evidenceQuality?: "excellent" | "good" | "fair" | null;
  // Structured detection detail for the live AI Inspection Panel. All fields
  // come straight from the vision model's assessment of a real photo — null /
  // absent means that photo showed no such evidence. Optional so findings
  // stored before these fields existed remain valid.
  // Pest identification from the vision model. Mirrors the intelligence-dataset
  // schema so findings stored from that pipeline are valid here too.
  possiblePest?: string | null;
  species?: string | null;
  lifeStage?: string | null;
  conduciveCondition?: string | null;
  harborage?: string | null;
  moisture?: string | null;
  structuralIssue?: string | null;
  // AI-estimated physical dimensions of this structural defect. Populated by
  // the vision model when it can infer dimensions from the photo. Laser sensor
  // readings (from hardware) override these in the mobile pricing engine.
  measurementEstimate?: {
    linearFt?: number | null;
    gapWidthIn?: number | null;
    heightFt?: number | null;
    confidence: number;
    source: "ai_vision_estimate";
  } | null;
  // Inspection zone this finding belongs to (slug from the zone-coverage
  // taxonomy), when the vision model could place it. Null / absent when the
  // scene was unclear — it simply doesn't count toward completeness.
  zone?: string | null;
  // RLQ-002: top-3 AI species candidates with individual confidence scores,
  // sorted descending. Allows the technician to select the correct answer
  // when the model is uncertain. Absent on older findings.
  candidates?: Array<{ species: string; confidence: number }>;
  // RLQ-001/003: confidence-gated display label.
  //   "identified"  → confidence ≥ 0.70, auto-identified species
  //   "possible"    → confidence 0.40–0.69, "Possible: <species>"
  //   "unidentified"→ confidence < 0.40, "Unable to identify"
  confidenceLabel?: "identified" | "possible" | "unidentified";
  // RLQ-001/008: technician review outcome. "pending" = not yet reviewed.
  reviewStatus?: "pending" | "accepted" | "corrected" | "dismissed";
  // RLQ-001: species the technician selected / typed during review.
  // Only set when reviewStatus = "corrected".
  technicianSpecies?: string | null;
}

/** A single inspection zone in a coverage snapshot. */
export interface CoverageZone {
  slug: string;
  label: string;
}

/**
 * Live inspection completeness snapshot. Computed server-side from the set of
 * covered zones (per-photo AI scene detection + attribute-derived zones from
 * findings) against the required zone set for the property type, promoted by
 * pest-specific overlays. ONLY required zones drive `completenessPct`;
 * recommended zones surface as softer `suggested` hints.
 */
export interface CoverageSnapshot {
  /** Normalized property type used to select the requirement matrix. */
  propertyType: string;
  /** 0-100, share of required zones that have at least one covering photo. */
  completenessPct: number;
  requiredZones: CoverageZone[];
  coveredRequired: CoverageZone[];
  uncoveredRequired: CoverageZone[];
  /** Recommended (not required) zones still uncovered — softer prompts. */
  suggested: CoverageZone[];
}

/** A single counted evidence label within an evidence group. */
export interface EvidenceCount {
  /** Stable key (lower-cased label) for React lists. */
  key: string;
  /** Display label, straight from the model's detection (first casing kept). */
  label: string;
  count: number;
}

/**
 * One category in the live evidence tally. `total` is the count of findings that
 * carry this category's attribute and is the PRIMARY display number ("3 Moisture").
 * `items` is a per-label breakdown — meaningful for pest species; for structural /
 * moisture the model's free text tends to be all-unique, so treat items as
 * secondary detail, not a sum.
 */
export interface EvidenceGroup {
  key: "pests" | "structural" | "moisture" | "exclusion";
  label: string;
  total: number;
  items: EvidenceCount[];
}

/**
 * Real-time evidence tally for the live AI Inspection Engine. DERIVED on read
 * from the analysis row's `findings` + `videoEvidence` — never persisted, so it
 * can never be stale. A single finding may contribute to multiple groups (a photo
 * can show a pest AND moisture AND an entry point), so the group totals are
 * independent and MUST NOT be summed to reach `totalEvidence`.
 */
export interface EvidenceSummary {
  /** Distinct evidence items reviewed: photo findings + attached videos. */
  totalEvidence: number;
  /** Photo-derived findings count. */
  photoEvidence: number;
  /** Attached video count (videos are reviewed evidence, not analyzed findings). */
  videoEvidence: number;
  /** Non-empty groups only, in a stable display order. */
  groups: EvidenceGroup[];
}

/**
 * A single next-action produced by the Live Guidance Engine. `priority` is a
 * fixed, deterministic weight (lower = more urgent) so the surfaced "next task"
 * never flickers between live re-runs. This is PROSPECTIVE ("go inspect X next")
 * guidance — distinct from the retrospective `recommendations` (corrective
 * actions grounded in real findings).
 */
export interface GuidanceRecommendation {
  /** Stable key for React lists, e.g. "missing_moisture:moisture_sources". */
  id: string;
  category:
    | "missing_room"
    | "missing_moisture"
    | "missing_exclusion"
    | "bait_stations"
    | "conducive"
    | "missing_evidence"
    | "suggested_room"
    // Memory-driven tasks (grounded in real prior-visit detections at this
    // address). Higher priority than generic capture tasks — see guidance-engine.
    | "memory_rodent"
    | "memory_bait"
    | "memory_activity";
  /** Lower = higher priority; the next task is the lowest number in the queue. */
  priority: number;
  /** Imperative next task, e.g. "Inspect moisture sources (plumbing, drains, leaks)". */
  title: string;
  /** Short justification, e.g. "Required area not yet captured." */
  reason: string;
  /** Coverage zone slug when the task maps to a zone; null / absent otherwise. */
  zone?: string | null;
}

/**
 * Live Guidance Engine output for the AI Inspection Engine. DERIVED on read from
 * the analysis row's `coverage` + `findings` + `analyzedImagePaths` — never
 * persisted, so it can never be stale. Surfaces ONE recommendation at a time
 * (`next`) while keeping the full prioritized `queue` for context.
 */
export interface GuidanceSummary {
  /** The single highest-priority next inspection task; null when nothing pends. */
  next: GuidanceRecommendation | null;
  /** Full prioritized queue, sorted by priority; includes `next` as element 0. */
  queue: GuidanceRecommendation[];
  /** Count of tasks AFTER `next` (queue.length - 1, min 0) — drives "N more". */
  remaining: number;
}

/**
 * Inspection Memory — prior-visit context for the CURRENT inspection at the same
 * physical address (same company). Aggregated verbatim from earlier inspections'
 * analysis rows; NEVER fabricated. The `highlights` are gap alerts comparing the
 * remembered signals against what has been captured today, and they feed the Live
 * Guidance Engine so the "next task" can be memory-driven.
 *
 * Honesty: there is no enumerated bait-station entity, so bait/monitoring memory
 * is grounded in real prior rodent detections / monitoring references and is
 * never numbered ("station #N").
 */
export interface InspectionMemory {
  hasPriorVisits: boolean;
  /** Number of prior inspections at this address (one per visit). */
  priorVisitCount: number;
  /** ISO date of the most recent prior visit, or null. */
  lastVisitDate: string | null;
  pestActivity: MemoryPestActivity[];
  baitStations: MemoryBaitStation[];
  entryPoints: MemoryEntryPoint[];
  recommendations: MemoryNote[];
  treatments: MemoryNote[];
  highlights: MemoryHighlight[];
}

/** A pest species detected on prior visits, aggregated by species. */
export interface MemoryPestActivity {
  /** Lower-cased species for React keys. */
  key: string;
  /** Species as detected (first casing kept). */
  label: string;
  /** Zone slug of a representative finding, when known. */
  zone: string | null;
  /** Highest severity ever seen for this species. */
  severity: string;
  /** Number of prior findings of this species. */
  visits: number;
  /** ISO date last seen, or null. */
  lastSeen: string | null;
}

/** A prior rodent-monitoring / bait-station reference (grounded, never numbered). */
export interface MemoryBaitStation {
  key: string;
  /** Verbatim finding description of the monitoring reference. */
  description: string;
  zone: string | null;
  lastSeen: string | null;
}

/** A prior entry point / exclusion opportunity. */
export interface MemoryEntryPoint {
  key: string;
  description: string;
  zone: string | null;
  lastSeen: string | null;
}

/** A remembered free-text note (recommendation or treatment) with recency. */
export interface MemoryNote {
  key: string;
  text: string;
  lastSeen: string | null;
}

/**
 * A gap alert: a prior-visit signal that today's inspection has not yet
 * re-covered. Only zoned signals (finding.zone known) produce highlights — an
 * unknown zone cannot be proven un-inspected.
 */
export interface MemoryHighlight {
  /** Stable id, `${type}:${zone}`. */
  id: string;
  type: "area_not_inspected" | "bait_station_missing" | "rodent_area_not_photographed";
  zone: string | null;
  /** Human-readable zone / activity label. */
  label: string;
  /** Ready-to-display sentence. */
  message: string;
  lastSeen: string | null;
}

/**
 * Metadata about a video attached to an inspection, recorded on the analysis
 * result as reviewed evidence. Videos are NOT analyzed into findings — see
 * `frameAnalysisStatus`, the forward hook for future per-frame analysis.
 */
export interface VideoEvidence {
  url: string;
  filename: string | null;
  durationSec: number | null;
  label: string | null;
  frameAnalysisStatus: "pending";
}

export const insertAnalysisResultSchema = createInsertSchema(analysisResultsTable).omit({ id: true, createdAt: true, companyId: true });
export type AnalysisResult = typeof analysisResultsTable.$inferSelect;
export type InsertAnalysisResult = z.infer<typeof insertAnalysisResultSchema>;
