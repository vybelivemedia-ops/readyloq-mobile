import { Router } from "express";
import { randomUUID } from "node:crypto";
import { appendProcessingMilestone } from "../lib/inspection-processing-events";
import { db } from "@workspace/db";
import {
  inspectionsTable,
  inspectionMediaTable,
  inspectionUploadIntentsTable,
  reportsTable,
  usersTable,
} from "@workspace/db";
import { eq, and, desc, ne, sql, gt } from "drizzle-orm";
import { z } from "zod/v4";
import { getCompanyId } from "../lib/tenant";
import { ObjectNotFoundError, ObjectStorageService } from "../lib/objectStorage";
import {
  ensureReportForInspection,
  runInspectionFinalization,
} from "../lib/inspection-complete";
import { logErrorEvent } from "../lib/error-events";

const router = Router();
const objectStorageService = new ObjectStorageService();
const capturedAtSchema = z.iso.datetime({ offset: true });
const OBJECT_EXISTENCE_CHECK_TIMEOUT_MS = 5_000;
const LOCATION_METADATA_KEY_PATTERN =
  /(gps|latitude|longitude|altitude|coordinates?|geolocation|geospatial|geographic|geotag|location|(^|[^a-z])(lat|lng|lon)([^a-z]|$)|position)/i;

function canChangeInspectionState(
  user: { role: string; clerkUserId: string },
  inspection: { technicianId: string | null },
): boolean {
  return (
    user.role === "manager" ||
    user.role === "owner" ||
    (user.role === "technician" && inspection.technicianId === user.clerkUserId)
  );
}

class ObjectExistenceCheckTimeoutError extends Error {
  constructor() {
    super("Object existence check timed out");
    this.name = "ObjectExistenceCheckTimeoutError";
  }
}

async function verifyObjectMetadataWithinDeadline(objectPath: string) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      objectStorageService.getObjectEntityMetadata(objectPath),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new ObjectExistenceCheckTimeoutError()),
          OBJECT_EXISTENCE_CHECK_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function removeLocationMetadata(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(removeLocationMetadata);
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => !LOCATION_METADATA_KEY_PATTERN.test(key))
      .map(([key, nested]) => [key, removeLocationMetadata(nested)]),
  );
}

function getCompanyObjectPath(rawUrl: unknown): string | null {
  if (typeof rawUrl !== "string") return null;
  const path = rawUrl.trim();
  if (path.startsWith("/api/storage/objects/")) {
    return path.slice("/api/storage".length);
  }
  if (path.startsWith("/objects/")) return path;
  return null;
}

