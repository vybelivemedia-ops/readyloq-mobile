/**
 * Client Portal Routes — read-only access for property managers.
 *
 * Auth model: caller authenticates with Clerk (same instance as company portal).
 * Their clerkUserId is looked up in clientPortalAccessTable to find:
 *   - which company they belong to (companyId)
 *   - which buildings they may view (siteAddresses[])
 *
 * ALL queries are double-scoped by companyId AND siteAddresses to prevent
 * cross-company or cross-building data leakage.
 */

import { Router } from "express";
import { createHash } from "node:crypto";
import { Readable } from "stream";
import { db } from "@workspace/db";
import {
  clientPortalAccessTable,
  inspectionsTable,
  inspectionMediaTable,
  reportsTable,
  analysisResultsTable,
  companiesTable,
  portalMessagesTable,
} from "@workspace/db";
import { eq, and, desc, asc, sql, inArray } from "drizzle-orm";
import { getAuth } from "@clerk/express";
import { z } from "zod";
import { requireCompany, requireRole } from "../middleware/require-auth";
import { buildServerReportHtml, buildFindingImageMap, verifiedReportImages } from "../lib/report-html-server";
import { renderReportPdf } from "../lib/report-pdf";
import { messageBus } from "../lib/message-bus";
import {
  ObjectNotFoundError,
  ObjectStorageService,
  objectPathCompanyScope,
} from "../lib/objectStorage";

const router = Router();
const objectStorageService = new ObjectStorageService();
const clientPhotoMediaTypes = ["photo", "image"];

// ─── Auth helper ──────────────────────────────────────────────────────────────

async function getClientAccess(req: any) {
  const { userId } = getAuth(req);
  if (!userId) return null;

  const [access] = await db
    .select()
    .from(clientPortalAccessTable)
    .where(eq(clientPortalAccessTable.clerkUserId, userId));

  return access ?? null;
}

// ─── GET /client/me ───────────────────────────────────────────────────────────

router.get("/me", async (req, res) => {
  const access = await getClientAccess(req);
  if (!access) return res.status(401).json({ error: "No client portal access" });

  const [company] = await db
    .select({ id: companiesTable.id, name: companiesTable.name, slug: companiesTable.slug })
    .from(companiesTable)
    .where(eq(companiesTable.id, access.companyId));

  return res.json({
    id: access.id,
    label: access.label ?? null,
    email: access.email ?? null,
    siteAddresses: access.siteAddresses,
    company: company ?? null,
    createdAt: access.createdAt.toISOString(),
  });
});

// ─── GET /client/buildings ────────────────────────────────────────────────────

router.get("/buildings", async (req, res) => {
  const access = await getClientAccess(req);
  if (!access) return res.status(401).json({ error: "No client portal access" });

  if (!access.siteAddresses.length) return res.json([]);

  // For each allowed address, aggregate inspection stats.
  const rows = await db.execute(sql`
    SELECT
      site_address                                                            AS "siteAddress",
      count(*)::int                                                           AS "totalInspections",
      count(*) filter (where status = 'completed')::int                      AS "completedInspections",
      max(completed_at)                                                       AS "lastVisitedAt",
      (array_agg(id ORDER BY completed_at DESC NULLS LAST))[1]               AS "lastInspectionId",
      array_agg(DISTINCT pt ORDER BY pt)
        FILTER (where pt IS NOT NULL)                                         AS "pestTypes"
    FROM inspections,
         LATERAL (
           SELECT jsonb_array_elements_text(pest_types) AS pt
           WHERE jsonb_array_length(pest_types) > 0
           UNION ALL
           SELECT NULL::text WHERE jsonb_array_length(pest_types) = 0
         ) pest_unnest
    WHERE company_id = ${access.companyId}
      AND site_address = ANY(${access.siteAddresses}::text[])
    GROUP BY site_address
    ORDER BY max(completed_at) DESC NULLS LAST
  `);

  const buildings = (rows as unknown as Array<{
    siteAddress: string;
    totalInspections: number;
    completedInspections: number;
    lastVisitedAt: Date | null;
    lastInspectionId: number | null;
    pestTypes: string[] | null;
  }>).map((r) => ({
    siteAddress: r.siteAddress,
    totalInspections: r.totalInspections,
    completedInspections: r.completedInspections,
    lastVisitedAt: r.lastVisitedAt?.toISOString() ?? null,
    lastInspectionId: r.lastInspectionId ? Number(r.lastInspectionId) : null,
    pestTypes: (r.pestTypes ?? []).filter(Boolean),
  }));

  return res.json(buildings);
});

