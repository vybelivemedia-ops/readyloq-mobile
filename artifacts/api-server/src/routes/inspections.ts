import { Router } from "express";
import { db } from "@workspace/db";
import { inspectionsTable, inspectionMediaTable, reportsTable } from "@workspace/db";
import { eq, and, desc, ne } from "drizzle-orm";
import { getCompanyId } from "../lib/tenant";
import {
  ensureReportForInspection,
  runInspectionFinalization,
} from "../lib/inspection-complete";
import { logErrorEvent } from "../lib/error-events";

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
    const { siteAddress, clientName, technicianName, technicianId, notes, pestTypes, clientKey, scheduledDate } =
      req.body;
    if (!siteAddress || !technicianName) {
      return res.status(400).json({ error: "siteAddress and technicianName are required" });
    }

    // Parse and validate scheduledDate when provided.
    let parsedScheduledDate: Date | null = null;
    if (scheduledDate) {
      const d = new Date(scheduledDate);
      if (isNaN(d.getTime())) {
        return res.status(400).json({ error: "Invalid scheduledDate — expected an ISO 8601 string" });
      }
      parsedScheduledDate = d;
    }

    // Idempotent create for the offline-first mobile client: `clientKey` is a
    // client-generated UUID. If a previous attempt already created this
    // inspection (response lost to a network drop), return the existing row
    // instead of duplicating it. Company-scoped via the unique index.
    const key = typeof clientKey === "string" && clientKey.trim() ? clientKey.trim() : null;
    if (key) {
      const [existing] = await db
        .select()
        .from(inspectionsTable)
        .where(
          and(eq(inspectionsTable.companyId, companyId), eq(inspectionsTable.clientKey, key)),
        );
      if (existing) {
        return res.status(200).json({
          ...existing,
          pestTypes: existing.pestTypes ?? [],
          media: [],
          createdAt: existing.createdAt.toISOString(),
          completedAt: existing.completedAt?.toISOString() ?? null,
        });
      }
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
        clientKey: key,
        scheduledDate: parsedScheduledDate,
      })
      .onConflictDoNothing({
        target: [inspectionsTable.companyId, inspectionsTable.clientKey],
      })
      .returning();

    // Insert lost a concurrent race on the same clientKey — fetch the winner.
    if (!row && key) {
      const [winner] = await db
        .select()
        .from(inspectionsTable)
        .where(
          and(eq(inspectionsTable.companyId, companyId), eq(inspectionsTable.clientKey, key)),
        );
      if (winner) {
        return res.status(200).json({
          ...winner,
          pestTypes: winner.pestTypes ?? [],
          media: [],
          createdAt: winner.createdAt.toISOString(),
          completedAt: winner.completedAt?.toISOString() ?? null,
        });
      }
    }
    if (!row) return res.status(500).json({ error: "Failed to create inspection" });

    return res.status(201).json({
      ...row,
      pestTypes: row.pestTypes ?? [],
      media: [],
      createdAt: row.createdAt.toISOString(),
      scheduledDate: row.scheduledDate?.toISOString() ?? null,
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
    const { status, notes, severity, pestTypes, completedAt, technicianSignature, ownerSignature, ownerNotAvailable, signedAt } = req.body;
    const updateData: Record<string, unknown> = {};
    if (status !== undefined) updateData.status = status;
    if (notes !== undefined) updateData.notes = notes;
    if (severity !== undefined) updateData.severity = severity;
    if (pestTypes !== undefined) updateData.pestTypes = pestTypes;
    if (completedAt !== undefined) updateData.completedAt = new Date(completedAt);
    if (technicianSignature !== undefined) updateData.technicianSignature = technicianSignature;
    if (ownerSignature !== undefined) updateData.ownerSignature = ownerSignature;
    if (ownerNotAvailable !== undefined) updateData.ownerNotAvailable = ownerNotAvailable;
    if (signedAt !== undefined) updateData.signedAt = new Date(signedAt);
    if (Object.keys(updateData).length === 0) {
      const [current] = await db
        .select()
        .from(inspectionsTable)
        .where(and(eq(inspectionsTable.id, id), eq(inspectionsTable.companyId, companyId)));
      if (!current) return res.status(404).json({ error: "Not found" });
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
        ...current,
        pestTypes: current.pestTypes ?? [],
        media: media.map((m) => ({ ...m, createdAt: m.createdAt.toISOString() })),
        createdAt: current.createdAt.toISOString(),
        completedAt: current.completedAt?.toISOString() ?? null,
      });
    }
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