// Keep media timestamps consistent across every inspection response. Drizzle
// returns timestamp columns as Date instances, while the API contract is ISO.
function serializeMedia(media: typeof inspectionMediaTable.$inferSelect) {
  return {
    ...media,
    createdAt: media.createdAt.toISOString(),
    capturedAt: media.capturedAt?.toISOString() ?? null,
  };
}

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
          media: media.map(serializeMedia),
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
    const {
      siteAddress,
      clientName,
      technicianName,
      technicianId: requestedTechnicianId,
      notes,
      pestTypes,
      clientKey,
      scheduledDate,
      unitNumber,
      visitPurpose,
    } = req.body;
    if (!siteAddress || !technicianName) {
      return res.status(400).json({ error: "siteAddress and technicianName are required" });
    }
    const caller = req.user!;
    const elevatedRoles = new Set(["manager", "owner"]);
    let technicianId: string | null = null;
    if (caller.role === "technician") {
      if (requestedTechnicianId != null && requestedTechnicianId !== caller.clerkUserId) {
        return res.status(403).json({ error: "Technicians can only create their own inspections" });
      }
      // Older clients omit technicianId; bind those records to the authenticated
      // technician instead of leaving an unowned record any peer could later edit.
      technicianId = caller.clerkUserId;
    } else if (requestedTechnicianId != null) {
      if (!elevatedRoles.has(caller.role)) {
        return res.status(403).json({ error: "Only a manager or owner may assign an inspection" });
      }
      const [assignedTechnician] = await db
        .select({ clerkUserId: usersTable.clerkUserId })
        .from(usersTable)
        .where(
          and(
            eq(usersTable.clerkUserId, requestedTechnicianId),
            eq(usersTable.companyId, companyId),
            eq(usersTable.role, "technician"),
          ),
        );
      if (!assignedTechnician) {
        return res.status(400).json({ error: "Assigned technician must belong to this company" });
      }
      technicianId = requestedTechnicianId;
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

    const row = await db.transaction(async (tx) => {
      const [created] = await tx
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
        unitNumber: typeof unitNumber === "string" && unitNumber.trim() ? unitNumber.trim() : null,
        visitPurpose:
          typeof visitPurpose === "string" && visitPurpose.trim() ? visitPurpose.trim() : null,
      })
      .onConflictDoNothing({
        target: [inspectionsTable.companyId, inspectionsTable.clientKey],
      })
      .returning();
      if (created) await appendProcessingMilestone(tx, {
        companyId, inspectionId: created.id, eventType: "inspection.created",
        sourceType: "inspections", sourceId: created.id, actor: `user:${req.user!.id}`,
        occurredAt: created.createdAt,
      });
      return created;
    });

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
      media: media.map(serializeMedia),
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
    const [existing] = await db
      .select()
      .from(inspectionsTable)
      .where(and(eq(inspectionsTable.id, id), eq(inspectionsTable.companyId, companyId)));

    if (!existing) return res.status(404).json({ error: "Not found" });

    const {
      status,
      notes,
      severity,
      pestTypes,
      completedAt,
      technicianSignature,
      ownerSignature,
      ownerNotAvailable,
      signedAt,
      // resignatureConsent: true lets a caller explicitly clear a signature that
      // is already stored.  Without it, an explicit null is rejected with 409 so
      // a momentarily-null re-sign flow cannot accidentally wipe the DB value.
      resignatureConsent,
      unitNumber,
      visitPurpose,
    } = req.body;

    const sensitiveFields = [
      status,
      severity,
      pestTypes,
      completedAt,
      technicianSignature,
      ownerSignature,
      ownerNotAvailable,
      signedAt,
    ];
    const modifiesSensitiveFields = sensitiveFields.some((value) => value !== undefined);
    if (modifiesSensitiveFields && !canChangeInspectionState(req.user!, existing)) {
      return res.status(403).json({
        error: "You can only change inspection status and signatures on your own inspections",
      });
    }

    // Guard: an explicit null ownerSignature must not silently overwrite a
    // non-null DB value — the app's local state may be momentarily null between
    // the user tapping "Re-sign" and the new SVG being painted.  Require the
    // caller to set resignatureConsent: true to confirm it is intentional.
    if (ownerSignature === null && resignatureConsent !== true) {
      const [current] = await db
        .select()
        .from(inspectionsTable)
        .where(and(eq(inspectionsTable.id, id), eq(inspectionsTable.companyId, companyId)));
      if (!current) return res.status(404).json({ error: "Not found" });
      if (current.ownerSignature !== null) {
        return res.status(409).json({
          error:
            "Cannot clear an existing owner signature without explicit resignatureConsent: true",
        });
      }
    }

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
    if (unitNumber !== undefined) updateData.unitNumber = typeof unitNumber === "string" && unitNumber.trim() ? unitNumber.trim() : null;
    if (visitPurpose !== undefined) updateData.visitPurpose = typeof visitPurpose === "string" && visitPurpose.trim() ? visitPurpose.trim() : null;
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
        media: media.map(serializeMedia),
        createdAt: current.createdAt.toISOString(),
        completedAt: current.completedAt?.toISOString() ?? null,
      });
    }
    const row = await db.transaction(async (tx) => {
      const [previous] = await tx.select({ status: inspectionsTable.status })
        .from(inspectionsTable)
        .where(and(eq(inspectionsTable.id, id), eq(inspectionsTable.companyId, companyId)))
        .for("update");
      if (!previous) return null;
      const [changed] = await tx.update(inspectionsTable).set(updateData)
        .where(and(eq(inspectionsTable.id, id), eq(inspectionsTable.companyId, companyId)))
        .returning();
      if (!changed) return null;
      if (changed.status !== previous.status) await appendProcessingMilestone(tx, {
        companyId, inspectionId: id,
        eventType: changed.status === "completed" ? "inspection.completed"
          : changed.status === "pending" ? "inspection.reopened" : "inspection.state_changed",
        sourceType: "inspections", sourceId: id, actor: `user:${req.user!.id}`,
        transitionKey: randomUUID(),
      });
      // Keep unit attribution atomic and tenant/inspection scoped.
      if (unitNumber !== undefined) await tx.update(inspectionMediaTable)
        .set({ unitNumber: changed.unitNumber })
        .where(and(eq(inspectionMediaTable.companyId, companyId),
          eq(inspectionMediaTable.inspectionId, id)));
      return changed;
    });
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
      media: media.map(serializeMedia),
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
    if (!canChangeInspectionState(req.user!, inspection)) {
      return res.status(403).json({
        error: "You can only complete your own inspections. Ask a manager or owner to complete this one.",
      });
    }

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
        media: media.map(serializeMedia),
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
    const updated = await db.transaction(async (tx) => {
      const [changed] = await tx
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
      if (changed) await appendProcessingMilestone(tx, {
        companyId, inspectionId: id, eventType: "inspection.completed",
        sourceType: "inspections", sourceId: id, actor: `user:${req.user!.id}`,
        occurredAt: changed.completedAt, transitionKey: randomUUID(),
      });
      return changed;
    });
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
        media: media.map(serializeMedia),
        createdAt: inspection.createdAt.toISOString(),
        completedAt: null,
        alreadyOpen: true,
      });
    }

    const updated = await db.transaction(async (tx) => {
      const [changed] = await tx.update(inspectionsTable)
        .set({ status: "pending", completedAt: null })
        .where(and(eq(inspectionsTable.id, id), eq(inspectionsTable.companyId, companyId),
          ne(inspectionsTable.status, "pending")))
        .returning();
      if (changed) await appendProcessingMilestone(tx, {
        companyId, inspectionId: id, eventType: "inspection.reopened",
        sourceType: "inspections", sourceId: id, actor: `user:${req.user!.id}`,
        transitionKey: randomUUID(),
      });
      if (changed) return changed;
      const [current] = await tx.select().from(inspectionsTable)
        .where(and(eq(inspectionsTable.id, id), eq(inspectionsTable.companyId, companyId)));
      return current;
    });
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
      media: media.map(serializeMedia),
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
    const [inspection] = await db
      .select()
      .from(inspectionsTable)
      .where(and(eq(inspectionsTable.id, id), eq(inspectionsTable.companyId, companyId)));
    if (!inspection) return res.status(404).json({ error: "Not found" });
    if (!canChangeInspectionState(req.user!, inspection)) {
      return res.status(403).json({
        error: "You can only delete your own inspections. Ask a manager or owner to delete this one.",
      });
    }

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
    if (!Number.isSafeInteger(inspectionId) || inspectionId < 1) {
      return res.status(400).json({ error: "Invalid inspection id" });
    }
    const {
      mediaType,
      url,
      uploadIntentId,
      filename,
      caption,
      durationSec,
      captureSource,
      qualityScore,
      captureMetadata,
      unitNumber,
      capturedAt,
    } = req.body;
    if (!mediaType || !url || !Number.isSafeInteger(uploadIntentId) || uploadIntentId < 1)
      return res.status(400).json({ error: "mediaType, url, and uploadIntentId are required" });
    // A supplied capture timestamp must be a real timestamp. Validate before
    // looking up or writing any rows so malformed client data cannot reach DB.
    let parsedCapturedAt: Date | null = null;
    if (capturedAt !== undefined) {
      const parsed = capturedAtSchema.safeParse(capturedAt);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid capturedAt — expected a timestamp" });
      }
      parsedCapturedAt = new Date(parsed.data);
    }
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
    if (!canChangeInspectionState(req.user!, inspection)) {
      return res.status(403).json({
        error: "You can only register evidence for your own inspections",
      });
    }
    const userId = req.user!.id;
    const [uploadIntent] = await db
      .select()
      .from(inspectionUploadIntentsTable)
      .where(and(
        eq(inspectionUploadIntentsTable.id, uploadIntentId),
        eq(inspectionUploadIntentsTable.companyId, companyId),
        eq(inspectionUploadIntentsTable.inspectionId, inspectionId),
        eq(inspectionUploadIntentsTable.userId, userId),
      ));
    if (!uploadIntent || uploadIntent.mediaType !== mediaType) {
      return res.status(404).json({ error: "Upload reservation not found" });
    }

    // Reject foreign/invalid URLs before idempotent replay. A registered intent
    // remains authoritative for same-tenant crop retries (the response returns
    // its original evidence), but must not accept foreign object claims.
    const objectPath = getCompanyObjectPath(url);
      const companyPathPrefix = `/objects/companies/${companyId}/uploads/`;
    const objectId = objectPath?.startsWith(companyPathPrefix)
      ? objectPath.slice(companyPathPrefix.length)
      : "";
    if (!/^[A-Za-z0-9][A-Za-z0-9._~-]*$/.test(objectId)) {
      return res.status(400).json({
        error: "Media URL must identify an object belonging to your company",
      });
    }
    if (uploadIntent.state === "registered") {
      if (!uploadIntent.registeredMediaId) {
        return res.status(409).json({ error: "Upload reservation state is inconsistent" });
      }
      const companyPathPrefix = `/objects/companies/${companyId}/uploads/`;
      const intentObjectId = uploadIntent.objectPath.startsWith(companyPathPrefix)
        ? uploadIntent.objectPath.slice(companyPathPrefix.length)
        : "";
      if (!/^[A-Za-z0-9][A-Za-z0-9._~-]*$/.test(intentObjectId)) {
        return res.status(409).json({ error: "Registered upload provenance is invalid" });
      }
      const [registered] = await db
        .select()
        .from(inspectionMediaTable)
        .where(and(
          eq(inspectionMediaTable.id, uploadIntent.registeredMediaId),
          eq(inspectionMediaTable.companyId, companyId),
          eq(inspectionMediaTable.inspectionId, inspectionId),
        ));
      if (
        !registered ||
        registered.mediaType !== uploadIntent.mediaType ||
        getCompanyObjectPath(registered.url) !== uploadIntent.objectPath
      ) {
        return res.status(409).json({ error: "Registered upload evidence is unavailable" });
      }
      return res.status(200).json(serializeMedia(registered));
    }
    if (uploadIntent.objectPath !== objectPath) {
      return res.status(404).json({ error: "Upload reservation not found" });
    }
    if (uploadIntent.state !== "reserved" || uploadIntent.expiresAt <= new Date()) {
      return res.status(400).json({ error: "Upload reservation expired or is no longer active" });
    }
    // Preserve idempotent retries even if the uploaded object was later
    // removed. This read releases its DB connection before touching storage.
    // Keep potentially slow GCS metadata/existence work outside a DB
    // transaction, with an upper bound so stalled storage cannot pin a pool
    // connection or leave the HTTP request waiting indefinitely.
    try {
      const metadata = await verifyObjectMetadataWithinDeadline(objectPath);
      if (metadata.size !== uploadIntent.expectedSize) {
        return res.status(400).json({ error: "Uploaded object size does not match its reservation" });
      }
      const actualContentType = metadata.contentType?.split(";")[0].trim().toLowerCase() ?? null;
      if (actualContentType !== uploadIntent.contentType) {
        return res.status(400).json({ error: "Uploaded object type does not match its reservation" });
      }
      if (uploadIntent.checksumAlgorithm === "md5") {
        if (!metadata.md5Hash || metadata.md5Hash !== uploadIntent.checksumValue) {
          return res.status(400).json({ error: "Uploaded object checksum does not match its reservation" });
        }
      }
    } catch (err) {
      if (err instanceof ObjectNotFoundError) {
        // A concurrent registration may have completed after the optimistic
        // retry lookup. Re-check under the same DB lock before returning the
        // non-disclosing missing-object error.
        const existingAfterMissingCheck = await db.transaction(async (tx) => {
          const lockKey = `inspection-media:${companyId}:${inspectionId}:${objectPath}`;
          await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`);
          const rows = await tx
            .select()
            .from(inspectionMediaTable)
            .where(
              and(
                eq(inspectionMediaTable.companyId, companyId),
                eq(inspectionMediaTable.inspectionId, inspectionId),
              ),
            );
          return rows.find((item) => getCompanyObjectPath(item.url) === objectPath);
        });
        if (existingAfterMissingCheck) {
          return res.status(200).json(serializeMedia(existingAfterMissingCheck));
        }
        return res.status(400).json({ error: "Unable to register media" });
      }
      if (err instanceof ObjectExistenceCheckTimeoutError) {
        return res.status(503).json({ error: "Media storage verification unavailable" });
      }
      throw err;
    }

    // Idempotency: the mobile sync engine may retry this call if the app
    // crashes between uploading the file and writing the mediaRowId locally.
    // Returning the existing row (HTTP 200) instead of inserting a duplicate
    // prevents the same file from being analyzed twice by the AI pipeline.
    // The sync client retries after ambiguous network failures. Serialize
    // registrations for the same tenant/inspection/object across API instances
    // so concurrent retries cannot create duplicate evidence rows.
    const result = await db.transaction(async (tx) => {
      const lockKey = `inspection-media:${companyId}:${inspectionId}:${objectPath}`;
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`);
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${"inspection-upload-intent:" + uploadIntentId}))`);
      const [currentIntent] = await tx
        .select()
        .from(inspectionUploadIntentsTable)
        .where(and(
          eq(inspectionUploadIntentsTable.id, uploadIntentId),
          eq(inspectionUploadIntentsTable.companyId, companyId),
          eq(inspectionUploadIntentsTable.inspectionId, inspectionId),
          eq(inspectionUploadIntentsTable.userId, userId),
        ));
      if (!currentIntent) {
        return { row: null, created: false, rejection: "missing" as const };
      }
      if (currentIntent.state === "registered" && currentIntent.registeredMediaId) {
        const [previouslyRegistered] = await tx
          .select()
          .from(inspectionMediaTable)
          .where(and(
            eq(inspectionMediaTable.id, currentIntent.registeredMediaId),
            eq(inspectionMediaTable.companyId, companyId),
            eq(inspectionMediaTable.inspectionId, inspectionId),
          ));
        if (
          previouslyRegistered &&
          getCompanyObjectPath(previouslyRegistered.url) === objectPath
        ) {
          return { row: previouslyRegistered, created: false, rejection: null };
        }
        return { row: null, created: false, rejection: "missing" as const };
      }
      if (currentIntent.state !== "reserved" || currentIntent.expiresAt <= new Date()) {
        return { row: null, created: false, rejection: "expired" as const };
      }

      const [row] = await tx
        .insert(inspectionMediaTable)
        .values({
          companyId,
          inspectionId,
          mediaType,
          url: objectPath,
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
              ? (removeLocationMetadata(captureMetadata) as Record<string, unknown>)
              : null,
          capturedAt: parsedCapturedAt,
          unitNumber:
            typeof unitNumber === "string" && unitNumber.trim()
              ? unitNumber.trim()
              : inspection.unitNumber ?? null,
        })
        .returning();
      if (!row) throw new Error("Failed to register inspection media");
      const [claimedIntent] = await tx
        .update(inspectionUploadIntentsTable)
        .set({ state: "registered", registeredMediaId: row.id })
        .where(and(
          eq(inspectionUploadIntentsTable.id, uploadIntentId),
          eq(inspectionUploadIntentsTable.state, "reserved"),
          gt(inspectionUploadIntentsTable.expiresAt, new Date()),
        ))
        .returning({ id: inspectionUploadIntentsTable.id });
      if (!claimedIntent) throw new Error("Upload reservation expired or was consumed during registration");
      if (row.capturedAt) await appendProcessingMilestone(tx, {
        companyId, inspectionId, eventType: "evidence.captured",
        sourceType: "inspection_media", sourceId: row.id, actor: `user:${req.user!.id}`,
        occurredAt: row.capturedAt,
      });
      await appendProcessingMilestone(tx, {
        companyId, inspectionId, eventType: "evidence.registered",
        sourceType: "inspection_media", sourceId: row.id, actor: `user:${req.user!.id}`,
        occurredAt: row.createdAt,
      });
      await tx
        .update(inspectionsTable)
        .set({ mediaCount: sql`${inspectionsTable.mediaCount} + 1` })
        .where(
          and(eq(inspectionsTable.id, inspectionId), eq(inspectionsTable.companyId, companyId)),
        );
      return { row, created: true, rejection: null };
    });
    if (result.rejection === "missing") {
      return res.status(404).json({ error: "Upload reservation not found" });
    }
    if (result.rejection === "expired") {
      return res.status(400).json({ error: "Upload reservation expired or is no longer active" });
    }
    if (!result.row) return res.status(500).json({ error: "Failed to register inspection media" });
    return res.status(result.created ? 201 : 200).json(serializeMedia(result.row));
  } catch (err) {
    if (err instanceof ObjectNotFoundError) {
      // Do not expose storage details or distinguish tenant/path information.
      return res.status(400).json({ error: "Unable to register media" });
    }
    if (err instanceof ObjectExistenceCheckTimeoutError) {
      return res.status(503).json({ error: "Media storage verification unavailable" });
    }
    return res.status(500).json({ error: "Failed to add media" });
  }
});

export default router;
