import { Router } from "express";
import { and, eq, desc, count, ilike, or } from "drizzle-orm";
import { randomUUID } from "crypto";
import bcrypt from "bcryptjs";
import {
  db,
  usersTable,
  deletionRequestsTable,
  accountAuditLogTable,
} from "@workspace/db";
import { RequestAccountDeletionBody, RequestWebAccountDeletionBody } from "@workspace/api-zod";
import { requireAuth, requireAdmin } from "../middlewares/auth.js";
import {
  revokeAllSessions,
  reactivateAccount,
  logAccountAudit,
  AUDIT,
  GRACE_DELETION_DAYS,
} from "../services/accountLifecycle.js";
import {
  sendDeletionRequestAdminNotification,
  sendDeletionRequestConfirmation,
} from "../services/email.js";
import { checkWebDeleteRateLimit } from "../lib/uploadRateLimit.js";

const router = Router();

function publicAccount(u: typeof usersTable.$inferSelect) {
  return {
    id: u.id,
    email: u.email,
    username: u.username,
    displayName: u.displayName,
    role: u.role,
    plan: u.plan,
    accountStatus: u.accountStatus,
    lastLoginAt: u.lastLoginAt,
    lastActivityAt: u.lastActivityAt,
    deletionRequestedAt: u.deletionRequestedAt,
    suspendedAt: u.suspendedAt,
    createdAt: u.createdAt,
  };
}

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// ── POST /api/account/delete-request ─────────────────────────────────────────
// Authenticated in-app deletion. Verifies the user's password, opens a deletion
// request, moves the account to pending_deletion (starting the 30-day grace),
// and revokes all sessions so the client is logged out.
router.post("/account/delete-request", requireAuth, async (req, res) => {
  const parsed = RequestAccountDeletionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }
  const { password, reason } = parsed.data;
  const userId = req.auth!.userId;

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!user) {
    res.status(404).json({ error: "Account not found" });
    return;
  }

  // Re-verify the password — deletion is a destructive, security-sensitive action.
  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    res.status(401).json({ error: "Incorrect password" });
    return;
  }

  if (user.accountStatus === "pending_deletion") {
    res.status(409).json({ error: "Your account is already scheduled for deletion." });
    return;
  }

  const now = new Date();
  const requestId = randomUUID();
  const scheduled = new Date(now.getTime() + GRACE_DELETION_DAYS * 86400000);

  await db.insert(deletionRequestsTable).values({
    id: requestId,
    userId: user.id,
    email: user.email,
    username: user.username,
    reason: reason ?? null,
    source: "app",
    ipAddress: req.ip ?? null,
    status: "pending",
  });

  await db
    .update(usersTable)
    .set({ accountStatus: "pending_deletion", deletionRequestedAt: now, updatedAt: now })
    .where(eq(usersTable.id, user.id));

  await revokeAllSessions(user.id);

  await logAccountAudit({
    userId: user.id,
    action: AUDIT.DELETION_REQUESTED,
    actorType: "user",
    ipAddress: req.ip,
    metadata: { requestId, source: "app" },
  });

  // Best-effort notifications.
  sendDeletionRequestAdminNotification({
    email: user.email,
    username: user.username,
    reason: reason ?? null,
    source: "app",
    requestId,
  }).catch((err) => req.log.error({ err }, "admin deletion notification failed"));
  sendDeletionRequestConfirmation({
    to: user.email,
    displayName: user.displayName,
    scheduledDeletionDate: fmtDate(scheduled),
  }).catch((err) => req.log.error({ err }, "deletion confirmation email failed"));

  res.json({
    message: "Your account has been scheduled for deletion.",
    scheduledDeletionDate: fmtDate(scheduled),
  });
});

// ── POST /api/account/cancel-deletion ────────────────────────────────────────
// Cancels a pending deletion for the authenticated user and restores the account.
router.post("/account/cancel-deletion", requireAuth, async (req, res) => {
  const userId = req.auth!.userId;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!user) {
    res.status(404).json({ error: "Account not found" });
    return;
  }
  if (user.accountStatus !== "pending_deletion") {
    res.status(409).json({ error: "Your account is not scheduled for deletion." });
    return;
  }

  await reactivateAccount({
    userId: user.id,
    actorType: "user",
    ipAddress: req.ip,
    action: AUDIT.DELETION_CANCELLED,
  });

  const [fresh] = await db.select().from(usersTable).where(eq(usersTable.id, user.id)).limit(1);
  res.json(publicAccount(fresh ?? user));
});

