import { Router } from "express";
import { db } from "@workspace/db";
import { inspectionsTable, inspectionMediaTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";

const router = Router();

// GET /inspections
router.get("/", async (req, res) => {
  try {
    const { status, technicianId } = req.query;
    let query = db.select().from(inspectionsTable).orderBy(desc(inspectionsTable.createdAt));
    const rows = await query;
    let filtered = rows;
    if (status) filtered = filtered.filter(r => r.status === status);
    if (technicianId) filtered = filtered.filter(r => r.technicianId === technicianId);

    const withMedia = await Promise.all(filtered.map(async (insp) => {
      const media = await db.select().from(inspectionMediaTable).where(eq(inspectionMediaTable.inspectionId, insp.id));
      return {
        ...insp,
        pestTypes: insp.pestTypes ?? [],
        media,
        createdAt: insp.createdAt.toISOString(),
        completedAt: insp.completedAt?.toISOString() ?? null,
      };
    }));
    res.json(withMedia);
  } catch (err) {
    res.status(500).json({ error: "Failed to list inspections" });
  }
});

// POST /inspections
router.post("/", async (req, res) => {
  try {
    const { siteAddress, clientName, technicianName, technicianId, notes, pestTypes } = req.body;
    if (!siteAddress || !technicianName) {
      return res.status(400).json({ error: "siteAddress and technicianName are required" });
    }
    const [row] = await db.insert(inspectionsTable).values({
      siteAddress,
      clientName: clientName ?? null,
      technicianName,
      technicianId: technicianId ?? null,
      notes: notes ?? null,
      pestTypes: pestTypes ?? [],
      status: "pending",
    }).returning();
    res.status(201).json({
      ...row,
      pestTypes: row.pestTypes ?? [],
      media: [],
      createdAt: row.createdAt.toISOString(),
      completedAt: null,
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to create inspection" });
  }
});

// GET /inspections/:id
router.get("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const [row] = await db.select().from(inspectionsTable).where(eq(inspectionsTable.id, id));
    if (!row) return res.status(404).json({ error: "Not found" });
    const media = await db.select().from(inspectionMediaTable).where(eq(inspectionMediaTable.inspectionId, id));
    res.json({
      ...row,
      pestTypes: row.pestTypes ?? [],
      media: media.map(m => ({ ...m, createdAt: m.createdAt.toISOString() })),
      createdAt: row.createdAt.toISOString(),
      completedAt: row.completedAt?.toISOString() ?? null,
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to get inspection" });
  }
});

// PATCH /inspections/:id
router.patch("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const { status, notes, severity, pestTypes, completedAt } = req.body;
    const updateData: Record<string, unknown> = {};
    if (status !== undefined) updateData.status = status;
    if (notes !== undefined) updateData.notes = notes;
    if (severity !== undefined) updateData.severity = severity;
    if (pestTypes !== undefined) updateData.pestTypes = pestTypes;
    if (completedAt !== undefined) updateData.completedAt = new Date(completedAt);
    const [row] = await db.update(inspectionsTable).set(updateData).where(eq(inspectionsTable.id, id)).returning();
    if (!row) return res.status(404).json({ error: "Not found" });
    const media = await db.select().from(inspectionMediaTable).where(eq(inspectionMediaTable.inspectionId, id));
    res.json({
      ...row,
      pestTypes: row.pestTypes ?? [],
      media: media.map(m => ({ ...m, createdAt: m.createdAt.toISOString() })),
      createdAt: row.createdAt.toISOString(),
      completedAt: row.completedAt?.toISOString() ?? null,
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to update inspection" });
  }
});

// DELETE /inspections/:id
router.delete("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    await db.delete(inspectionsTable).where(eq(inspectionsTable.id, id));
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: "Failed to delete inspection" });
  }
});

// POST /inspections/:id/media
router.post("/:id/media", async (req, res) => {
  try {
    const inspectionId = parseInt(req.params.id);
    const { mediaType, url, filename, caption, durationSec } = req.body;
    if (!mediaType || !url) return res.status(400).json({ error: "mediaType and url are required" });
    const [row] = await db.insert(inspectionMediaTable).values({
      inspectionId,
      mediaType,
      url,
      filename: filename ?? null,
      caption: caption ?? null,
      durationSec: durationSec ?? null,
    }).returning();
    // update media count
    await db.update(inspectionsTable)
      .set({ mediaCount: (await db.select().from(inspectionMediaTable).where(eq(inspectionMediaTable.inspectionId, inspectionId))).length })
      .where(eq(inspectionsTable.id, inspectionId));
    res.status(201).json({ ...row, createdAt: row.createdAt.toISOString() });
  } catch (err) {
    res.status(500).json({ error: "Failed to add media" });
  }
});

export default router;
