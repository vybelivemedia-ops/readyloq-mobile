import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { companiesTable } from "./companies";

export type EnterpriseSyncProvider = "pestpac";
export type EnterpriseSyncDirection = "inbound" | "outbound";
export type EnterpriseSyncEntityType =
  | "customer"
  | "location"
  | "route"
  | "work_order"
  | "inspection"
  | "inventory_usage";
export type EnterpriseSyncOperation =
  | "upsert"
  | "complete"
  | "usage"
  | "reconcile";

export type EnterpriseSyncMessageStatus =
  | "PENDING"
  | "PROCESSING"
  | "SUCCEEDED"
  | "RETRYABLE_FAILURE"
  | "PERMANENT_FAILURE"
  | "UNAUTHORIZED"
  | "CONFLICT";

export type EnterpriseSyncRunStatus =
  | "RUNNING"
  | "SUCCEEDED"
  | "PARTIAL"
  | "FAILED";

/**
 * Cross-system identity map. External IDs are never used without a company
 * boundary, because two ReadyLoq tenants may connect to separate PestPac
 * accounts that reuse the same numeric IDs.
 */
export const integrationEntityLinksTable = pgTable(
  "integration_entity_links",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id")
      .notNull()
      .references(() => companiesTable.id, { onDelete: "cascade" }),
    provider: text("provider").$type<EnterpriseSyncProvider>().notNull(),
    entityType: text("entity_type").$type<EnterpriseSyncEntityType>().notNull(),
    localEntityId: integer("local_entity_id"),
    externalId: text("external_id").notNull(),
    externalParentId: text("external_parent_id"),
    externalVersion: text("external_version"),
    sourceUpdatedAt: timestamp("source_updated_at"),
    sourceHash: text("source_hash"),
    lastSyncedAt: timestamp("last_synced_at"),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("integration_entity_links_external_uq").on(
      t.companyId,
      t.provider,
      t.entityType,
      t.externalId,
    ),
    index("integration_entity_links_local_idx").on(
      t.companyId,
      t.provider,
      t.entityType,
      t.localEntityId,
    ),
  ],
);

/**
 * Durable inbox/outbox for all asynchronous PestPac work that is not covered
 * by the legacy inspection outbox. Raw payloads are retained for replay and
 * debugging; workers must treat them as untrusted external input.
 */
export const integrationSyncMessagesTable = pgTable(
  "integration_sync_messages",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id")
      .notNull()
      .references(() => companiesTable.id, { onDelete: "cascade" }),
    provider: text("provider").$type<EnterpriseSyncProvider>().notNull(),
    direction: text("direction").$type<EnterpriseSyncDirection>().notNull(),
    entityType: text("entity_type").$type<EnterpriseSyncEntityType>().notNull(),
    operation: text("operation").$type<EnterpriseSyncOperation>().notNull(),
    localEntityId: integer("local_entity_id"),
    externalId: text("external_id"),
    idempotencyKey: text("idempotency_key").notNull(),
    payloadJson: jsonb("payload_json").notNull(),
    status: text("status")
      .$type<EnterpriseSyncMessageStatus>()
      .notNull()
      .default("PENDING"),
    attemptCount: integer("attempt_count").notNull().default(0),
    availableAt: timestamp("available_at").notNull().defaultNow(),
    lockedAt: timestamp("locked_at"),
    lockedBy: text("locked_by"),
    lastErrorCode: text("last_error_code"),
    lastErrorMessage: text("last_error_message"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    processedAt: timestamp("processed_at"),
  },
  (t) => [
    uniqueIndex("integration_sync_messages_idempotency_uq").on(
      t.companyId,
      t.provider,
      t.idempotencyKey,
    ),
    index("integration_sync_messages_ready_idx").on(
      t.status,
      t.availableAt,
    ),
    index("integration_sync_messages_company_idx").on(t.companyId),
    index("integration_sync_messages_entity_idx").on(
      t.companyId,
      t.entityType,
      t.externalId,
    ),
  ],
);

export const integrationSyncRunsTable = pgTable(
  "integration_sync_runs",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id")
      .notNull()
      .references(() => companiesTable.id, { onDelete: "cascade" }),
    provider: text("provider").$type<EnterpriseSyncProvider>().notNull(),
    direction: text("direction").$type<EnterpriseSyncDirection>().notNull(),
    entityType: text("entity_type")
      .$type<EnterpriseSyncEntityType>()
      .notNull(),
    status: text("status").$type<EnterpriseSyncRunStatus>().notNull(),
    cursorBefore: text("cursor_before"),
    cursorAfter: text("cursor_after"),
    recordsSeen: integer("records_seen").notNull().default(0),
    recordsCreated: integer("records_created").notNull().default(0),
    recordsUpdated: integer("records_updated").notNull().default(0),
    recordsFailed: integer("records_failed").notNull().default(0),
    startedAt: timestamp("started_at").notNull().defaultNow(),
    finishedAt: timestamp("finished_at"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
  },
  (t) => [
    index("integration_sync_runs_company_idx").on(t.companyId),
    index("integration_sync_runs_lookup_idx").on(
      t.companyId,
      t.provider,
      t.direction,
      t.entityType,
      t.startedAt,
    ),
  ],
);

export const integrationConflictsTable = pgTable(
  "integration_conflicts",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id")
      .notNull()
      .references(() => companiesTable.id, { onDelete: "cascade" }),
    provider: text("provider").$type<EnterpriseSyncProvider>().notNull(),
    entityType: text("entity_type").$type<EnterpriseSyncEntityType>().notNull(),
    localEntityId: integer("local_entity_id"),
    externalId: text("external_id"),
    fieldName: text("field_name").notNull(),
    localValue: jsonb("local_value"),
    externalValue: jsonb("external_value"),
    status: text("status").notNull().default("open"),
    resolution: text("resolution"),
    resolvedBy: integer("resolved_by"),
    resolvedAt: timestamp("resolved_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("integration_conflicts_company_status_idx").on(
      t.companyId,
      t.status,
    ),
    index("integration_conflicts_entity_idx").on(
      t.companyId,
      t.entityType,
      t.externalId,
    ),
  ],
);

export type IntegrationEntityLink = typeof integrationEntityLinksTable.$inferSelect;
export type InsertIntegrationEntityLink =
  typeof integrationEntityLinksTable.$inferInsert;
export type IntegrationSyncMessage =
  typeof integrationSyncMessagesTable.$inferSelect;
export type InsertIntegrationSyncMessage =
  typeof integrationSyncMessagesTable.$inferInsert;
export type IntegrationSyncRun = typeof integrationSyncRunsTable.$inferSelect;
export type IntegrationConflict = typeof integrationConflictsTable.$inferSelect;