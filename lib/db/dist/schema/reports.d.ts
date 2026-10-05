import { z } from "zod/v4";
import type { Finding } from "./analysis";
/**
 * AI-generated narrative report. Produced on demand from an inspection's data
 * (findings, voice transcripts, photo labels, property metadata) by a single
 * text-model call and snapshotted onto the report so it stays stable. Every
 * field is always present after a successful generation (server normalizes
 * defaults), so PDF/UI rendering never has to guard for partial output.
 */
export interface AiReportNarrative {
    executiveSummary: string;
    inspectionFindings: string;
    evidenceObserved: string;
    pestActivityAssessment: string;
    structuralDeficiencies: string;
    sanitationConcerns: string;
    recommendedCorrectiveActions: string[];
    monitoringRecommendations: string[];
    followUpSchedule: string;
    technicianNotes: string;
    managerReviewNotes: string;
    propertyType: string;
    model: string;
    generatedAt: string;
    /**
     * Optional for backward compatibility with narratives generated before
     * these sections existed; always present on new generations.
     */
    conduciveConditions?: string;
    customerRecommendations?: string[];
}
export declare const reportsTable: import("drizzle-orm/pg-core").PgTableWithColumns<{
    name: "reports";
    schema: undefined;
    columns: {
        id: import("drizzle-orm/pg-core").PgColumn<{
            name: "id";
            tableName: "reports";
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
            tableName: "reports";
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
            tableName: "reports";
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
        title: import("drizzle-orm/pg-core").PgColumn<{
            name: "title";
            tableName: "reports";
            dataType: "string";
            columnType: "PgText";
            data: string;
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
        }, {}, {}>;
        clientName: import("drizzle-orm/pg-core").PgColumn<{
            name: "client_name";
            tableName: "reports";
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
        siteAddress: import("drizzle-orm/pg-core").PgColumn<{
            name: "site_address";
            tableName: "reports";
            dataType: "string";
            columnType: "PgText";
            data: string;
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
        }, {}, {}>;
        status: import("drizzle-orm/pg-core").PgColumn<{
            name: "status";
            tableName: "reports";
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
            tableName: "reports";
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
            tableName: "reports";
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
        treatmentNotes: import("drizzle-orm/pg-core").PgColumn<{
            name: "treatment_notes";
            tableName: "reports";
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
        exclusionOpportunities: import("drizzle-orm/pg-core").PgColumn<{
            name: "exclusion_opportunities";
            tableName: "reports";
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
        technicianName: import("drizzle-orm/pg-core").PgColumn<{
            name: "technician_name";
            tableName: "reports";
            dataType: "string";
            columnType: "PgText";
            data: string;
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
        }, {}, {}>;
        inspectionDate: import("drizzle-orm/pg-core").PgColumn<{
            name: "inspection_date";
            tableName: "reports";
            dataType: "string";
            columnType: "PgText";
            data: string;
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
        }, {}, {}>;
        severity: import("drizzle-orm/pg-core").PgColumn<{
            name: "severity";
            tableName: "reports";
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
        pdfUrl: import("drizzle-orm/pg-core").PgColumn<{
            name: "pdf_url";
            tableName: "reports";
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
        aiNarrative: import("drizzle-orm/pg-core").PgColumn<{
            name: "ai_narrative";
            tableName: "reports";
            dataType: "json";
            columnType: "PgJsonb";
            data: AiReportNarrative;
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
            $type: AiReportNarrative;
        }>;
        approvedByUserId: import("drizzle-orm/pg-core").PgColumn<{
            name: "approved_by_user_id";
            tableName: "reports";
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
        approvedAt: import("drizzle-orm/pg-core").PgColumn<{
            name: "approved_at";
            tableName: "reports";
            dataType: "date";
            columnType: "PgTimestamp";
            data: Date;
            driverParam: string;
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
            tableName: "reports";
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
export declare const insertReportSchema: z.ZodObject<{
    siteAddress: z.ZodString;
    clientName: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    technicianName: z.ZodString;
    status: z.ZodOptional<z.ZodString>;
    severity: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    inspectionId: z.ZodInt;
    title: z.ZodString;
    findings: z.ZodOptional<z.ZodNullable<z.ZodType<Finding[], Finding[], z.core.$ZodTypeInternals<Finding[], Finding[]>>>>;
    recommendations: z.ZodOptional<z.ZodNullable<z.ZodType<string[], string[], z.core.$ZodTypeInternals<string[], string[]>>>>;
    treatmentNotes: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    exclusionOpportunities: z.ZodOptional<z.ZodNullable<z.ZodType<string[], string[], z.core.$ZodTypeInternals<string[], string[]>>>>;
    inspectionDate: z.ZodString;
    pdfUrl: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    aiNarrative: z.ZodOptional<z.ZodNullable<z.ZodType<AiReportNarrative, AiReportNarrative, z.core.$ZodTypeInternals<AiReportNarrative, AiReportNarrative>>>>;
    approvedByUserId: z.ZodOptional<z.ZodNullable<z.ZodInt>>;
    approvedAt: z.ZodOptional<z.ZodNullable<z.ZodDate>>;
}, {
    out: {};
    in: {};
}>;
export type Report = typeof reportsTable.$inferSelect;
export type InsertReport = z.infer<typeof insertReportSchema>;
//# sourceMappingURL=reports.d.ts.map