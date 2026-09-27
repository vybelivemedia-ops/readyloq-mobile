/**
 * /api/admin — Platform super-admin endpoints
 *
 * POST /token-auth   — no Clerk required; exchange SUPER_ADMIN_BOOTSTRAP_TOKEN
 *                      for a short-lived HMAC session token.
 * All other routes   — require a valid admin session token (Bearer header).
 */
import { createHmac, timingSafeEqual } from "crypto";
import { Router, type IRouter } from "express";
import type { Request, Response, NextFunction } from "express";
import rateLimit from "express-rate-limit";
import { db } from "@workspace/db";
import { usersTable, companiesTable, analysisResultsTable, type UserRole } from "@workspace/db";
import { eq } from "drizzle-orm";
import { runOpportunitySynthesisCore } from "../lib/opportunity-ai";

const router: IRouter = Router();

const VALID_ROLES: UserRole[] = ["owner", "manager", "sales", "technician"];
const ADMIN_TOKEN_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours

// ── HMAC token helpers ────────────────────────────────────────────────────────

function signAdminToken(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET not configured");
  const ts = Date.now().toString();
  const mac = createHmac("sha256", secret).update(`readyloq-admin:${ts}`).digest("hex");
  return `${ts}.${mac}`;
}

function verifyAdminToken(token: string): boolean {
  const secret = process.env.SESSION_SECRET;
  if (!secret) return false;
  const dot = token.lastIndexOf(".");
  if (dot === -1) return false;
  const ts = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  const age = Date.now() - parseInt(ts, 10);
  if (isNaN(age) || age < 0 || age > ADMIN_TOKEN_TTL_MS) return false;
  const expected = createHmac("sha256", secret).update(`readyloq-admin:${ts}`).digest("hex");
  try {
    const macBuf = Buffer.from(mac, "hex");
    const expBuf = Buffer.from(expected, "hex");
    if (macBuf.length !== expBuf.length) return false;
    return timingSafeEqual(macBuf, expBuf);
  } catch {
    return false;
  }
}

/** Middleware: requires a valid admin HMAC token in Authorization: Bearer header. */
const requireAdminToken = (req: Request, res: Response, next: NextFunction) => {
  const auth = req.headers.authorization;
  if (auth?.startsWith("Bearer ")) {
    if (verifyAdminToken(auth.slice(7))) return next();
  }
  return res.status(403).json({ error: "Valid admin session token required" });
};

// ── Brute-force limiter for /token-auth ─────────────────────────────────────
// This endpoint's only credential is SUPER_ADMIN_BOOTSTRAP_TOKEN, and it's
// reachable with no Clerk session at all — the general apiLimiter (500 req /
// 15 min, shared with every other endpoint) is far too loose to slow down a
// dedicated guesser. Cap attempts much tighter, keyed per-IP.
const tokenAuthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many admin login attempts, please try again later." },
});

// ── POST /token-auth ──────────────────────────────────────────────────────────
// Exchange SUPER_ADMIN_BOOTSTRAP_TOKEN for a short-lived HMAC session token.
// No Clerk auth required — the bootstrap token IS the credential.
router.post("/token-auth", tokenAuthLimiter, async (req, res) => {
  const envToken = process.env.SUPER_ADMIN_BOOTSTRAP_TOKEN;
  if (!envToken) {
    return res.status(503).json({ error: "Admin access not configured" });
  }
  const { token } = req.body as { token?: string };
  if (!token || token !== envToken) {
    return res.status(403).json({ error: "Invalid token" });
  }
  try {
    return res.json({ adminToken: signAdminToken() });
  } catch {
    return res.status(500).json({ error: "Could not issue session token" });
  }
});

// ── GET /users ────────────────────────────────────────────────────────────────
// All users across all companies, with their company name.
router.get("/users", requireAdminToken, async (_req, res) => {
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
router.patch("/users/:id", requireAdminToken, async (req, res) => {
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

// ── POST /resynthesize-opportunities ─────────────────────────────────────────
// Re-runs opportunity synthesis for every completed analysis result in the DB.
// Safe to call multiple times — synthesis itself is idempotent (strengthens
// existing open opportunities rather than duplicating them).
// Accepts either full Clerk auth+superAdmin OR the SUPER_ADMIN_BOOTSTRAP_TOKEN
// header for shell/script access.
router.post("/resynthesize-opportunities", async (req, res) => {
  const envToken = process.env.SUPER_ADMIN_BOOTSTRAP_TOKEN;
  const headerToken = req.headers["x-admin-token"];
  const tokenOk = envToken && typeof headerToken === "string" && headerToken === envToken;
  if (!tokenOk) return res.status(403).json({ error: "Forbidden" });
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
