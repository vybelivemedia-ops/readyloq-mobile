/** Identifies a pest category or species the playbook applies to. */
export type PlaybookPestTarget = string;
/** A mandatory action or treatment step that must be logged. */
export type PlaybookRequiredStep = {
    id: string;
    label: string;
};
/** A restricted chemical product name or class. */
export type ChemicalRestriction = {
    name: string;
    reason?: string;
};
export declare const companyPlaybooksTable: import("drizzle-orm/pg-core").PgTableWithColumns<{
    name: "company_playbooks";
    schema: undefined;
    columns: {
        id: import("drizzle-orm/pg-core").PgColumn<{
            name: "id";
            tableName: "company_playbooks";
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
            tableName: "company_playbooks";
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
            tableName: "company_playbooks";
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
        targetPests: import("drizzle-orm/pg-core").PgColumn<{
            name: "target_pests";
            tableName: "company_playbooks";
            dataType: "json";
            columnType: "PgJsonb";
            data: string[];
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
            $type: string[];
        }>;
        requiredSteps: import("drizzle-orm/pg-core").PgColumn<{
            name: "required_steps";
            tableName: "company_playbooks";
            dataType: "json";
            columnType: "PgJsonb";
            data: PlaybookRequiredStep[];
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
            $type: PlaybookRequiredStep[];
        }>;
        chemicalRestrictions: import("drizzle-orm/pg-core").PgColumn<{
            name: "chemical_restrictions";
            tableName: "company_playbooks";
            dataType: "json";
            columnType: "PgJsonb";
            data: ChemicalRestriction[];
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
            $type: ChemicalRestriction[];
        }>;
        notes: import("drizzle-orm/pg-core").PgColumn<{
            name: "notes";
            tableName: "company_playbooks";
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
        isActive: import("drizzle-orm/pg-core").PgColumn<{
            name: "is_active";
            tableName: "company_playbooks";
            dataType: "boolean";
            columnType: "PgBoolean";
            data: boolean;
            driverParam: boolean;
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
            tableName: "company_playbooks";
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
            tableName: "company_playbooks";
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
export declare const insertPlaybookSchema: import("zod/v4").ZodObject<{
    title: import("zod/v4").ZodString;
    targetPests: import("zod/v4").ZodOptional<import("zod/v4").ZodType<string[], string[], import("zod/v4/core").$ZodTypeInternals<string[], string[]>>>;
    requiredSteps: import("zod/v4").ZodOptional<import("zod/v4").ZodType<PlaybookRequiredStep[], PlaybookRequiredStep[], import("zod/v4/core").$ZodTypeInternals<PlaybookRequiredStep[], PlaybookRequiredStep[]>>>;
    chemicalRestrictions: import("zod/v4").ZodOptional<import("zod/v4").ZodType<ChemicalRestriction[], ChemicalRestriction[], import("zod/v4/core").$ZodTypeInternals<ChemicalRestriction[], ChemicalRestriction[]>>>;
    notes: import("zod/v4").ZodOptional<import("zod/v4").ZodNullable<import("zod/v4").ZodString>>;
    isActive: import("zod/v4").ZodOptional<import("zod/v4").ZodBoolean>;
}, {
    out: {};
    in: {};
}>;
export type CompanyPlaybook = typeof companyPlaybooksTable.$inferSelect;
export type NewCompanyPlaybook = typeof companyPlaybooksTable.$inferInsert;
//# sourceMappingURL=playbooks.d.ts.map