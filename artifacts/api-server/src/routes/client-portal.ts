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
import { db } from "@workspace/db";
import {
  clientPortalAccessTable,
  inspectionsTable,
  reportsTable,
  companiesTable,
  portalMessagesTable,
} from "@workspace/db";
import { eq, and, desc, asc, sql } from "drizzle-orm";
import { getAuth } from "@clerk/express";
import { z } from "zod";
import { requireCompany, requireRole } from "../middleware/require-auth";
import { buildServerReportHtml } from "../lib/report-html-server";
import { messageBus } from "../lib/message-bus";

const router = Router();

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
    rows.map((r) => ({
      ...r,
      pestTypes: r.pestTypes ?? [],
      createdAt: r.createdAt.toISOString(),
      completedAt: r.completedAt?.toISOString() ?? null,
    })),
  );
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

  const html = buildServerReportHtml(report, inspection);
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "private, max-age=300");
  return res.send(html);
});

// ─── POST /client/reports/:id/pdf ────────────────────────────────────────────
// Returns a client-scoped, print-ready URL for an approved report.
// The stored pdfUrl on the report record is the internal company-portal route
// which requires company-user auth — property managers cannot access it.
// This endpoint always derives a client-authorized URL so the caller can open
// or print the report without needing company-portal credentials.
// No DB write is performed; the stored pdfUrl field is intentionally untouched.

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

  // Always derive a client-scoped URL — the internal /api/reports/:id/html route
  // requires company-user authentication and is not usable by property managers.
  const baseUrl =
    process.env.PUBLIC_BASE_URL ??
    `https://${process.env.REPLIT_DEV_DOMAIN ?? "localhost"}`;
  const pdfUrl = `${baseUrl}/api/client/reports/${id}/html`;

  return res.json({ pdfUrl });
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
