import { randomBytes } from "node:crypto";
import { Router, type IRouter } from "express";
import {
  db,
  customerSummariesTable,
  inspectionsTable,
  analysisResultsTable,
} from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { getCompanyId } from "../lib/tenant";
import {
  generateCustomerSummaryBody,
  SummaryFidelityError,
} from "../lib/customer-summary-ai";
import { logErrorEvent } from "../lib/error-events";

/**
 * Customer Summaries — the ONLY artifact that can ever leave the company.
 *
 * SECURITY: mounted behind `requireAuth + requireCompany +
 * requireRole("manager")` (see routes/index.ts). Nothing here is customer-
 * facing until a manager explicitly approves; approval freezes the body and
 * mints an expiring, unguessable share token served by the separate PUBLIC
 * share route (routes/share.ts) — which never includes photos.
 *
 * Lifecycle: generate (draft) → edit (draft only) → approve (freeze + token)
 * → optionally revoke the share link. Regeneration is blocked once approved.
 */

const router: IRouter = Router();

const SHARE_DEFAULT_DAYS = 30;
const SHARE_MAX_DAYS = 90;

function serialize(row: typeof customerSummariesTable.$inferSelect) {
  return {
    ...row,
    approvedAt: row.approvedAt ? row.approvedAt.toISOString() : null,
    shareExpiresAt: row.shareExpiresAt ? row.shareExpiresAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// GET /customer-summaries/inspection/:inspectionId
router.get("/inspection/:inspectionId", async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const inspectionId = parseInt(req.params.inspectionId);
    if (Number.isNaN(inspectionId)) return res.status(400).json({ error: "Invalid id" });

    const [row] = await db
      .select()
      .from(customerSummariesTable)
      .where(
        and(
          eq(customerSummariesTable.inspectionId, inspectionId),
          eq(customerSummariesTable.companyId, companyId),
        ),
      )
      .limit(1);
    if (!row) return res.status(404).json({ error: "No summary for this inspection" });
    return res.json(serialize(row));
  } catch {
    return res.status(500).json({ error: "Failed to load summary" });
  }
});

// POST /customer-summaries/inspection/:inspectionId/generate — create or
// regenerate the DRAFT from the inspection's latest verified analysis.
router.post("/inspection/:inspectionId/generate", async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const inspectionId = parseInt(req.params.inspectionId);
    if (Number.isNaN(inspectionId)) return res.status(400).json({ error: "Invalid id" });

    const [inspection] = await db
      .select()
      .from(inspectionsTable)
      .where(
        and(eq(inspectionsTable.id, inspectionId), eq(inspectionsTable.companyId, companyId)),
      )
      .limit(1);
    if (!inspection) return res.status(404).json({ error: "Inspection not found" });

    const [existing] = await db
      .select()
      .from(customerSummariesTable)
      .where(
        and(
          eq(customerSummariesTable.inspectionId, inspectionId),
          eq(customerSummariesTable.companyId, companyId),
        ),
      )
      .limit(1);
    if (existing && existing.status === "approved") {
      return res
        .status(409)
        .json({ error: "Summary is approved and frozen — it can no longer be regenerated" });
    }

    // Latest analysis run is the source of truth for what the summary may say.
    const [analysis] = await db
      .select()
      .from(analysisResultsTable)
      .where(
        and(
          eq(analysisResultsTable.inspectionId, inspectionId),
          eq(analysisResultsTable.companyId, companyId),
        ),
      )
      .orderBy(desc(analysisResultsTable.createdAt))
      .limit(1);
    if (!analysis) {
      return res.status(409).json({ error: "Run the inspection analysis first" });
    }

    let body: string;
    try {
      body = await generateCustomerSummaryBody({
        siteAddress: inspection.siteAddress,
        technicianName: inspection.technicianName,
        inspectionDate: inspection.createdAt,
        findings: analysis.findings ?? [],
        recommendations: analysis.recommendations ?? [],
      });
    } catch (err) {
      if (err instanceof SummaryFidelityError) {
        return res
          .status(422)
          .json({ error: "Generated summary failed the fidelity check — try again" });
      }
      throw err;
    }

    const [row] = existing
      ? await db
          .update(customerSummariesTable)
          .set({ body, updatedAt: new Date() })
          .where(
            and(
              eq(customerSummariesTable.id, existing.id),
              eq(customerSummariesTable.companyId, companyId),
            ),
          )
          .returning()
      : await db
          .insert(customerSummariesTable)
          .values({ companyId, inspectionId, body, status: "draft" })
          .returning();

    return res.status(existing ? 200 : 201).json(serialize(row));
  } catch {
    void logErrorEvent("ai", {
      companyId: req.user?.companyId ?? 0,
      userId: req.user?.id,
      message: "Customer summary generation failed",
      context: { stage: "customer_summary" },
    });
    return res.status(500).json({ error: "Failed to generate summary" });
  }
});

