import { randomUUID } from "crypto";
import { and, eq, isNull, lte, sql } from "drizzle-orm";
import {
  db,
  usersTable,
  deletionRequestsTable,
  accountAuditLogTable,
  notificationsTable,
} from "@workspace/db";
import { logger } from "../lib/logger.js";
import {
  sendAccountDeletionReminder,
  sendInactivityWarning,
  sendSuspensionNotice,
  sendSuspensionFinalNotice,
} from "./email.js";

// ── Lifecycle timeline (days) ──────────────────────────────────────────────
// Self-requested deletion: 30-day grace, reminder at day 25.
export const GRACE_DELETION_DAYS = 30;
export const GRACE_REMINDER_DAY = 25;
// Inactivity pipeline: warn → suspend → final notice → delete.
export const INACTIVITY_WARN_DAYS = 175;
export const INACTIVITY_SUSPEND_DAYS = 180;
export const SUSPENSION_FINAL_NOTICE_DAYS = 205; // = 25 days after suspension
export const INACTIVITY_DELETE_DAYS = 210; // = 30 days after suspension

// ── Audit actions (stable identifiers) ─────────────────────────────────────
export const AUDIT = {
  DELETION_REQUESTED: "account.deletion_requested",
  DELETION_REQUESTED_WEB: "account.deletion_requested_web",
  DELETION_CANCELLED: "account.deletion_cancelled",
  REACTIVATED: "account.reactivated",
  SUSPENDED: "account.suspended_inactivity",
  RESTORED_BY_ADMIN: "account.restored_by_admin",
  DELETED_GRACE: "account.deleted_grace_period",
  DELETED_INACTIVITY: "account.deleted_inactivity",
  REMINDER_SENT: "account.deletion_reminder_sent",
  INACTIVITY_WARNED: "account.inactivity_warned",
  FINAL_NOTICE_SENT: "account.suspension_final_notice_sent",
} as const;

type ActorType = "user" | "system" | "admin";

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// Effective "last seen" — falls back through activity → login → account creation.
const effectiveActivity = sql`COALESCE(${usersTable.lastActivityAt}, ${usersTable.lastLoginAt}, ${usersTable.createdAt})`;

// ── Audit logging ───────────────────────────────────────────────────────────
export async function logAccountAudit(opts: {
  userId: string | null;
  action: string;
  actorType: ActorType;
  ipAddress?: string | null;
  metadata?: Record<string, unknown> | null;
}): Promise<void> {
  try {
    await db.insert(accountAuditLogTable).values({
      id: randomUUID(),
      userId: opts.userId,
      action: opts.action,
      actorType: opts.actorType,
      ipAddress: opts.ipAddress ?? null,
      metadata: opts.metadata ? JSON.stringify(opts.metadata) : null,
    });
  } catch (err) {
    // Audit logging must never break the primary flow.
    logger.error({ err, action: opts.action }, "Failed to write account audit log");
  }
}

