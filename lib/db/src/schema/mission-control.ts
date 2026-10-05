import {
  pgTable,
  serial,
  integer,
  boolean,
  text,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
  check,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { companiesTable } from "./companies";
import { inspectionsTable } from "./inspections";
import { usersTable } from "./users";
import { metaGlassesSessionsTable } from "./meta-glasses";

export const missionControlApprovalsTable = pgTable(
  "mission_control_approvals",
  {
    id: serial("id").primaryKey(),
    type: text("type").notNull(),
    status: text("status").notNull().default("pending"),
    requestedBy: text("requested_by").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    action: text("action").notNull(),
    expectedAccessState: boolean("expected_access_state"),
    request: text("request").notNull(),
    reason: text("reason").notNull(),
    idempotencyKey: text("idempotency_key"),
    note: text("note"),
    decidedBy: text("decided_by"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    decidedAt: timestamp("decided_at"),
  },
  (t) => [
    uniqueIndex("mission_control_approvals_idempotency_uq")
      .on(t.idempotencyKey)
      .where(sql`${t.idempotencyKey} IS NOT NULL`),
    index("mission_control_approvals_status_created_idx").on(t.status, t.createdAt),
  ],
);

export const missionControlAuditTable = pgTable(
  "mission_control_audit",
  {
    id: serial("id").primaryKey(),
    actorId: text("actor_id").notNull(),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id").notNull(),
    details: jsonb("details"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("mission_control_audit_created_idx").on(t.createdAt)],
);

export const missionControlIncidentsTable = pgTable(
  "mission_control_incidents",
  {
    id: serial("id").primaryKey(),
    reference: text("reference").notNull(),
    sourceType: text("source_type").notNull(),
    sourceId: text("source_id").notNull(),
    companyId: integer("company_id")
      .notNull()
      .references(() => companiesTable.id, { onDelete: "cascade" }),
    inspectionId: integer("inspection_id").references(() => inspectionsTable.id, { onDelete: "set null" }),
    userId: integer("user_id").references(() => usersTable.id, { onDelete: "set null" }),
    sessionId: integer("session_id").references(() => metaGlassesSessionsTable.id, { onDelete: "set null" }),
    status: text("status").notNull().default("open"),
    severity: text("severity").notNull().default("medium"),
    assignedTo: text("assigned_to"),
    acknowledgedAt: timestamp("acknowledged_at"),
    note: text("note"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("mission_control_incidents_reference_uq").on(t.reference),
    index("mission_control_incidents_company_idx").on(t.companyId),
    index("mission_control_incidents_inspection_idx").on(t.inspectionId),
  ],
);

export const missionControlAgentTasksTable = pgTable(
  "mission_control_agent_tasks",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id")
      .notNull()
      .references(() => companiesTable.id, { onDelete: "cascade" }),
    prompt: text("prompt").notNull(),
    status: text("status").notNull().default("queued"),
    createdBy: text("created_by").notNull(),
    result: text("result"),
    error: text("error"),
    attempts: integer("attempts").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    startedAt: timestamp("started_at"),
    heartbeatAt: timestamp("heartbeat_at"),
    completedAt: timestamp("completed_at"),
  },
  (t) => [
    index("mission_control_agent_tasks_company_created_idx").on(t.companyId, t.createdAt),
    index("mission_control_agent_tasks_status_created_idx").on(t.status, t.createdAt),
  ],
);

export const missionControlDelegationsTable = pgTable(
  "mission_control_delegations",
  {
    id: serial("id").primaryKey(),
    taskId: integer("task_id").notNull().references(() => missionControlAgentTasksTable.id, { onDelete: "cascade" }),
    companyId: integer("company_id").notNull().references(() => companiesTable.id, { onDelete: "cascade" }),
    specialist: text("specialist").notNull(),
    scope: text("scope").notNull(),
    status: text("status").notNull().default("queued"),
    result: text("result"),
    error: text("error"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    completedAt: timestamp("completed_at"),
  },
  (t) => [
    uniqueIndex("mission_control_delegations_task_specialist_uq").on(t.taskId, t.specialist),
    index("mission_control_delegations_company_task_idx").on(t.companyId, t.taskId),
  ],
);

export const missionControlWorkTracesTable = pgTable(
  "mission_control_work_traces",
  {
    id: serial("id").primaryKey(),
    taskId: integer("task_id").notNull().references(() => missionControlAgentTasksTable.id, { onDelete: "cascade" }),
    companyId: integer("company_id").notNull().references(() => companiesTable.id, { onDelete: "cascade" }),
    delegationId: integer("delegation_id").references(() => missionControlDelegationsTable.id, { onDelete: "cascade" }),
    actor: text("actor").notNull(),
    event: text("event").notNull(),
    detail: text("detail").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("mission_control_work_traces_company_task_idx").on(t.companyId, t.taskId, t.id)],
);

/**
 * Append-only, tenant-scoped event ledger for inspection activity.
 *
 * This intentionally does not mirror existing inspection/evidence/analysis
 * rows. Only new events written through the Mission Control event writer are
 * recorded here.
 */
export const missionControlInspectionEventsTable = pgTable(
  "mission_control_inspection_events",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id")
      .notNull()
      .references(() => companiesTable.id),
    // Preserve the inspection's numeric identity even after the live
    // inspection row is removed; the append-only event is historical evidence.
    inspectionId: integer("inspection_id").notNull(),
    eventType: text("event_type").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    sourceRecordType: text("source_record_type").notNull(),
    sourceRecordId: text("source_record_id").notNull(),
    actor: text("actor").notNull(),
    recordedAt: timestamp("recorded_at").notNull().defaultNow(),
    occurredAt: timestamp("occurred_at"),
    idempotencyKey: text("idempotency_key").notNull(),
    payload: jsonb("payload")
      .$type<Record<string, string | number | boolean | null>>()
      .notNull()
      .default({}),
    origin: text("origin").notNull().default("newly_generated"),
  },
  (t) => [
    check(
      "mission_control_inspection_events_origin_check",
      sql`${t.origin} = 'newly_generated'`,
    ),
    uniqueIndex("mission_control_inspection_events_company_idempotency_uq").on(
      t.companyId,
      t.idempotencyKey,
    ),
    index("mission_control_inspection_events_company_inspection_recorded_idx").on(
      t.companyId,
      t.inspectionId,
      t.recordedAt,
      t.id,
    ),
    index("mission_control_inspection_events_entity_idx").on(
      t.companyId,
      t.entityType,
      t.entityId,
    ),
    index("mission_control_inspection_events_source_idx").on(
      t.companyId,
      t.sourceRecordType,
      t.sourceRecordId,
    ),
  ],
);