// ── POST /api/account/reactivate ─────────────────────────────────────────────
// Reactivates a suspended or pending-deletion account for the authenticated user.
router.post("/account/reactivate", requireAuth, async (req, res) => {
  const userId = req.auth!.userId;
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!user) {
    res.status(404).json({ error: "Account not found" });
    return;
  }
  if (user.accountStatus === "active") {
    res.json(publicAccount(user));
    return;
  }

  await reactivateAccount({ userId: user.id, actorType: "user", ipAddress: req.ip });

  const [fresh] = await db.select().from(usersTable).where(eq(usersTable.id, user.id)).limit(1);
  res.json(publicAccount(fresh ?? user));
});

// ── POST /api/account/web-delete-request ─────────────────────────────────────
// Public, unauthenticated deletion request (Google Play "data deletion URL").
// Records a request for admin review and notifies operations. It deliberately
// does NOT disable any account directly — an unauthenticated email submission
// cannot prove ownership, so account disablement is gated behind admin approval.
// Always returns a generic success to avoid account-enumeration.
router.post("/account/web-delete-request", async (req, res) => {
  if (!checkWebDeleteRateLimit(req.ip ?? "unknown")) {
    res.status(429).json({
      error: "Too many requests. Please try again later.",
    });
    return;
  }

  const parsed = RequestWebAccountDeletionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }
  const email = parsed.data.email.toLowerCase();
  const { username, reason } = parsed.data;

  const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email)).limit(1);

  const requestId = randomUUID();
  await db.insert(deletionRequestsTable).values({
    id: requestId,
    userId: user?.id ?? null,
    email,
    username: username ?? user?.username ?? null,
    reason: reason ?? null,
    source: "web",
    ipAddress: req.ip ?? null,
    status: "pending",
  });

  await logAccountAudit({
    userId: user?.id ?? null,
    action: AUDIT.DELETION_REQUESTED_WEB,
    actorType: "user",
    ipAddress: req.ip,
    metadata: { requestId, source: "web", email },
  });

  sendDeletionRequestAdminNotification({
    email,
    username: username ?? user?.username ?? null,
    reason: reason ?? null,
    source: "web",
    requestId,
  }).catch((err) => req.log.error({ err }, "admin web deletion notification failed"));

  res.json({
    message:
      "Your request has been received. Our team will process the deletion of your account and associated data. You will receive a confirmation by email.",
  });
});

// ── Admin: GET /api/admin/deletion-requests ──────────────────────────────────
router.get("/admin/deletion-requests", requireAdmin, async (req, res) => {
  const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10));
  const limit = Math.min(200, Math.max(1, parseInt(String(req.query.limit ?? "50"), 10)));
  const offset = (page - 1) * limit;
  const status = req.query.status ? String(req.query.status) : null;

  const where =
    status === "pending" || status === "completed" || status === "cancelled"
      ? eq(deletionRequestsTable.status, status)
      : undefined;

  const [requests, [{ total }]] = await Promise.all([
    db
      .select()
      .from(deletionRequestsTable)
      .where(where)
      .orderBy(desc(deletionRequestsTable.createdAt))
      .limit(limit)
      .offset(offset),
    db.select({ total: count() }).from(deletionRequestsTable).where(where),
  ]);

  res.json({ requests, total: Number(total) });
});

// ── Admin: GET /api/admin/accounts ───────────────────────────────────────────
router.get("/admin/accounts", requireAdmin, async (req, res) => {
  const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10));
  const limit = Math.min(200, Math.max(1, parseInt(String(req.query.limit ?? "50"), 10)));
  const offset = (page - 1) * limit;
  const statusParam = req.query.status ? String(req.query.status) : null;
  const search = req.query.search ? String(req.query.search).trim() : null;

  const conditions = [];
  if (
    statusParam === "active" ||
    statusParam === "pending_deletion" ||
    statusParam === "suspended" ||
    statusParam === "deleted"
  ) {
    conditions.push(eq(usersTable.accountStatus, statusParam));
  }
  if (search) {
    const term = `%${search}%`;
    conditions.push(or(ilike(usersTable.email, term), ilike(usersTable.username, term)));
  }
  const where = conditions.length ? and(...conditions) : undefined;

  const [rows, [{ total }]] = await Promise.all([
    db
      .select()
      .from(usersTable)
      .where(where)
      .orderBy(desc(usersTable.createdAt))
      .limit(limit)
      .offset(offset),
    db.select({ total: count() }).from(usersTable).where(where),
  ]);

  res.json({ accounts: rows.map(publicAccount), total: Number(total) });
});