// ── Session revocation ──────────────────────────────────────────────────────
// Clears the stored refresh token and bumps tokenVersion so any outstanding
// access tokens are immediately rejected by requireAuth's version check.
export async function revokeAllSessions(userId: string): Promise<void> {
  await db
    .update(usersTable)
    .set({
      refreshTokenHash: null,
      tokenVersion: sql`${usersTable.tokenVersion} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(usersTable.id, userId));
}

// ── Reactivation ────────────────────────────────────────────────────────────
// Restores a pending_deletion or suspended account to active, clears every
// lifecycle marker, and cancels any open deletion requests. Used by the login
// restore-on-signin path, the explicit reactivate endpoint, and admin restore.
export async function reactivateAccount(opts: {
  userId: string;
  actorType: ActorType;
  ipAddress?: string | null;
  action?: string;
}): Promise<void> {
  const now = new Date();
  await db
    .update(usersTable)
    .set({
      accountStatus: "active",
      deletionRequestedAt: null,
      suspendedAt: null,
      deletionReminderSentAt: null,
      inactivityWarnedAt: null,
      suspensionFinalNoticeSentAt: null,
      lastActivityAt: now,
      updatedAt: now,
    })
    .where(eq(usersTable.id, opts.userId));

  await db
    .update(deletionRequestsTable)
    .set({ status: "cancelled", resolvedAt: now })
    .where(
      and(
        eq(deletionRequestsTable.userId, opts.userId),
        eq(deletionRequestsTable.status, "pending"),
      ),
    );

  await logAccountAudit({
    userId: opts.userId,
    action: opts.action ?? AUDIT.REACTIVATED,
    actorType: opts.actorType,
    ipAddress: opts.ipAddress ?? null,
  });
}

// ── Permanent deletion ──────────────────────────────────────────────────────
// Hard-deletes the user row; all owned content (streams, clips, oauth
// connections w/ encrypted tokens, platforms w/ stream keys, etc.) is removed
// via ON DELETE CASCADE. The deletion_requests + account_audit_log rows survive
// (their userId FKs are ON DELETE SET NULL) as the compliance proof-of-deletion.
async function hardDeleteUser(opts: {
  userId: string;
  email: string;
  action: string;
  reason: string;
}): Promise<void> {
  const now = new Date();

  // Write the audit record BEFORE deleting so we retain proof. We keep only the
  // opaque internal id in metadata, not re-derivable PII.
  await logAccountAudit({
    userId: opts.userId,
    action: opts.action,
    actorType: "system",
    metadata: { deletedUserId: opts.userId, reason: opts.reason },
  });

  // Resolve any open deletion requests for this user.
  await db
    .update(deletionRequestsTable)
    .set({ status: "completed", resolvedAt: now })
    .where(
      and(
        eq(deletionRequestsTable.userId, opts.userId),
        eq(deletionRequestsTable.status, "pending"),
      ),
    );

  await db.delete(usersTable).where(eq(usersTable.id, opts.userId));

  logger.info({ userId: opts.userId, action: opts.action }, "Account permanently deleted");
}

// ── Daily lifecycle sweep ───────────────────────────────────────────────────
// Idempotent: safe to run repeatedly. Each email has a "sentAt" marker so it is
// never sent twice; deletions are gated on status + elapsed time.
export interface LifecycleSweepResult {
  graceRemindersSent: number;
  graceDeletions: number;
  inactivityWarnings: number;
  inactivitySuspensions: number;
  suspensionFinalNotices: number;
  inactivityDeletions: number;
}

export async function runAccountLifecycleSweep(): Promise<LifecycleSweepResult> {
  const result: LifecycleSweepResult = {
    graceRemindersSent: 0,
    graceDeletions: 0,
    inactivityWarnings: 0,
    inactivitySuspensions: 0,
    suspensionFinalNotices: 0,
    inactivityDeletions: 0,
  };

  // 1. Grace-period reminders (day 25 of self-requested deletion).
  const reminderDue = await db
    .select()
    .from(usersTable)
    .where(
      and(
        eq(usersTable.accountStatus, "pending_deletion"),
        lte(usersTable.deletionRequestedAt, daysAgo(GRACE_REMINDER_DAY)),
        isNull(usersTable.deletionReminderSentAt),
      ),
    );
  for (const u of reminderDue) {
    const scheduled = u.deletionRequestedAt
      ? new Date(u.deletionRequestedAt.getTime() + GRACE_DELETION_DAYS * 86400000)
      : daysFromNow(GRACE_DELETION_DAYS - GRACE_REMINDER_DAY);
    const daysRemaining = Math.max(
      0,
      Math.ceil((scheduled.getTime() - Date.now()) / 86400000),
    );
    await sendAccountDeletionReminder({
      to: u.email,
      displayName: u.displayName,
      scheduledDeletionDate: fmtDate(scheduled),
      daysRemaining,
    }).catch((err) => logger.error({ err, userId: u.id }, "deletion reminder email failed"));
    await db
      .update(usersTable)
      .set({ deletionReminderSentAt: new Date() })
      .where(eq(usersTable.id, u.id));
    await logAccountAudit({ userId: u.id, action: AUDIT.REMINDER_SENT, actorType: "system" });
    result.graceRemindersSent++;
  }

  // 2. Grace-period deletions (day 30).
  const graceDeleteDue = await db
    .select()
    .from(usersTable)
    .where(
      and(
        eq(usersTable.accountStatus, "pending_deletion"),
        lte(usersTable.deletionRequestedAt, daysAgo(GRACE_DELETION_DAYS)),
      ),
    );
  for (const u of graceDeleteDue) {
    await hardDeleteUser({
      userId: u.id,
      email: u.email,
      action: AUDIT.DELETED_GRACE,
      reason: "grace_period_elapsed",
    });
    result.graceDeletions++;
  }

  // 3. Inactivity warnings (day 175).
  const warnDue = await db
    .select()
    .from(usersTable)
    .where(
      and(
        eq(usersTable.accountStatus, "active"),
        lte(effectiveActivity, daysAgo(INACTIVITY_WARN_DAYS)),
        isNull(usersTable.inactivityWarnedAt),
      ),
    );
  for (const u of warnDue) {
    const daysUntilSuspension = INACTIVITY_SUSPEND_DAYS - INACTIVITY_WARN_DAYS;
    await sendInactivityWarning({
      to: u.email,
      displayName: u.displayName,
      daysUntilSuspension,
    }).catch((err) => logger.error({ err, userId: u.id }, "inactivity warning email failed"));
    // In-app notification mirrors the email so inactive users who still open the
    // app see the warning even if email delivery is missed.
    await db
      .insert(notificationsTable)
      .values({
        id: randomUUID(),
        userId: u.id,
        type: "system",
        title: "Your account is inactive",
        message: `You haven't used VYBE LIVE in a while. Your account will be suspended in ${daysUntilSuspension} days and later deleted unless you sign in.`,
      })
      .catch((err) => logger.error({ err, userId: u.id }, "inactivity warning notification failed"));
    await db
      .update(usersTable)
      .set({ inactivityWarnedAt: new Date() })
      .where(eq(usersTable.id, u.id));
    await logAccountAudit({ userId: u.id, action: AUDIT.INACTIVITY_WARNED, actorType: "system" });
    result.inactivityWarnings++;
  }

  // 4. Inactivity suspensions (day 180).
  const suspendDue = await db
    .select()
    .from(usersTable)
    .where(
      and(
        eq(usersTable.accountStatus, "active"),
        lte(effectiveActivity, daysAgo(INACTIVITY_SUSPEND_DAYS)),
      ),
    );
  for (const u of suspendDue) {
    const now = new Date();
    await db
      .update(usersTable)
      .set({ accountStatus: "suspended", suspendedAt: now, updatedAt: now })
      .where(eq(usersTable.id, u.id));
    await revokeAllSessions(u.id);
    await sendSuspensionNotice({
      to: u.email,
      displayName: u.displayName,
      finalDeletionDate: fmtDate(daysFromNow(INACTIVITY_DELETE_DAYS - INACTIVITY_SUSPEND_DAYS)),
    }).catch((err) => logger.error({ err, userId: u.id }, "suspension notice email failed"));
    await logAccountAudit({ userId: u.id, action: AUDIT.SUSPENDED, actorType: "system" });
    result.inactivitySuspensions++;
  }

  // 5. Suspension final notice (day 205 = 25 days after suspension).
  const finalNoticeDue = await db
    .select()
    .from(usersTable)
    .where(
      and(
        eq(usersTable.accountStatus, "suspended"),
        lte(usersTable.suspendedAt, daysAgo(SUSPENSION_FINAL_NOTICE_DAYS - INACTIVITY_SUSPEND_DAYS)),
        isNull(usersTable.suspensionFinalNoticeSentAt),
      ),
    );
  for (const u of finalNoticeDue) {
    const finalDate = u.suspendedAt
      ? new Date(u.suspendedAt.getTime() + (INACTIVITY_DELETE_DAYS - INACTIVITY_SUSPEND_DAYS) * 86400000)
      : daysFromNow(INACTIVITY_DELETE_DAYS - SUSPENSION_FINAL_NOTICE_DAYS);
    const daysRemaining = Math.max(0, Math.ceil((finalDate.getTime() - Date.now()) / 86400000));
    await sendSuspensionFinalNotice({
      to: u.email,
      displayName: u.displayName,
      finalDeletionDate: fmtDate(finalDate),
      daysRemaining,
    }).catch((err) => logger.error({ err, userId: u.id }, "final notice email failed"));
    await db
      .update(usersTable)
      .set({ suspensionFinalNoticeSentAt: new Date() })
      .where(eq(usersTable.id, u.id));
    await logAccountAudit({ userId: u.id, action: AUDIT.FINAL_NOTICE_SENT, actorType: "system" });
    result.suspensionFinalNotices++;
  }

  // 6. Inactivity deletions (day 210 = 30 days after suspension).
  const inactivityDeleteDue = await db
    .select()
    .from(usersTable)
    .where(
      and(
        eq(usersTable.accountStatus, "suspended"),
        lte(usersTable.suspendedAt, daysAgo(INACTIVITY_DELETE_DAYS - INACTIVITY_SUSPEND_DAYS)),
      ),
    );
  for (const u of inactivityDeleteDue) {
    await hardDeleteUser({
      userId: u.id,
      email: u.email,
      action: AUDIT.DELETED_INACTIVITY,
      reason: "inactivity_window_elapsed",
    });
    result.inactivityDeletions++;
  }

  return result;
}
