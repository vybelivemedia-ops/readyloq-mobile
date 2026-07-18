/**
 * Inspection Scorecards — the management lens over each completed analysis.
 *
 * Computed 100% deterministically (pure math over stored verified findings —
 * NO AI involvement) in a fire-and-forget hook after each analysis run, and
 * upserted so re-analysis refreshes the same row. Technicians never see
 * scorecards: quality scoring is a coaching tool for management, so every
 * route serving these rows is gated at requireRole("manager").
 */
export type ScorecardRiskLevel = "low" | "medium" | "high" | "critical";
/** 0–100 sub-scores that make the quality score reproducible and explainable. */
export interface ScorecardComponents {
    /** Photos captured vs. a reasonable evidence baseline. */
    photoCoverage: number;
    /** Share of findings whose evidence quality was rated good/excellent. */
    evidenceQuality: number;
    /** Average model confidence across findings (0–100). */
    avgConfidence: number;
    /** Share of opportunity-mapped findings that got a matching recommendation. */
    recommendationCoverage: number;
}
/**
 * A verified finding that maps to a service type but had NO matching
 * recommendation recorded — a concrete, evidence-backed miss (deterministic
 * keyword mapping, same approach as the intelligence unreported-opportunity
 * logic).
 */
export interface MissedOpportunity {
    findingId: number;
    serviceType: string;
    description: string;
    severity: string;
}
export declare const inspectionScorecardsTable: import("drizzle-orm/pg-core").PgTableWithColumns<{
    name: "inspection_scorecards";
    schema: undefined;
    columns: {
        id: import("drizzle-orm/pg-core").PgColumn<{
            name: "id";
            tableName: "inspection_scorecards";
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
            tableName: "inspection_scorecards";
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
            tableName: "inspection_scorecards";
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
        technicianName: import("drizzle-orm/pg-core").PgColumn<{
            name: "technician_name";
            tableName: "inspection_scorecards";
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
        qualityScore: import("drizzle-orm/pg-core").PgColumn<{
            name: "quality_score";
            tableName: "inspection_scorecards";
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
        components: import("drizzle-orm/pg-core").PgColumn<{
            name: "components";
            tableName: "inspection_scorecards";
            dataType: "json";
            columnType: "PgJsonb";
            data: ScorecardComponents;
            driverParam: unknown;
            notNull: true;
            hasDefault: false;
            isPrimaryKey: false;
            isAutoincrement: false;
            hasRuntimeDefault: false;
            enumValues: undefined;
            baseColumn: never;
            identity: undefined;
            generated: undefined;
        }, {}, {
            $type: ScorecardComponents;
        }>;
        missedOpportunities: import("drizzle-orm/pg-core").PgColumn<{
            name: "missed_opportunities";
            tableName: "inspection_scorecards";
            dataType: "json";
            columnType: "PgJsonb";
            data: MissedOpportunity[];
            driverParam: unknown;
            notNull: true;
            hasDefault: true;
            isPrimaryKey: false;
            isAutoincrement: false;
            hasRuntimeDefault: false;
            enumValues: undefined;
            baseColumn: never;
            identity: undefined;
            generated: undefined;
        }, {}, {
            $type: MissedOpportunity[];
        }>;
        riskScore: import("drizzle-orm/pg-core").PgColumn<{
            name: "risk_score";
            tableName: "inspection_scorecards";
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
        riskLevel: import("drizzle-orm/pg-core").PgColumn<{
            name: "risk_level";
            tableName: "inspection_scorecards";
            dataType: "string";
            columnType: "PgText";
            data: ScorecardRiskLevel;
            driverParam: string;
            notNull: true;
            hasDefault: false;
            isPrimaryKey: false;
            isAutoincrement: false;
            hasRuntimeDefault: false;
            enumValues: [string, ...string[]];
            baseColumn: never;
            identity: undefined;
            generated: undefined;
        }, {}, {
            $type: ScorecardRiskLevel;
        }>;
        findingsCount: import("drizzle-orm/pg-core").PgColumn<{
            name: "findings_count";
            tableName: "inspection_scorecards";
            dataType: "number";
            columnType: "PgInteger";
            data: number;
            driverParam: string | number;
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
        photosAnalyzed: import("drizzle-orm/pg-core").PgColumn<{
            name: "photos_analyzed";
            tableName: "inspection_scorecards";
            dataType: "number";
            columnType: "PgInteger";
            data: number;
            driverParam: string | number;
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
        createdAt: import("drizzle-orm/pg-core").PgColumn<{
            name: "created_at";
            tableName: "inspection_scorecards";
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
        updatedAt: import("drizzle-orm/pg-core").PgColumn<{
            name: "updated_at";
            tableName: "inspection_scorecards";
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
export type InspectionScorecard = typeof inspectionScorecardsTable.$inferSelect;
//# sourceMappingURL=scorecards.d.ts.map