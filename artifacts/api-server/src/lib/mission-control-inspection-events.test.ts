import { describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import {
  companiesTable,
  db,
  inspectionsTable,
  missionControlInspectionEventsTable,
} from "@workspace/db";
import {
  appendMissionControlInspectionEvent,
  type MissionControlInspectionEventInput,
} from "./mission-control-inspection-events";
import { migrateMissionControl } from "./migrate-mission-control";

const input: MissionControlInspectionEventInput = {
  companyId: 7,
  inspectionId: 21,
  eventType: "evidence.attached",
  entityType: "evidence",
  entityId: "media-42",
  sourceRecordType: "inspection_media",
  sourceRecordId: "42",
  actor: "technician:9",
  occurredAt: new Date("2025-02-02T12:00:00.000Z"),
  idempotencyKey: "capture:42",
  payload: { mediaType: "photo", qualityScore: 88 },
};

function makeExecutor({
  inspection = { companyId: input.companyId },
  inserted,
  existing,
}: {
  inspection?: { companyId: number } | null;
  inserted?: Record<string, unknown>;
  existing?: Record<string, unknown>;
} = {}) {
  let selectCount = 0;
  const select = vi.fn(() => {
    const currentSelect = selectCount++;
    const query = {
      from: vi.fn(() => query),
      where: vi.fn(() => query),
      limit: vi.fn(async () =>
        currentSelect === 0
          ? inspection === null
            ? []
            : [inspection]
          : existing
            ? [existing]
            : [],
      ),
    };
    return query;
  });
  const returning = vi.fn(async () => inserted ? [inserted] : []);
  const onConflictDoNothing = vi.fn(() => ({ returning }));
  const values = vi.fn(() => ({ onConflictDoNothing }));
  const insert = vi.fn(() => ({ values }));

  return {
    executor: { select, insert },
    select,
    insert,
    values,
    onConflictDoNothing,
    returning,
  };
}

describe("appendMissionControlInspectionEvent", () => {
  it("rejects an inspection that is not owned by the requested company", async () => {
    const mocks = makeExecutor({ inspection: null });

    await expect(
      appendMissionControlInspectionEvent(mocks.executor, input),
    ).rejects.toThrow("Inspection does not belong to the requested company");
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("deduplicates within the company and returns the original immutable event", async () => {
    const original = {
      id: 3,
      companyId: input.companyId,
      inspectionId: input.inspectionId,
      eventType: input.eventType,
      sourceRecordType: input.sourceRecordType,
      sourceRecordId: input.sourceRecordId,
      idempotencyKey: input.idempotencyKey,
      origin: "newly_generated",
      recordedAt: new Date("2025-02-02T12:01:00.000Z"),
    };
    const mocks = makeExecutor({ existing: original });

    const result = await appendMissionControlInspectionEvent(
      mocks.executor,
      input,
    );

    expect(result).toEqual({ event: original, created: false });
    expect(mocks.insert).toHaveBeenCalledTimes(1);
    expect(mocks.onConflictDoNothing).toHaveBeenCalledWith({
      target: expect.arrayContaining([
        expect.anything(),
        expect.anything(),
      ]),
    });
    expect(mocks.select).toHaveBeenCalledTimes(2);
    expect(mocks.values).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: input.companyId,
        inspectionId: input.inspectionId,
        idempotencyKey: input.idempotencyKey,
        payload: input.payload,
      }),
    );
    // The writer's executor contract and implementation have no update/delete
    // path; database triggers provide the corresponding hard guarantee.
    expect(mocks.executor).not.toHaveProperty("update");
    expect(mocks.executor).not.toHaveProperty("delete");
  });

  it("marks only a successful insert as created", async () => {
    const created = {
      id: 4,
      companyId: input.companyId,
      inspectionId: input.inspectionId,
      origin: "newly_generated",
    };
    const mocks = makeExecutor({ inserted: created });

    const result = await appendMissionControlInspectionEvent(
      mocks.executor,
      input,
    );

    expect(result).toEqual({ event: created, created: true });
    expect(mocks.select).toHaveBeenCalledTimes(1);
  });

  it("retains immutable event identity after inspection deletion and still rejects foreign inspection ownership", async () => {
    await migrateMissionControl();
    await db.execute(sql`
      ALTER TABLE mission_control_inspection_events
      DROP CONSTRAINT IF EXISTS mission_control_inspection_events_test_inspection_fk
    `);
    await db.execute(sql`
      ALTER TABLE mission_control_inspection_events
      ADD CONSTRAINT mission_control_inspection_events_test_inspection_fk
      FOREIGN KEY (inspection_id) REFERENCES inspections(id) NOT VALID
    `);
    try {
      await migrateMissionControl();
      const legacyInspectionForeignKey = await db.execute(sql`
        SELECT conname
        FROM pg_constraint
        WHERE conrelid = 'mission_control_inspection_events'::regclass
          AND contype = 'f'
          AND pg_get_constraintdef(oid) LIKE 'FOREIGN KEY (inspection_id)%'
      `);
      expect(legacyInspectionForeignKey.rows).toHaveLength(0);
    } finally {
      await db.execute(sql`
        ALTER TABLE mission_control_inspection_events
        DROP CONSTRAINT IF EXISTS mission_control_inspection_events_test_inspection_fk
      `);
    }

    const rollback = new Error("rollback event-retention test fixture");
    await expect(db.transaction(async (tx) => {
      const token = randomUUID();
      const [company] = await tx.insert(companiesTable).values({
        name: `Mission Control Event Retention ${token}`,
        slug: `mc-event-retention-${token}`,
      }).returning({ id: companiesTable.id });
      const [inspection] = await tx.insert(inspectionsTable).values({
        companyId: company!.id,
        siteAddress: "Mission Control Event Retention Test",
        technicianName: "Test Technician",
      }).returning({ id: inspectionsTable.id });
      const [otherCompany] = await tx.insert(companiesTable).values({
        name: `Mission Control Foreign Event Retention ${token}`,
        slug: `mc-foreign-event-retention-${token}`,
      }).returning({ id: companiesTable.id });
      const [foreignInspection] = await tx.insert(inspectionsTable).values({
        companyId: otherCompany!.id,
        siteAddress: "Mission Control Foreign Event Retention Test",
        technicianName: "Foreign Test Technician",
      }).returning({ id: inspectionsTable.id });

      await expect(
        appendMissionControlInspectionEvent(tx, {
          ...input,
          companyId: company!.id,
          inspectionId: foreignInspection!.id,
          idempotencyKey: `foreign:${token}`,
        }),
      ).rejects.toThrow("Inspection does not belong to the requested company");

      const result = await appendMissionControlInspectionEvent(tx, {
        ...input,
        companyId: company!.id,
        inspectionId: inspection!.id,
        idempotencyKey: `retained:${token}`,
      });
      expect(result.created).toBe(true);

      await tx.delete(inspectionsTable).where(eq(inspectionsTable.id, inspection!.id));
      const retained = await tx.select().from(missionControlInspectionEventsTable)
        .where(and(
          eq(missionControlInspectionEventsTable.companyId, company!.id),
          eq(missionControlInspectionEventsTable.inspectionId, inspection!.id),
        ));
      expect(retained).toHaveLength(1);
      expect(retained[0]).toMatchObject({
        companyId: company!.id,
        inspectionId: inspection!.id,
        idempotencyKey: `retained:${token}`,
      });

      await tx.execute(sql`SAVEPOINT mission_control_event_delete_test`);
      let deleteError: unknown;
      try {
        await tx.delete(missionControlInspectionEventsTable)
          .where(eq(missionControlInspectionEventsTable.id, result.event.id));
      } catch (error) {
        deleteError = error;
        await tx.execute(sql`ROLLBACK TO SAVEPOINT mission_control_event_delete_test`);
      }
      expect(deleteError).toBeDefined();
      const stillRetained = await tx.select({ id: missionControlInspectionEventsTable.id })
        .from(missionControlInspectionEventsTable)
        .where(and(
          eq(missionControlInspectionEventsTable.companyId, company!.id),
          eq(missionControlInspectionEventsTable.inspectionId, inspection!.id),
        ));
      expect(stillRetained).toEqual([{ id: result.event.id }]);

      throw rollback;
    })).rejects.toBe(rollback);
  });
});