import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  brandingProfilesTable,
  insertBrandingProfileSchema,
  READYLOQ_DEFAULT_PROFILE,
  type BrandingProfile,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth, requireRole } from "../middleware/require-auth";

const router: IRouter = Router();

function serialize(row: BrandingProfile) {
  return {
    ...row,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const HEX_COLOR_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
function isValidColor(v: unknown): boolean {
  return v == null || (typeof v === "string" && HEX_COLOR_RE.test(v));
}
/** Returns the name of the first invalid hex color field, or null if all valid. */
function firstInvalidColor(d: {
  primaryColor?: unknown;
  secondaryColor?: unknown;
  accentColor?: unknown;
}): string | null {
  if (!isValidColor(d.primaryColor)) return "primaryColor";
  if (!isValidColor(d.secondaryColor)) return "secondaryColor";
  if (!isValidColor(d.accentColor)) return "accentColor";
  return null;
}

/** Ensure at least the protected ReadyLoq Default profile exists. */
async function ensureSeeded(): Promise<BrandingProfile[]> {
  const rows = await db.select().from(brandingProfilesTable);
  if (rows.length > 0) return rows;
  const [row] = await db
    .insert(brandingProfilesTable)
    .values({ ...READYLOQ_DEFAULT_PROFILE, isDefault: true, isActive: true })
    .returning();
  return [row];
}

async function getActiveProfile(): Promise<BrandingProfile> {
  const rows = await ensureSeeded();
  return rows.find((r) => r.isActive) ?? rows.find((r) => r.isDefault) ?? rows[0];
}

// ── PUBLIC: active profile (for login/landing branding before sign-in) ─────────
router.get("/active", async (_req, res) => {
  try {
    return res.json(serialize(await getActiveProfile()));
  } catch {
    return res.status(500).json({ error: "Failed to get active branding" });
  }
});

// Backward-compatible alias used by report PDF data hook.
router.get("/", async (_req, res) => {
  try {
    return res.json(serialize(await getActiveProfile()));
  } catch {
    return res.status(500).json({ error: "Failed to get branding" });
  }
});

// ── Everything below is manager-only ──────────────────────────────────────────
router.use(requireAuth, requireRole("manager"));

router.get("/profiles", async (_req, res) => {
  try {
    const rows = await ensureSeeded();
    rows.sort((a, b) => a.id - b.id);
    return res.json(rows.map(serialize));
  } catch {
    return res.status(500).json({ error: "Failed to list branding profiles" });
  }
});

router.post("/profiles", async (req, res) => {
  try {
    const validation = insertBrandingProfileSchema.safeParse(req.body);
    if (!validation.success) {
      return res
        .status(400)
        .json({ error: "Invalid request body", issues: validation.error.issues });
    }
    // New profiles can never be the protected default or auto-activate.
    const { isDefault, isActive, ...data } = validation.data;
    const badColor = firstInvalidColor(data);
    if (badColor) {
      return res
        .status(400)
        .json({ error: `Invalid ${badColor}: expected a hex color like #0ea5e9` });
    }
    const [row] = await db
      .insert(brandingProfilesTable)
      .values({ ...data, isDefault: false, isActive: false })
      .returning();
    return res.status(201).json(serialize(row));
  } catch {
    return res.status(500).json({ error: "Failed to create branding profile" });
  }
});

router.get("/profiles/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const [row] = await db
      .select()
      .from(brandingProfilesTable)
      .where(eq(brandingProfilesTable.id, id));
    if (!row) return res.status(404).json({ error: "Profile not found" });
    return res.json(serialize(row));
  } catch {
    return res.status(500).json({ error: "Failed to get branding profile" });
  }
});

