import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  db,
  companiesTable,
  companyFieldIntegrationsTable,
  enterpriseOutboxTable,
  inspectionsTable,
  missionControlInspectionEventsTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import type { HardenedInspectionPayload } from "../../types/enterprise-payload";
import { EnterpriseBridgeProductionService } from "./enterprise-bridge-production";
import { OutboxProcessor } from "./outbox-processor";

describe("enterprise inspection outbox recovery", () => {
  let companyId: number;
  let inspectionId: number;

  beforeEach(async () => {
    const [company] = await db
      .insert(companiesTable)
      .values({ name: "Outbox Test", slug: `outbox-${randomUUID()}` })
      .returning({ id: companiesTable.id });
    if (!company) throw new Error("Failed to create company");
    companyId = company.id;
    const [inspection] = await db
      .insert(inspectionsTable)
      .values({
        companyId,
        siteAddress: "8 Recovery Rd",
        technicianName: "Recovery Tech",
      })
      .returning({ id: inspectionsTable.id });
    if (!inspection) throw new Error("Failed to create inspection");
    inspectionId = inspection.id;
    await db.insert(companyFieldIntegrationsTable).values({
      companyId,
      systemType: "pestpac",
      accountId: "sandbox",
      apiKey: "sandbox-key",
      enabled: true,
    });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await db.delete(inspectionsTable).where(eq(inspectionsTable.id, inspectionId));
    await db.delete(companyFieldIntegrationsTable).where(eq(companyFieldIntegrationsTable.companyId, companyId));
    // Preserve the test tenant identity referenced by its immutable history.
  });

  it.each(["PROCESSING", "QUEUED"] as const)(
    "claims a legacy %s delivery and records its actual recovery milestones", async (initialStatus) => {
    const payload: HardenedInspectionPayload = {
      inspectionId: String(inspectionId),
      externalWorkOrderId: "pestpac-work-88",
      companyId: String(companyId),
      propertyId: "8 Recovery Rd",
      technicianId: "tech-1",
      timestamp: "2026-09-01T12:00:00.000Z",
      signatures: {
        technicianUserId: "tech-1",
        technicianSignatureUrl: "",
        customerSignatureUrl: "",
        signedAt: "2026-09-01T12:00:00.000Z",
        signatureVersion: "v1",
      },
      measurements: [],
      aiFindings: [],
    };
    await db.insert(enterpriseOutboxTable).values({
      companyId,
      inspectionId,
      idempotencyKey: `inspection:${companyId}:${inspectionId}`,
      payloadJson: payload,
      status: initialStatus,
      lockedAt: initialStatus === "PROCESSING" ? new Date(Date.now() - 11 * 60_000) : null,
      lockedBy: initialStatus === "PROCESSING" ? "crashed-worker" : null,
    });
    const dispatch = vi
      .spyOn(EnterpriseBridgeProductionService, "dispatchToSystem")
      .mockResolvedValue({ status: "DELIVERED", httpStatus: 200 });

    const result = await OutboxProcessor.processPendingRetries({
      workerId: "recovery-worker",
    });

    expect(result).toEqual({ claimed: 1, delivered: 1, failed: 0 });
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ targetSystem: "pestpac" }),
      expect.objectContaining({ externalWorkOrderId: "pestpac-work-88" }),
    );
    const [row] = await db
      .select()
      .from(enterpriseOutboxTable)
      .where(eq(enterpriseOutboxTable.inspectionId, inspectionId));
    expect(row).toMatchObject({
      status: "DELIVERED",
      retryCount: 1,
      lockedAt: null,
      lockedBy: null,
    });
    const events = await db.select().from(missionControlInspectionEventsTable)
      .where(eq(missionControlInspectionEventsTable.inspectionId, inspectionId));
    expect(events.map((event) => event.eventType).sort()).toEqual(["sync.delivered", "sync.processing"]);
    expect(events.every((event) => event.sourceRecordId === row!.id && event.payload
      && Object.keys(event.payload).length === 0)).toBe(true);
    // The legacy queued/processing history of this manually created row was
    // never recorded; reclaiming it does not invent an earlier queue event.
    expect(events.some((event) => event.eventType === "sync.queued")).toBe(false);
    expect((await OutboxProcessor.processPendingRetries({ workerId: "retry-after-delivered" })).claimed).toBe(0);
    const afterRetry = await db.select().from(missionControlInspectionEventsTable)
      .where(eq(missionControlInspectionEventsTable.inspectionId, inspectionId));
    expect(afterRetry).toEqual(events);
  });
});