// POST /inspections/:id/complete — the technician's explicit "Complete
// Inspection". This is the ONLY transition that ends an in-progress
// inspection: it marks the record completed, guarantees a service report
// exists, and kicks off the background finalization pipeline (AI narrative,
// customer summary draft, Opportunity Intelligence, scorecard). Idempotent —
// a repeat call (retry, double-tap, second device) is a safe no-op.
router.post("/:id/complete", async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const id = parseInt(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid id" });

    const [inspection] = await db
      .select()
      .from(inspectionsTable)
      .where(and(eq(inspectionsTable.id, id), eq(inspectionsTable.companyId, companyId)));
    if (!inspection) return res.status(404).json({ error: "Not found" });

    const serializeWithMedia = async (row: typeof inspectionsTable.$inferSelect) => {
      const media = await db
        .select()
        .from(inspectionMediaTable)
        .where(
          and(
            eq(inspectionMediaTable.companyId, companyId),
            eq(inspectionMediaTable.inspectionId, id),
          ),
        );
      return {
        ...row,
        pestTypes: row.pestTypes ?? [],
        media: media.map((m) => ({ ...m, createdAt: m.createdAt.toISOString() })),
        createdAt: row.createdAt.toISOString(),
        completedAt: row.completedAt?.toISOString() ?? null,
      };
    };

    const latestReportId = async () => {
      const [report] = await db
        .select()
        .from(reportsTable)
        .where(
          and(eq(reportsTable.companyId, companyId), eq(reportsTable.inspectionId, id)),
        )
        .orderBy(desc(reportsTable.createdAt))
        .limit(1);
      return report?.id ?? null;
    };

    if (inspection.status === "completed") {
      return res.json({
        inspection: await serializeWithMedia(inspection),
        reportId: await latestReportId(),
        alreadyCompleted: true,
        finalization: "skipped",
      });
    }

    // Atomic transition guard: only ONE caller wins the pending → completed
    // transition, so concurrent completes (double-tap, retry after a network
    // blip) can never run the finalization pipeline twice.
    const [updated] = await db
      .update(inspectionsTable)
      .set({ status: "completed", completedAt: new Date() })
      .where(
        and(
          eq(inspectionsTable.id, id),
          eq(inspectionsTable.companyId, companyId),
          ne(inspectionsTable.status, "completed"),
        ),
      )
      .returning();
    if (!updated) {
      // Lost the race — another request already completed it.
      const [current] = await db
        .select()
        .from(inspectionsTable)
        .where(and(eq(inspectionsTable.id, id), eq(inspectionsTable.companyId, companyId)));
      return res.json({
        inspection: await serializeWithMedia(current ?? inspection),
        reportId: await latestReportId(),
        alreadyCompleted: true,
        finalization: "skipped",
      });
    }

    // Guarantee the service report exists before responding (DB-only, fast).
    const report = await ensureReportForInspection({ companyId, inspectionId: id });

    // AI narrative, customer summary draft, opportunities, scorecard run in
    // the background — completion never blocks on AI latency, and per-step
    // failures log to the error monitor instead of un-completing anything.
    void runInspectionFinalization({
      companyId,
      inspectionId: id,
      reportId: report?.id ?? null,
      userId: req.user?.id,
    }).catch(() => {
      void logErrorEvent("ai", {
        companyId,
        userId: req.user?.id,
        message: "Inspection finalization pipeline crashed",
        inspectionId: id,
        context: { stage: "complete_pipeline" },
      });
    });

    return res.json({
      inspection: await serializeWithMedia(updated),
      reportId: report?.id ?? null,
      alreadyCompleted: false,
      finalization: "started",
    });
  } catch (err) {
    return res.status(500).json({ error: "Failed to complete inspection" });
  }
});

