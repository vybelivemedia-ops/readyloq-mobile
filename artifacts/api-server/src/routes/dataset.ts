import { Router } from "express";
import { db } from "@workspace/db";
import { datasetImagesTable } from "@workspace/db";
import { desc, ilike, eq, or } from "drizzle-orm";

const router = Router();

const CATEGORY_LABELS: Record<string, string> = {
  pest_activity: "Pest Activity",
  exclusion: "Exclusion Issues",
  sanitation: "Sanitation Concerns",
  moisture: "Moisture Conditions",
  structural: "Structural Deficiencies",
};

// GET /dataset
router.get("/", async (req, res) => {
  try {
    const { category, pestType, search, page = "1", limit = "20" } = req.query as Record<string, string>;
    const pageNum = Math.max(1, parseInt(page));
    const limitNum = Math.min(50, parseInt(limit));
    const offset = (pageNum - 1) * limitNum;

    let rows = await db.select().from(datasetImagesTable).orderBy(desc(datasetImagesTable.createdAt));

    if (category) rows = rows.filter(r => r.category === category);
    if (pestType) rows = rows.filter(r => r.pestType.toLowerCase().includes(pestType.toLowerCase()));
    if (search) {
      const s = search.toLowerCase();
      rows = rows.filter(r =>
        r.title.toLowerCase().includes(s) ||
        (r.description ?? "").toLowerCase().includes(s) ||
        r.pestType.toLowerCase().includes(s) ||
        (r.tags as string[]).some(t => t.toLowerCase().includes(s))
      );
    }

    const total = rows.length;
    const items = rows.slice(offset, offset + limitNum).map(r => ({
      ...r,
      tags: r.tags ?? [],
      createdAt: r.createdAt.toISOString(),
    }));

    res.json({ items, total, page: pageNum, limit: limitNum });
  } catch (err) {
    res.status(500).json({ error: "Failed to list dataset" });
  }
});

// GET /dataset/categories
router.get("/categories", async (req, res) => {
  try {
    const rows = await db.select().from(datasetImagesTable);
    const countMap: Record<string, number> = {};
    for (const r of rows) {
      countMap[r.category] = (countMap[r.category] ?? 0) + 1;
    }
    const cats = Object.entries(CATEGORY_LABELS).map(([slug, name]) => ({
      slug,
      name,
      count: countMap[slug] ?? 0,
      icon: null,
    }));
    res.json(cats);
  } catch (err) {
    res.status(500).json({ error: "Failed to list categories" });
  }
});

export default router;
