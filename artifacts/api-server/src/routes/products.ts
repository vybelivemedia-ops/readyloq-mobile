/**
 * Chemical product catalogue routes — ReadyLoq
 *
 * GET /products               — list all active products (filterable by pest & site)
 * GET /products/:id           — single product with label rules inline
 * GET /products/:id/label-rules — label rules only (for the compliance wizard)
 *
 * Products are platform-wide (no companyId); all authenticated beta users can
 * read them. No write endpoints — the catalogue is managed via seed data for
 * now (see lib/db/src/seed/products.ts). Task #68 will add admin write access.
 */

import { Router } from "express";
import { db } from "@workspace/db";
import { productsTable, productLabelRulesTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";

const router = Router();

// ─── Serialisers ──────────────────────────────────────────────────────────────

function serializeProduct(
  p: typeof productsTable.$inferSelect,
  lr: typeof productLabelRulesTable.$inferSelect | null,
) {
  return {
    ...p,
    createdAt: p.createdAt.toISOString(),
    labelRules: lr
      ? { ...lr, createdAt: lr.createdAt.toISOString() }
      : null,
  };
}

// ─── GET /products ────────────────────────────────────────────────────────────
//
// Optional query params:
//   ?pest=Rodents                        — filter to products approved for this pest
//   ?site=residential_interior           — filter to products approved for this site
//   ?pest=Ants&site=commercial_exterior  — both filters (AND)
//
// Returns every product joined with its label rules so the mobile quick-pick
// list only needs one request.

router.get("/", async (req, res) => {
  try {
    const pest =
      typeof req.query.pest === "string" && req.query.pest
        ? req.query.pest
        : null;
    const site =
      typeof req.query.site === "string" && req.query.site
        ? req.query.site
        : null;

    const rows = await db
      .select({ product: productsTable, labelRules: productLabelRulesTable })
      .from(productsTable)
      .leftJoin(
        productLabelRulesTable,
        eq(productLabelRulesTable.productId, productsTable.id),
      )
      .where(eq(productsTable.isActive, true));

    // Post-query JS filter for jsonb array membership — the product catalogue
    // is small (tens of rows) so index scanning is overkill here.
    let filtered = rows;
    if (pest) {
      filtered = filtered.filter((r) =>
        r.labelRules?.approvedPestTypes?.includes(pest),
      );
    }
    if (site) {
      filtered = filtered.filter((r) =>
        r.labelRules?.approvedSiteClassifications?.includes(site),
      );
    }

    return res.json(
      filtered.map((r) => serializeProduct(r.product, r.labelRules)),
    );
  } catch {
    return res.status(500).json({ error: "Failed to list products" });
  }
});

// ─── GET /products/:id ────────────────────────────────────────────────────────

router.get("/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (Number.isNaN(id)) {
      return res.status(400).json({ error: "Invalid product ID" });
    }

    const [row] = await db
      .select({ product: productsTable, labelRules: productLabelRulesTable })
      .from(productsTable)
      .leftJoin(
        productLabelRulesTable,
        eq(productLabelRulesTable.productId, productsTable.id),
      )
      .where(and(eq(productsTable.id, id), eq(productsTable.isActive, true)));

    if (!row) return res.status(404).json({ error: "Product not found" });

    return res.json(serializeProduct(row.product, row.labelRules));
  } catch {
    return res.status(500).json({ error: "Failed to get product" });
  }
});

// ─── GET /products/:id/label-rules ────────────────────────────────────────────

router.get("/:id/label-rules", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (Number.isNaN(id)) {
      return res.status(400).json({ error: "Invalid product ID" });
    }

    const [row] = await db
      .select()
      .from(productLabelRulesTable)
      .where(eq(productLabelRulesTable.productId, id));

    if (!row) return res.status(404).json({ error: "Label rules not found" });

    return res.json({ ...row, createdAt: row.createdAt.toISOString() });
  } catch {
    return res.status(500).json({ error: "Failed to get label rules" });
  }
});

export default router;