// ─── GET /client/buildings/:address/inspections ───────────────────────────────

router.get("/buildings/:address/inspections", async (req, res) => {
  const access = await getClientAccess(req);
  if (!access) return res.status(401).json({ error: "No client portal access" });

  const address = decodeURIComponent(req.params.address);
  if (!access.siteAddresses.includes(address)) {
    return res.status(403).json({ error: "Access denied to this building" });
  }

  const rows = await db
    .select({
      id: inspectionsTable.id,
      status: inspectionsTable.status,
      technicianName: inspectionsTable.technicianName,
      pestTypes: inspectionsTable.pestTypes,
      severity: inspectionsTable.severity,
      findingsCount: inspectionsTable.findingsCount,
      mediaCount: inspectionsTable.mediaCount,
      createdAt: inspectionsTable.createdAt,
      completedAt: inspectionsTable.completedAt,
      signedAt: inspectionsTable.signedAt,
      ownerNotAvailable: inspectionsTable.ownerNotAvailable,
      // Expose presence only — never return the raw SVG signature strings.
      technicianSignature: inspectionsTable.technicianSignature,
      ownerSignature: inspectionsTable.ownerSignature,
    })
    .from(inspectionsTable)
    .where(
      and(
        eq(inspectionsTable.companyId, access.companyId),
        eq(inspectionsTable.siteAddress, address),
      ),
    )
    .orderBy(desc(inspectionsTable.createdAt));

  return res.json(
    // Destructure the raw SVG strings out before spreading so they are never
    // sent over the wire — only boolean presence flags are exposed.
    rows.map(({ technicianSignature, ownerSignature, ...r }) => ({
      ...r,
      pestTypes: r.pestTypes ?? [],
      createdAt: r.createdAt.toISOString(),
      completedAt: r.completedAt?.toISOString() ?? null,
      signedAt: r.signedAt?.toISOString() ?? null,
      ownerNotAvailable: r.ownerNotAvailable,
      technicianSigned: technicianSignature !== null,
      ownerSigned: ownerSignature !== null,
    })),
  );
});

// ─── GET /client/inspections/:inspectionId/media ─────────────────────────────
// Lists photo metadata for an authorized inspection. Storage paths are never
// exposed to clients; each item receives a client-scoped image URL that checks
// access again before it streams the bytes.

