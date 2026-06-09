import { Router } from "express";
import { db } from "@workspace/db";
import { brandingTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router();

async function getOrCreate() {
  const rows = await db.select().from(brandingTable);
  if (rows.length > 0) return rows[0];
  const [row] = await db.insert(brandingTable).values({
    companyName: "ReadyLoq",
    poweredByVisible: true,
  }).returning();
  return row;
}

// GET /branding
router.get("/", async (req, res) => {
  try {
    const row = await getOrCreate();
    res.json({ ...row, updatedAt: row.updatedAt.toISOString() });
  } catch (err) {
    res.status(500).json({ error: "Failed to get branding" });
  }
});

// PATCH /branding
router.patch("/", async (req, res) => {
  try {
    const row = await getOrCreate();
    const updates: Record<string, unknown> = {};
    const fields = ["companyName", "logoUrl", "primaryColor", "accentColor", "tagline", "supportEmail", "supportPhone", "poweredByVisible"];
    for (const f of fields) {
      if (req.body[f] !== undefined) updates[f] = req.body[f];
    }
    updates.updatedAt = new Date();
    const [updated] = await db.update(brandingTable).set(updates).where(eq(brandingTable.id, row.id)).returning();
    res.json({ ...updated, updatedAt: updated.updatedAt.toISOString() });
  } catch (err) {
    res.status(500).json({ error: "Failed to update branding" });
  }
});

export default router;