// POST /inspections/:id/reopen — revert a completed inspection back to
// 'pending' so the technician can add evidence or correct information.
//
// Permission: managers and owners may reopen any inspection in the company.
// A technician may only reopen their own inspection (matched via clerkUserId
// stored in technicianId at creation time). Returns 403 otherwise.
// Idempotent: re-opening an already-pending inspection is a safe no-op.
router.post("/:id/reopen", async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const id = parseInt(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid id" });

    const [inspection] = await db
      .select()
      .from(inspectionsTable)
      .where(and(eq(inspectionsTable.id, id), eq(inspectionsTable.companyId, companyId)));
    if (!inspection) return res.status(404).json({ error: "Not found" });

    // Permission: manager/owner may reopen any inspection; a technician may
    // only reopen inspections where they are the original technician.
    const user = req.user!;
    const ROLE_RANK: Record<string, number> = { technician: 0, sales: 1, manager: 2, owner: 3 };
    const isPrivileged = (ROLE_RANK[user.role] ?? 0) >= ROLE_RANK.manager;
    const isOwnInspection = inspection.technicianId === user.clerkUserId;
    if (!isPrivileged && !isOwnInspection) {
      return res.status(403).json({
        error: "You can only reopen your own inspections. Ask a manager or owner to reopen this one.",
      });
    }

    // Already pending — idempotent no-op.
    if (inspection.status !== "completed") {
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
        ...inspection,
        pestTypes: inspection.pestTypes ?? [],
        media: media.map((m) => ({ ...m, createdAt: m.createdAt.toISOString() })),
        createdAt: inspection.createdAt.toISOString(),
        completedAt: null,
        alreadyOpen: true,
      });
    }

    const [updated] = await db
      .update(inspectionsTable)
      .set({ status: "pending", completedAt: null })
      .where(and(eq(inspectionsTable.id, id), eq(inspectionsTable.companyId, companyId)))
      .returning();
    if (!updated) return res.status(404).json({ error: "Not found" });

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
      ...updated,
      pestTypes: updated.pestTypes ?? [],
      media: media.map((m) => ({ ...m, createdAt: m.createdAt.toISOString() })),
      createdAt: updated.createdAt.toISOString(),
      completedAt: null,
      alreadyOpen: false,
    });
  } catch (err) {
    return res.status(500).json({ error: "Failed to reopen inspection" });
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
    const { mediaType, url, filename, caption, durationSec, captureSource, qualityScore, captureMetadata } = req.body;
    if (!mediaType || !url)
      return res.status(400).json({ error: "mediaType and url are required" });
    const VALID_MEDIA_TYPES = ["photo", "image", "video", "document", "audio", "voice"] as const;
    if (!VALID_MEDIA_TYPES.includes(mediaType)) {
      return res.status(400).json({
        error: `Invalid mediaType. Must be one of: ${VALID_MEDIA_TYPES.join(", ")}`,
      });
    }
    // Child write: the parent inspection must belong to the caller's company.
    const [inspection] = await db
      .select()
      .from(inspectionsTable)
      .where(
        and(eq(inspectionsTable.id, inspectionId), eq(inspectionsTable.companyId, companyId)),
      );
    if (!inspection) return res.status(404).json({ error: "Not found" });
    // Idempotency: the mobile sync engine may retry this call if the app
    // crashes between uploading the file and writing the mediaRowId locally.
    // Returning the existing row (HTTP 200) instead of inserting a duplicate
    // prevents the same file from being analyzed twice by the AI pipeline.
    const [existing] = await db
      .select()
      .from(inspectionMediaTable)
      .where(
        and(
          eq(inspectionMediaTable.companyId, companyId), // tenant guard: defense-in-depth alongside parent inspection check
          eq(inspectionMediaTable.inspectionId, inspectionId),
          eq(inspectionMediaTable.url, url),
        ),
      )
      .limit(1);
    if (existing) {
      return res.status(200).json({ ...existing, createdAt: existing.createdAt.toISOString() });
    }
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
        // Vision Platform provenance (optional; validated to safe shapes).
        captureSource: typeof captureSource === "string" ? captureSource : "phone_camera",
        qualityScore:
          typeof qualityScore === "number" && Number.isFinite(qualityScore)
            ? Math.max(0, Math.min(100, Math.round(qualityScore)))
            : null,
        captureMetadata:
          captureMetadata && typeof captureMetadata === "object" && !Array.isArray(captureMetadata)
            ? (captureMetadata as Record<string, unknown>)
            : null,
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