router.get("/inspections/:inspectionId/media", async (req, res) => {
  const access = await getClientAccess(req);
  if (!access) return res.status(401).json({ error: "No client portal access" });

  const inspectionId = Number(req.params.inspectionId);
  if (!Number.isInteger(inspectionId) || inspectionId <= 0) {
    return res.status(400).json({ error: "Invalid inspection id" });
  }

  const [inspection] = await db
    .select({
      id: inspectionsTable.id,
      siteAddress: inspectionsTable.siteAddress,
    })
    .from(inspectionsTable)
    .where(
      and(
        eq(inspectionsTable.id, inspectionId),
        eq(inspectionsTable.companyId, access.companyId),
      ),
    );

  // Keep cross-company inspection IDs indistinguishable from missing IDs.
  if (!inspection) return res.status(404).json({ error: "Inspection not found" });
  if (!access.siteAddresses.includes(inspection.siteAddress)) {
    return res.status(403).json({ error: "Access denied to this building" });
  }

  const mediaRows = await db
    .select({
      id: inspectionMediaTable.id,
      mediaType: inspectionMediaTable.mediaType,
      filename: inspectionMediaTable.filename,
      caption: inspectionMediaTable.caption,
      captureSource: inspectionMediaTable.captureSource,
      qualityScore: inspectionMediaTable.qualityScore,
      zoomSubject: inspectionMediaTable.zoomSubject,
      createdAt: inspectionMediaTable.createdAt,
    })
    .from(inspectionMediaTable)
    .where(
      and(
        eq(inspectionMediaTable.inspectionId, inspection.id),
        eq(inspectionMediaTable.companyId, access.companyId),
        inArray(inspectionMediaTable.mediaType, clientPhotoMediaTypes),
      ),
    )
    .orderBy(asc(inspectionMediaTable.createdAt));

  return res.json(
    mediaRows.map((media) => ({
      id: media.id,
      mediaType: media.mediaType,
      filename: media.filename,
      caption: media.caption,
      captureSource: media.captureSource,
      qualityScore: media.qualityScore,
      zoomSubject: media.zoomSubject,
      capturedAt: media.createdAt.toISOString(),
      imageUrl: `/client/inspections/${inspection.id}/media/${media.id}`,
    })),
  );
});

// ─── GET /client/inspections/:inspectionId/media/:mediaId ───────────────────
// Streams a single evidence image after re-authorizing the inspection and
// building. This is intentionally separate from /storage/objects, which is
// restricted to internal company users rather than external property managers.

router.get("/inspections/:inspectionId/media/:mediaId", async (req, res): Promise<void> => {
  const access = await getClientAccess(req);
  if (!access) {
    res.status(401).json({ error: "No client portal access" });
    return;
  }

  const inspectionId = Number(req.params.inspectionId);
  const mediaId = Number(req.params.mediaId);
  if (
    !Number.isInteger(inspectionId) ||
    inspectionId <= 0 ||
    !Number.isInteger(mediaId) ||
    mediaId <= 0
  ) {
    res.status(400).json({ error: "Invalid evidence id" });
    return;
  }

  const [inspection] = await db
    .select({
      id: inspectionsTable.id,
      siteAddress: inspectionsTable.siteAddress,
    })
    .from(inspectionsTable)
    .where(
      and(
        eq(inspectionsTable.id, inspectionId),
        eq(inspectionsTable.companyId, access.companyId),
      ),
    );

  if (!inspection) {
    res.status(404).json({ error: "Evidence not found" });
    return;
  }
  if (!access.siteAddresses.includes(inspection.siteAddress)) {
    res.status(403).json({ error: "Access denied to this building" });
    return;
  }

  const [media] = await db
    .select({ url: inspectionMediaTable.url })
    .from(inspectionMediaTable)
    .where(
      and(
        eq(inspectionMediaTable.id, mediaId),
        eq(inspectionMediaTable.inspectionId, inspection.id),
        eq(inspectionMediaTable.companyId, access.companyId),
        inArray(inspectionMediaTable.mediaType, clientPhotoMediaTypes),
      ),
    );

  if (!media) {
    res.status(404).json({ error: "Evidence not found" });
    return;
  }

  // Old clients sometimes persisted a display path (/api/storage/objects/…).
  // Normalize both display and canonical storage forms before verifying tenant
  // ownership and reading the private object.
  const storagePath = objectStorageService
    .normalizeObjectEntityPath(media.url)
    .replace(/^\/api\/storage/, "");
  if (objectPathCompanyScope(storagePath) !== access.companyId) {
    res.status(404).json({ error: "Evidence not found" });
    return;
  }

  try {
    const objectFile = await objectStorageService.getObjectEntityFile(storagePath);
    const response = await objectStorageService.downloadObject(objectFile);

    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));
    // Authorization can be revoked at any time, so a browser must re-check
    // the client-scoped route before every evidence view.
    res.setHeader("Cache-Control", "private, no-store");

    if (response.body) {
      Readable.fromWeb(response.body as ReadableStream<Uint8Array>).pipe(res);
    } else {
      res.end();
    }
    return;
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      res.status(404).json({ error: "Evidence not found" });
      return;
    }
    req.log.error({ err: error }, "Error serving client evidence");
    res.status(500).json({ error: "Failed to load evidence" });
    return;
  }
});

