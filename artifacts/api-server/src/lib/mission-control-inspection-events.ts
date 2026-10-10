import { and, eq } from "drizzle-orm";
import {
  inspectionsTable,
  missionControlInspectionEventsTable,
} from "@workspace/db";

export type MissionControlInspectionEventInput = {
  companyId: number;
  inspectionId: number;
  eventType: string;
  entityType: string;
  entityId: string;
  sourceRecordType: string;
  sourceRecordId: string;
  actor: string;
  occurredAt?: Date | null;
  idempotencyKey: string;
  payload?: Record<string, string | number | boolean | null>;
};

export type MissionControlInspectionEvent =
  typeof missionControlInspectionEventsTable.$inferSelect;

export type AppendedMissionControlInspectionEvent = {
  event: MissionControlInspectionEvent;
  created: boolean;
};

// The generic executor accepts both the root Drizzle database and its
// transaction object, whose fluent method types are intentionally different.
type EventWriterExecutor = {
  select: (...args: any[]) => any;
  insert: (...args: any[]) => any;
};

const MAX_PAYLOAD_ENTRIES = 20;
const MAX_PAYLOAD_KEY_LENGTH = 64;
const MAX_PAYLOAD_STRING_LENGTH = 256;

function validatePayload(
  payload: MissionControlInspectionEventInput["payload"],
): Record<string, string | number | boolean | null> {
  const safePayload = payload ?? {};
  const entries = Object.entries(safePayload);
  if (entries.length > MAX_PAYLOAD_ENTRIES) {
    throw new Error("Mission Control event payload has too many fields");
  }
  for (const [key, value] of entries) {
    if (!key || key.length > MAX_PAYLOAD_KEY_LENGTH) {
      throw new Error("Mission Control event payload contains an invalid key");
    }
    if (
      typeof value === "string" &&
      value.length > MAX_PAYLOAD_STRING_LENGTH
    ) {
      throw new Error("Mission Control event payload string is too long");
    }
    if (typeof value === "number" && !Number.isFinite(value)) {
      throw new Error("Mission Control event payload contains a non-finite number");
    }
    if (
      value !== null &&
      typeof value !== "string" &&
      typeof value !== "number" &&
      typeof value !== "boolean"
    ) {
      throw new Error("Mission Control event payload must contain scalar values");
    }
  }
  return safePayload;
}

/**
 * Append one newly generated Mission Control event.
 *
 * Pass a transaction executor when the event must be atomic with the source
 * action. Idempotency is scoped to companyId. A repeated key returns the
 * original event without updating it or changing its server-recorded time.
 */
export async function appendMissionControlInspectionEvent<
  TExecutor extends EventWriterExecutor,
>(
  executor: TExecutor,
  input: MissionControlInspectionEventInput,
): Promise<AppendedMissionControlInspectionEvent> {
  if (!Number.isInteger(input.companyId) || input.companyId <= 0) {
    throw new Error("Mission Control event requires a valid companyId");
  }
  if (!Number.isInteger(input.inspectionId) || input.inspectionId <= 0) {
    throw new Error("Mission Control event requires a valid inspectionId");
  }
  for (const [field, value] of Object.entries({
    eventType: input.eventType,
    entityType: input.entityType,
    entityId: input.entityId,
    sourceRecordType: input.sourceRecordType,
    sourceRecordId: input.sourceRecordId,
    actor: input.actor,
    idempotencyKey: input.idempotencyKey,
  })) {
    if (!value.trim()) {
      throw new Error(`Mission Control event requires ${field}`);
    }
  }
  if (input.occurredAt && Number.isNaN(input.occurredAt.getTime())) {
    throw new Error("Mission Control event occurredAt must be a valid date");
  }
  const payload = validatePayload(input.payload);

  const [inspection] = await executor
    .select({ companyId: inspectionsTable.companyId })
    .from(inspectionsTable)
    .where(
      and(
        eq(inspectionsTable.id, input.inspectionId),
        eq(inspectionsTable.companyId, input.companyId),
      ),
    )
    .limit(1);
  if (!inspection) {
    throw new Error("Inspection does not belong to the requested company");
  }

  const [inserted] = await executor
    .insert(missionControlInspectionEventsTable)
    .values({
      companyId: input.companyId,
      inspectionId: input.inspectionId,
      eventType: input.eventType,
      entityType: input.entityType,
      entityId: input.entityId,
      sourceRecordType: input.sourceRecordType,
      sourceRecordId: input.sourceRecordId,
      actor: input.actor,
      occurredAt: input.occurredAt ?? null,
      idempotencyKey: input.idempotencyKey,
      payload,
      // Do not accept origin from callers. The database default and constraint
      // reserve this value for actual insertions by this new-event writer.
    })
    .onConflictDoNothing({
      target: [
        missionControlInspectionEventsTable.companyId,
        missionControlInspectionEventsTable.idempotencyKey,
      ],
    })
    .returning();

  if (inserted) {
    return { event: inserted, created: true };
  }

  const [existing] = await executor
    .select()
    .from(missionControlInspectionEventsTable)
    .where(
      and(
        eq(missionControlInspectionEventsTable.companyId, input.companyId),
        eq(
          missionControlInspectionEventsTable.idempotencyKey,
          input.idempotencyKey,
        ),
      ),
    )
    .limit(1);
  if (!existing) {
    throw new Error("Mission Control event idempotency conflict could not be resolved");
  }
  if (
    existing.inspectionId !== input.inspectionId ||
    existing.eventType !== input.eventType ||
    existing.sourceRecordType !== input.sourceRecordType ||
    existing.sourceRecordId !== input.sourceRecordId
  ) {
    throw new Error("Mission Control event key belongs to a different source transition");
  }
  return { event: existing, created: false };
}