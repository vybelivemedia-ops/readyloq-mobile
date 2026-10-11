import { beforeAll, afterAll, beforeEach, describe, it, expect, vi } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
const auth = vi.hoisted(() => ({ userId: null as string | null }));
vi.mock("@clerk/express", async (original) => ({
  ...await original<typeof import("@clerk/express")>(),
  getAuth: () => auth, clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
}));
import app from "../app";
import { db, companiesTable, usersTable, propertyProfilesTable, inspectionsTable, propertyLocationsTable, propertyVisitsTable, propertyVisitCoverageTable, propertyLocationEventsTable } from "@workspace/db";
import { eq, inArray, sql } from "drizzle-orm";
import { normalizeAddressKey } from "../lib/property-intelligence";
import { migratePropertyFoundation } from "../lib/migrate-property-foundation";

const suffix = randomUUID();
const manager = `foundation_mgr_${suffix}`, tech = `foundation_tech_${suffix}`, other = `foundation_other_${suffix}`;
let companyId: number, otherCompany: number, propertyId: number, unassignedId: number, otherPropertyId: number;
let buildingId: string, floorId: string, unitId: string, inspectionId: number;
const address = `Foundation ${suffix} Street`;
const base = () => `/api/property-foundation/${propertyId}`;
const node = (body: object, property = propertyId) => request(app).post(`/api/property-foundation/${property}/locations`).send({ id: randomUUID(), ...body });
const visit = () => request(app).post(`${base()}/visits`).send({ clientKey: randomUUID() });

beforeAll(async () => {
  await migratePropertyFoundation();
  await migratePropertyFoundation(); // startup reentrancy on the test DB only
  [companyId, otherCompany] = await Promise.all(["a", "b"].map(async (part) => {
    const [c] = await db.insert(companiesTable).values({ name: `Foundation ${part}`, slug: `foundation-${part}-${suffix}` }).returning();
    return c.id;
  }));
  await db.insert(usersTable).values([
    { clerkUserId: manager, role: "manager", companyId },
    { clerkUserId: tech, role: "technician", companyId },
    { clerkUserId: other, role: "manager", companyId: otherCompany },
  ]);
  const profiles = await db.insert(propertyProfilesTable).values([
    { companyId, addressKey: normalizeAddressKey(address), siteAddress: address },
    { companyId, addressKey: normalizeAddressKey(`${address} unassigned`), siteAddress: `${address} unassigned` },
    { companyId: otherCompany, addressKey: normalizeAddressKey(address), siteAddress: address },
  ]).returning();
  [propertyId, unassignedId, otherPropertyId] = profiles.map((p) => p.id);
  const [inspection] = await db.insert(inspectionsTable).values({
    companyId, siteAddress: address, unitNumber: "12A", technicianName: "Technician", technicianId: tech,
    status: "pending", findingsCount: 0, mediaCount: 0, pestTypes: [],
  }).returning();
  inspectionId = inspection.id;
});
beforeEach(() => { auth.userId = manager; });
afterAll(async () => {
  const companies = [companyId, otherCompany].filter(Boolean);
  if (!companies.length) return;
  await db.delete(propertyVisitCoverageTable).where(inArray(propertyVisitCoverageTable.companyId, companies));
  await db.delete(propertyVisitsTable).where(inArray(propertyVisitsTable.companyId, companies));
  await db.delete(propertyLocationEventsTable).where(inArray(propertyLocationEventsTable.companyId, companies));
  await db.delete(propertyLocationsTable).where(inArray(propertyLocationsTable.companyId, companies));
  await db.delete(propertyProfilesTable).where(inArray(propertyProfilesTable.companyId, companies));
  await db.delete(inspectionsTable).where(inArray(inspectionsTable.companyId, companies));
  await db.delete(usersTable).where(inArray(usersTable.companyId, companies));
  await db.delete(companiesTable).where(inArray(companiesTable.id, companies));
});

