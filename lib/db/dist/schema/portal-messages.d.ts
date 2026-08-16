import { z } from "zod/v4";
/**
 * In-portal messaging between property managers (clients) and
 * dispatchers / service providers.
 *
 * Identity model:
 *   - companyId  — the pest-control company that owns the thread
 *   - siteAddress — the human-readable address used throughout the client portal
 *                   (matches inspectionsTable.siteAddress and clientPortalAccessTable.siteAddresses)
 *   - senderType — 'client' (property manager) or 'provider' (dispatcher/tech)
 *   - senderClerkId — Clerk user ID for deduplication and audit
 *   - senderName — display name cached at send time
 */
export declare const portalMessagesTable: import("drizzle-orm/pg-core").PgTableWithColumns<{
    name: "portal_messages";
    schema: undefined;
    columns: {
        id: import("drizzle-orm/pg-core").PgColumn<{
            name: "id";
            tableName: "portal_messages";
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
            tableName: "portal_messages";
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
        siteAddress: import("drizzle-orm/pg-core").PgColumn<{
            name: "site_address";
            tableName: "portal_messages";
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
        senderType: import("drizzle-orm/pg-core").PgColumn<{
            name: "sender_type";
            tableName: "portal_messages";
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
        senderClerkId: import("drizzle-orm/pg-core").PgColumn<{
            name: "sender_clerk_id";
            tableName: "portal_messages";
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
        senderName: import("drizzle-orm/pg-core").PgColumn<{
            name: "sender_name";
            tableName: "portal_messages";
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
        message: import("drizzle-orm/pg-core").PgColumn<{
            name: "message";
            tableName: "portal_messages";
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
        createdAt: import("drizzle-orm/pg-core").PgColumn<{
            name: "created_at";
            tableName: "portal_messages";
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
export declare const insertPortalMessageSchema: z.ZodObject<{
    siteAddress: z.ZodString;
    senderType: z.ZodString;
    senderClerkId: z.ZodString;
    senderName: z.ZodOptional<z.ZodNullable<z.ZodString>>;
    message: z.ZodString;
}, {
    out: {};
    in: {};
}>;
export type PortalMessage = typeof portalMessagesTable.$inferSelect;
export type InsertPortalMessage = z.infer<typeof insertPortalMessageSchema>;
//# sourceMappingURL=portal-messages.d.ts.map