import { beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import {
  db, companiesTable, inspectionsTable, inspectionMediaTable,
  missionControlInspectionEventsTable, inspectionSyncLogsTable,
} from "@workspace/db";
import { appendProcessingMilestone, recordInspectionSyncAttempt } from "./inspection-processing-events";
import { getMissionControlInspectionTimeline } from "./mission-control-inspection-timeline";
import { migrateMissionControl } from "./migrate-mission-control";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
async function fixture(tx: Transaction) {
  const token = randomUUID();
  const [company] = await tx.insert(companiesTable).values({
    name: "Processing milestones test", slug: `milestones-${token}`,
  }).returning();
  const [inspection] = await tx.insert(inspectionsTable).values({
    companyId: company!.id, siteAddress: "PRIVATE ADDRESS", technicianName: "PRIVATE NAME",
  }).returning();
  return { companyId: company!.id, inspectionId: inspection!.id };
}

beforeAll(migrateMissionControl);

describe("transactional processing milestones", () => {
  it("keeps evidence and its event atomic, with private source data omitted", async () => {
    const rollback = new Error("rollback fixture");
    let scope!: Awaited<ReturnType<typeof fixture>>;
    await expect(db.transaction(async (tx) => {
      scope = await fixture(tx);
      const [media] = await tx.insert(inspectionMediaTable).values({
        ...scope, mediaType: "photo", url: "/objects/PRIVATE-PATH", filename: "PRIVATE-FILENAME",
        captureMetadata: { privateNotes: "PRIVATE DIAGNOSTICS" },
      }).returning();
      const input = {
        ...scope, eventType: "evidence.registered" as const,
        sourceType: "inspection_media", sourceId: media!.id, actor: "system:test",
        occurredAt: new Date("2026-10-01T12:00:00Z"),
      };
      const first = await appendProcessingMilestone(tx, input);
      const retry = await appendProcessingMilestone(tx, { ...input, occurredAt: new Date() });
      expect(first.created).toBe(true);
      expect(retry.created).toBe(false);
      expect(retry.event).toEqual(first.event);
      expect(first.event.payload).toEqual({});
      const timeline = await getMissionControlInspectionTimeline(scope, tx);
      const event = timeline.find((entry) => entry.id === `mission-control-event:${first.event.id}`);
      expect(event).toMatchObject({
        provenance: "newly_generated_event", sourceId: String(media!.id),
        detail: "Uploaded evidence verified and registered",
      });
      expect(JSON.stringify(timeline)).not.toMatch(/PRIVATE/);
      throw rollback;
    })).rejects.toBe(rollback);
    expect(await db.select().from(inspectionMediaTable)
      .where(eq(inspectionMediaTable.inspectionId, scope.inspectionId))).toHaveLength(0);
    expect(await db.select().from(missionControlInspectionEventsTable)
      .where(eq(missionControlInspectionEventsTable.inspectionId, scope.inspectionId))).toHaveLength(0);
  });

  it("rolls back source writes when event ownership validation fails", async () => {
    let mediaId = 0;
    await expect(db.transaction(async (tx) => {
      const scope = await fixture(tx);
      const foreign = await fixture(tx);
      const [media] = await tx.insert(inspectionMediaTable).values({
        ...scope, mediaType: "photo", url: "PRIVATE",
      }).returning();
      mediaId = media!.id;
      await appendProcessingMilestone(tx, {
        ...scope, companyId: foreign.companyId, eventType: "evidence.registered",
        sourceType: "inspection_media", sourceId: mediaId, actor: "system:test",
      });
    })).rejects.toThrow("Inspection does not belong");
    expect(await db.select().from(inspectionMediaTable)
      .where(eq(inspectionMediaTable.id, mediaId))).toHaveLength(0);
  });

  it("records concurrent identical writes once and isolates inspections and tenants", async () => {
    const scope = await db.transaction(fixture);
    const foreign = await db.transaction(fixture);
    try {
      const input = {
        ...scope, eventType: "inspection.created" as const,
        sourceType: "inspections", sourceId: scope.inspectionId, actor: "system:test",
      };
      const results = await Promise.all(Array.from({ length: 6 }, () =>
        db.transaction((tx) => appendProcessingMilestone(tx, input))));
      expect(results.filter((result) => result.created)).toHaveLength(1);
      expect(new Set(results.map((result) => result.event.id)).size).toBe(1);
      await db.transaction((tx) => appendProcessingMilestone(tx, {
        ...input, ...foreign, sourceId: foreign.inspectionId,
      }));
      const entries = await getMissionControlInspectionTimeline(scope);
      expect(entries.filter((entry) => entry.eventType === "inspection.created")).toHaveLength(1);
      expect(entries.some((entry) => entry.sourceId === String(foreign.inspectionId))).toBe(false);
      // Concurrent legitimate transitions have independent stable source IDs.
      await Promise.all([
        recordInspectionSyncAttempt({ ...scope, systemType: "pestpac", success: true,
          resultJson: { secret: "PRIVATE RESPONSE" } }, "system:test"),
        recordInspectionSyncAttempt({ ...scope, systemType: "pestpac", success: false,
          errorMessage: "PRIVATE DIAGNOSTICS" }, "system:test"),
      ]);
      const history = await getMissionControlInspectionTimeline(scope);
      const sync = history.filter((entry) => entry.sourceType === "inspection_sync_logs");
      expect(sync).toHaveLength(2);
      expect(sync.map((entry) => entry.eventType).sort()).toEqual(["sync.failed", "sync.succeeded"]);
      expect(sync.every((entry) => entry.provenance === "newly_generated_event")).toBe(true);
      expect(JSON.stringify(history)).not.toMatch(/PRIVATE/);
      expect(await getMissionControlInspectionTimeline(scope)).toEqual(history.map(
        (entry) => entry.provenance === "current_state_derived"
          ? expect.objectContaining({ ...entry, observedAt: expect.any(Date) }) : entry,
      ));
    } finally {
      // Append-only history intentionally survives live inspection deletion.
      await db.delete(inspectionSyncLogsTable).where(eq(inspectionSyncLogsTable.inspectionId, scope.inspectionId));
      await db.delete(inspectionsTable).where(inArray(inspectionsTable.id, [scope.inspectionId, foreign.inspectionId]));
    }
  });

  it("rejects a reused company key pointing at another inspection", async () => {
    const rollback = new Error("rollback fixture");
    await expect(db.transaction(async (tx) => {
      const scope = await fixture(tx);
      const [other] = await tx.insert(inspectionsTable).values({
        companyId: scope.companyId, siteAddress: "Another test", technicianName: "Test",
      }).returning();
      const { appendMissionControlInspectionEvent } = await import("./mission-control-inspection-events");
      const input = {
        ...scope, eventType: "inspection.created", entityType: "inspection",
        entityId: String(scope.inspectionId), sourceRecordType: "inspections",
        sourceRecordId: String(scope.inspectionId), actor: "system:test", idempotencyKey: "same-key",
      };
      await appendMissionControlInspectionEvent(tx, input);
      await expect(appendMissionControlInspectionEvent(tx, {
        ...input, inspectionId: other!.id,
      })).rejects.toThrow("different source transition");
      throw rollback;
    })).rejects.toBe(rollback);
  });
});
