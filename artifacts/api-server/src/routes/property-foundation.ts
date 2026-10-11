import { Router, type Request } from "express";
import { and, eq, sql, inArray, desc } from "drizzle-orm";
import { z } from "zod/v4";
import { db, inspectionsTable, propertyProfilesTable, propertyLocationsTable, propertyVisitsTable, propertyVisitCoverageTable, propertyLocationEventsTable } from "@workspace/db";
import { getCompanyId } from "../lib/tenant";
import { normalizeAddressKey } from "../lib/property-intelligence";
import { activeLocation, validateLocation, snapshotSpace, FoundationError, MAX_PROPERTY_LOCATIONS } from "../lib/property-foundation";

const router = Router();
const uuid = z.string().uuid();
const createSchema = z.object({
  id: uuid, kind: z.enum(["building", "floor", "unit", "common_area"]),
  label: z.string().trim().min(1).max(120), parentId: uuid.nullable().default(null),
  commonAreaType: z.string().max(40).nullable().default(null),
}).strict();
const patchSchema = z.object({
  revision: z.number().int().positive(), label: z.string().trim().min(1).max(120).optional(),
  parentId: uuid.nullable().optional(), commonAreaType: z.string().max(40).nullable().optional(),
  archived: z.boolean().optional(), reason: z.string().trim().min(1).max(500).optional(),
}).strict().refine((v) => Object.keys(v).some((k) => k !== "revision" && k !== "reason"), "No changes supplied");
const coverageSchema = z.object({
  revision: z.number().int().positive(), state: z.enum(["not_inspected", "in_progress", "inspected", "no_access"]),
  inspectionId: z.number().int().positive().nullable().optional(), reason: z.string().trim().min(1).max(500).optional(),
}).strict();
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// All writes serialize on the existing profile row, protecting snapshots from
// concurrent archive/move/create operations without changing old records.
async function scope(tx: Tx, req: Request, lock: boolean) {
  const propertyId = Number(req.params.propertyId);
  if (!Number.isSafeInteger(propertyId) || propertyId < 1) throw new FoundationError(400, "Invalid property ID");
  const companyId = getCompanyId(req);
  let query = tx.select().from(propertyProfilesTable).where(and(eq(propertyProfilesTable.id, propertyId), eq(propertyProfilesTable.companyId, companyId)));
  const [property] = await (lock ? query.for("update") : query);
  if (!property) throw new FoundationError(404, "Property not found");
  const user = req.user!;
  const role = user.roleOverride ?? user.role;
  if (!["owner", "manager", "technician", "sales"].includes(role)) throw new FoundationError(403, "Role cannot access property roster");
  if (role === "sales" && lock) throw new FoundationError(403, "Sales has read-only roster access");
  if (role === "technician") {
    const assigned = await tx.select({ address: inspectionsTable.siteAddress }).from(inspectionsTable)
      .where(and(eq(inspectionsTable.companyId, companyId), eq(inspectionsTable.technicianId, user.clerkUserId)));
    if (!assigned.some((r) => normalizeAddressKey(r.address) === property.addressKey))
      throw new FoundationError(403, "Technician is not assigned to this property");
  }
  return { companyId, propertyId, property, actor: user.clerkUserId, role };
}
async function locations(tx: Tx, companyId: number, propertyId: number) {
  return tx.select().from(propertyLocationsTable).where(and(eq(propertyLocationsTable.companyId, companyId), eq(propertyLocationsTable.propertyId, propertyId)));
}
async function event(tx: Tx, s: { companyId: number; propertyId: number; actor: string }, action: string, detail: Record<string, unknown>) {
  await tx.insert(propertyLocationEventsTable).values({ companyId: s.companyId, propertyId: s.propertyId, actor: s.actor, action, detail });
}
function endpoint(fn: (tx: Tx, req: Request) => Promise<unknown>, status = 200) {
  return async (req: Request, res: import("express").Response) => {
    try { return res.status(status).json(await db.transaction((tx) => fn(tx, req))); }
    catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ error: "Invalid request", issues: error.issues });
      if (error instanceof FoundationError) return res.status(error.status).json({ error: error.message });
      req.log.error({ err: error }, "Property foundation request failed");
      return res.status(500).json({ error: "Property foundation request failed" });
    }
  };
}

