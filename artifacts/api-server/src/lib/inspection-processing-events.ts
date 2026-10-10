import { db, inspectionSyncLogsTable } from "@workspace/db";
import { appendMissionControlInspectionEvent } from "./mission-control-inspection-events";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export const PROCESSING_MILESTONES = {
  "inspection.created": "Inspection created",
  "inspection.completed": "Inspection completed",
  "inspection.reopened": "Inspection reopened",
  "inspection.state_changed": "Inspection state changed",
  "upload.reserved": "Evidence upload reserved",
  "evidence.captured": "Evidence captured (device-reported time)",
  "evidence.registered": "Uploaded evidence verified and registered",
  "analysis.attempt_started": "AI processing attempt claimed",
  "analysis.attempt_succeeded": "AI provider result saved",
  "analysis.attempt_failed": "AI processing attempt failed",
  "analysis.result_saved": "Analysis result saved",
  "sync.succeeded": "External sync succeeded",
  "sync.failed": "External sync failed",
  "sync.queued": "External delivery queued",
  "sync.processing": "External delivery attempt claimed",
  "sync.delivered": "External delivery confirmed",
  "sync.retryable_failure": "External delivery failed; retry scheduled",
  "sync.permanent_failure": "External delivery permanently failed",
  "sync.unauthorized": "External delivery authorization failed",
  "sync.invalid_configuration": "External delivery configuration invalid",
  "sync.timeout": "External delivery timed out",
} as const;

/**
 * Only public lifecycle facts belong here. No paths, addresses, findings,
 * filenames, free-form diagnostics or provider responses enter event payloads.
 * Call only from the transaction that actually changes the source record.
 */
export async function appendProcessingMilestone(
  tx: Transaction,
  input: {
    companyId: number;
    inspectionId: number;
    eventType: keyof typeof PROCESSING_MILESTONES;
    sourceType: string;
    sourceId: number | string;
    actor: string;
    occurredAt?: Date | null;
    transitionKey?: string;
  },
) {
  return appendMissionControlInspectionEvent(tx, {
    companyId: input.companyId,
    inspectionId: input.inspectionId,
    eventType: input.eventType,
    entityType: input.sourceType,
    entityId: String(input.sourceId),
    sourceRecordType: input.sourceType,
    sourceRecordId: String(input.sourceId),
    actor: input.actor,
    occurredAt: input.occurredAt ?? new Date(),
    idempotencyKey: [
      "processing", input.inspectionId, input.eventType, input.sourceType,
      input.sourceId, input.transitionKey ?? "once",
    ].join(":"),
  });
}

export async function recordInspectionSyncAttempt(
  input: typeof inspectionSyncLogsTable.$inferInsert,
  actor: string,
) {
  return db.transaction(async (tx) => {
    const [row] = await tx.insert(inspectionSyncLogsTable).values(input).returning();
    if (!row) throw new Error("Failed to record inspection sync attempt");
    await appendProcessingMilestone(tx, {
      companyId: row.companyId,
      inspectionId: row.inspectionId,
      eventType: row.success ? "sync.succeeded" : "sync.failed",
      sourceType: "inspection_sync_logs",
      sourceId: row.id,
      actor,
      occurredAt: row.syncedAt,
    });
    return row;
  });
}