// PATCH /customer-summaries/:id — manager edits the DRAFT body (human final say).
router.patch("/:id", async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const id = parseInt(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid id" });
    const body = typeof req.body?.body === "string" ? req.body.body.trim() : "";
    if (!body) return res.status(400).json({ error: "Summary body is required" });
    if (body.length > 4000) return res.status(400).json({ error: "Summary too long" });

    const [existing] = await db
      .select()
      .from(customerSummariesTable)
      .where(
        and(eq(customerSummariesTable.id, id), eq(customerSummariesTable.companyId, companyId)),
      )
      .limit(1);
    if (!existing) return res.status(404).json({ error: "Summary not found" });
    if (existing.status === "approved") {
      return res.status(409).json({ error: "Approved summaries are frozen" });
    }

    const [row] = await db
      .update(customerSummariesTable)
      .set({ body, updatedAt: new Date() })
      .where(
        and(eq(customerSummariesTable.id, id), eq(customerSummariesTable.companyId, companyId)),
      )
      .returning();
    return res.json(serialize(row));
  } catch {
    return res.status(500).json({ error: "Failed to update summary" });
  }
});

// POST /customer-summaries/:id/approve — freeze the body and mint the share
// token. This is THE gate between company-private and customer-visible.
router.post("/:id/approve", async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const id = parseInt(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid id" });

    const days =
      typeof req.body?.expiresInDays === "number" &&
      Number.isInteger(req.body.expiresInDays) &&
      req.body.expiresInDays >= 1 &&
      req.body.expiresInDays <= SHARE_MAX_DAYS
        ? req.body.expiresInDays
        : SHARE_DEFAULT_DAYS;

    const [existing] = await db
      .select()
      .from(customerSummariesTable)
      .where(
        and(eq(customerSummariesTable.id, id), eq(customerSummariesTable.companyId, companyId)),
      )
      .limit(1);
    if (!existing) return res.status(404).json({ error: "Summary not found" });
    if (existing.status === "approved") {
      return res.status(409).json({ error: "Summary is already approved" });
    }

    const shareToken = randomBytes(32).toString("base64url");
    const [row] = await db
      .update(customerSummariesTable)
      .set({
        status: "approved",
        approvedByUserId: req.user!.id,
        approvedAt: new Date(),
        shareToken,
        shareExpiresAt: new Date(Date.now() + days * 24 * 60 * 60 * 1000),
        updatedAt: new Date(),
      })
      .where(
        and(eq(customerSummariesTable.id, id), eq(customerSummariesTable.companyId, companyId)),
      )
      .returning();
    return res.json(serialize(row));
  } catch {
    return res.status(500).json({ error: "Failed to approve summary" });
  }
});

// POST /customer-summaries/:id/revoke — kill the share link immediately.
// The summary stays approved/frozen; only the public access is withdrawn.
router.post("/:id/revoke", async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const id = parseInt(req.params.id);
    if (Number.isNaN(id)) return res.status(400).json({ error: "Invalid id" });

    const [existing] = await db
      .select()
      .from(customerSummariesTable)
      .where(
        and(eq(customerSummariesTable.id, id), eq(customerSummariesTable.companyId, companyId)),
      )
      .limit(1);
    if (!existing) return res.status(404).json({ error: "Summary not found" });
    if (!existing.shareToken) {
      return res.status(409).json({ error: "Summary has no active share link" });
    }

    const [row] = await db
      .update(customerSummariesTable)
      .set({ shareToken: null, shareExpiresAt: null, updatedAt: new Date() })
      .where(
        and(eq(customerSummariesTable.id, id), eq(customerSummariesTable.companyId, companyId)),
      )
      .returning();
    return res.json(serialize(row));
  } catch {
    return res.status(500).json({ error: "Failed to revoke share link" });
  }
});

export default router;
