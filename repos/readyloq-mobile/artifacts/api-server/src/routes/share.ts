import { Router, type IRouter } from "express";
import { db, customerSummariesTable, inspectionsTable, companiesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

/**
 * PUBLIC share routes — the ONLY unauthenticated window into tenant data.
 *
 * Access is capability-based: the URL token (32 random bytes, base64url) IS
 * the credential. Lookup is SOLELY by token — no IDs in the URL, nothing
 * enumerable. Missing, unapproved, revoked, and expired all return the SAME
 * uniform 404 so the response never reveals whether a summary exists.
 *
 * The payload is the minimum a homeowner needs: company name, address, date,
 * and the approved summary text. NO photos (storage stays behind company-
 * scoped ACLs), NO finding details, NO internal IDs.
 */

const router: IRouter = Router();

const NOT_FOUND = { error: "This link is invalid or has expired" };

// GET /share/summary/:token
router.get("/summary/:token", async (req, res) => {
  try {
    const token = req.params.token;
    // Cheap shape check before touching the DB (64+ chars of base64url).
    if (typeof token !== "string" || token.length < 20 || token.length > 128) {
      return res.status(404).json(NOT_FOUND);
    }

    const [row] = await db
      .select({
        body: customerSummariesTable.body,
        status: customerSummariesTable.status,
        approvedAt: customerSummariesTable.approvedAt,
        shareExpiresAt: customerSummariesTable.shareExpiresAt,
        siteAddress: inspectionsTable.siteAddress,
        inspectionDate: inspectionsTable.createdAt,
        companyName: companiesTable.name,
      })
      .from(customerSummariesTable)
      .innerJoin(
        inspectionsTable,
        eq(customerSummariesTable.inspectionId, inspectionsTable.id),
      )
      .innerJoin(companiesTable, eq(customerSummariesTable.companyId, companiesTable.id))
      .where(
        and(
          eq(customerSummariesTable.shareToken, token),
          eq(customerSummariesTable.status, "approved"),
        ),
      )
      .limit(1);

    if (
      !row ||
      !row.shareExpiresAt ||
      row.shareExpiresAt.getTime() < Date.now()
    ) {
      return res.status(404).json(NOT_FOUND);
    }

    return res.json({
      companyName: row.companyName,
      propertyAddress: row.siteAddress,
      inspectionDate: row.inspectionDate.toISOString().slice(0, 10),
      approvedAt: row.approvedAt ? row.approvedAt.toISOString().slice(0, 10) : null,
      summary: row.body,
    });
  } catch {
    // Uniform 404 even on errors — a public endpoint never leaks internals.
    return res.status(404).json(NOT_FOUND);
  }
});

export default router;
