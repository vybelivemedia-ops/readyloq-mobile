/**
 * Enterprise Bridge — write-ahead outbox table.
 *
 * A row is inserted BEFORE the HTTP dispatch call so a crash between insert
 * and the HTTP response leaves a QUEUED record that a retry worker can pick
 * up later.  The row is updated to the final DeliveryOutcome status after the
 * call returns.
 *
 * Retry workers should only re-attempt rows with status in the retryable set:
 *   ('QUEUED', 'RETRYABLE_FAILURE', 'TIMEOUT')
 *
 * Rows with PERMANENT_FAILURE, UNAUTHORIZED, or INVALID_CONFIGURATION must
 * NOT be retried automatically — they require human intervention.
 */
export type OutboxStatus = "QUEUED" | "PROCESSING" | "DELIVERED" | "RETRYABLE_FAILURE" | "PERMANENT_FAILURE" | "UNAUTHORIZED" | "INVALID_CONFIGURATION" | "TIMEOUT";
/** Statuses that a background retry worker is allowed to re-attempt. */
export declare const RETRYABLE_OUTBOX_STATUSES: OutboxStatus[];
export declare const enterpriseOutboxTable: import("drizzle-orm/pg-core").PgTableWithColumns<{
    name: "enterprise_outbox";
    schema: undefined;
    columns: {
        id: import("drizzle-orm/pg-core").PgColumn<{
            name: "id";
            tableName: "enterprise_outbox";
            dataType: "string";
            columnType: "PgUUID";
            data: string;
            driverParam: string;
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
            tableName: "enterprise_outbox";
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
            tableName: "enterprise_outbox";
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
        idempotencyKey: import("drizzle-orm/pg-core").PgColumn<{
            name: "idempotency_key";
            tableName: "enterprise_outbox";
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
        payloadJson: import("drizzle-orm/pg-core").PgColumn<{
            name: "payload_json";
            tableName: "enterprise_outbox";
            dataType: "json";
            columnType: "PgJsonb";
            data: unknown;
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
        }, {}, {}>;
        status: import("drizzle-orm/pg-core").PgColumn<{
            name: "status";
            tableName: "enterprise_outbox";
            dataType: "string";
            columnType: "PgText";
            data: OutboxStatus;
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
        }, {}, {
            $type: OutboxStatus;
        }>;
        lastHttpStatus: import("drizzle-orm/pg-core").PgColumn<{
            name: "last_http_status";
            tableName: "enterprise_outbox";
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
        lastErrorCode: import("drizzle-orm/pg-core").PgColumn<{
            name: "last_error_code";
            tableName: "enterprise_outbox";
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
        lastErrorMessage: import("drizzle-orm/pg-core").PgColumn<{
            name: "last_error_message";
            tableName: "enterprise_outbox";
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
        retryCount: import("drizzle-orm/pg-core").PgColumn<{
            name: "retry_count";
            tableName: "enterprise_outbox";
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
        nextAttemptAt: import("drizzle-orm/pg-core").PgColumn<{
            name: "next_attempt_at";
            tableName: "enterprise_outbox";
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
        lockedAt: import("drizzle-orm/pg-core").PgColumn<{
            name: "locked_at";
            tableName: "enterprise_outbox";
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
        lockedBy: import("drizzle-orm/pg-core").PgColumn<{
            name: "locked_by";
            tableName: "enterprise_outbox";
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
        createdAt: import("drizzle-orm/pg-core").PgColumn<{
            name: "created_at";
            tableName: "enterprise_outbox";
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
        lastAttemptAt: import("drizzle-orm/pg-core").PgColumn<{
            name: "last_attempt_at";
            tableName: "enterprise_outbox";
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
    };
    dialect: "pg";
}>;
export type EnterpriseOutboxRow = typeof enterpriseOutboxTable.$inferSelect;
export type InsertEnterpriseOutbox = typeof enterpriseOutboxTable.$inferInsert;
//# sourceMappingURL=enterprise-outbox.d.ts.map