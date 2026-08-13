/**
 * Client Portal Access — grants a property manager (an external Clerk user
 * who is NOT in the usersTable) read-only access to one or more buildings
 * serviced by a pest control company.
 *
 * Isolation: every API query in the /client/* routes must:
 *   1. Look up the caller's clerkUserId here to find their companyId + siteAddresses
 *   2. Scope ALL DB queries to that companyId AND to the allowed siteAddresses list
 *
 * A property manager with access to Building A of Company X can NEVER see:
 *   - Building B of Company X (different address not in their siteAddresses)
 *   - Any building of Company Y (different companyId)
 */
export declare const clientPortalAccessTable: import("drizzle-orm/pg-core").PgTableWithColumns<{
    name: "client_portal_access";
    schema: undefined;
    columns: {
        id: import("drizzle-orm/pg-core").PgColumn<{
            name: "id";
            tableName: "client_portal_access";
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
            tableName: "client_portal_access";
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
        clerkUserId: import("drizzle-orm/pg-core").PgColumn<{
            name: "clerk_user_id";
            tableName: "client_portal_access";
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
        label: import("drizzle-orm/pg-core").PgColumn<{
            name: "label";
            tableName: "client_portal_access";
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
        email: import("drizzle-orm/pg-core").PgColumn<{
            name: "email";
            tableName: "client_portal_access";
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
        siteAddresses: import("drizzle-orm/pg-core").PgColumn<{
            name: "site_addresses";
            tableName: "client_portal_access";
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
        grantedByUserId: import("drizzle-orm/pg-core").PgColumn<{
            name: "granted_by_user_id";
            tableName: "client_portal_access";
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
            tableName: "client_portal_access";
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
export type ClientPortalAccess = typeof clientPortalAccessTable.$inferSelect;
//# sourceMappingURL=client-portal.d.ts.map