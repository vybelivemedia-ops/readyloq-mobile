import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  db,
  companiesTable,
  companyFieldIntegrationsTable,
  inspectionsTable,
  integrationConflictsTable,
  integrationEntityLinksTable,
  integrationSyncMessagesTable,
  integrationSyncRunsTable,
  propertyProfilesTable,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import {
  enqueuePestPacInboundRecord,
  getPestPacStopHistory,
  mapPestPacLocation,
  mapPestPacWorkOrder,
  normalizePestPacRecord,
  pollPestPacInbound,
  processPendingPestPacMessages,
} from "./pestpac-sync";

describe("PestPac bidirectional sync", () => {
  let companyId: number;
  const originalActivationFlag = process.env.PESTPAC_BIDIRECTIONAL_SYNC_ENABLED;

  beforeEach(async () => {
    const [company] = await db
      .insert(companiesTable)
      .values({
        name: "PestPac Sync Test",
        slug: `pestpac-sync-${randomUUID()}`,
      })
      .returning({ id: companiesTable.id });
    if (!company) throw new Error("Failed to create test company");
    companyId = company.id;
    await db.insert(companyFieldIntegrationsTable).values({
      companyId,
      systemType: "pestpac",
      accountId: "sandbox-account",
      apiKey: "sandbox-key",
      apiToken: "sandbox-oauth-token",
      apiBaseUrl: "https://pestpac.example.test/v1",
      enabled: true,
    });
  });

  afterEach(async () => {
    if (originalActivationFlag === undefined) {
      delete process.env.PESTPAC_BIDIRECTIONAL_SYNC_ENABLED;
    } else {
      process.env.PESTPAC_BIDIRECTIONAL_SYNC_ENABLED = originalActivationFlag;
    }
    await db.delete(inspectionsTable).where(eq(inspectionsTable.companyId, companyId));
    await db.delete(propertyProfilesTable).where(eq(propertyProfilesTable.companyId, companyId));
    await db.delete(companiesTable).where(eq(companiesTable.id, companyId));
  });

  it("normalizes common PestPac work-order and location shapes", () => {
    expect(
      mapPestPacLocation({
        locationId: "location-7",
        customerId: "customer-4",
        name: "Main warehouse",
        propertyType: "commercial",
        address: {
          street: "44 River Rd",
          city: "Albany",
          state: "NY",
          zip: "12207",
        },
      }),
    ).toEqual({
      id: "location-7",
      customerExternalId: "customer-4",
      siteAddress: "44 River Rd, Albany, NY, 12207",
      displayName: "Main warehouse",
      propertyType: "commercial",
      serviceNotes: null,
    });

    expect(
      mapPestPacWorkOrder({
        workOrderId: "work-9",
        locationId: "location-7",
        customerName: "Acme Foods",
        serviceAddress: {
          street1: "44 River Rd",
          city: "Albany",
          stateCode: "NY",
          postalCode: "12207",
        },
        scheduledAt: "2026-09-01T14:30:00.000Z",
        assignedTo: { id: "employee-2", name: "Sam Tech" },
        serviceType: "Monthly service",
      }),
    ).toMatchObject({
      id: "work-9",
      locationExternalId: "location-7",
      siteAddress: "44 River Rd, Albany, NY, 12207",
      clientName: "Acme Foods",
      technicianId: "employee-2",
      technicianName: "Sam Tech",
      visitPurpose: "Monthly service",
    });
  });

  it("keeps location history dormant while the contract gate is disabled", async () => {
    delete process.env.PESTPAC_BIDIRECTIONAL_SYNC_ENABLED;
    let called = false;
    const result = await getPestPacStopHistory(
      companyId,
      123,
      new Date("2026-09-01T09:00:00.000Z"),
      {
        fetchImpl: async () => {
          called = true;
          return Response.json({ notes: [] });
        },
      },
    );
    expect(result).toEqual({ status: "disabled", notes: [] });
    expect(called).toBe(false);
  });

  it("resolves company-scoped links and sends server-managed PestPac history headers", async () => {
    process.env.PESTPAC_BIDIRECTIONAL_SYNC_ENABLED = "true";
    const [inspection] = await db
      .insert(inspectionsTable)
      .values({
        companyId,
        siteAddress: "44 River Rd, Albany, NY, 12207",
        technicianName: "Sam Tech",
        technicianId: "readyloq-tech-1",
        status: "pending",
        scheduledDate: new Date("2026-09-01T09:00:00.000Z"),
      })
      .returning({ id: inspectionsTable.id });
    if (!inspection) throw new Error("Failed to create history test inspection");

    await db.insert(integrationEntityLinksTable).values([
      {
        companyId,
        provider: "pestpac",
        entityType: "location",
        externalId: "location / 7",
        metadata: { locationId: "location / 7" },
      },
      {
        companyId,
        provider: "pestpac",
        entityType: "work_order",
        localEntityId: inspection.id,
        externalId: "work-order-9",
        externalParentId: "customer-4",
        metadata: {
          workOrderId: "work-order-9",
          locationId: "location / 7",
        },
      },
    ]);

    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const result = await getPestPacStopHistory(
      companyId,
      inspection.id,
      new Date("2026-09-01T09:00:00.000Z"),
      {
        fetchImpl: async (url, init) => {
          calls.push({ url, init });
          return Response.json({
            notes: [
              {
                noteId: "note-before",
                text: "Use rear loading entrance.",
                noteType: "access",
                authorName: "PestPac Dispatcher",
                createdAt: "2026-08-15T12:00:00.000Z",
              },
              {
                noteId: "note-after",
                text: "Future service note",
                createdAt: "2026-09-02T12:00:00.000Z",
              },
            ],
          });
        },
      },
    );

    expect(result).toEqual({
      status: "available",
      notes: [
        {
          id: "note-before",
          note: "Use rear loading entrance.",
          category: "access",
          authorName: "PestPac Dispatcher",
          createdAt: "2026-08-15T12:00:00.000Z",
        },
      ],
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(
      "https://pestpac.example.test/v1/locations/location%20%2F%207/notes",
    );
    expect(calls[0]?.init?.headers).toMatchObject({
      apiKey: "sandbox-key",
      "tenant-id": "sandbox-account",
      Authorization: "Bearer sandbox-oauth-token",
    });
  });

  it("returns non-fatal states for unmapped stops and PestPac auth failures", async () => {
    process.env.PESTPAC_BIDIRECTIONAL_SYNC_ENABLED = "true";
    const historyBefore = new Date("2026-09-01T09:00:00.000Z");
    await expect(
      getPestPacStopHistory(companyId, 999999, historyBefore),
    ).resolves.toEqual({ status: "not_mapped", notes: [] });

    const [inspection] = await db
      .insert(inspectionsTable)
      .values({
        companyId,
        siteAddress: "8 Auth Failure Ave",
        technicianName: "Sam Tech",
        status: "pending",
      })
      .returning({ id: inspectionsTable.id });
    if (!inspection) throw new Error("Failed to create auth-failure inspection");
    await db.insert(integrationEntityLinksTable).values([
      {
        companyId,
        provider: "pestpac",
        entityType: "location",
        externalId: "location-auth",
      },
      {
        companyId,
        provider: "pestpac",
        entityType: "work_order",
        localEntityId: inspection.id,
        externalId: "work-auth",
        metadata: { workOrderId: "work-auth", locationId: "location-auth" },
      },
    ]);

    await expect(
      getPestPacStopHistory(companyId, inspection.id, historyBefore, {
        fetchImpl: async () => new Response(null, { status: 401 }),
      }),
    ).resolves.toEqual({ status: "unavailable", notes: [] });
  });

  it("deduplicates inbound work orders and upserts one scheduled inspection", async () => {
    const raw = {
      workOrderId: "work-order-101",
      version: "3",
      customerName: "Harbor Apartments",
      serviceAddress: {
        street: "10 Dock St",
        city: "Buffalo",
        state: "NY",
        zip: "14202",
      },
      scheduledDate: "2026-09-03T09:00:00.000Z",
      technicianId: "pestpac-tech-8",
      technicianName: "Alex Field",
      serviceType: "Routine inspection",
    };
    const record = normalizePestPacRecord("work_order", raw);
    if (!record) throw new Error("Expected normalized record");

    await expect(enqueuePestPacInboundRecord(companyId, record)).resolves.toBe(true);
    await expect(enqueuePestPacInboundRecord(companyId, record)).resolves.toBe(false);
    await processPendingPestPacMessages({ workerId: "test-worker" });

    const inspections = await db
      .select()
      .from(inspectionsTable)
      .where(
        and(
          eq(inspectionsTable.companyId, companyId),
          eq(inspectionsTable.clientKey, "pestpac:work-order-101"),
        ),
      );
    expect(inspections).toHaveLength(1);
    expect(inspections[0]).toMatchObject({
      siteAddress: "10 Dock St, Buffalo, NY, 14202",
      technicianId: "pestpac-tech-8",
      status: "pending",
    });

    const links = await db
      .select()
      .from(integrationEntityLinksTable)
      .where(
        and(
          eq(integrationEntityLinksTable.companyId, companyId),
          eq(integrationEntityLinksTable.externalId, "work-order-101"),
        ),
      );
    expect(links).toHaveLength(1);
    expect(links[0]?.localEntityId).toBe(inspections[0]?.id);
  });

  it("retains malformed external locations as actionable conflicts", async () => {
    const record = normalizePestPacRecord("location", {
      locationId: "location-without-address",
      customerId: "customer-1",
      version: "1",
    });
    if (!record) throw new Error("Expected normalized record");
    await enqueuePestPacInboundRecord(companyId, record);
    await processPendingPestPacMessages({ workerId: "test-worker-conflict" });

    const [message] = await db
      .select()
      .from(integrationSyncMessagesTable)
      .where(
        and(
          eq(integrationSyncMessagesTable.companyId, companyId),
          eq(integrationSyncMessagesTable.externalId, "location-without-address"),
        ),
      );
    expect(message?.status).toBe("CONFLICT");

    const conflicts = await db
      .select()
      .from(integrationConflictsTable)
      .where(eq(integrationConflictsTable.companyId, companyId));
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]).toMatchObject({
      externalId: "location-without-address",
      fieldName: "record",
      status: "open",
    });
  });

  it("stores and resumes the inbound cursor without duplicating unchanged payloads", async () => {
    const calls: string[] = [];
    const fetchImpl = async (url: string): Promise<Response> => {
      calls.push(url);
      if (url.includes("/workorders")) {
        return Response.json({
          workOrders: [
            {
              workOrderId: "cursor-work-1",
              version: "v1",
              customerName: "Cursor Customer",
              siteAddress: "1 Cursor Ave",
              scheduledDate: "2026-09-05T10:00:00.000Z",
            },
          ],
        });
      }
      return Response.json([]);
    };

    const first = await pollPestPacInbound(companyId, {
      fetchImpl,
      now: new Date("2026-09-01T00:00:00.000Z"),
    });
    expect(first.recordsQueued).toBe(1);
    expect(calls.some((url) => url.includes("modifiedSince="))).toBe(false);

    calls.length = 0;
    const second = await pollPestPacInbound(companyId, {
      fetchImpl,
      now: new Date("2026-09-01T00:05:00.000Z"),
    });
    expect(second.recordsQueued).toBe(0);
    expect(calls.every((url) => url.includes("modifiedSince="))).toBe(true);

    const runs = await db
      .select()
      .from(integrationSyncRunsTable)
      .where(eq(integrationSyncRunsTable.companyId, companyId));
    expect(runs).toHaveLength(2);
    expect(runs[1]?.cursorBefore).toBe("2026-09-01T00:00:00.000Z");
  });
});
