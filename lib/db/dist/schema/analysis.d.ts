import { z } from "zod/v4";
export declare const analysisResultsTable: import("drizzle-orm/pg-core").PgTableWithColumns<{
    name: "analysis_results";
    schema: undefined;
    columns: {
        id: import("drizzle-orm/pg-core").PgColumn<{
            name: "id";
            tableName: "analysis_results";
            dataType: "number";
            columnType: "PgSerial";
            data: number;
            driverParam: number;
            notNull: true;
            hasDefault: true;
            isPrimaryKey: true;
            isAutoincrement: false;
            hasRuntimeDefault: false;
            enumValues: undefined;
            baseColumn: never;
            identity: undefined;
            generated: undefined;
        }, {}, {}>;
        companyId: import("drizzle-orm/pg-core").PgColumn<{
            name: "company_id";
            tableName: "analysis_results";
            dataType: "number";
            columnType: "PgInteger";
            data: number;
            driverParam: string | number;
            notNull: true;
            hasDefault: false;
            isPrimaryKey: false;
            isAutoincrement: false;
            hasRuntimeDefault: false;
            enumValues: undefined;
            baseColumn: never;
            identity: undefined;
            generated: undefined;
        }, {}, {}>;
        inspectionId: import("drizzle-orm/pg-core").PgColumn<{
            name: "inspection_id";
            tableName: "analysis_results";
            dataType: "number";
            columnType: "PgInteger";
            data: number;
            driverParam: string | number;
            notNull: true;
            hasDefault: false;
            isPrimaryKey: false;
            isAutoincrement: false;
            hasRuntimeDefault: false;
            enumValues: undefined;
            baseColumn: never;
            identity: undefined;
            generated: undefined;
        }, {}, {}>;
        status: import("drizzle-orm/pg-core").PgColumn<{
            name: "status";
            tableName: "analysis_results";
            dataType: "string";
            columnType: "PgText";
            data: string;
            driverParam: string;
            notNull: true;
            hasDefault: true;
            isPrimaryKey: false;
            isAutoincrement: false;
            hasRuntimeDefault: false;
            enumValues: [string, ...string[]];
            baseColumn: never;
            identity: undefined;
            generated: undefined;
        }, {}, {}>;
        findings: import("drizzle-orm/pg-core").PgColumn<{
            name: "findings";
            tableName: "analysis_results";
            dataType: "json";
            columnType: "PgJsonb";
            data: Finding[];
            driverParam: unknown;
            notNull: false;
            hasDefault: true;
            isPrimaryKey: false;
            isAutoincrement: false;
            hasRuntimeDefault: false;
            enumValues: undefined;
            baseColumn: never;
            identity: undefined;
            generated: undefined;
        }, {}, {
            $type: Finding[];
        }>;
        recommendations: import("drizzle-orm/pg-core").PgColumn<{
            name: "recommendations";
            tableName: "analysis_results";
            dataType: "json";
            columnType: "PgJsonb";
            data: string[];
            driverParam: unknown;
            notNull: false;
            hasDefault: true;
            isPrimaryKey: false;
            isAutoincrement: false;
            hasRuntimeDefault: false;
            enumValues: undefined;
            baseColumn: never;
            identity: undefined;
            generated: undefined;
        }, {}, {
            $type: string[];
        }>;
        videoEvidence: import("drizzle-orm/pg-core").PgColumn<{
            name: "video_evidence";
            tableName: "analysis_results";
            dataType: "json";
            columnType: "PgJsonb";
            data: VideoEvidence[];
            driverParam: unknown;
            notNull: false;
            hasDefault: true;
            isPrimaryKey: false;
            isAutoincrement: false;
            hasRuntimeDefault: false;
            enumValues: undefined;
            baseColumn: never;
            identity: undefined;
            generated: undefined;
        }, {}, {
            $type: VideoEvidence[];
        }>;
        analyzedImagePaths: import("drizzle-orm/pg-core").PgColumn<{
            name: "analyzed_image_paths";
            tableName: "analysis_results";
            dataType: "json";
            columnType: "PgJsonb";
            data: string[];
            driverParam: unknown;
            notNull: false;
            hasDefault: true;
            isPrimaryKey: false;
            isAutoincrement: false;
            hasRuntimeDefault: false;
            enumValues: undefined;
            baseColumn: never;
            identity: undefined;
            generated: undefined;
        }, {}, {
            $type: string[];
        }>;
        photoZones: import("drizzle-orm/pg-core").PgColumn<{
            name: "photo_zones";
            tableName: "analysis_results";
            dataType: "json";
            columnType: "PgJsonb";
            data: Record<string, string>;
            driverParam: unknown;
            notNull: false;
            hasDefault: true;
            isPrimaryKey: false;
            isAutoincrement: false;
            hasRuntimeDefault: false;
            enumValues: undefined;
            baseColumn: never;
            identity: undefined;
            generated: undefined;
        }, {}, {
            $type: Record<string, string>;
        }>;
        coverage: import("drizzle-orm/pg-core").PgColumn<{
            name: "coverage";
            tableName: "analysis_results";
            dataType: "json";
            columnType: "PgJsonb";
            data: CoverageSnapshot | null;
            driverParam: unknown;
            notNull: false;
            hasDefault: false;
            isPrimaryKey: false;
            isAutoincrement: false;
            hasRuntimeDefault: false;
            enumValues: undefined;
            baseColumn: never;
            identity: undefined;
            generated: undefined;
        }, {}, {
            $type: CoverageSnapshot | null;
        }>;
        overallConfidence: import("drizzle-orm/pg-core").PgColumn<{
            name: "overall_confidence";
            tableName: "analysis_results";
            dataType: "number";
            columnType: "PgReal";
            data: number;
            driverParam: string | number;
            notNull: false;
            hasDefault: false;
            isPrimaryKey: false;
            isAutoincrement: false;
            hasRuntimeDefault: false;
            enumValues: undefined;
            baseColumn: never;
            identity: undefined;
            generated: undefined;
        }, {}, {}>;
        riskLevel: import("drizzle-orm/pg-core").PgColumn<{
            name: "risk_level";
            tableName: "analysis_results";
            dataType: "string";
            columnType: "PgText";
            data: string;
            driverParam: string;
            notNull: false;
            hasDefault: false;
            isPrimaryKey: false;
            isAutoincrement: false;
            hasRuntimeDefault: false;
            enumValues: [string, ...string[]];
            baseColumn: never;
            identity: undefined;
            generated: undefined;
        }, {}, {}>;
        technicianFeedback: import("drizzle-orm/pg-core").PgColumn<{
            name: "technician_feedback";
            tableName: "analysis_results";
            dataType: "string";
            columnType: "PgText";
            data: string;
            driverParam: string;
            notNull: false;
            hasDefault: false;
            isPrimaryKey: false;
            isAutoincrement: false;
            hasRuntimeDefault: false;
            enumValues: [string, ...string[]];
            baseColumn: never;
            identity: undefined;
            generated: undefined;
        }, {}, {}>;
        feedbackStatus: import("drizzle-orm/pg-core").PgColumn<{
            name: "feedback_status";
            tableName: "analysis_results";
            dataType: "string";
            columnType: "PgText";
            data: string;
            driverParam: string;
            notNull: false;
            hasDefault: false;
            isPrimaryKey: false;
            isAutoincrement: false;
            hasRuntimeDefault: false;
            enumValues: [string, ...string[]];
            baseColumn: never;
            identity: undefined;
            generated: undefined;
        }, {}, {}>;
        analysisErrors: import("drizzle-orm/pg-core").PgColumn<{
            name: "analysis_errors";
            tableName: "analysis_results";
            dataType: "number";
            columnType: "PgInteger";
            data: number;
            driverParam: string | number;
            notNull: false;
            hasDefault: false;
            isPrimaryKey: false;
            isAutoincrement: false;
            hasRuntimeDefault: false;
            enumValues: undefined;
            baseColumn: never;
            identity: undefined;
            generated: undefined;
        }, {}, {}>;
        createdAt: import("drizzle-orm/pg-core").PgColumn<{
            name: "created_at";
            tableName: "analysis_results";
            dataType: "date";
            columnType: "PgTimestamp";
            data: Date;
            driverParam: string;
            notNull: true;
            hasDefault: true;
            isPrimaryKey: false;
            isAutoincrement: false;
            hasRuntimeDefault: false;
            enumValues: undefined;
            baseColumn: never;
            identity: undefined;
            generated: undefined;
        }, {}, {}>;
    };
    dialect: "pg";
}>;
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
    possiblePest?: string | null;
    species?: string | null;
    lifeStage?: string | null;
    conduciveCondition?: string | null;
    harborage?: string | null;
    moisture?: string | null;
    structuralIssue?: string | null;
    measurementEstimate?: {
        linearFt?: number | null;
        gapWidthIn?: number | null;
        heightFt?: number | null;
        confidence: number;
        source: "ai_vision_estimate";
    } | null;
    zone?: string | null;
    candidates?: Array<{
        species: string;
        confidence: number;
    }>;
    confidenceLabel?: "identified" | "possible" | "unidentified";
    reviewStatus?: "pending" | "accepted" | "corrected" | "dismissed";
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
    category: "missing_room" | "missing_moisture" | "missing_exclusion" | "bait_stations" | "conducive" | "missing_evidence" | "suggested_room" | "memory_rodent" | "memory_bait" | "memory_activity";
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
export declare const insertAnalysisResultSchema: z.ZodObject<{
    status: z.ZodOptional<z.ZodString>;
    inspectionId: z.ZodInt;
    findings: z.ZodOptional<z.ZodNullable<z.ZodType<Finding[], Finding[], z.core.$ZodTypeInternals<Finding[], Finding[]>>>>;
    recommendations: z.ZodOptional<z.ZodNullable<z.ZodType<string[], string[], z.core.$ZodTypeInternals<string[], string[]>>>>;
    videoEvidence: z.ZodOptional<z.ZodNullable<z.ZodType<VideoEvidence[], VideoEvidence[], z.core.$ZodTypeInternals<VideoEvidence[], VideoEvidence[]>>>>;
    analyzedImagePaths: z.ZodOptional<z.ZodNullable<z.ZodType<string[], string[], z.core.$ZodTypeInternals<string[], string[]>>>>;
    photoZones: z.ZodOptional<z.ZodNullable<z.ZodType<Record<string, string>, Record<string, string>, z.core.$ZodTypeInternals<Record<string, string>, Record<string, string>>>>>;
    coverage: z.ZodOptional<z.ZodNullable<z.ZodType<import("drizzle-zod").Json, unknown, z.core.$ZodTypeInternals<import("drizzle-zod").Json, unknown>>>>;
    overallConfidence: z.ZodOptional<z.ZodNullable<z.ZodNumber>>;
    riskLevel: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    technicianFeedback: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    feedbackStatus: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    analysisErrors: z.ZodOptional<z.ZodNullable<z.ZodInt>>;
}, {
    out: {};
    in: {};
}>;
export type AnalysisResult = typeof analysisResultsTable.$inferSelect;
export type InsertAnalysisResult = z.infer<typeof insertAnalysisResultSchema>;
//# sourceMappingURL=analysis.d.ts.map