// ─── GET /client/buildings/:address/reports ───────────────────────────────────

router.get("/buildings/:address/reports", async (req, res) => {
  const access = await getClientAccess(req);
  if (!access) return res.status(401).json({ error: "No client portal access" });

  const address = decodeURIComponent(req.params.address);
  if (!access.siteAddresses.includes(address)) {
    return res.status(403).json({ error: "Access denied to this building" });
  }

  const rows = await db
    .select({
      id: reportsTable.id,
      inspectionId: reportsTable.inspectionId,
      title: reportsTable.title,
      status: reportsTable.status,
      severity: reportsTable.severity,
      technicianName: reportsTable.technicianName,
      inspectionDate: reportsTable.inspectionDate,
      pdfUrl: reportsTable.pdfUrl,
      exclusionOpportunities: reportsTable.exclusionOpportunities,
      createdAt: reportsTable.createdAt,
    })
    .from(reportsTable)
    .where(
      and(
        eq(reportsTable.companyId, access.companyId),
        eq(reportsTable.siteAddress, address),
        eq(reportsTable.status, "approved"), // clients only see approved reports
      ),
    )
    .orderBy(desc(reportsTable.createdAt));

  return res.json(
    rows.map((r) => ({
      ...r,
      // Do not expose the company-user HTML URL or a private object path to
      // customers. A report without a generated PDF needs the generate action.
      pdfUrl: r.pdfUrl?.startsWith(`/objects/companies/${access.companyId}/reports/${r.id}/`)
        ? `/api/client/reports/${r.id}/pdf`
        : null,
      exclusionOpportunities: Array.isArray(r.exclusionOpportunities)
        ? (r.exclusionOpportunities as string[])
        : [],
      createdAt: r.createdAt.toISOString(),
    })),
  );
});

// ─── GET /client/buildings/:address/trends ────────────────────────────────────

router.get("/buildings/:address/trends", async (req, res) => {
  const access = await getClientAccess(req);
  if (!access) return res.status(401).json({ error: "No client portal access" });

  const address = decodeURIComponent(req.params.address);
  if (!access.siteAddresses.includes(address)) {
    return res.status(403).json({ error: "Access denied to this building" });
  }

  const twelveMonthsAgo = new Date();
  twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);

  // Monthly pest-type counts for the last 12 months.
  const rows = await db.execute(sql`
    SELECT
      to_char(date_trunc('month', completed_at), 'YYYY-MM') AS "month",
      pt                                                      AS "pestType",
      count(*)::int                                           AS "count"
    FROM inspections,
         LATERAL jsonb_array_elements_text(pest_types) AS pt
    WHERE company_id    = ${access.companyId}
      AND site_address  = ${address}
      AND status        = 'completed'
      AND completed_at >= ${twelveMonthsAgo}
      AND jsonb_array_length(pest_types) > 0
    GROUP BY 1, 2
    ORDER BY 1, 3 DESC
  `);

  // Also pull monthly inspection counts (even those with no pest types).
  const countRows = await db.execute(sql`
    SELECT
      to_char(date_trunc('month', completed_at), 'YYYY-MM') AS "month",
      count(*)::int                                           AS "inspections"
    FROM inspections
    WHERE company_id    = ${access.companyId}
      AND site_address  = ${address}
      AND status        = 'completed'
      AND completed_at >= ${twelveMonthsAgo}
    GROUP BY 1
    ORDER BY 1
  `);

  return res.json({
    pestTrends: rows,
    inspectionCounts: countRows,
  });
});

