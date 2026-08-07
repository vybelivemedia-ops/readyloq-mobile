/**
 * /api/admin — Platform super-admin endpoints
 *
 * All routes except /bootstrap require requireSuperAdmin.
 * /bootstrap is protected by SUPER_ADMIN_BOOTSTRAP_TOKEN env var (one-time use).
 */
import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { usersTable, companiesTable, type UserRole } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth, requireSuperAdmin } from "../middleware/require-auth";

const router: IRouter = Router();

const VALID_ROLES: UserRole[] = ["owner", "manager", "sales", "technician"];

// ── POST /bootstrap ───────────────────────────────────────────────────────────
// One-time call: caller presents SUPER_ADMIN_BOOTSTRAP_TOKEN, gets isSuperAdmin.
// Designed to be called exactly once by the platform owner to seed the first
// super admin. Subsequent calls by already-elevated accounts are safe no-ops.
router.post("/bootstrap", requireAuth, async (req, res) => {
  const envToken = process.env.SUPER_ADMIN_BOOTSTRAP_TOKEN;
  if (!envToken) {
    return res.status(503).json({ error: "Bootstrap token not configured" });
  }
  const { token } = req.body as { token?: string };
  if (!token || token !== envToken) {
    return res.status(403).json({ error: "Invalid bootstrap token" });
  }
  const user = req.user!;
  const [updated] = await db
    .update(usersTable)
    .set({ isSuperAdmin: true })
    .where(eq(usersTable.id, user.id))
    .returning();
  return res.json({
    success: true,
    message: "Super admin access granted",
    isSuperAdmin: updated.isSuperAdmin,
  });
});

// ── GET /users ────────────────────────────────────────────────────────────────
// All users across all companies, with their company name.
router.get("/users", requireAuth, requireSuperAdmin, async (_req, res) => {
  const rows = await db
    .select({
      id: usersTable.id,
      clerkUserId: usersTable.clerkUserId,
      role: usersTable.role,
      roleOverride: usersTable.roleOverride,
      isSuperAdmin: usersTable.isSuperAdmin,
      betaAccess: usersTable.betaAccess,
      companyId: usersTable.companyId,
      companyName: companiesTable.name,
      createdAt: usersTable.createdAt,
      lastSeenAt: usersTable.lastSeenAt,
    })
    .from(usersTable)
    .leftJoin(companiesTable, eq(usersTable.companyId, companiesTable.id))
    .orderBy(usersTable.createdAt);

  return res.json(
    rows.map((r) => ({
      ...r,
      createdAt: r.createdAt.toISOString(),
      lastSeenAt: r.lastSeenAt ? r.lastSeenAt.toISOString() : null,
    })),
  );
});

// ── PATCH /users/:id ──────────────────────────────────────────────────────────
// Update any user's role, betaAccess, or isSuperAdmin flag.
router.patch("/users/:id", requireAuth, requireSuperAdmin, async (req, res) => {
  const userId = parseInt(req.params["id"] as string, 10);
  if (isNaN(userId)) return res.status(400).json({ error: "Invalid user id" });

  const { role, isSuperAdmin, betaAccess } = req.body as {
    role?: string;
    isSuperAdmin?: boolean;
    betaAccess?: boolean;
  };

  const updates: Partial<{
    role: UserRole;
    isSuperAdmin: boolean;
    betaAccess: boolean;
  }> = {};

  if (role !== undefined) {
    if (!VALID_ROLES.includes(role as UserRole)) {
      return res.status(400).json({ error: `role must be one of: ${VALID_ROLES.join(", ")}` });
    }
    updates.role = role as UserRole;
  }
  if (typeof isSuperAdmin === "boolean") updates.isSuperAdmin = isSuperAdmin;
  if (typeof betaAccess === "boolean") updates.betaAccess = betaAccess;

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: "No valid fields to update" });
  }

  const [updated] = await db
    .update(usersTable)
    .set(updates)
    .where(eq(usersTable.id, userId))
    .returning();

  if (!updated) return res.status(404).json({ error: "User not found" });

  return res.json({
    id: updated.id,
    clerkUserId: updated.clerkUserId,
    role: updated.role,
    roleOverride: updated.roleOverride,
    isSuperAdmin: updated.isSuperAdmin,
    betaAccess: updated.betaAccess,
    companyId: updated.companyId,
    createdAt: updated.createdAt.toISOString(),
  });
});

export default router;
