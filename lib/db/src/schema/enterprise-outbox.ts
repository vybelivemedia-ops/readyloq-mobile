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

import {
  pgTable,
  uuid,
  integer,
  text,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { companiesTable } from "./companies";
import { inspectionsTable } from "./inspections";

export type OutboxStatus =
  | "QUEUED"
  | "DELIVERED"
  | "RETRYABLE_FAILURE"
  | "PERMANENT_FAILURE"
  | "UNAUTHORIZED"
  | "INVALID_CONFIGURATION"
  | "TIMEOUT";

/** Statuses that a background retry worker is allowed to re-attempt. */
export const RETRYABLE_OUTBOX_STATUSES: OutboxStatus[] = [
  "QUEUED",
  "RETRYABLE_FAILURE",
  "TIMEOUT",
];

export const enterpriseOutboxTable = pgTable(
  "enterprise_outbox",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: integer("company_id")
      .notNull()
      .references(() => companiesTable.id, { onDelete: "cascade" }),
    /**
     * Stored as integer FK matching inspectionsTable.id.
     * The HardenedInspectionPayload.inspectionId string is parsed to int by
     * OutboxProcessor before insertion.
     */
    inspectionId: integer("inspection_id")
      .notNull()
      .references(() => inspectionsTable.id, { onDelete: "cascade" }),
    /**
     * Full HardenedInspectionPayload serialised for replay without re-fetching
     * from the DB.  Treated as opaque JSON — do not query individual fields.
     */
    payloadJson: jsonb("payload_json").notNull(),
    /** Current dispatch status (see OutboxStatus). */
    status: text("status").$type<OutboxStatus>().notNull().default("QUEUED"),
    /** HTTP status code from the last attempt (null if QUEUED or network failure). */
    lastHttpStatus: integer("last_http_status"),
    /** External error code from the last attempt. */
    lastErrorCode: text("last_error_code"),
    /** Human-readable error from the last attempt. */
    lastErrorMessage: text("last_error_message"),
    /** Number of dispatch attempts (0 = queued but not yet attempted). */
    retryCount: integer("retry_count").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    /** Timestamp of the most recent dispatch attempt. */
    lastAttemptAt: timestamp("last_attempt_at"),
  },
  (t) => [
    index("enterprise_outbox_company_idx").on(t.companyId),
    index("enterprise_outbox_inspection_idx").on(t.inspectionId),
    // Lets the retry worker efficiently find rows that need re-processing.
    index("enterprise_outbox_status_created_idx").on(t.status, t.createdAt),
  ],
);

export type EnterpriseOutboxRow = typeof enterpriseOutboxTable.$inferSelect;
export type InsertEnterpriseOutbox = typeof enterpriseOutboxTable.$inferInsert;
