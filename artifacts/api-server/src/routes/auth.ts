import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { randomBytes } from "node:crypto";
import { db } from "@workspace/db";
import {
  usersTable,
  companiesTable,
  companyInvitesTable,
  brandingProfilesTable,
  clientPortalAccessTable,
  READYLOQ_DEFAULT_PROFILE,
  type CompanyInvite,
  type UserRole,
} from "@workspace/db";
import { and, eq, isNull } from "drizzle-orm";
import { getAuth } from "@clerk/express";
import { requireAuth, requireClerkAuth, requireRole, requireCompany, requireSuperAdmin } from "../middleware/require-auth";

const router: IRouter = Router();

// Roles a manager/owner is allowed to grant via an invite. Owner is never
// invitable (a company has exactly one owner: whoever created it).
const INVITABLE_ROLES: UserRole[] = ["manager", "sales", "technician"];

async function requireActiveInviteCompany(req: Request, res: Response, next: NextFunction): Promise<void> {
  const companyIds = new Set<number>();
  if (req.user?.companyId != null) companyIds.add(req.user.companyId);

  const token = typeof req.body?.token === "string" ? req.body.token.trim() : "";
  if (token) {
    const [invite] = await db
      .select({ companyId: companyInvitesTable.companyId })
      .from(companyInvitesTable)
      .where(eq(companyInvitesTable.token, token))
      .limit(1);
    if (invite) companyIds.add(invite.companyId);
  }

  if (companyIds.size === 0) {
    next();
    return;
  }
  const companies = await db
    .select({ accessSuspended: companiesTable.accessSuspended })
    .from(companiesTable)
    .where(eq(companiesTable.id, [...companyIds][0]!));
  if (companies[0]?.accessSuspended) {
    res.status(403).json({ error: "Company access suspended", code: "company_access_suspended" });
    return;
  }
  if (companyIds.size > 1) {
    const [target] = await db.select({ accessSuspended: companiesTable.accessSuspended })
      .from(companiesTable).where(eq(companiesTable.id, [...companyIds][1]!));
    if (target?.accessSuspended) {
      res.status(403).json({ error: "Company access suspended", code: "company_access_suspended" });
      return;
    }
  }
  next();
}

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
// Uses requireClerkAuth (not requireAuth) to avoid auto-provisioning a
// usersTable row for property managers who are authenticated via Clerk but
// are external clients, not internal staff.
//
// Resolution order:
//   1. If the Clerk user already has a usersTable row → return staff identity
//      (this covers the happy-path for owner/manager/sales/technician).
//   2. If not in usersTable AND found in clientPortalAccessTable → return a
//      property_manager identity (no usersTable row created).
//   3. If in neither table → auto-provision as technician (new staff onboarding).
router.get("/me", requireClerkAuth, async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: "Unauthorized" });

  try {
    // Case 1: existing internal staff user.
    if (req.user) {
      const user = req.user;
      let company = null;
      if (user.companyId != null) {
        const [row] = await db
          .select()
          .from(companiesTable)
          .where(eq(companiesTable.id, user.companyId));
        if (row) company = { id: row.id, name: row.name, slug: row.slug };
      }
      const effectiveRole = (user.roleOverride ?? user.role) as string;
      // Throttled "last seen" refresh (fire-and-forget).
      const last = user.lastSeenAt ? user.lastSeenAt.getTime() : 0;
      if (Date.now() - last > 5 * 60 * 1000) {
        void db
          .update(usersTable)
          .set({ lastSeenAt: new Date() })
          .where(eq(usersTable.id, user.id))
          .catch(() => {});
      }
      return res.json({
        id: user.id,
        clerkUserId: user.clerkUserId,
        role: user.role,
        effectiveRole,
        roleOverride: user.roleOverride ?? null,
        isSuperAdmin: user.isSuperAdmin,
        companyId: user.companyId,
        betaAccess: user.betaAccess,
        company,
        pushNotificationsEnabled: user.pushNotificationsEnabled ?? true,
        hasPushToken: user.pushToken != null,
        pushLastFailedAt: user.pushLastFailedAt?.toISOString() ?? null,
        briefingEmailOptOut: user.briefingEmailOptOut ?? false,
      });
    }

    // Case 2: not in usersTable — check clientPortalAccessTable before
    // provisioning, so external property managers never get a phantom staff row.
    const [clientAccess] = await db
      .select()
      .from(clientPortalAccessTable)
      .where(eq(clientPortalAccessTable.clerkUserId, userId));

    if (clientAccess) {
      const [clientCompany] = await db
        .select({ id: companiesTable.id, name: companiesTable.name, slug: companiesTable.slug })
        .from(companiesTable)
        .where(eq(companiesTable.id, clientAccess.companyId));

      return res.json({
        id: null,
        clerkUserId: userId,
        role: "property_manager",
        effectiveRole: "property_manager",
        roleOverride: null,
        isSuperAdmin: false,
        companyId: clientAccess.companyId,
        betaAccess: false,
        company: clientCompany ?? null,
        pushNotificationsEnabled: false,
        hasPushToken: false,
        pushLastFailedAt: null,
        briefingEmailOptOut: true,
        clientAccess: {
          id: clientAccess.id,
          label: clientAccess.label ?? null,
          siteAddresses: clientAccess.siteAddresses,
        },
      });
    }

    // Case 3: brand-new staff member — provision a technician row (normal
    // onboarding; they'll be assigned to a company via an invite link).
    const [newUser] = await db
      .insert(usersTable)
      .values({ clerkUserId: userId, role: "technician" })
      .returning();

    return res.json({
      id: newUser.id,
      clerkUserId: newUser.clerkUserId,
      role: newUser.role,
      effectiveRole: newUser.role,
      roleOverride: null,
      isSuperAdmin: false,
      companyId: null,
      betaAccess: newUser.betaAccess,
      company: null,
      pushNotificationsEnabled: true,
      hasPushToken: false,
      pushLastFailedAt: null,
      briefingEmailOptOut: false,
    });
  } catch {
    return res.status(500).json({ error: "Failed to load user" });
  }
});