// ── Admin: GET /api/admin/audit-logs ─────────────────────────────────────────
router.get("/admin/audit-logs", requireAdmin, async (req, res) => {
  const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10));
  const limit = Math.min(200, Math.max(1, parseInt(String(req.query.limit ?? "50"), 10)));
  const offset = (page - 1) * limit;
  const userId = req.query.userId ? String(req.query.userId) : null;

  const where = userId ? eq(accountAuditLogTable.userId, userId) : undefined;

  const [logs, [{ total }]] = await Promise.all([
    db
      .select()
      .from(accountAuditLogTable)
      .where(where)
      .orderBy(desc(accountAuditLogTable.createdAt))
      .limit(limit)
      .offset(offset),
    db.select({ total: count() }).from(accountAuditLogTable).where(where),
  ]);

  res.json({ logs, total: Number(total) });
});

// ── Admin: POST /api/admin/accounts/:userId/restore ──────────────────────────
router.post("/admin/accounts/:userId/restore", requireAdmin, async (req, res) => {
  const userId = String(req.params.userId);
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!user) {
    res.status(404).json({ error: "Account not found" });
    return;
  }
  if (user.accountStatus === "active") {
    res.json({ message: "Account is already active." });
    return;
  }
  if (user.accountStatus === "deleted") {
    res.status(409).json({ error: "A permanently deleted account cannot be restored." });
    return;
  }

  await reactivateAccount({
    userId: user.id,
    actorType: "admin",
    ipAddress: req.ip,
    action: AUDIT.RESTORED_BY_ADMIN,
  });

  res.json({ message: "Account restored." });
});

// ── Admin: POST /api/admin/deletion-requests/:requestId/cancel ────────────────
router.post("/admin/deletion-requests/:requestId/cancel", requireAdmin, async (req, res) => {
  const requestId = String(req.params.requestId);
  const [reqRow] = await db
    .select()
    .from(deletionRequestsTable)
    .where(eq(deletionRequestsTable.id, requestId))
    .limit(1);
  if (!reqRow) {
    res.status(404).json({ error: "Deletion request not found" });
    return;
  }
  if (reqRow.status !== "pending") {
    res.status(409).json({ error: "This request has already been resolved." });
    return;
  }

  await db
    .update(deletionRequestsTable)
    .set({ status: "cancelled", resolvedAt: new Date() })
    .where(eq(deletionRequestsTable.id, requestId));

  // If the linked account had entered the grace period, restore it too.
  if (reqRow.userId) {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, reqRow.userId)).limit(1);
    if (user && user.accountStatus === "pending_deletion") {
      await reactivateAccount({
        userId: user.id,
        actorType: "admin",
        ipAddress: req.ip,
        action: AUDIT.RESTORED_BY_ADMIN,
      });
    }
  }

  await logAccountAudit({
    userId: reqRow.userId,
    action: AUDIT.DELETION_CANCELLED,
    actorType: "admin",
    ipAddress: req.ip,
    metadata: { requestId },
  });

  res.json({ message: "Deletion request cancelled." });
});

// ── Admin: POST /api/admin/deletion-requests/:requestId/approve ───────────────
// Starts the 30-day grace period for the account linked to a (typically web)
// deletion request, after the admin has verified ownership out-of-band.
router.post("/admin/deletion-requests/:requestId/approve", requireAdmin, async (req, res) => {
  const requestId = String(req.params.requestId);
  const [reqRow] = await db
    .select()
    .from(deletionRequestsTable)
    .where(eq(deletionRequestsTable.id, requestId))
    .limit(1);
  if (!reqRow) {
    res.status(404).json({ error: "Deletion request not found" });
    return;
  }
  if (reqRow.status !== "pending") {
    res.status(409).json({ error: "This request has already been resolved." });
    return;
  }
  if (!reqRow.userId) {
    res.status(400).json({ error: "No VYBE LIVE account is linked to this request." });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, reqRow.userId)).limit(1);
  if (!user) {
    res.status(400).json({ error: "The linked account no longer exists." });
    return;
  }
  if (user.accountStatus === "deleted") {
    res.status(409).json({ error: "The linked account is already deleted." });
    return;
  }

  const now = new Date();
  const scheduled = new Date(now.getTime() + GRACE_DELETION_DAYS * 86400000);

  await db
    .update(usersTable)
    .set({ accountStatus: "pending_deletion", deletionRequestedAt: now, updatedAt: now })
    .where(eq(usersTable.id, user.id));

  await revokeAllSessions(user.id);

  await logAccountAudit({
    userId: user.id,
    action: AUDIT.DELETION_REQUESTED,
    actorType: "admin",
    ipAddress: req.ip,
    metadata: { requestId, source: reqRow.source, approvedByAdmin: true },
  });

  sendDeletionRequestConfirmation({
    to: user.email,
    displayName: user.displayName,
    scheduledDeletionDate: fmtDate(scheduled),
  }).catch((err) => req.log.error({ err }, "deletion confirmation email failed"));

  res.json({ message: `Account scheduled for deletion on ${fmtDate(scheduled)}.` });
});

export default router;
