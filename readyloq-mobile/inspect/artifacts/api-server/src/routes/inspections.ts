import { Router } from "express";
import { db } from "@workspace/db";
import { inspectionsTable, inspectionMediaTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { getCompanyId } from "../lib/tenant";

const router = Router();

// GET /inspections
router.get("/", async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const { status, technicianId } = req.query;
    const rows = await db
      .select()
      .from(inspectionsTable)
      .where(eq(inspectionsTable.companyId, companyId))
      .orderBy(desc(inspectionsTable.createdAt));
    let filtered = rows;
    if (status) filtered = filtered.filter((r) => r.status === status);
    if (technicianId) filtered = filtered.filter((r) => r.technicianId === technicianId);

    const withMedia = await Promise.all(
      filtered.map(async (insp) => {
        const media = await db
          .select()
          .from(inspectionMediaTable)
          .where(
            and(
              eq(inspectionMediaTable.companyId, companyId),
              eq(inspectionMediaTable.inspectionId, insp.id),
            ),
          );
        return {
          ...insp,
          pestTypes: insp.pestTypes ?? [],
          media,
          createdAt: insp.createdAt.toISOString(),
          completedAt: insp.completedAt?.toISOString() ?? null,
        };
      }),
    );
    return res.json(withMedia);
  } catch (err) {
    return res.status(500).json({ error: "Failed to list inspections" });
  }
});

// POST /inspections
router.post("/", async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const { siteAddress, clientName, technicianName, technicianId, notes, pestTypes } =
      req.body;
    if (!siteAddress || !technicianName) {
      return res.status(400).json({ error: "siteAddress and technicianName are required" });
    }
    const [row] = await db
      .insert(inspectionsTable)
      .values({
        companyId,
        siteAddress,
        clientName: clientName ?? null,
        technicianName,
        technicianId: technicianId ?? null,
        notes: notes ?? null,
        pestTypes: pestTypes ?? [],
        status: "pending",
      })
      .returning();
    return res.status(201).json({
      ...row,
      pestTypes: row.pestTypes ?? [],
      media: [],
      createdAt: row.createdAt.toISOString(),
      completedAt: null,
    });
  } catch (err) {
    return res.status(500).json({ error: "Failed to create inspection" });
  }
});

// GET /inspections/:id
router.get("/:id", async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const id = parseInt(req.params.id);
    const [row] = await db
      .select()
      .from(inspectionsTable)
      .where(and(eq(inspectionsTable.id, id), eq(inspectionsTable.companyId, companyId)));
    if (!row) return res.status(404).json({ error: "Not found" });
    const media = await db
      .select()
      .from(inspectionMediaTable)
      .where(
        and(
          eq(inspectionMediaTable.companyId, companyId),
          eq(inspectionMediaTable.inspectionId, id),
        ),
      );
    return res.json({
      ...row,
      pestTypes: row.pestTypes ?? [],
      media: media.map((m) => ({ ...m, createdAt: m.createdAt.toISOString() })),
      createdAt: row.createdAt.toISOString(),
      completedAt: row.completedAt?.toISOString() ?? null,
    });
  } catch (err) {
    return res.status(500).json({ error: "Failed to get inspection" });
  }
});

// PATCH /inspections/:id
router.patch("/:id", async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const id = parseInt(req.params.id);
    const { status, notes, severity, pestTypes, completedAt } = req.body;
    const updateData: Record<string, unknown> = {};
    if (status !== undefined) updateData.status = status;
    if (notes !== undefined) updateData.notes = notes;
    if (severity !== undefined) updateData.severity = severity;
    if (pestTypes !== undefined) updateData.pestTypes = pestTypes;
    if (completedAt !== undefined) updateData.completedAt = new Date(completedAt);
    const [row] = await db
      .update(inspectionsTable)
      .set(updateData)
      .where(and(eq(inspectionsTable.id, id), eq(inspectionsTable.companyId, companyId)))
      .returning();
    if (!row) return res.status(404).json({ error: "Not found" });
    const media = await db
      .select()
      .from(inspectionMediaTable)
      .where(
        and(
          eq(inspectionMediaTable.companyId, companyId),
          eq(inspectionMediaTable.inspectionId, id),
        ),
      );
    return res.json({
      ...row,
      pestTypes: row.pestTypes ?? [],
      media: media.map((m) => ({ ...m, createdAt: m.createdAt.toISOString() })),
      createdAt: row.createdAt.toISOString(),
      completedAt: row.completedAt?.toISOString() ?? null,
    });
  } catch (err) {
    return res.status(500).json({ error: "Failed to update inspection" });
  }
});

// DELETE /inspections/:id
router.delete("/:id", async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const id = parseInt(req.params.id);
    await db
      .delete(inspectionsTable)
      .where(and(eq(inspectionsTable.id, id), eq(inspectionsTable.companyId, companyId)));
    return res.status(204).send();
  } catch (err) {
    return res.status(500).json({ error: "Failed to delete inspection" });
  }
});

// POST /inspections/:id/media
router.post("/:id/media", async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const inspectionId = parseInt(req.params.id);
    const { mediaType, url, filename, caption, durationSec } = req.body;
    if (!mediaType || !url)
      return res.status(400).json({ error: "mediaType and url are required" });
    // Child write: the parent inspection must belong to the caller's company.
    const [inspection] = await db
      .select()
      .from(inspectionsTable)
      .where(
        and(eq(inspectionsTable.id, inspectionId), eq(inspectionsTable.companyId, companyId)),
      );
    if (!inspection) return res.status(404).json({ error: "Not found" });
    const [row] = await db
      .insert(inspectionMediaTable)
      .values({
        companyId,
        inspectionId,
        mediaType,
        url,
        filename: filename ?? null,
        caption: caption ?? null,
        durationSec: durationSec ?? null,
      })
      .returning();
    // update media count (scoped to the caller's company)
    const mediaForInspection = await db
      .select()
      .from(inspectionMediaTable)
      .where(
        and(
          eq(inspectionMediaTable.companyId, companyId),
          eq(inspectionMediaTable.inspectionId, inspectionId),
        ),
      );
    await db
      .update(inspectionsTable)
      .set({ mediaCount: mediaForInspection.length })
      .where(
        and(eq(inspectionsTable.id, inspectionId), eq(inspectionsTable.companyId, companyId)),
      );
    return res.status(201).json({ ...row, createdAt: row.createdAt.toISOString() });
  } catch (err) {
    return res.status(500).json({ error: "Failed to add media" });
  }
});

export default router;
