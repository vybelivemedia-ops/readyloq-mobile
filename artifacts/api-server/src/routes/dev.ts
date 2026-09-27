/**
 * Development/test-only routes.
 *
 * This module is mounted in app.ts ONLY when ALL of these hold:
 *   1. REPLIT_DEPLOYMENT is absent  — Replit sets this in every production
 *      deployment, so the router is never registered in a deployed build.
 *   2. DEV_FIXTURE_SECRET is present — must be set intentionally for e2e runs.
 *
 * Additionally, every individual request is re-checked inside requireDevSecret:
 *   3. REPLIT_DEPLOYMENT must still be absent (defense in depth).
 *   4. The caller must supply the same secret in x-dev-fixture-secret header.
 *
 * Both the mount-time gate (app.ts) and the per-request gate (requireDevSecret)
 * must pass; either one alone is sufficient to block access in production.
 *
 * Mounted at: POST /api/dev/claim-fixture-role
 */

import { Router, type IRouter } from "express";
import type { Request, Response } from "express";
import { db } from "@workspace/db";
import {
  usersTable,
  companiesTable,
  type UserRole,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { DEV_FIXTURE_SLUG } from "../seed/dev-fixtures";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const VALID_ROLES: UserRole[] = ["owner", "manager", "sales", "technician"];

/**
 * Per-request guard — rejects with 404 when ANY of the following hold:
 *   - REPLIT_DEPLOYMENT is set (defense-in-depth: fail-closed in production even
 *     if the router was somehow mounted)
 *   - DEV_FIXTURE_SECRET env var is absent
 *   - The caller's x-dev-fixture-secret header doesn't match the env secret
 *
 * Returns 404 (not 401/403) so the endpoint is indistinguishable from a
 * nonexistent route to external callers.
 */
function requireDevSecret(req: Request, res: Response, next: () => void) {
  // Hard block in any deployed environment — must never be reached in prod.
  if (process.env.REPLIT_DEPLOYMENT) {
    return res.status(404).json({ error: "Not found" });
  }
  const secret = process.env.DEV_FIXTURE_SECRET;
  if (!secret) {
    return res.status(404).json({ error: "Not found" });
  }
  const provided = req.headers["x-dev-fixture-secret"];
  if (provided !== secret) {
    return res.status(404).json({ error: "Not found" });
  }
  return next();
}

/**
 * POST /api/dev/claim-fixture-role
 *
 * Links (or re-links) a Clerk user to the dev fixture company with the
 * requested role. The user row is upserted: if the Clerk user has already
 * been auto-provisioned by /api/auth/me (case 3), we update their
 * company_id and role; otherwise we insert a fresh row.
 *
 * Headers: x-dev-fixture-secret: <DEV_FIXTURE_SECRET>
 * Body: { clerkUserId: string, role: "owner"|"manager"|"sales"|"technician" }
 * Response: { ok: true, userId: number, companyId: number, role: string }
 */
router.post("/claim-fixture-role", requireDevSecret, async (req, res) => {
  const { clerkUserId, role } = req.body as {
    clerkUserId?: string;
    role?: string;
  };

  if (!clerkUserId || typeof clerkUserId !== "string") {
    return res.status(400).json({ error: "clerkUserId (string) is required" });
  }

  if (!role || !VALID_ROLES.includes(role as UserRole)) {
    return res.status(400).json({
      error: `role must be one of: ${VALID_ROLES.join(", ")}`,
    });
  }

  const typedRole = role as UserRole;

  try {
    // Resolve the fixture company.
    const [company] = await db
      .select({ id: companiesTable.id })
      .from(companiesTable)
      .where(eq(companiesTable.slug, DEV_FIXTURE_SLUG));

    if (!company) {
      return res.status(503).json({
        error:
          "Fixture company not found — ensure ensureDevFixtures() has run on startup",
      });
    }

    const companyId = company.id;

    // Upsert the users row.
    const [user] = await db
      .insert(usersTable)
      .values({
        clerkUserId,
        companyId,
        role: typedRole,
        betaAccess: true,
      })
      .onConflictDoUpdate({
        target: usersTable.clerkUserId,
        set: { companyId, role: typedRole },
      })
      .returning({ id: usersTable.id });

    logger.info(
      { clerkUserId, role: typedRole, companyId },
      "[dev-fixtures] claim-fixture-role: user linked to fixture company",
    );

    return res.json({ ok: true, userId: user.id, companyId, role: typedRole });
  } catch (err) {
    logger.error({ err }, "[dev-fixtures] claim-fixture-role failed");
    return res.status(500).json({ error: "Internal error" });
  }
});

export default router;