router.get("/:propertyId/roster", endpoint(async (tx, req) => {
  const s = await scope(tx, req, false);
  return { propertyId: s.propertyId, locations: await locations(tx, s.companyId, s.propertyId) };
}));
router.post("/:propertyId/locations", endpoint(async (tx, req) => {
  const s = await scope(tx, req, true);
  const input = createSchema.parse(req.body);
  const nodes = await locations(tx, s.companyId, s.propertyId);
  const existing = nodes.find((n) => n.id === input.id);
  if (existing) {
    if (existing.label === input.label && existing.kind === input.kind && existing.parentId === input.parentId && existing.commonAreaType === input.commonAreaType) return existing;
    throw new FoundationError(409, "Location ID already exists with different content");
  }
  if (nodes.length >= MAX_PROPERTY_LOCATIONS) throw new FoundationError(409, "Property roster capacity reached");
  validateLocation(input, nodes);
  const duplicate = nodes.some((n) => !n.archivedAt && n.parentId === input.parentId && n.kind === input.kind && n.label.toLocaleLowerCase() === input.label.toLocaleLowerCase());
  if (duplicate) throw new FoundationError(409, "An active location with this label already exists under this parent");
  const [node] = await tx.insert(propertyLocationsTable).values({ ...input, companyId: s.companyId, propertyId: s.propertyId }).returning();
  await event(tx, s, "location_added", { after: node });
  return node;
}, 201));
router.patch("/:propertyId/locations/:locationId", endpoint(async (tx, req) => {
  const s = await scope(tx, req, true);
  const id = uuid.parse(req.params.locationId);
  const input = patchSchema.parse(req.body);
  const nodes = await locations(tx, s.companyId, s.propertyId);
  const node = nodes.find((n) => n.id === id);
  if (!node) throw new FoundationError(404, "Location not found");
  if (node.revision !== input.revision) throw new FoundationError(409, "Location changed; reload before editing");
  if (input.archived && !input.reason) throw new FoundationError(400, "Archive reason is required");
  if (input.archived === true && (input.label !== undefined || input.parentId !== undefined || input.commonAreaType !== undefined))
    throw new FoundationError(400, "Archive separately from label or parent edits");
  const changed = { ...node, ...(input.label !== undefined ? { label: input.label } : {}), ...(input.parentId !== undefined ? { parentId: input.parentId } : {}),
    ...(input.commonAreaType !== undefined ? { commonAreaType: input.commonAreaType } : {}) };
  if (input.archived !== true) validateLocation(changed, nodes);
  // Moving a floor/building must not move it under a descendant, and parent type
  // cannot change. validateLocation therefore also rules out cycles.
  if (input.archived !== true && nodes.some((n) => n.id !== id && !n.archivedAt && n.kind === changed.kind && n.parentId === changed.parentId && n.label.toLocaleLowerCase() === changed.label.toLocaleLowerCase()))
    throw new FoundationError(409, "An active location already uses this label");
  const ids = new Set([id]);
  if (input.archived) {
    for (let changedSet = true; changedSet;) {
      changedSet = false;
      for (const child of nodes) if (child.parentId && ids.has(child.parentId) && !ids.has(child.id)) { ids.add(child.id); changedSet = true; }
    }
    await tx.update(propertyLocationsTable).set({ archivedAt: new Date(), revision: sql`${propertyLocationsTable.revision} + 1` })
      .where(and(eq(propertyLocationsTable.companyId, s.companyId), eq(propertyLocationsTable.propertyId, s.propertyId), inArray(propertyLocationsTable.id, [...ids])));
  }
  const [updated] = await tx.update(propertyLocationsTable).set({
    label: changed.label, parentId: changed.parentId, commonAreaType: changed.commonAreaType,
    ...(input.archived === false ? { archivedAt: null } : {}), ...(!input.archived ? { revision: node.revision + 1 } : {}),
  }).where(eq(propertyLocationsTable.id, id)).returning();
  await event(tx, s, input.archived ? "location_archived" : "location_edited", { before: node, after: updated, affectedIds: [...ids], reason: input.reason ?? null });
  return updated;
}));
router.get("/:propertyId/visits", endpoint(async (tx, req) => {
  const s = await scope(tx, req, false);
  return tx.select().from(propertyVisitsTable).where(and(eq(propertyVisitsTable.companyId, s.companyId), eq(propertyVisitsTable.propertyId, s.propertyId)))
    .orderBy(desc(propertyVisitsTable.createdAt)).limit(100);
}));
async function readVisit(tx: Tx, s: { companyId: number; propertyId: number }, id: string) {
  const [visit] = await tx.select().from(propertyVisitsTable).where(and(eq(propertyVisitsTable.id, id), eq(propertyVisitsTable.companyId, s.companyId), eq(propertyVisitsTable.propertyId, s.propertyId)));
  if (!visit) throw new FoundationError(404, "Visit not found");
  const coverage = await tx.select().from(propertyVisitCoverageTable).where(and(eq(propertyVisitCoverageTable.visitId, id), eq(propertyVisitCoverageTable.companyId, s.companyId), eq(propertyVisitCoverageTable.propertyId, s.propertyId)));
  return { visit, coverage };
}
router.post("/:propertyId/visits", endpoint(async (tx, req) => {
  const s = await scope(tx, req, true);
  const { clientKey } = z.object({ clientKey: uuid }).strict().parse(req.body);
  const [existing] = await tx.select().from(propertyVisitsTable).where(and(eq(propertyVisitsTable.companyId, s.companyId), eq(propertyVisitsTable.propertyId, s.propertyId), eq(propertyVisitsTable.clientKey, clientKey)));
  if (existing) return readVisit(tx, s, existing.id);
  const nodes = await locations(tx, s.companyId, s.propertyId);
  const spaces = nodes.filter((n) => (n.kind === "unit" || n.kind === "common_area") && activeLocation(n, nodes));
  if (!spaces.length) throw new FoundationError(409, "Add active units or common areas before creating a visit");
  const [visit] = await tx.insert(propertyVisitsTable).values({ companyId: s.companyId, propertyId: s.propertyId, clientKey, createdBy: s.actor }).returning();
  await tx.insert(propertyVisitCoverageTable).values(spaces.map((n) => ({ companyId: s.companyId, propertyId: s.propertyId, visitId: visit.id, spaceId: n.id, snapshot: snapshotSpace(n, nodes), state: "not_inspected" as const })));
  await event(tx, s, "visit_created", { visitId: visit.id, spaces: spaces.length });
  return readVisit(tx, s, visit.id);
}, 201));
router.get("/:propertyId/visits/:visitId", endpoint(async (tx, req) => readVisit(tx, await scope(tx, req, false), uuid.parse(req.params.visitId))));
router.patch("/:propertyId/visits/:visitId/coverage/:coverageId", endpoint(async (tx, req) => {
  const s = await scope(tx, req, true);
  const visitId = uuid.parse(req.params.visitId);
  const coverageId = uuid.parse(req.params.coverageId);
  const input = coverageSchema.parse(req.body);
  const { coverage } = await readVisit(tx, s, visitId);
  const row = coverage.find((c) => c.id === coverageId);
  if (!row) throw new FoundationError(404, "Coverage not found");
  if (input.revision !== row.revision) throw new FoundationError(409, "Coverage changed; reload before editing");
  if (input.state === "no_access" && !input.reason) throw new FoundationError(400, "No-access reason required");
  const inspectionId = input.inspectionId === undefined ? row.inspectionId : input.inspectionId;
  if (input.state === "inspected" || input.state === "in_progress" || inspectionId != null) {
    if (!inspectionId) throw new FoundationError(400, "Explicit inspection linkage required");
    const [inspection] = await tx.select().from(inspectionsTable).where(and(eq(inspectionsTable.id, inspectionId), eq(inspectionsTable.companyId, s.companyId))).for("share");
    if (!inspection || normalizeAddressKey(inspection.siteAddress) !== s.property.addressKey)
      throw new FoundationError(400, "Inspection must belong to this property and company");
    if (s.role === "technician" && inspection.technicianId !== s.actor) throw new FoundationError(403, "Inspection is not assigned to you");
    const [space] = await tx.select().from(propertyLocationsTable).where(eq(propertyLocationsTable.id, row.spaceId));
    const label = inspection.unitNumber?.trim().toLocaleLowerCase();
    if (!label || ![row.snapshot.label, space?.label].some((v) => v?.trim().toLocaleLowerCase() === label))
      throw new FoundationError(409, "Inspection unit/area label must match this space; no automatic historical remapping");
    if (coverage.some((c) => c.id !== row.id && c.inspectionId === inspectionId))
      throw new FoundationError(409, "This inspection is already linked to another space in this visit");
    if (input.state === "inspected" && (inspection.status !== "completed" || !inspection.completedAt)) throw new FoundationError(409, "Linked inspection must be explicitly completed");
  }
  const [updated] = await tx.update(propertyVisitCoverageTable).set({ state: input.state, inspectionId, reason: input.state === "no_access" ? input.reason! : null, revision: row.revision + 1 }).where(eq(propertyVisitCoverageTable.id, row.id)).returning();
  await event(tx, s, "coverage_changed", { before: row, after: updated });
  return updated;
}));
export default router;
