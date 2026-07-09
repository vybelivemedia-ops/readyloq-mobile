import { Router, type IRouter } from "express";
import { randomBytes } from "node:crypto";
import { db } from "@workspace/db";
import {
  usersTable,
  companiesTable,
  companyInvitesTable,
  brandingProfilesTable,
  READYLOQ_DEFAULT_PROFILE,
  type CompanyInvite,
  type UserRole,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { requireAuth, requireRole, requireCompany } from "../middleware/require-auth";

const router: IRouter = Router();

// Roles a manager/owner is allowed to grant via an invite. Owner is never
// invitable (a company has exactly one owner: whoever created it).
const INVITABLE_ROLES: UserRole[] = ["manager", "sales", "technician"];

function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return base || "company";
}

/** Pick a slug derived from `name` that is not already taken. */
async function uniqueSlug(name: string): Promise<string> {
  const base = slugify(name);
  for (let attempt = 0; attempt < 5; attempt++) {
    const candidate = attempt === 0 ? base : `${base}-${randomBytes(3).toString("hex")}`;
    const [existing] = await db
      .select({ id: companiesTable.id })
      .from(companiesTable)
      .where(eq(companiesTable.slug, candidate));
    if (!existing) return candidate;
  }
  return `${base}-${randomBytes(6).toString("hex")}`;
}

function serializeInvite(row: CompanyInvite) {
  return {
    id: row.id,
    companyId: row.companyId,
    token: row.token,
    email: row.email,
    role: row.role,
    createdByUserId: row.createdByUserId,
    acceptedByUserId: row.acceptedByUserId,
    expiresAt: row.expiresAt ? row.expiresAt.toISOString() : null,
    acceptedAt: row.acceptedAt ? row.acceptedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

// ── GET /me ───────────────────────────────────────────────────────────────────
router.get("/me", requireAuth, async (req, res) => {
  const user = req.user!;
  try {
    let company = null;
    if (user.companyId != null) {
      const [row] = await db
        .select()
        .from(companiesTable)
        .where(eq(companiesTable.id, user.companyId));
      if (row) company = { id: row.id, name: row.name, slug: row.slug };
    }
    return res.json({
      id: user.id,
      clerkUserId: user.clerkUserId,
      role: user.role,
      companyId: user.companyId,
      betaAccess: user.betaAccess,
      company,
    });
  } catch {
    return res.status(500).json({ error: "Failed to load user" });
  }
});

// ── POST /company — create a company; caller becomes its owner ──────────────────
router.post("/company", requireAuth, async (req, res) => {
  const user = req.user!;
  if (user.companyId != null) {
    return res.status(409).json({ error: "You already belong to a company", code: "has_company" });
  }
  const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
  if (!name) return res.status(400).json({ error: "Company name is required" });
  if (name.length > 120) return res.status(400).json({ error: "Company name is too long" });

  try {
    const slug = await uniqueSlug(name);
    const company = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(companiesTable)
        .values({ name, slug })
        .returning();
      await tx
        .update(usersTable)
        .set({ companyId: created.id, role: "owner" })
        .where(eq(usersTable.id, user.id));
      // Seed a per-company default branding profile (active + protected default).
      await tx.insert(brandingProfilesTable).values({
        ...READYLOQ_DEFAULT_PROFILE,
        name: "Default",
        companyName: name,
        companyId: created.id,
        isDefault: true,
        isActive: true,
      });
      return created;
    });
    // Reflect the new membership on the in-flight request object.
    req.user!.companyId = company.id;
    req.user!.role = "owner";
    return res.status(201).json({ id: company.id, name: company.name, slug: company.slug });
  } catch {
    return res.status(500).json({ error: "Failed to create company" });
  }
});

// ── GET /company/members — manager+ ────────────────────────────────────────────
router.get(
  "/company/members",
  requireAuth,
  requireCompany,
  requireRole("manager"),
  async (req, res) => {
    try {
      const members = await db
        .select({
          id: usersTable.id,
          role: usersTable.role,
          clerkUserId: usersTable.clerkUserId,
          createdAt: usersTable.createdAt,
        })
        .from(usersTable)
        .where(eq(usersTable.companyId, req.user!.companyId!));
      return res.json(
        members.map((m) => ({
          id: m.id,
          role: m.role,
          clerkUserId: m.clerkUserId,
          createdAt: m.createdAt.toISOString(),
        })),
      );
    } catch {
      return res.status(500).json({ error: "Failed to list members" });
    }
  },
);

// ── Invites (manager+) ─────────────────────────────────────────────────────────
router.post(
  "/invites",
  requireAuth,
  requireCompany,
  requireRole("manager"),
  async (req, res) => {
    const role: UserRole = req.body?.role ?? "technician";
    if (!INVITABLE_ROLES.includes(role)) {
      return res.status(400).json({ error: "Invalid role for invite" });
    }
    const email =
      typeof req.body?.email === "string" && req.body.email.trim()
        ? req.body.email.trim()
        : null;
    try {
      const token = randomBytes(24).toString("hex");
      const expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000); // 14 days
      const [invite] = await db
        .insert(companyInvitesTable)
        .values({
          companyId: req.user!.companyId!,
          token,
          role,
          email,
          createdByUserId: req.user!.id,
          expiresAt,
        })
        .returning();
      return res.status(201).json(serializeInvite(invite));
    } catch {
      return res.status(500).json({ error: "Failed to create invite" });
    }
  },
);

router.get(
  "/invites",
  requireAuth,
  requireCompany,
  requireRole("manager"),
  async (req, res) => {
    try {
      const invites = await db
        .select()
        .from(companyInvitesTable)
        .where(eq(companyInvitesTable.companyId, req.user!.companyId!));
      invites.sort((a, b) => b.id - a.id);
      return res.json(invites.map(serializeInvite));
    } catch {
      return res.status(500).json({ error: "Failed to list invites" });
    }
  },
);

// ── POST /accept-invite — join a company via token ─────────────────────────────
router.post("/accept-invite", requireAuth, async (req, res) => {
  const user = req.user!;
  if (user.companyId != null) {
    return res.status(409).json({ error: "You already belong to a company", code: "has_company" });
  }
  const token = typeof req.body?.token === "string" ? req.body.token.trim() : "";
  if (!token) return res.status(400).json({ error: "Invite token is required" });

  try {
    const [invite] = await db
      .select()
      .from(companyInvitesTable)
      .where(eq(companyInvitesTable.token, token));
    if (!invite) return res.status(404).json({ error: "Invalid invite", code: "invalid_invite" });
    if (invite.acceptedByUserId != null) {
      return res.status(409).json({ error: "Invite already used", code: "invite_used" });
    }
    if (invite.expiresAt && invite.expiresAt.getTime() < Date.now()) {
      return res.status(410).json({ error: "Invite expired", code: "invite_expired" });
    }

    await db.transaction(async (tx) => {
      await tx
        .update(usersTable)
        .set({ companyId: invite.companyId, role: invite.role })
        .where(eq(usersTable.id, user.id));
      // Guard against a race: only consume the invite if still unaccepted.
      await tx
        .update(companyInvitesTable)
        .set({ acceptedByUserId: user.id, acceptedAt: new Date() })
        .where(
          and(
            eq(companyInvitesTable.id, invite.id),
            eq(companyInvitesTable.token, token),
          ),
        );
    });
    req.user!.companyId = invite.companyId;
    req.user!.role = invite.role;
    return res.json({ companyId: invite.companyId, role: invite.role });
  } catch {
    return res.status(500).json({ error: "Failed to accept invite" });
  }
});

export default router;
