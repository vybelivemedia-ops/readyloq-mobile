import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  db,
  companiesTable,
  companyFieldIntegrationsTable,
  enterpriseOutboxTable,
  inspectionsTable,
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
    await db.delete(companiesTable).where(eq(companiesTable.id, companyId));
  });

  it("reclaims a stale processing lease and delivers the persisted payload", async () => {
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
      status: "PROCESSING",
      lockedAt: new Date(Date.now() - 11 * 60_000),
      lockedBy: "crashed-worker",
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
  });
});