// ── POST /me/role-override — super-admin role impersonation ───────────────────
// Sets an ephemeral roleOverride on the calling user's account. Pass role: null
// to clear the override and revert to the real DB role.
router.post("/me/role-override", requireAuth, requireSuperAdmin, async (req, res) => {
  const user = req.user!;
  const { role } = req.body as { role: UserRole | null };
  const VALID: UserRole[] = ["owner", "manager", "sales", "technician"];
  if (role !== null && role !== undefined && !VALID.includes(role as UserRole)) {
    return res.status(400).json({ error: `role must be one of: ${VALID.join(", ")} or null` });
  }
  await db
    .update(usersTable)
    .set({ roleOverride: role ?? null })
    .where(eq(usersTable.id, user.id));
  return res.json({ success: true, roleOverride: role ?? null });
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

// ── POST /me/push-token — register device push token ─────────────────────────
// Stores the Expo push token for the authenticated user. Owners use this to
// receive critical-risk inspection push notifications. Any role can register a
// token, but only owner tokens are currently consumed.
router.post("/me/push-token", requireAuth, async (req, res) => {
  const user = req.user!;
  const { token } = req.body as { token?: unknown };
  if (typeof token !== "string" || !token.startsWith("ExponentPushToken[")) {
    return res.status(400).json({ error: "Invalid push token format" });
  }
  try {
    // Clear pushLastFailedAt on re-registration so the dashboard banner hides.
    await db
      .update(usersTable)
      .set({ pushToken: token, pushLastFailedAt: null })
      .where(eq(usersTable.id, user.id));
    return res.json({ success: true });
  } catch {
    return res.status(500).json({ error: "Failed to save push token" });
  }
});

// ── DELETE /me/push-token — remove push token (opt out) ───────────────────────
router.delete("/me/push-token", requireAuth, async (req, res) => {
  const user = req.user!;
  try {
    await db
      .update(usersTable)
      .set({ pushToken: null })
      .where(eq(usersTable.id, user.id));
    return res.json({ success: true });
  } catch {
    return res.status(500).json({ error: "Failed to remove push token" });
  }
});

// ── DELETE /me/push-failure — dismiss the push-failure banner ─────────────────
// Clears the pushLastFailedAt flag so the owner dashboard banner hides. Owners
// call this after visiting Settings to re-register their token or re-enable
// push notifications.
router.delete("/me/push-failure", requireAuth, async (req, res) => {
  const user = req.user!;
  try {
    await db
      .update(usersTable)
      .set({ pushLastFailedAt: null })
      .where(eq(usersTable.id, user.id));
    return res.json({ success: true });
  } catch {
    return res.status(500).json({ error: "Failed to dismiss push failure" });
  }
});

// ── PATCH /me/push-notifications — toggle notification preference ─────────────
router.patch("/me/push-notifications", requireAuth, async (req, res) => {
  const user = req.user!;
  const { enabled } = req.body as { enabled?: unknown };
  if (typeof enabled !== "boolean") {
    return res.status(400).json({ error: "enabled must be a boolean" });
  }
  try {
    // When re-enabling, also clear the delivery-failure flag so the dashboard
    // banner hides immediately without requiring a separate token re-registration.
    if (enabled) {
      await db
        .update(usersTable)
        .set({ pushNotificationsEnabled: true, pushLastFailedAt: null })
        .where(eq(usersTable.id, user.id));
    } else {
      await db
        .update(usersTable)
        .set({ pushNotificationsEnabled: false })
        .where(eq(usersTable.id, user.id));
    }
    return res.json({ success: true, pushNotificationsEnabled: enabled });
  } catch {
    return res.status(500).json({ error: "Failed to update push notification preference" });
  }
});

// ── PATCH /me/briefing-email — toggle daily briefing email preference ──────────
router.patch("/me/briefing-email", requireAuth, async (req, res) => {
  const user = req.user!;
  const { optOut } = req.body as { optOut?: unknown };
  if (typeof optOut !== "boolean") {
    return res.status(400).json({ error: "optOut must be a boolean" });
  }
  try {
    await db
      .update(usersTable)
      .set({ briefingEmailOptOut: optOut })
      .where(eq(usersTable.id, user.id));
    return res.json({ success: true, briefingEmailOptOut: optOut });
  } catch {
    return res.status(500).json({ error: "Failed to update briefing email preference" });
  }
});

// ── POST /accept-invite — join a company via token ─────────────────────────────
router.post("/accept-invite", requireAuth, requireActiveInviteCompany, async (req, res) => {
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

    const acceptance = await db.transaction(async (tx) => {
      const [company] = await tx.select({ accessSuspended: companiesTable.accessSuspended })
        .from(companiesTable).where(eq(companiesTable.id, invite.companyId)).for("update");
      if (!company) return "invalid_company" as const;
      if (company.accessSuspended) return "suspended" as const;

      const [lockedUser] = await tx.select({ companyId: usersTable.companyId })
        .from(usersTable).where(eq(usersTable.id, user.id)).for("update");
      if (!lockedUser || lockedUser.companyId != null) return "has_company" as const;
      const [lockedInvite] = await tx.select().from(companyInvitesTable)
        .where(eq(companyInvitesTable.id, invite.id)).for("update");
      if (!lockedInvite || lockedInvite.acceptedByUserId != null) return "invite_used" as const;
      if (lockedInvite.expiresAt && lockedInvite.expiresAt.getTime() < Date.now()) return "invite_expired" as const;

      await tx
        .update(usersTable)
        .set({ companyId: invite.companyId, role: invite.role })
        .where(eq(usersTable.id, user.id));
      await tx
        .update(companyInvitesTable)
        .set({ acceptedByUserId: user.id, acceptedAt: new Date() })
        .where(
          and(
            eq(companyInvitesTable.id, invite.id),
            eq(companyInvitesTable.token, token),
            isNull(companyInvitesTable.acceptedByUserId),
          ),
        );
      return "accepted" as const;
    });
    if (acceptance === "suspended") {
      return res.status(403).json({ error: "Company access suspended", code: "company_access_suspended" });
    }
    if (acceptance === "has_company") {
      return res.status(409).json({ error: "You already belong to a company", code: "has_company" });
    }
    if (acceptance === "invite_used") {
      return res.status(409).json({ error: "Invite already used", code: "invite_used" });
    }
    if (acceptance === "invite_expired") {
      return res.status(410).json({ error: "Invite expired", code: "invite_expired" });
    }
    if (acceptance !== "accepted") {
      return res.status(404).json({ error: "Invalid invite", code: "invalid_invite" });
    }
    req.user!.companyId = invite.companyId;
    req.user!.role = invite.role;
    return res.json({ companyId: invite.companyId, role: invite.role });
  } catch {
    return res.status(500).json({ error: "Failed to accept invite" });
  }
});

export default router;
