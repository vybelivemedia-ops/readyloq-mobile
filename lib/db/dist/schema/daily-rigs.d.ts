/**
 * Technician daily rig — the set of products a tech loads onto their truck
 * each morning.  One row per (company, technician, date); upserted every time
 * the tech updates their selection.  Date is stored as a simple ISO date string
 * ("YYYY-MM-DD") so midnight resets work cleanly regardless of timezone.
 */
export declare const technicianDailyRigsTable: import("drizzle-orm/pg-core").PgTableWithColumns<{
    name: "technician_daily_rigs";
    schema: undefined;
    columns: {
        id: import("drizzle-orm/pg-core").PgColumn<{
            name: "id";
            tableName: "technician_daily_rigs";
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
            tableName: "technician_daily_rigs";
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
        technicianId: import("drizzle-orm/pg-core").PgColumn<{
            name: "technician_id";
            tableName: "technician_daily_rigs";
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
        rigDate: import("drizzle-orm/pg-core").PgColumn<{
            name: "rig_date";
            tableName: "technician_daily_rigs";
            dataType: "string";
            columnType: "PgDateString";
            data: string;
            driverParam: string;
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
        productIds: import("drizzle-orm/pg-core").PgColumn<{
            name: "product_ids";
            tableName: "technician_daily_rigs";
            dataType: "json";
            columnType: "PgJsonb";
            data: number[];
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
            $type: number[];
        }>;
        createdAt: import("drizzle-orm/pg-core").PgColumn<{
            name: "created_at";
            tableName: "technician_daily_rigs";
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
            tableName: "technician_daily_rigs";
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
export type TechnicianDailyRig = typeof technicianDailyRigsTable.$inferSelect;
export type InsertTechnicianDailyRig = typeof technicianDailyRigsTable.$inferInsert;
//# sourceMappingURL=daily-rigs.d.ts.map