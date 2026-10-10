import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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
  baitStationsTable,
  companiesTable,
  db,
  inspectionsTable,
  usersTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { migrateBaitStationIdempotency } from "../lib/migrate-bait-station-idempotency";

const OWNER = "bait_station_idempotency_owner";
const OTHER_OWNER = "bait_station_idempotency_other_owner";
const SLUG = "bait-station-idempotency-test";
const OTHER_SLUG = "bait-station-idempotency-other-test";

let companyId: number;
let otherCompanyId: number;
let inspectionId: number;
let otherInspectionId: number;

async function findOrCreateCompany(name: string, slug: string): Promise<number> {
  const [existing] = await db.select().from(companiesTable).where(eq(companiesTable.slug, slug));
  if (existing) return existing.id;
  const [created] = await db.insert(companiesTable).values({ name, slug }).returning();
  return created.id;
}

async function createInspection(forCompanyId: number, address: string): Promise<number> {
  const [row] = await db.insert(inspectionsTable).values({
    companyId: forCompanyId,
    siteAddress: address,
    technicianName: "Test Technician",
    status: "pending",
  }).returning();
  return row.id;
}

function asUser(userId: string | null) {
  authState.userId = userId;
}

beforeAll(async () => {
  await migrateBaitStationIdempotency();
  companyId = await findOrCreateCompany("Bait Station Idempotency Test", SLUG);
  otherCompanyId = await findOrCreateCompany("Bait Station Other Tenant Test", OTHER_SLUG);
  await db.delete(usersTable).where(eq(usersTable.clerkUserId, OWNER));
  await db.delete(usersTable).where(eq(usersTable.clerkUserId, OTHER_OWNER));
  await db.insert(usersTable).values([
    { clerkUserId: OWNER, role: "owner", companyId },
    { clerkUserId: OTHER_OWNER, role: "owner", companyId: otherCompanyId },
  ]);
  inspectionId = await createInspection(companyId, "1 Idempotency Way");
  otherInspectionId = await createInspection(otherCompanyId, "2 Other Way");
});

beforeEach(async () => {
  asUser(null);
  await db.delete(baitStationsTable).where(eq(baitStationsTable.inspectionId, inspectionId));
});

afterAll(async () => {
  asUser(null);
  await db.delete(inspectionsTable).where(eq(inspectionsTable.companyId, companyId));
  await db.delete(inspectionsTable).where(eq(inspectionsTable.companyId, otherCompanyId));
  await db.delete(usersTable).where(eq(usersTable.clerkUserId, OWNER));
  await db.delete(usersTable).where(eq(usersTable.clerkUserId, OTHER_OWNER));
});

const input = (clientKey: string, label = "North wall") => ({
  clientKey,
  label,
  locationType: "exterior",
  status: "active",
  notes: "No activity",
  lastCheckedAt: "2026-04-17T12:00:00.000Z",
});

describe("POST /inspections/:inspectionId/bait-stations idempotency", () => {
  it("preserves legacy creates without a clientKey (replay is not guaranteed)", async () => {
    asUser(OWNER);
    const body = { label: "Legacy station", status: "active" };
    const first = await request(app)
      .post(`/api/inspections/${inspectionId}/bait-stations`)
      .send(body);
    const retry = await request(app)
      .post(`/api/inspections/${inspectionId}/bait-stations`)
      .send(body);

    expect(first.status).toBe(201);
    expect(retry.status).toBe(201);
    expect(retry.body.id).not.toBe(first.body.id);
    expect(first.body).not.toHaveProperty("clientKey");
    const rows = await db.select().from(baitStationsTable)
      .where(eq(baitStationsTable.inspectionId, inspectionId));
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.clientKey === null && row.clientPayloadHash === null)).toBe(true);
  });

  it("replays the same row and rejects a key reused with different payload", async () => {
    asUser(OWNER);
    const first = await request(app)
      .post(`/api/inspections/${inspectionId}/bait-stations`)
      .send(input("station-client-key-a"));
    const retry = await request(app)
      .post(`/api/inspections/${inspectionId}/bait-stations`)
      .send(input("station-client-key-a"));

    expect(first.status).toBe(201);
    expect(retry.status).toBe(200);
    expect(retry.body.id).toBe(first.body.id);

    const conflict = await request(app)
      .post(`/api/inspections/${inspectionId}/bait-stations`)
      .send(input("station-client-key-a", "Different station"));
    expect(conflict.status).toBe(409);

    const rows = await db.select().from(baitStationsTable)
      .where(eq(baitStationsTable.inspectionId, inspectionId));
    expect(rows).toHaveLength(1);
  });

  it("concurrent creates with one key commit exactly one station", async () => {
    asUser(OWNER);
    const calls = await Promise.all(Array.from({ length: 6 }, () =>
      request(app)
        .post(`/api/inspections/${inspectionId}/bait-stations`)
        .send(input("station-concurrent-key")),
    ));

    expect(calls.filter((response) => response.status === 201)).toHaveLength(1);
    expect(calls.filter((response) => response.status === 200)).toHaveLength(5);
    expect(new Set(calls.map((response) => response.body.id)).size).toBe(1);
    const rows = await db.select().from(baitStationsTable)
      .where(eq(baitStationsTable.inspectionId, inspectionId));
    expect(rows).toHaveLength(1);
  });

  it("checks tenant ownership of the inspection before looking up a replay key", async () => {
    asUser(OWNER);
    await request(app)
      .post(`/api/inspections/${inspectionId}/bait-stations`)
      .send(input("tenant-bound-key"));

    asUser(OTHER_OWNER);
    const foreign = await request(app)
      .post(`/api/inspections/${inspectionId}/bait-stations`)
      .send(input("tenant-bound-key"));
    expect(foreign.status).toBe(404);
    expect(foreign.body.error).toBe("Inspection not found");
  });
});