router.patch("/profiles/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const validation = insertBrandingProfileSchema.partial().safeParse(req.body);
    if (!validation.success) {
      return res
        .status(400)
        .json({ error: "Invalid request body", issues: validation.error.issues });
    }
    const [existing] = await db
      .select()
      .from(brandingProfilesTable)
      .where(eq(brandingProfilesTable.id, id));
    if (!existing) return res.status(404).json({ error: "Profile not found" });

    // isDefault / isActive are managed via dedicated endpoints, not direct edits.
    const { isDefault, isActive, ...data } = validation.data;
    const badColor = firstInvalidColor(data);
    if (badColor) {
      return res
        .status(400)
        .json({ error: `Invalid ${badColor}: expected a hex color like #0ea5e9` });
    }
    const [updated] = await db
      .update(brandingProfilesTable)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(brandingProfilesTable.id, id))
      .returning();
    return res.json(serialize(updated));
  } catch {
    return res.status(500).json({ error: "Failed to update branding profile" });
  }
});

router.post("/profiles/:id/duplicate", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const [source] = await db
      .select()
      .from(brandingProfilesTable)
      .where(eq(brandingProfilesTable.id, id));
    if (!source) return res.status(404).json({ error: "Profile not found" });

    const { id: _id, createdAt, updatedAt, ...rest } = source;
    const [row] = await db
      .insert(brandingProfilesTable)
      .values({ ...rest, name: `${source.name} (Copy)`, isDefault: false, isActive: false })
      .returning();
    return res.status(201).json(serialize(row));
  } catch {
    return res.status(500).json({ error: "Failed to duplicate branding profile" });
  }
});

router.delete("/profiles/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const [existing] = await db
      .select()
      .from(brandingProfilesTable)
      .where(eq(brandingProfilesTable.id, id));
    if (!existing) return res.status(404).json({ error: "Profile not found" });
    if (existing.isDefault) {
      return res.status(400).json({ error: "The default ReadyLoq profile cannot be deleted" });
    }

    await db.transaction(async (tx) => {
      await tx.delete(brandingProfilesTable).where(eq(brandingProfilesTable.id, id));
      // If we removed the active profile, fall back to the default.
      if (existing.isActive) {
        const [def] = await tx
          .select()
          .from(brandingProfilesTable)
          .where(eq(brandingProfilesTable.isDefault, true));
        if (def) {
          await tx
            .update(brandingProfilesTable)
            .set({ isActive: true })
            .where(eq(brandingProfilesTable.id, def.id));
        }
      }
    });
    return res.status(204).end();
  } catch {
    return res.status(500).json({ error: "Failed to delete branding profile" });
  }
});

router.post("/profiles/:id/activate", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const [target] = await db
      .select()
      .from(brandingProfilesTable)
      .where(eq(brandingProfilesTable.id, id));
    if (!target) return res.status(404).json({ error: "Profile not found" });

    const [updated] = await db.transaction(async (tx) => {
      await tx.update(brandingProfilesTable).set({ isActive: false });
      return tx
        .update(brandingProfilesTable)
        .set({ isActive: true, updatedAt: new Date() })
        .where(eq(brandingProfilesTable.id, id))
        .returning();
    });
    return res.json(serialize(updated));
  } catch {
    return res.status(500).json({ error: "Failed to activate branding profile" });
  }
});

router.post("/restore-defaults", async (_req, res) => {
  try {
    const updated = await db.transaction(async (tx) => {
      await ensureSeeded();
      const [def] = await tx
        .select()
        .from(brandingProfilesTable)
        .where(eq(brandingProfilesTable.isDefault, true));
      // Reset the protected default to canonical ReadyLoq values...
      await tx
        .update(brandingProfilesTable)
        .set({ ...READYLOQ_DEFAULT_PROFILE, isDefault: true, updatedAt: new Date() })
        .where(eq(brandingProfilesTable.id, def.id));
      // ...and make it the active profile.
      await tx.update(brandingProfilesTable).set({ isActive: false });
      const [active] = await tx
        .update(brandingProfilesTable)
        .set({ isActive: true })
        .where(eq(brandingProfilesTable.id, def.id))
        .returning();
      return active;
    });
    return res.json(serialize(updated));
  } catch {
    return res.status(500).json({ error: "Failed to restore defaults" });
  }
});

export default router;
