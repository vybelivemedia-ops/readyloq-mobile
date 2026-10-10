/**
 * /api/admin — Platform super-admin endpoints.
 * Every route requires an authenticated Clerk Super Admin. Super Admin
 * elevation itself is handled only by governed Mission Control workflows.
 */
import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { usersTable, companiesTable, analysisResultsTable, type UserRole } from "@workspace/db";
import { eq } from "drizzle-orm";
import { runOpportunitySynthesisCore } from "../lib/opportunity-ai";
import { requireAuth, requireSuperAdmin } from "../middleware/require-auth";

const router: IRouter = Router();
router.use(requireAuth, requireSuperAdmin);

const VALID_ROLES: UserRole[] = ["owner", "manager", "sales", "technician"];

// ── GET /users ────────────────────────────────────────────────────────────────
// All users across all companies, with their company name.
router.get("/users", async (_req, res) => {
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
// Super Admin grants/revocations require the Mission Control two-admin
// approval route; direct account PATCH requests cannot perform them.
router.patch("/users/:id", async (req, res) => {
  const userId = parseInt(req.params["id"] as string, 10);
  if (isNaN(userId)) return res.status(400).json({ error: "Invalid user id" });

  const { role, isSuperAdmin, betaAccess } = req.body as {
    role?: string;
    isSuperAdmin?: boolean;
    betaAccess?: boolean;
  };
  if (isSuperAdmin !== undefined) {
    return res.status(403).json({ error: "Super Admin access changes require Mission Control approval by a different authenticated administrator" });
  }

  const updates: Partial<{
    role: UserRole;
    betaAccess: boolean;
  }> = {};

  if (role !== undefined) {
    if (!VALID_ROLES.includes(role as UserRole)) {
      return res.status(400).json({ error: `role must be one of: ${VALID_ROLES.join(", ")}` });
    }
    updates.role = role as UserRole;
  }
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

// ── POST /resynthesize-opportunities ─────────────────────────────────────────
// Re-runs opportunity synthesis for every completed analysis result in the DB.
// Safe to call multiple times — synthesis itself is idempotent (strengthens
// existing open opportunities rather than duplicating them).
// Protected by the Clerk Super Admin guard installed above.
router.post("/resynthesize-opportunities", async (_req, res) => {
  const rows = await db
    .select({
      id: analysisResultsTable.id,
      companyId: analysisResultsTable.companyId,
      inspectionId: analysisResultsTable.inspectionId,
      findings: analysisResultsTable.findings,
    })
    .from(analysisResultsTable);

  const eligible = rows.filter((r) => Array.isArray(r.findings) && r.findings.length > 0);

  let processed = 0;
  let failed = 0;
  const errors: { analysisId: number; error: string }[] = [];

  for (const row of eligible) {
    try {
      await runOpportunitySynthesisCore({
        companyId: row.companyId,
        inspectionId: row.inspectionId,
        findings: row.findings as Parameters<typeof runOpportunitySynthesisCore>[0]["findings"],
      });
      processed++;
    } catch (err) {
      failed++;
      errors.push({
        analysisId: row.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return res.json({
    total: eligible.length,
    processed,
    failed,
    errors,
  });
});

export default router;
