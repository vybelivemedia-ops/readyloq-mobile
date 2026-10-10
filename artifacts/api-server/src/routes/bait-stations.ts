import { Router, type Request } from "express";
import { db } from "@workspace/db";
import { baitStationsTable, inspectionsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { getCompanyId } from "../lib/tenant";
import { z } from "zod/v4";
import { createHash } from "node:crypto";

type Params = { inspectionId: string; stationId?: string };
const router = Router({ mergeParams: true });

const upsertSchema = z.object({
  label: z.string().min(1).max(100),
  locationType: z.string().optional(),
  latitude: z.string().optional(),
  longitude: z.string().optional(),
  status: z.enum(["active", "missing", "damaged", "removed"]).default("active"),
  notes: z.string().optional(),
  lastCheckedAt: z.iso.datetime({ offset: true }).optional(),
});

const createSchema = upsertSchema.extend({
  clientKey: z.string().trim().min(1).max(200).optional(),
});

function payloadHash(input: z.infer<typeof upsertSchema>): string {
  // Omitted optional values are normalized so retries hash identically.
  const canonical = {
    label: input.label,
    locationType: input.locationType ?? null,
    latitude: input.latitude ?? null,
    longitude: input.longitude ?? null,
    status: input.status,
    notes: input.notes ?? null,
    lastCheckedAt: input.lastCheckedAt ? new Date(input.lastCheckedAt).toISOString() : null,
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

function serializeStation(row: typeof baitStationsTable.$inferSelect) {
  const { clientKey: _clientKey, clientPayloadHash: _clientPayloadHash, ...publicRow } = row;
  return {
    ...publicRow,
    createdAt: row.createdAt.toISOString(),
    lastCheckedAt: row.lastCheckedAt?.toISOString() ?? null,
  };
}

async function replayOrConflict(
  companyId: number,
  inspectionId: number,
  clientKey: string,
  clientPayloadHash: string,
  res: import("express").Response,
) {
  const [existing] = await db
    .select()
    .from(baitStationsTable)
    .where(and(
      eq(baitStationsTable.companyId, companyId),
      eq(baitStationsTable.inspectionId, inspectionId),
      eq(baitStationsTable.clientKey, clientKey),
    ));
  if (!existing) return null;
  if (existing.clientPayloadHash !== clientPayloadHash) {
    res.status(409).json({ error: "Bait station clientKey was already used with a different payload" });
    return false;
  }
  res.status(200).json(serializeStation(existing));
  return true;
}

// GET /inspections/:inspectionId/bait-stations
router.get("/", async (req: Request<Params>, res) => {
  try {
    const companyId = getCompanyId(req);
    const inspectionId = Number(req.params.inspectionId);
    if (isNaN(inspectionId)) return res.status(400).json({ error: "Invalid inspection ID" });

    // Verify the parent inspection belongs to this company before listing stations.
    const [inspection] = await db
      .select({ id: inspectionsTable.id })
      .from(inspectionsTable)
      .where(and(eq(inspectionsTable.id, inspectionId), eq(inspectionsTable.companyId, companyId)));
    if (!inspection) return res.status(404).json({ error: "Inspection not found" });

    const rows = await db
      .select()
      .from(baitStationsTable)
      .where(
        and(
          eq(baitStationsTable.companyId, companyId),
          eq(baitStationsTable.inspectionId, inspectionId),
        ),
      );

    return res.json(rows.map(serializeStation));
  } catch {
    return res.status(500).json({ error: "Failed to list bait stations" });
  }
});

// POST /inspections/:inspectionId/bait-stations
router.post("/", async (req: Request<Params>, res) => {
  try {
    const companyId = getCompanyId(req);
    const inspectionId = Number(req.params.inspectionId);
    if (isNaN(inspectionId)) return res.status(400).json({ error: "Invalid inspection ID" });

    // Verify the parent inspection belongs to this company before writing.
    const [inspection] = await db
      .select({ id: inspectionsTable.id })
      .from(inspectionsTable)
      .where(and(eq(inspectionsTable.id, inspectionId), eq(inspectionsTable.companyId, companyId)));
    if (!inspection) return res.status(404).json({ error: "Inspection not found" });

    const parse = createSchema.safeParse(req.body);
    if (!parse.success) return res.status(400).json({ error: "Invalid body", detail: parse.error.issues });

    const { clientKey, ...input } = parse.data;
    const values = {
      companyId,
      inspectionId,
      label: input.label,
      locationType: input.locationType,
      latitude: input.latitude,
      longitude: input.longitude,
      status: input.status,
      notes: input.notes,
      lastCheckedAt: input.lastCheckedAt ? new Date(input.lastCheckedAt) : new Date(),
    };

    // Legacy clients may omit clientKey. Preserve their previous create
    // behavior, but retries cannot be safely identified without a stable key.
    if (clientKey === undefined) {
      const [row] = await db
        .insert(baitStationsTable)
        .values(values)
        .returning();
      if (!row) return res.status(500).json({ error: "Failed to create bait station" });
      return res.status(201).json(serializeStation(row));
    }

    const clientPayloadHash = payloadHash(input);

    // The tenant-owned parent is verified above before any replay lookup.
    const replay = await replayOrConflict(companyId, inspectionId, clientKey, clientPayloadHash, res);
    if (replay !== null) return;

    const [row] = await db
      .insert(baitStationsTable)
      .values({
        ...values,
        clientKey,
        clientPayloadHash,
      })
      .onConflictDoNothing({
        target: [baitStationsTable.companyId, baitStationsTable.inspectionId, baitStationsTable.clientKey],
      })
      .returning();

    if (row) return res.status(201).json(serializeStation(row));

    // A concurrent POST won the unique-key race; load and validate its winner.
    const racedReplay = await replayOrConflict(companyId, inspectionId, clientKey, clientPayloadHash, res);
    if (racedReplay !== null) return;
    return res.status(500).json({ error: "Failed to create bait station" });
  } catch {
    return res.status(500).json({ error: "Failed to create bait station" });
  }
});

// PATCH /inspections/:inspectionId/bait-stations/:stationId
router.patch("/:stationId", async (req: Request<Params>, res) => {
  try {
    const companyId = getCompanyId(req);
    const inspectionId = Number(req.params.inspectionId);
    const stationId = Number(req.params.stationId);
    if (isNaN(inspectionId) || isNaN(stationId)) return res.status(400).json({ error: "Invalid ID" });

    const parse = upsertSchema.partial().safeParse(req.body);
    if (!parse.success) return res.status(400).json({ error: "Invalid body", detail: parse.error.issues });

    const update: Record<string, unknown> = { ...parse.data };
    if (parse.data.lastCheckedAt) update.lastCheckedAt = new Date(parse.data.lastCheckedAt);

    const [row] = await db
      .update(baitStationsTable)
      .set(update)
      .where(
        and(
          eq(baitStationsTable.id, stationId),
          eq(baitStationsTable.inspectionId, inspectionId),
          eq(baitStationsTable.companyId, companyId),
        ),
      )
      .returning();

    if (!row) return res.status(404).json({ error: "Bait station not found" });
    return res.json(serializeStation(row));
  } catch {
    return res.status(500).json({ error: "Failed to update bait station" });
  }
});

// DELETE /inspections/:inspectionId/bait-stations/:stationId
router.delete("/:stationId", async (req: Request<Params>, res) => {
  try {
    const companyId = getCompanyId(req);
    const inspectionId = Number(req.params.inspectionId);
    const stationId = Number(req.params.stationId);
    if (isNaN(inspectionId) || isNaN(stationId)) return res.status(400).json({ error: "Invalid ID" });

    const deleted = await db
      .delete(baitStationsTable)
      .where(
        and(
          eq(baitStationsTable.id, stationId),
          eq(baitStationsTable.inspectionId, inspectionId),
          eq(baitStationsTable.companyId, companyId),
        ),
      )
      .returning({ id: baitStationsTable.id });

    if (deleted.length === 0) return res.status(404).json({ error: "Bait station not found" });
    return res.status(204).send();
  } catch {
    return res.status(500).json({ error: "Failed to delete bait station" });
  }
});

export default router;
