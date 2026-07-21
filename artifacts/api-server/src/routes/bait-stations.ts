import { Router, type Request } from "express";
import { db } from "@workspace/db";
import { baitStationsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { getCompanyId } from "../lib/tenant";
import { z } from "zod/v4";

type Params = { inspectionId: string; stationId?: string };
const router = Router({ mergeParams: true });

const upsertSchema = z.object({
  label: z.string().min(1).max(100),
  locationType: z.string().optional(),
  latitude: z.string().optional(),
  longitude: z.string().optional(),
  status: z.enum(["active", "missing", "damaged", "removed"]).default("active"),
  notes: z.string().optional(),
  lastCheckedAt: z.string().optional(),
});

// GET /inspections/:inspectionId/bait-stations
router.get("/", async (req: Request<Params>, res) => {
  try {
    const companyId = getCompanyId(req);
    const inspectionId = Number(req.params.inspectionId);
    if (isNaN(inspectionId)) return res.status(400).json({ error: "Invalid inspection ID" });

    const rows = await db
      .select()
      .from(baitStationsTable)
      .where(
        and(
          eq(baitStationsTable.companyId, companyId),
          eq(baitStationsTable.inspectionId, inspectionId),
        ),
      );

    return res.json(rows.map((r) => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
      lastCheckedAt: r.lastCheckedAt?.toISOString() ?? null,
    })));
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

    const parse = upsertSchema.safeParse(req.body);
    if (!parse.success) return res.status(400).json({ error: "Invalid body", detail: parse.error.issues });

    const [row] = await db
      .insert(baitStationsTable)
      .values({
        companyId,
        inspectionId,
        label: parse.data.label,
        locationType: parse.data.locationType,
        latitude: parse.data.latitude,
        longitude: parse.data.longitude,
        status: parse.data.status,
        notes: parse.data.notes,
        lastCheckedAt: parse.data.lastCheckedAt ? new Date(parse.data.lastCheckedAt) : new Date(),
      })
      .returning();

    return res.status(201).json({
      ...row,
      createdAt: row.createdAt.toISOString(),
      lastCheckedAt: row.lastCheckedAt?.toISOString() ?? null,
    });
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
    return res.json({
      ...row,
      createdAt: row.createdAt.toISOString(),
      lastCheckedAt: row.lastCheckedAt?.toISOString() ?? null,
    });
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

    await db
      .delete(baitStationsTable)
      .where(
        and(
          eq(baitStationsTable.id, stationId),
          eq(baitStationsTable.inspectionId, inspectionId),
          eq(baitStationsTable.companyId, companyId),
        ),
      );

    return res.status(204).send();
  } catch {
    return res.status(500).json({ error: "Failed to delete bait station" });
  }
});

export default router;
