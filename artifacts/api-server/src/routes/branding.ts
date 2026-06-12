import { Router } from "express";
import { db } from "@workspace/db";
import { brandingTable, insertBrandingSchema } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireRole } from "../middleware/require-auth";

const router = Router();

async function getOrCreate() {
  const rows = await db.select().from(brandingTable);
  if (rows.length > 0) return rows[0];
  const [row] = await db
    .insert(brandingTable)
    .values({ companyName: "ReadyLoq", poweredByVisible: true })
    .returning();
  return row;
}

router.get("/", async (_req, res) => {
  try {
    const row = await getOrCreate();
    res.json({ ...row, updatedAt: row.updatedAt.toISOString() });
  } catch {
    res.status(500).json({ error: "Failed to get branding" });
  }
});

router.patch("/", requireRole("manager"), async (req, res) => {
  try {
    const validation = insertBrandingSchema.partial().safeParse(req.body);
    if (!validation.success) {
      return res
        .status(400)
        .json({ error: "Invalid request body", issues: validation.error.issues });
    }
    const row = await getOrCreate();
    const updates: Record<string, unknown> = {
      ...validation.data,
      updatedAt: new Date(),
    };
    const [updated] = await db
      .update(brandingTable)
      .set(updates)
      .where(eq(brandingTable.id, row.id))
      .returning();
    res.json({ ...updated, updatedAt: updated.updatedAt.toISOString() });
  } catch {
    res.status(500).json({ error: "Failed to update branding" });
  }
});

export default router;