// ─── GET /client/reports/:id/html ────────────────────────────────────────────
// Returns a standalone print-ready HTML page. Scoped by clientPortalAccessTable:
// the caller must have access to the report's building and the report must be approved.

router.get("/reports/:id/html", async (req, res) => {
  const access = await getClientAccess(req);
  if (!access) return res.status(401).send("No client portal access");

  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).send("Invalid id");

  const [report] = await db
    .select()
    .from(reportsTable)
    .where(
      and(
        eq(reportsTable.id, id),
        eq(reportsTable.companyId, access.companyId),
        eq(reportsTable.status, "approved"),
      ),
    );

  if (!report) return res.status(404).send("Report not found");

  if (!access.siteAddresses.includes(report.siteAddress)) {
    return res.status(403).send("Access denied to this building");
  }

  const [inspection] = await db
    .select()
    .from(inspectionsTable)
    .where(
      and(
        eq(inspectionsTable.id, report.inspectionId),
        eq(inspectionsTable.companyId, access.companyId),
      ),
    );

  if (!inspection) return res.status(404).send("Inspection not found");

  const mediaRows = await db
    .select({
      url: inspectionMediaTable.url,
      captureMetadata: inspectionMediaTable.captureMetadata,
    })
    .from(inspectionMediaTable)
    .where(
      and(
        eq(inspectionMediaTable.inspectionId, report.inspectionId),
        eq(inspectionMediaTable.companyId, access.companyId),
        inArray(inspectionMediaTable.mediaType, ["photo", "image"]),
      ),
    );

  // Embed finding evidence photos as base64 data URIs so the HTML document
  // is fully self-contained for printing and offline viewing.  Both canonical
  // imageUrl forms (/objects/… and /api/storage/objects/…) are handled.
  const reportFindings = (report.findings ?? []) as Array<{ imageUrl?: string | null }>;
  const imageDataMap = await buildFindingImageMap(
    verifiedReportImages(access.companyId, mediaRows, reportFindings),
  );

  const html = buildServerReportHtml(report, inspection, mediaRows, imageDataMap);
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "private, no-store");
  return res.send(html);
});

// ─── POST /client/reports/:id/pdf ────────────────────────────────────────────
// Generate an actual PDF from the approved report snapshot and every evidence
// photo, verify its object bytes, then publish the private path. Customer access
// is checked again on the GET that serves the exact generated object.

function reportPdfSourceHash(
  report: typeof reportsTable.$inferSelect,
  inspection: typeof inspectionsTable.$inferSelect,
  media: Array<typeof inspectionMediaTable.$inferSelect>,
  analysis: { id: number; status: string },
): string {
  // pdfUrl itself changes when a PDF is stored; it cannot be part of its own
  // source fingerprint. Sorting media makes the hash independent of DB row order.
  const { pdfUrl: _storedPdf, ...reportSnapshot } = report;
  return createHash("sha256").update(JSON.stringify({
    report: reportSnapshot,
    inspection,
    media: [...media].sort((a, b) => a.id - b.id),
    analysis,
  })).digest("hex");
}

