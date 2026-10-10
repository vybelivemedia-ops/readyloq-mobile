import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";

const { authState } = vi.hoisted(() => ({
  authState: { userId: null as string | null },
}));

vi.mock("@clerk/express", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@clerk/express")>();
  return {
    ...actual,
    getAuth: () => authState,
    clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  };
});

import app from "../app";
import {
  db,
  companiesTable,
  usersTable,
  companyFieldIntegrationsTable,
  inspectionsTable,
  analysisResultsTable,
  inspectionMediaTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import * as ssrfSafeFetchModule from "../lib/ssrf-safe-fetch";

const RUN_ID = Date.now();
const USER_A = `crm-tenant-a-${RUN_ID}`;
const USER_B = `crm-tenant-b-${RUN_ID}`;
const USER_UNCONFIGURED = `crm-tenant-unconfigured-${RUN_ID}`;

let companyAId: number;
let companyBId: number;
let unconfiguredCompanyId: number;
let userAId: number;
let userBId: number;
let unconfiguredUserId: number;
let inspectionAId: number;
let inspectionBId: number;
let originalPestPacKey: string | undefined;

beforeAll(async () => {
  const [companyA] = await db
    .insert(companiesTable)
    .values({ name: `CRM Tenant A ${RUN_ID}`, slug: `crm-tenant-a-${RUN_ID}` })
    .returning();
  const [companyB] = await db
    .insert(companiesTable)
    .values({ name: `CRM Tenant B ${RUN_ID}`, slug: `crm-tenant-b-${RUN_ID}` })
    .returning();
  const [unconfiguredCompany] = await db
    .insert(companiesTable)
    .values({ name: `Unconfigured CRM Tenant ${RUN_ID}`, slug: `crm-unconfigured-${RUN_ID}` })
    .returning();
  companyAId = companyA.id;
  companyBId = companyB.id;
  unconfiguredCompanyId = unconfiguredCompany.id;

  const [userA] = await db
    .insert(usersTable)
    .values({ clerkUserId: USER_A, role: "manager", companyId: companyAId })
    .returning();
  const [userB] = await db
    .insert(usersTable)
    .values({ clerkUserId: USER_B, role: "manager", companyId: companyBId })
    .returning();
  const [unconfiguredUser] = await db
    .insert(usersTable)
    .values({ clerkUserId: USER_UNCONFIGURED, role: "manager", companyId: unconfiguredCompanyId })
    .returning();
  userAId = userA.id;
  userBId = userB.id;
  unconfiguredUserId = unconfiguredUser.id;

  await db.insert(companyFieldIntegrationsTable).values([
    {
      companyId: companyAId,
      systemType: "pestpac",
      accountId: "acct-a",
      apiKey: "tenant-a-key",
      enabled: true,
    },
    {
      companyId: companyBId,
      systemType: "pestpac",
      accountId: "acct-b",
      apiKey: "tenant-b-key",
      enabled: true,
    },
  ]);

  const [inspectionA] = await db
    .insert(inspectionsTable)
    .values({ companyId: companyAId, siteAddress: "100 Tenant A St", technicianName: "Tech A" })
    .returning();
  const [inspectionB] = await db
    .insert(inspectionsTable)
    .values({ companyId: companyBId, siteAddress: "200 Tenant B St", technicianName: "Tech B" })
    .returning();
  inspectionAId = inspectionA.id;
  inspectionBId = inspectionB.id;

  const foreignFinding = {
    id: 9001,
    category: "Foreign",
    description: "foreign company finding",
    confidence: 0.9,
    severity: "high",
    location: null,
    imageUrl: null,
    treatment: null,
    exclusionOpportunity: false,
  };
  const ownedFinding = {
    ...foreignFinding,
    id: 9002,
    category: "Owned",
    description: "owned company finding",
  };
  await db.insert(analysisResultsTable).values([
    { companyId: companyBId, inspectionId: inspectionAId, findings: [foreignFinding] },
    { companyId: companyAId, inspectionId: inspectionAId, findings: [ownedFinding] },
  ]);
  await db.insert(inspectionMediaTable).values([
    {
      companyId: companyBId,
      inspectionId: inspectionAId,
      mediaType: "photo",
      url: "https://evidence.example/foreign.jpg",
    },
    {
      companyId: companyAId,
      inspectionId: inspectionAId,
      mediaType: "photo",
      url: "https://evidence.example/owned.jpg",
    },
  ]);

  originalPestPacKey = process.env.PESTPAC_API_KEY;
  process.env.PESTPAC_API_KEY = "global-env-key-must-not-be-used";
});

afterAll(async () => {
  authState.userId = null;
  vi.restoreAllMocks();
  if (originalPestPacKey === undefined) delete process.env.PESTPAC_API_KEY;
  else process.env.PESTPAC_API_KEY = originalPestPacKey;
  await db
    .delete(companyFieldIntegrationsTable)
    .where(eq(companyFieldIntegrationsTable.companyId, companyAId));
  await db
    .delete(companyFieldIntegrationsTable)
    .where(eq(companyFieldIntegrationsTable.companyId, companyBId));
  await db.delete(inspectionsTable).where(eq(inspectionsTable.id, inspectionAId));
  await db.delete(inspectionsTable).where(eq(inspectionsTable.id, inspectionBId));
  await db.delete(usersTable).where(eq(usersTable.id, userAId));
  await db.delete(usersTable).where(eq(usersTable.id, userBId));
  await db.delete(usersTable).where(eq(usersTable.id, unconfiguredUserId));
  await db.delete(companiesTable).where(eq(companiesTable.id, companyAId));
  await db.delete(companiesTable).where(eq(companiesTable.id, companyBId));
  await db.delete(companiesTable).where(eq(companiesTable.id, unconfiguredCompanyId));
});

describe("GET /api/crm/clients tenant isolation", () => {
  it("uses each company's stored CRM credentials instead of global env credentials", async () => {
    const keysUsed: Array<string | null> = [];
    vi.spyOn(ssrfSafeFetchModule, "ssrfSafeFetch").mockImplementation(async (_url, init) => {
      const headers = new Headers(init?.headers);
      const key = headers.get("X-WorkWave-Key");
      keysUsed.push(key);
      const name = key === "tenant-a-key" ? "Tenant A Client" : "Tenant B Client";
      return new Response(JSON.stringify([
        { id: key === "tenant-a-key" ? "a1" : "b1", firstName: name },
      ]), { status: 200, headers: { "Content-Type": "application/json" } });
    });

    authState.userId = USER_A;
    const responseA = await request(app).get("/api/crm/clients");
    expect(responseA.status).toBe(200);
    expect(responseA.body.clients).toEqual([
      { id: "a1", name: "Tenant A Client", address: "" },
    ]);

    authState.userId = USER_B;
    const responseB = await request(app).get("/api/crm/clients");
    expect(responseB.status).toBe(200);
    expect(responseB.body.clients).toEqual([
      { id: "b1", name: "Tenant B Client", address: "" },
    ]);

    expect(keysUsed).toEqual(["tenant-a-key", "tenant-b-key"]);
  });

  it("fails closed when a company has no stored CRM config, even if global credentials exist", async () => {
    const fetchMock = vi.spyOn(ssrfSafeFetchModule, "ssrfSafeFetch");
    fetchMock.mockClear();
    authState.userId = USER_UNCONFIGURED;
    const response = await request(app).get("/api/crm/clients");

    expect(response.status).toBe(503);
    expect(response.body.error).toBe("No active CRM configured for this company.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("pushes only with the caller company's CRM credentials and denies foreign inspections", async () => {
    const pushes: Array<{ key: string | null; body: { text: string } }> = [];
    vi.spyOn(ssrfSafeFetchModule, "ssrfSafeFetch")
      .mockReset()
      .mockImplementation(async (_url, init) => {
        const headers = new Headers(init?.headers);
        pushes.push({
          key: headers.get("X-WorkWave-Key"),
          body: JSON.parse(String(init?.body)) as { text: string },
        });
        return new Response(null, { status: 202 });
      });

    authState.userId = USER_A;
    const responseA = await request(app)
      .post(`/api/crm/inspections/${inspectionAId}/push`)
      .send({ clientId: "customer-a" });
    expect(responseA.status).toBe(200);
    expect(pushes[0]?.key).toBe("tenant-a-key");
    expect(pushes[0]?.body.text).toContain("owned company finding");
    expect(pushes[0]?.body.text).toContain("https://evidence.example/owned.jpg");
    expect(pushes[0]?.body.text).not.toContain("foreign company finding");
    expect(pushes[0]?.body.text).not.toContain("https://evidence.example/foreign.jpg");

    authState.userId = USER_B;
    const responseB = await request(app)
      .post(`/api/crm/inspections/${inspectionBId}/push`)
      .send({ clientId: "customer-b" });
    expect(responseB.status).toBe(200);
    expect(pushes[1]?.key).toBe("tenant-b-key");

    authState.userId = USER_A;
    const foreignResponse = await request(app)
      .post(`/api/crm/inspections/${inspectionBId}/push`)
      .send({ clientId: "customer-a" });
    expect(foreignResponse.status).toBe(404);
    expect(pushes).toHaveLength(2);
  });

  it("reports status from the caller company's integration row", async () => {
    authState.userId = USER_A;
    const configured = await request(app).get("/api/crm/status");
    expect(configured.status).toBe(200);
    expect(configured.body).toEqual({ configured: true, provider: "pestpac" });

    authState.userId = USER_UNCONFIGURED;
    const unconfigured = await request(app).get("/api/crm/status");
    expect(unconfigured.status).toBe(200);
    expect(unconfigured.body).toEqual({ configured: false, provider: null });
  });
});