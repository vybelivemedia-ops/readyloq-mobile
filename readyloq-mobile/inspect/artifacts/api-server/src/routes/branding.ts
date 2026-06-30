import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  brandingProfilesTable,
  companiesTable,
  insertBrandingProfileSchema,
  READYLOQ_DEFAULT_PROFILE,
  type BrandingProfile,
} from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { requireAuth, requireRole, requireCompany } from "../middleware/require-auth";
import { getCompanyId } from "../lib/tenant";

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

// The reserved "platform" company owns the ReadyLoq default brand served to
// anyone before they sign in. It is self-healing: if the row is missing (e.g. a
// freshly published database that was never seeded), it is created on demand so
// the public pre-login brand endpoint never hard-fails. Cache the resolved id so
// the public endpoint stays cheap.
let platformCompanyIdCache: number | null = null;
async function ensurePlatformCompanyId(): Promise<number> {
  if (platformCompanyIdCache != null) return platformCompanyIdCache;
  const [existing] = await db
    .select()
    .from(companiesTable)
    .where(eq(companiesTable.slug, "platform"));
  if (existing) {
    platformCompanyIdCache = existing.id;
    return existing.id;
  }
  // Create the reserved company on demand, tolerating a concurrent creator via
  // the unique slug constraint, then read back the canonical row.
  await db
    .insert(companiesTable)
    .values({ name: "ReadyLoq Platform", slug: "platform" })
    .onConflictDoNothing({ target: companiesTable.slug });
  const [row] = await db
    .select()
    .from(companiesTable)
    .where(eq(companiesTable.slug, "platform"));
  if (!row) {
    // The insert+reselect should always yield a row; if not, the DB is in an
    // unexpected state — surface it explicitly rather than caching a bad value.
    throw new Error("Failed to bootstrap reserved platform company");
  }
  platformCompanyIdCache = row.id;
  return row.id;
}

// Advisory-lock namespace for serializing first-time per-company branding seeds.
const BRANDING_SEED_LOCK_NAMESPACE = 42891;

/** Ensure the given company has at least a default branding profile. */
async function ensureSeeded(companyId: number): Promise<BrandingProfile[]> {
  const rows = await db
    .select()
    .from(brandingProfilesTable)
    .where(eq(brandingProfilesTable.companyId, companyId));
  if (rows.length > 0) return rows;
  // First-time bootstrap: take a transaction-scoped advisory lock keyed by the
  // company so two concurrent first requests can't each insert a default/active
  // profile (which would violate the "one active default" invariant). The lock
  // is released automatically when the transaction ends.
  return await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(${BRANDING_SEED_LOCK_NAMESPACE}, ${companyId})`,
    );
    const existing = await tx
      .select()
      .from(brandingProfilesTable)
      .where(eq(brandingProfilesTable.companyId, companyId));
    if (existing.length > 0) return existing;
    const [row] = await tx
      .insert(brandingProfilesTable)
      .values({ ...READYLOQ_DEFAULT_PROFILE, companyId, isDefault: true, isActive: true })
      .returning();
    return [row];
  });
}

async function getActiveProfile(companyId: number): Promise<BrandingProfile> {
  const rows = await ensureSeeded(companyId);
  return rows.find((r) => r.isActive) ?? rows.find((r) => r.isDefault) ?? rows[0];
}

// ── PUBLIC: platform active profile (login/landing branding before sign-in) ───
router.get("/active", async (_req, res) => {
  try {
    const platformId = await ensurePlatformCompanyId();
    return res.json(serialize(await getActiveProfile(platformId)));
  } catch {
    return res.status(500).json({ error: "Failed to get active branding" });
  }
});

// Backward-compatible alias used by the report PDF data hook (pre-login brand).
router.get("/", async (_req, res) => {
  try {
    const platformId = await ensurePlatformCompanyId();
    return res.json(serialize(await getActiveProfile(platformId)));
  } catch {
    return res.status(500).json({ error: "Failed to get branding" });
  }
});

// ── AUTHED: the caller's own company active profile (post-login brand) ─────────
router.get("/company", requireAuth, requireCompany, async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    return res.json(serialize(await getActiveProfile(companyId)));
  } catch {
    return res.status(500).json({ error: "Failed to get company branding" });
  }
});

// ── Everything below is manager-only and scoped to the caller's company ───────
router.use(requireAuth, requireCompany, requireRole("manager"));

router.get("/profiles", async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const rows = await ensureSeeded(companyId);
    rows.sort((a, b) => a.id - b.id);
    return res.json(rows.map(serialize));
  } catch {
    return res.status(500).json({ error: "Failed to list branding profiles" });
  }
});

router.post("/profiles", async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const validation = insertBrandingProfileSchema.safeParse(req.body);
    if (!validation.success) {
      return res
        .status(400)
        .json({ error: "Invalid request body", issues: validation.error.issues });
    }
    // New profiles can never be the protected default or auto-activate, and are
    // always stamped with the caller's company.
    const { isDefault, isActive, ...data } = validation.data;
    const badColor = firstInvalidColor(data);
    if (badColor) {
      return res
        .status(400)
        .json({ error: `Invalid ${badColor}: expected a hex color like #0ea5e9` });
    }
    const [row] = await db
      .insert(brandingProfilesTable)
      .values({ ...data, companyId, isDefault: false, isActive: false })
      .returning();
    return res.status(201).json(serialize(row));
  } catch {
    return res.status(500).json({ error: "Failed to create branding profile" });
  }
});