router.post("/reports/:id/pdf", async (req, res) => {
  const access = await getClientAccess(req);
  if (!access) return res.status(401).json({ error: "No client portal access" });

  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });

  const [report] = await db
    .select()
    .from(reportsTable)
    .where(
      and(
        eq(reportsTable.id, id),
        eq(reportsTable.companyId, access.companyId),
        eq(reportsTable.status, "approved"),
      ),
    );

  if (!report) return res.status(404).json({ error: "Report not found" });

  if (!access.siteAddresses.includes(report.siteAddress)) {
    return res.status(403).json({ error: "Access denied to this building" });
  }

  const [inspection] = await db.select().from(inspectionsTable).where(and(
    eq(inspectionsTable.id, report.inspectionId),
    eq(inspectionsTable.companyId, access.companyId),
  ));
  if (!inspection || inspection.status !== "completed") {
    return res.status(409).json({ error: "Inspection is not complete; report PDF cannot be generated" });
  }
  const [analysis] = await db.select({ id: analysisResultsTable.id, status: analysisResultsTable.status })
    .from(analysisResultsTable)
    .where(and(
      eq(analysisResultsTable.inspectionId, inspection.id),
      eq(analysisResultsTable.companyId, access.companyId),
    ))
    .orderBy(desc(analysisResultsTable.createdAt))
    .limit(1);
  if (analysis?.status !== "complete") {
    return res.status(409).json({ error: "Inspection analysis is not complete; report PDF cannot be generated" });
  }

  try {
    const mediaRows = await db.select().from(inspectionMediaTable).where(and(
      eq(inspectionMediaTable.inspectionId, inspection.id),
      eq(inspectionMediaTable.companyId, access.companyId),
      inArray(inspectionMediaTable.mediaType, clientPhotoMediaTypes),
    ));
    const imageDataMap = await buildFindingImageMap(
      verifiedReportImages(access.companyId, mediaRows, report.findings ?? []),
    );
    const pdf = await renderReportPdf(report, inspection, mediaRows, imageDataMap);
    const sourceHash = reportPdfSourceHash(report, inspection, mediaRows, analysis);
    const objectPath = await objectStorageService.uploadReportPdf(access.companyId, id, pdf, sourceHash);
    const [published] = await db.update(reportsTable).set({ pdfUrl: objectPath }).where(and(
      eq(reportsTable.id, id),
      eq(reportsTable.companyId, access.companyId),
      eq(reportsTable.status, "approved"),
    )).returning({ id: reportsTable.id });
    if (!published) return res.status(409).json({ error: "Report approval changed during generation" });
    res.setHeader("Cache-Control", "private, no-store");
    return res.json({
      pdfUrl: `/api/client/reports/${id}/pdf?artifact=${encodeURIComponent(objectPath.split("/").at(-1)!)}`,
      byteSize: pdf.length,
    });
  } catch (error) {
    req.log?.error({ err: error, reportId: id }, "Failed to generate or store customer report PDF");
    return res.status(503).json({ error: "Report PDF is unavailable; no incomplete PDF was delivered" });
  }
});