describe("property foundation", () => {
  it("rejects anonymous access and cross-company properties", async () => {
    auth.userId = null;
    expect((await request(app).get(`${base()}/roster`)).status).toBe(401);
    auth.userId = other;
    expect((await request(app).get(`${base()}/roster`)).status).toBe(404);
    expect((await node({ kind: "building", label: "Spoof" })).status).toBe(404);
  });
  it("uses stable IDs for buildings, floors, 12A–12P units and common areas", async () => {
    const b = await node({ kind: "building", label: "North Building" });
    expect(b.status).toBe(201); buildingId = b.body.id;
    const f = await node({ kind: "floor", label: "Level Twelve", parentId: buildingId });
    expect(f.status).toBe(201); floorId = f.body.id;
    for (const letter of "ABCDEFGHIJKLMNOP") {
      const u = await node({ kind: "unit", label: `12${letter}`, parentId: floorId });
      expect(u.status).toBe(201);
      expect(u.body.label).toBe(`12${letter}`);
      if (letter === "A") unitId = u.body.id;
    }
    const basement = await node({ kind: "common_area", label: "Basement area", commonAreaType: "basement", parentId: buildingId });
    expect(basement.status).toBe(201);
    expect((await node({ kind: "floor", label: "Invalid", parentId: unitId })).status).toBe(400);
  });
  it("requires technician assignment and rejects caller-owned tenant fields", async () => {
    auth.userId = tech;
    expect((await node({ kind: "common_area", label: "West stairwell", commonAreaType: "stairwell", parentId: floorId })).status).toBe(201);
    expect((await node({ kind: "building", label: "Other scope" }, unassignedId)).status).toBe(403);
    expect((await node({ kind: "building", label: "Spoof", companyId: otherCompany })).status).toBe(400);
    expect((await node({ kind: "building", label: "Foreign" }, otherPropertyId)).status).toBe(404);
  });
  it("rejects cross-property parent references in the API and database", async () => {
    expect((await node({ kind: "unit", label: "Wrong parent", parentId: floorId }, unassignedId)).status).toBe(400);
    await expect(db.insert(propertyLocationsTable).values({
      companyId, propertyId: unassignedId, parentId: floorId, kind: "unit", label: "Bypass",
    })).rejects.toThrow();
    await expect(db.insert(propertyLocationsTable).values({
      companyId: otherCompany, propertyId, kind: "building", label: "Tenant bypass",
    })).rejects.toThrow();
  });
  it("makes location creation idempotent and rejects changed retries", async () => {
    const id = randomUUID();
    const input = { id, kind: "unit", label: "Suite A/B", parentId: buildingId };
    expect((await request(app).post(`${base()}/locations`).send(input)).status).toBe(201);
    expect((await request(app).post(`${base()}/locations`).send(input)).body.id).toBe(id);
    expect((await request(app).post(`${base()}/locations`).send({ ...input, label: "Different" })).status).toBe(409);
  });
  it("permits scoped technician label/floor edits and rejects stale revisions", async () => {
    auth.userId = tech;
    const res = await request(app).patch(`${base()}/locations/${unitId}`).send({ revision: 1, label: "12A", parentId: buildingId });
    expect(res.status).toBe(200); expect(res.body.id).toBe(unitId); expect(res.body.revision).toBe(2);
    expect((await request(app).patch(`${base()}/locations/${unitId}`).send({ revision: 1, label: "Stale" })).status).toBe(409);
    expect((await request(app).patch(`${base()}/locations/${unitId}`).send({ revision: 2, parentId: unitId })).status).toBe(400);
  });
  it("snapshots all spaces as not inspected and allows two separate same-day visits", async () => {
    const key = randomUUID();
    const a = await request(app).post(`${base()}/visits`).send({ clientKey: key });
    const retry = await request(app).post(`${base()}/visits`).send({ clientKey: key });
    const b = await visit();
    expect(a.status).toBe(201); expect(b.status).toBe(201);
    expect(retry.body.visit.id).toBe(a.body.visit.id);
    expect(b.body.visit.id).not.toBe(a.body.visit.id);
    expect(a.body.coverage.length).toBeGreaterThanOrEqual(18);
    expect(a.body.coverage.every((c: { state: string; inspectionId: number | null }) => c.state === "not_inspected" && c.inspectionId === null)).toBe(true);
  });
  it("never treats empty findings/photos or missing AI as inspected", async () => {
    const v = (await visit()).body;
    const c = v.coverage.find((r: { spaceId: string }) => r.spaceId === unitId);
    const url = `${base()}/visits/${v.visit.id}/coverage/${c.id}`;
    expect((await request(app).patch(url).send({ revision: 1, state: "inspected" })).status).toBe(400);
    expect((await request(app).patch(url).send({ revision: 1, state: "inspected", inspectionId })).status).toBe(409);
    expect((await request(app).patch(url).send({ revision: 1, state: "no_access" })).status).toBe(400);
    const noAccess = await request(app).patch(url).send({ revision: 1, state: "no_access", reason: "Resident unavailable" });
    expect(noAccess.status).toBe(200);
    expect(noAccess.body.state).toBe("no_access");
    await db.update(inspectionsTable).set({ status: "completed", completedAt: new Date() }).where(eq(inspectionsTable.id, inspectionId));
    const complete = await request(app).patch(url).send({ revision: 2, state: "inspected", inspectionId });
    expect(complete.status).toBe(200); // explicit completion, not photo/finding counts
    expect(complete.body).not.toHaveProperty("clear");
    const wrongSpace = v.coverage.find((r: { spaceId: string }) => r.spaceId !== unitId);
    expect((await request(app).patch(`${base()}/visits/${v.visit.id}/coverage/${wrongSpace.id}`).send({ revision: 1, state: "inspected", inspectionId })).status).toBe(409);
  });
  it("archives without destroying snapshots or legacy inspection history", async () => {
    const v = (await visit()).body;
    const before = v.coverage.find((r: { spaceId: string }) => r.spaceId === unitId);
    const archive = await request(app).patch(`${base()}/locations/${unitId}`).send({ revision: 2, archived: true, reason: "Removed from service roster" });
    expect(archive.status).toBe(200); expect(archive.body.archivedAt).toBeTruthy();
    const persisted = (await request(app).get(`${base()}/visits/${v.visit.id}`)).body;
    expect(persisted.coverage.find((r: { spaceId: string }) => r.spaceId === unitId)).toEqual(before);
    const [legacy] = await db.select().from(inspectionsTable).where(eq(inspectionsTable.id, inspectionId));
    expect(legacy.unitNumber).toBe("12A");
    const next = (await visit()).body;
    expect(next.coverage.some((r: { spaceId: string }) => r.spaceId === unitId)).toBe(false);
    expect((await request(app).delete(`${base()}/locations/${unitId}`)).status).toBe(404);
  });
  it("reconciles additively without replacing referenced tenant keys or FKs", async () => {
    const constraints = () => db.execute(sql`
      SELECT conname, oid::text AS identity, convalidated, pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE connamespace = 'public'::regnamespace AND conname IN (
        'property_profiles_company_id_uq', 'property_locations_scope_id_uq', 'property_visits_scope_id_uq',
        'pf_locations_profile_fk', 'pf_locations_parent_fk', 'pf_visits_profile_fk',
        'pf_coverage_visit_fk', 'pf_coverage_space_fk', 'pf_events_profile_fk'
      ) ORDER BY conname
    `);
    const before = (await constraints()).rows;
    expect(before).toHaveLength(9);
    expect(before.every((c) => c.convalidated)).toBe(true);
    await migratePropertyFoundation();
    await migratePropertyFoundation();
    expect((await constraints()).rows).toEqual(before);
  });
  it("supports 192 apartments as a scale fixture, not a product constant", async () => {
    const b = (await node({ kind: "building", label: "Scale fixture" })).body;
    await db.insert(propertyLocationsTable).values(Array.from({ length: 192 }, (_, i) => ({
      companyId, propertyId, parentId: b.id, kind: "unit" as const, label: `Apartment ${i + 1}`,
    })));
    const v = (await visit()).body;
    expect(v.coverage.filter((c: { snapshot: { ancestors: { id: string }[] } }) => c.snapshot.ancestors.some((p) => p.id === b.id))).toHaveLength(192);
    expect(v.coverage.every((c: { state: string }) => c.state === "not_inspected")).toBe(true);
  });
});