router.get("/profiles/:id", async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const id = Number(req.params.id);
    const [row] = await db
      .select()
      .from(brandingProfilesTable)
      .where(
        and(eq(brandingProfilesTable.id, id), eq(brandingProfilesTable.companyId, companyId)),
      );
    if (!row) return res.status(404).json({ error: "Profile not found" });
    return res.json(serialize(row));
  } catch {
    return res.status(500).json({ error: "Failed to get branding profile" });
  }
});

router.patch("/profiles/:id", async (req, res) => {
  try {
    const companyId = getCompanyId(req);
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
      .where(
        and(eq(brandingProfilesTable.id, id), eq(brandingProfilesTable.companyId, companyId)),
      );
    if (!existing) return res.status(404).json({ error: "Profile not found" });

    // isDefault / isActive are managed via dedicated endpoints, never direct edits;
    // companyId is fixed by the tenant boundary.
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
      .where(
        and(eq(brandingProfilesTable.id, id), eq(brandingProfilesTable.companyId, companyId)),
      )
      .returning();
    return res.json(serialize(updated));
  } catch {
    return res.status(500).json({ error: "Failed to update branding profile" });
  }
});

router.post("/profiles/:id/duplicate", async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const id = Number(req.params.id);
    const [source] = await db
      .select()
      .from(brandingProfilesTable)
      .where(
        and(eq(brandingProfilesTable.id, id), eq(brandingProfilesTable.companyId, companyId)),
      );
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
    const companyId = getCompanyId(req);
    const id = Number(req.params.id);
    const [existing] = await db
      .select()
      .from(brandingProfilesTable)
      .where(
        and(eq(brandingProfilesTable.id, id), eq(brandingProfilesTable.companyId, companyId)),
      );
    if (!existing) return res.status(404).json({ error: "Profile not found" });
    if (existing.isDefault) {
      return res.status(400).json({ error: "The default profile cannot be deleted" });
    }

    await db.transaction(async (tx) => {
      await tx
        .delete(brandingProfilesTable)
        .where(
          and(eq(brandingProfilesTable.id, id), eq(brandingProfilesTable.companyId, companyId)),
        );
      // If we removed the active profile, fall back to the company default.
      if (existing.isActive) {
        const [def] = await tx
          .select()
          .from(brandingProfilesTable)
          .where(
            and(
              eq(brandingProfilesTable.companyId, companyId),
              eq(brandingProfilesTable.isDefault, true),
            ),
          );
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
    const companyId = getCompanyId(req);
    const id = Number(req.params.id);
    const [target] = await db
      .select()
      .from(brandingProfilesTable)
      .where(
        and(eq(brandingProfilesTable.id, id), eq(brandingProfilesTable.companyId, companyId)),
      );
    if (!target) return res.status(404).json({ error: "Profile not found" });

    const [updated] = await db.transaction(async (tx) => {
      // Only deactivate within the caller's company so other tenants are untouched.
      await tx
        .update(brandingProfilesTable)
        .set({ isActive: false })
        .where(eq(brandingProfilesTable.companyId, companyId));
      return tx
        .update(brandingProfilesTable)
        .set({ isActive: true, updatedAt: new Date() })
        .where(
          and(eq(brandingProfilesTable.id, id), eq(brandingProfilesTable.companyId, companyId)),
        )
        .returning();
    });
    return res.json(serialize(updated));
  } catch {
    return res.status(500).json({ error: "Failed to activate branding profile" });
  }
});

router.post("/restore-defaults", async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const updated = await db.transaction(async (tx) => {
      await ensureSeeded(companyId);
      const [def] = await tx
        .select()
        .from(brandingProfilesTable)
        .where(
          and(
            eq(brandingProfilesTable.companyId, companyId),
            eq(brandingProfilesTable.isDefault, true),
          ),
        );
      // Reset the protected default to canonical ReadyLoq values...
      await tx
        .update(brandingProfilesTable)
        .set({ ...READYLOQ_DEFAULT_PROFILE, isDefault: true, updatedAt: new Date() })
        .where(eq(brandingProfilesTable.id, def.id));
      // ...and make it the active profile (within this company only).
      await tx
        .update(brandingProfilesTable)
        .set({ isActive: false })
        .where(eq(brandingProfilesTable.companyId, companyId));
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