router.get("/reports/:id/pdf", async (req, res) => {
  const access = await getClientAccess(req);
  if (!access) return res.status(401).send("No client portal access");
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) return res.status(400).send("Invalid id");
  const [report] = await db.select().from(reportsTable).where(and(
    eq(reportsTable.id, id),
    eq(reportsTable.companyId, access.companyId),
    eq(reportsTable.status, "approved"),
  ));
  if (!report) return res.status(404).send("Report not found");
  if (!access.siteAddresses.includes(report.siteAddress)) return res.status(403).send("Access denied to this building");

  const prefix = `/objects/companies/${access.companyId}/reports/${id}/`;
  if (!report.pdfUrl?.startsWith(prefix)) {
    return res.status(409).send("PDF not generated; use Download PDF first");
  }
  const [inspection] = await db.select().from(inspectionsTable).where(and(
    eq(inspectionsTable.id, report.inspectionId),
    eq(inspectionsTable.companyId, access.companyId),
  ));
  const [analysis] = await db.select({ id: analysisResultsTable.id, status: analysisResultsTable.status })
    .from(analysisResultsTable).where(and(
      eq(analysisResultsTable.inspectionId, report.inspectionId),
      eq(analysisResultsTable.companyId, access.companyId),
    )).orderBy(desc(analysisResultsTable.createdAt)).limit(1);
  if (!inspection || inspection.status !== "completed" || analysis?.status !== "complete") {
    return res.status(409).send("Report source is no longer complete; regenerate the PDF");
  }
  const mediaRows = await db.select().from(inspectionMediaTable).where(and(
    eq(inspectionMediaTable.inspectionId, inspection.id),
    eq(inspectionMediaTable.companyId, access.companyId),
    inArray(inspectionMediaTable.mediaType, clientPhotoMediaTypes),
  ));
  if (!report.pdfUrl.endsWith(`-${reportPdfSourceHash(report, inspection, mediaRows, analysis)}.pdf`)) {
    return res.status(409).send("Report source changed; regenerate the PDF");
  }
  const artifact = req.query.artifact;
  if (typeof artifact === "string" && artifact !== report.pdfUrl.slice(prefix.length)) {
    return res.status(409).send("Report was regenerated; download the latest PDF");
  }
  try {
    const bytes = await objectStorageService.downloadReportPdf(access.companyId, id, report.pdfUrl);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="readyloq-report-${id}.pdf"`);
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    return res.send(bytes);
  } catch (error) {
    req.log?.error({ err: error, reportId: id }, "Customer report PDF missing or invalid in storage");
    return res.status(503).send("Report PDF is unavailable; please regenerate it");
  }
});

// ─── GET /client/reports/:id ──────────────────────────────────────────────────

router.get("/reports/:id", async (req, res) => {
  const access = await getClientAccess(req);
  if (!access) return res.status(401).json({ error: "No client portal access" });

  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });

  const [report] = await db
    .select()
    .from(reportsTable)
    .where(
      and(
        eq(reportsTable.id, id),
        eq(reportsTable.companyId, access.companyId),
        eq(reportsTable.status, "approved"),
      ),
    );

  if (!report) return res.status(404).json({ error: "Report not found" });

  // Verify the building is in this property manager's access list.
  if (!access.siteAddresses.includes(report.siteAddress)) {
    return res.status(403).json({ error: "Access denied to this building" });
  }

  return res.json({
    ...report,
    pdfUrl: report.pdfUrl?.startsWith(`/objects/companies/${access.companyId}/reports/${id}/`)
      ? `/api/client/reports/${id}/pdf`
      : null,
    findings: Array.isArray(report.findings) ? report.findings : [],
    recommendations: Array.isArray(report.recommendations) ? report.recommendations : [],
    exclusionOpportunities: Array.isArray(report.exclusionOpportunities)
      ? report.exclusionOpportunities
      : [],
    createdAt: report.createdAt.toISOString(),
  });
});

// ─── Manager-side: grant / revoke / list client access ───────────────────────

const grantSchema = z.object({
  clerkUserId: z.string().min(1),
  email: z.string().email().optional(),
  label: z.string().optional(),
  siteAddresses: z.array(z.string().min(1)).min(1),
});

/** POST /client/invites — manager grants a property manager access */
router.post("/invites", requireCompany, requireRole("manager"), async (req, res) => {
  // requireRole("manager") is applied at the router level in index.ts
  const companyId: number = (req as any).user?.companyId;
  if (!companyId) return res.status(401).json({ error: "Unauthorized" });

  const parse = grantSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ error: "Invalid request", details: parse.error.issues });
  }

  const { clerkUserId, email, label, siteAddresses } = parse.data;

  // Upsert: if the user already has access, extend their siteAddresses.
  const [existing] = await db
    .select()
    .from(clientPortalAccessTable)
    .where(
      and(
        eq(clientPortalAccessTable.companyId, companyId),
        eq(clientPortalAccessTable.clerkUserId, clerkUserId),
      ),
    );

  if (existing) {
    const merged = Array.from(new Set([...existing.siteAddresses, ...siteAddresses]));
    const [updated] = await db
      .update(clientPortalAccessTable)
      .set({ siteAddresses: merged, label: label ?? existing.label, email: email ?? existing.email })
      .where(eq(clientPortalAccessTable.id, existing.id))
      .returning();
    return res.json({ ...updated, createdAt: updated.createdAt.toISOString() });
  }

  const [created] = await db
    .insert(clientPortalAccessTable)
    .values({
      companyId,
      clerkUserId,
      email: email ?? null,
      label: label ?? null,
      siteAddresses,
      grantedByUserId: (req as any).user?.id ?? null,
    })
    .returning();

  return res.status(201).json({ ...created, createdAt: created.createdAt.toISOString() });
});

/** GET /client/invites — list all property manager accesses for this company */
router.get("/invites", requireCompany, requireRole("manager"), async (req, res) => {
  const companyId: number = (req as any).user?.companyId;
  if (!companyId) return res.status(401).json({ error: "Unauthorized" });

  const rows = await db
    .select()
    .from(clientPortalAccessTable)
    .where(eq(clientPortalAccessTable.companyId, companyId))
    .orderBy(desc(clientPortalAccessTable.createdAt));

  return res.json(rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })));
});

/** DELETE /client/invites/:id — revoke access */
router.delete("/invites/:id", requireCompany, requireRole("manager"), async (req, res) => {
  const companyId: number = (req as any).user?.companyId;
  if (!companyId) return res.status(401).json({ error: "Unauthorized" });

  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: "Invalid id" });

  const [deleted] = await db
    .delete(clientPortalAccessTable)
    .where(
      and(
        eq(clientPortalAccessTable.id, id),
        eq(clientPortalAccessTable.companyId, companyId),
      ),
    )
    .returning();

  if (!deleted) return res.status(404).json({ error: "Access record not found" });
  return res.status(204).send();
});

// ─── GET /client/buildings/:address/messages ──────────────────────────────────

router.get("/buildings/:address/messages", async (req, res) => {
  const access = await getClientAccess(req);
  if (!access) return res.status(401).json({ error: "No client portal access" });

  const address = decodeURIComponent(req.params.address);
  if (!access.siteAddresses.includes(address)) {
    return res.status(403).json({ error: "Access denied to this building" });
  }

  const rows = await db
    .select()
    .from(portalMessagesTable)
    .where(
      and(
        eq(portalMessagesTable.companyId, access.companyId),
        eq(portalMessagesTable.siteAddress, address),
      ),
    )
    .orderBy(asc(portalMessagesTable.createdAt))
    .limit(100);

  return res.json(rows.map((m) => ({ ...m, createdAt: m.createdAt.toISOString() })));
});

// ─── POST /client/buildings/:address/messages ─────────────────────────────────

const clientMessageSchema = z.object({ message: z.string().min(1).max(2000) });

router.post("/buildings/:address/messages", async (req, res) => {
  const access = await getClientAccess(req);
  if (!access) return res.status(401).json({ error: "No client portal access" });

  const address = decodeURIComponent(req.params.address);
  if (!access.siteAddresses.includes(address)) {
    return res.status(403).json({ error: "Access denied to this building" });
  }

  const { userId } = getAuth(req);
  const body = clientMessageSchema.safeParse(req.body);
  if (!body.success) return res.status(400).json({ error: "Invalid message" });

  const [msg] = await db
    .insert(portalMessagesTable)
    .values({
      companyId: access.companyId,
      siteAddress: address,
      senderType: "client",
      senderClerkId: userId!,
      senderName: access.label ?? access.email ?? null,
      message: body.data.message,
    })
    .returning();

  messageBus.publish(msg);

  return res.status(201).json({ ...msg, createdAt: msg.createdAt.toISOString() });
});

// ─── GET /client/buildings/:address/messages/stream (SSE) ────────────────────

router.get("/buildings/:address/messages/stream", async (req, res) => {
  const access = await getClientAccess(req);
  if (!access) { res.status(401).end(); return; }

  const address = decodeURIComponent(req.params.address);
  if (!access.siteAddresses.includes(address)) { res.status(403).end(); return; }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // disable Replit proxy / nginx buffering
  res.flushHeaders();

  // Heartbeat keeps the TCP connection alive through proxies (25 s < typical 30 s timeout).
  const heartbeat = setInterval(() => res.write(": ping\n\n"), 25_000);

  const unsubscribe = messageBus.subscribe(access.companyId, address, (msg) => {
    res.write(`data: ${JSON.stringify({ ...msg, createdAt: msg.createdAt.toISOString() })}\n\n`);
  });

  req.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
});

export default router;
