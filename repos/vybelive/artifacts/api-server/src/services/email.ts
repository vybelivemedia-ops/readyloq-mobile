import nodemailer, { type Transporter } from "nodemailer";
import { logger } from "../lib/logger.js";

// ── SMTP transport ──────────────────────────────────────────────────────────
// Provider-agnostic SMTP. Currently configured for Gmail (smtp.gmail.com).
// Host/port/user/from are supplied as env vars; only SMTP_PASS (the mailbox or
// Gmail App Password) is a Replit Secret.
const SMTP_HOST = process.env.SMTP_HOST ?? "smtp.gmail.com";
const SMTP_PORT = parseInt(process.env.SMTP_PORT ?? "465", 10);
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;

// Default "From" for all beta mail. Falls back to the authenticated SMTP user
// (e.g. the Gmail account) when SMTP_FROM is unset, because Gmail rejects or
// rewrites a From that doesn't match the authenticated mailbox / verified alias.
export const BETA_FROM_EMAIL =
  process.env.SMTP_FROM ??
  (SMTP_USER ? `VYBE LIVE <${SMTP_USER}>` : "VYBE LIVE <beta@getvybe.live>");

let cachedTransport: Transporter | null = null;
function getTransport(): Transporter | null {
  if (!SMTP_PASS) return null;
  if (!cachedTransport) {
    cachedTransport = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465, // 465 = implicit TLS, 587 = STARTTLS
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });
  }
  return cachedTransport;
}

/** True only when both the SMTP user and password are configured (no mock delivery). */
export function isEmailConfigured(): boolean {
  return Boolean(SMTP_USER && SMTP_PASS);
}

/** Verify the SMTP connection + credentials without sending a message. */
export async function verifyEmailTransport(): Promise<void> {
  const t = getTransport();
  if (!t) {
    throw new Error(
      "SMTP is not configured — set SMTP_USER and SMTP_PASS (Gmail address + App Password) in Replit Secrets",
    );
  }
  await t.verify();
}

// Operations address that receives compliance / deletion-request notifications.
export const ADMIN_NOTIFY_EMAIL = process.env.ADMIN_NOTIFY_EMAIL ?? "admin@getvybe.live";

// ── Branded wrapper ────────────────────────────────────────────────────────
function wrap(bodyHtml: string): string {
  return `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto;background:#0a0a0a;color:#fff;padding:40px;border-radius:12px;">
      <h1 style="font-size:28px;font-weight:900;margin:0 0 8px;">VYBE<span style="color:#e11d48;">LIVE</span></h1>
      <hr style="border:none;border-top:1px solid #222;margin:24px 0;" />
      ${bodyHtml}
      <p style="color:#555;font-size:13px;margin-top:32px;">— The VYBE LIVE Team</p>
    </div>
  `;
}

// ── Generic sender ──────────────────────────────────────────────────────────
// Real delivery only — there is no mock/no-op path. When SMTP is unconfigured
// this throws so the caller logs a delivery failure instead of silently
// pretending the message was sent. Both success and failure are logged.
async function sendMail(opts: {
  to: string;
  subject: string;
  text: string;
  html: string;
}): Promise<{ messageId: string }> {
  const t = getTransport();
  if (!t) {
    logger.error(
      { to: opts.to, subject: opts.subject },
      "Email delivery failed — SMTP not configured (SMTP_USER/SMTP_PASS missing)",
    );
    throw new Error(
      "SMTP is not configured — set SMTP_USER and SMTP_PASS (Gmail address + App Password) in Replit Secrets",
    );
  }

  try {
    const info = await t.sendMail({
      from: BETA_FROM_EMAIL,
      to: opts.to,
      subject: opts.subject,
      text: opts.text,
      html: opts.html,
    });
    logger.info(
      { to: opts.to, subject: opts.subject, messageId: info.messageId },
      "Email delivered",
    );
    return { messageId: info.messageId };
  } catch (err) {
    logger.error(
      { err, to: opts.to, subject: opts.subject },
      "Email delivery failed",
    );
    throw err;
  }
}

// ── Beta waitlist welcome (sent automatically on signup) ─────────────────────
export async function sendWaitlistConfirmation(opts: {
  to: string;
  firstName: string;
}): Promise<{ messageId: string }> {
  return sendMail({
    to: opts.to,
    subject: "Welcome to the VYBE LIVE Beta Waitlist",
    text: `Hi ${opts.firstName},\n\nThank you for joining the VYBE LIVE Beta Waitlist. We will contact you when beta access becomes available.\n\nThe VYBE LIVE Team`,
    html: wrap(`
      <h2 style="font-size:22px;font-weight:700;margin:0 0 16px;">You're on the list!</h2>
      <p style="color:#aaa;font-size:16px;line-height:1.6;margin:0 0 16px;">Hi ${opts.firstName},</p>
      <p style="color:#aaa;font-size:16px;line-height:1.6;margin:0 0 16px;">
        Thank you for joining the VYBE LIVE Beta Waitlist. We will contact you when beta access becomes available.
      </p>
    `),
  });
}

// ── Beta invitation (reusable) ───────────────────────────────────────────────
// Sent when a waitlist member is granted beta access. Reusable for the test
// endpoint and any future "send invite" admin action.
export async function sendBetaInvitation(opts: {
  to: string;
  firstName?: string;
  inviteUrl?: string;
}): Promise<{ messageId: string }> {
  const greeting = opts.firstName ? `Hi ${opts.firstName},` : "Hi there,";
  const ctaUrl = opts.inviteUrl ?? "https://getvybe.live";
  return sendMail({
    to: opts.to,
    subject: "You're in — your VYBE LIVE beta invite",
    text: `${greeting}\n\nGreat news — your VYBE LIVE beta access is ready. Stream from your phone, GoPro, or Meta Glasses and multistream everywhere at once.\n\nGet started: ${ctaUrl}\n\nThe VYBE LIVE Team`,
    html: wrap(`
      <h2 style="font-size:22px;font-weight:700;margin:0 0 16px;">You're in!</h2>
      <p style="color:#aaa;font-size:16px;line-height:1.6;margin:0 0 16px;">${greeting}</p>
      <p style="color:#aaa;font-size:16px;line-height:1.6;margin:0 0 24px;">
        Great news — your <strong style="color:#fff;">VYBE LIVE beta access</strong> is ready. Stream from your phone, GoPro, or Meta Glasses and multistream to every platform at once.
      </p>
      <a href="${ctaUrl}" style="display:inline-block;background:#e11d48;color:#fff;text-decoration:none;font-weight:700;font-size:16px;padding:14px 28px;border-radius:8px;">Start streaming</a>
    `),
  });
}

// ── Account deletion / lifecycle emails ─────────────────────────────────────

// Sent to the operations inbox whenever a deletion request is submitted (web or app).
export async function sendDeletionRequestAdminNotification(opts: {
  email: string;
  username: string | null;
  reason: string | null;
  source: "app" | "web";
  requestId: string;
}): Promise<void> {
  await sendMail({
    to: ADMIN_NOTIFY_EMAIL,
    subject: `[VYBE LIVE] Account deletion request (${opts.source}) — ${opts.email}`,
    text: `A new account deletion request was submitted.\n\nRequest ID: ${opts.requestId}\nEmail: ${opts.email}\nUsername: ${opts.username ?? "(none)"}\nSource: ${opts.source}\nReason: ${opts.reason ?? "(none provided)"}\n\nReview it in the admin dashboard.`,
    html: wrap(`
      <h2 style="font-size:20px;font-weight:700;margin:0 0 16px;">New account deletion request</h2>
      <table style="color:#ddd;font-size:14px;line-height:1.8;">
        <tr><td style="color:#888;padding-right:16px;">Request ID</td><td>${opts.requestId}</td></tr>
        <tr><td style="color:#888;padding-right:16px;">Email</td><td>${opts.email}</td></tr>
        <tr><td style="color:#888;padding-right:16px;">Username</td><td>${opts.username ?? "(none)"}</td></tr>
        <tr><td style="color:#888;padding-right:16px;">Source</td><td>${opts.source}</td></tr>
        <tr><td style="color:#888;padding-right:16px;vertical-align:top;">Reason</td><td>${opts.reason ?? "(none provided)"}</td></tr>
      </table>
      <p style="color:#aaa;font-size:14px;margin-top:20px;">Review and action this request in the admin dashboard.</p>
    `),
  });
}

// Confirmation to the user that their deletion request was received (day 0).
export async function sendDeletionRequestConfirmation(opts: {
  to: string;
  displayName: string;
  scheduledDeletionDate: string;
}): Promise<void> {
  await sendMail({
    to: opts.to,
    subject: "Your VYBE LIVE account is scheduled for deletion",
    text: `Hi ${opts.displayName},\n\nWe've received your request to delete your VYBE LIVE account. Your account has been disabled and is scheduled for permanent deletion on ${opts.scheduledDeletionDate}.\n\nChanged your mind? Sign in any time before that date to cancel the deletion and restore your account.\n\nThe VYBE LIVE Team`,
    html: wrap(`
      <h2 style="font-size:22px;font-weight:700;margin:0 0 16px;">Account scheduled for deletion</h2>
      <p style="color:#aaa;font-size:16px;line-height:1.6;margin:0 0 16px;">Hi ${opts.displayName},</p>
      <p style="color:#aaa;font-size:16px;line-height:1.6;margin:0 0 16px;">
        We've received your request to delete your VYBE LIVE account. Your account has been disabled and is scheduled for
        <strong style="color:#fff;">permanent deletion on ${opts.scheduledDeletionDate}</strong>.
      </p>
      <p style="color:#aaa;font-size:16px;line-height:1.6;margin:0 0 16px;">
        Changed your mind? Sign in any time before that date to cancel the deletion and restore your account.
      </p>
    `),
  });
}

// Day-25 reminder before the 30-day grace deletion completes.
export async function sendAccountDeletionReminder(opts: {
  to: string;
  displayName: string;
  scheduledDeletionDate: string;
  daysRemaining: number;
}): Promise<void> {
  await sendMail({
    to: opts.to,
    subject: `Your VYBE LIVE account will be deleted in ${opts.daysRemaining} days`,
    text: `Hi ${opts.displayName},\n\nThis is a reminder that your VYBE LIVE account is scheduled for permanent deletion on ${opts.scheduledDeletionDate} (${opts.daysRemaining} days from now).\n\nIf this request was made in error, sign in now to cancel the deletion and keep your account. After ${opts.scheduledDeletionDate} this cannot be undone.\n\nThe VYBE LIVE Team`,
    html: wrap(`
      <h2 style="font-size:22px;font-weight:700;margin:0 0 16px;">Final reminder: deletion in ${opts.daysRemaining} days</h2>
      <p style="color:#aaa;font-size:16px;line-height:1.6;margin:0 0 16px;">Hi ${opts.displayName},</p>
      <p style="color:#aaa;font-size:16px;line-height:1.6;margin:0 0 16px;">
        Your VYBE LIVE account is scheduled for <strong style="color:#fff;">permanent deletion on ${opts.scheduledDeletionDate}</strong>.
      </p>
      <p style="color:#aaa;font-size:16px;line-height:1.6;margin:0 0 16px;">
        If this request was made in error, sign in now to cancel the deletion and keep your account. After that date this cannot be undone.
      </p>
    `),
  });
}

// Day-175 inactivity warning, 5 days before suspension.
export async function sendInactivityWarning(opts: {
  to: string;
  displayName: string;
  daysUntilSuspension: number;
}): Promise<void> {
  await sendMail({
    to: opts.to,
    subject: "We miss you at VYBE LIVE — sign in to keep your account",
    text: `Hi ${opts.displayName},\n\nWe noticed you haven't used VYBE LIVE in a while. To keep your account active, simply sign in within the next ${opts.daysUntilSuspension} days.\n\nIf you don't sign in, your account will be temporarily suspended and eventually deleted for inactivity.\n\nThe VYBE LIVE Team`,
    html: wrap(`
      <h2 style="font-size:22px;font-weight:700;margin:0 0 16px;">We miss you</h2>
      <p style="color:#aaa;font-size:16px;line-height:1.6;margin:0 0 16px;">Hi ${opts.displayName},</p>
      <p style="color:#aaa;font-size:16px;line-height:1.6;margin:0 0 16px;">
        We noticed you haven't used VYBE LIVE in a while. To keep your account active, simply sign in within the next
        <strong style="color:#fff;">${opts.daysUntilSuspension} days</strong>.
      </p>
      <p style="color:#aaa;font-size:16px;line-height:1.6;margin:0 0 16px;">
        If you don't sign in, your account will be temporarily suspended and eventually deleted for inactivity.
      </p>
    `),
  });
}

// Day-180 suspension notice — account is suspended but recoverable by signing in.
export async function sendSuspensionNotice(opts: {
  to: string;
  displayName: string;
  finalDeletionDate: string;
}): Promise<void> {
  await sendMail({
    to: opts.to,
    subject: "Your VYBE LIVE account has been suspended for inactivity",
    text: `Hi ${opts.displayName},\n\nYour VYBE LIVE account has been suspended due to inactivity. You can fully restore it at any time before ${opts.finalDeletionDate} simply by signing in.\n\nIf you don't reactivate by then, your account and data will be permanently deleted.\n\nThe VYBE LIVE Team`,
    html: wrap(`
      <h2 style="font-size:22px;font-weight:700;margin:0 0 16px;">Account suspended for inactivity</h2>
      <p style="color:#aaa;font-size:16px;line-height:1.6;margin:0 0 16px;">Hi ${opts.displayName},</p>
      <p style="color:#aaa;font-size:16px;line-height:1.6;margin:0 0 16px;">
        Your VYBE LIVE account has been suspended due to inactivity. You can fully restore it at any time before
        <strong style="color:#fff;">${opts.finalDeletionDate}</strong> simply by signing in.
      </p>
      <p style="color:#aaa;font-size:16px;line-height:1.6;margin:0 0 16px;">
        If you don't reactivate by then, your account and data will be permanently deleted.
      </p>
    `),
  });
}

// Day-205 final notice before inactivity deletion completes (day 210).
export async function sendSuspensionFinalNotice(opts: {
  to: string;
  displayName: string;
  finalDeletionDate: string;
  daysRemaining: number;
}): Promise<void> {
  await sendMail({
    to: opts.to,
    subject: `Final notice: your VYBE LIVE account will be deleted in ${opts.daysRemaining} days`,
    text: `Hi ${opts.displayName},\n\nThis is the final notice for your suspended VYBE LIVE account. It will be permanently deleted on ${opts.finalDeletionDate} (${opts.daysRemaining} days from now).\n\nSign in now to reactivate and keep your account and all your data.\n\nThe VYBE LIVE Team`,
    html: wrap(`
      <h2 style="font-size:22px;font-weight:700;margin:0 0 16px;">Final notice: deletion in ${opts.daysRemaining} days</h2>
      <p style="color:#aaa;font-size:16px;line-height:1.6;margin:0 0 16px;">Hi ${opts.displayName},</p>
      <p style="color:#aaa;font-size:16px;line-height:1.6;margin:0 0 16px;">
        Your suspended VYBE LIVE account will be <strong style="color:#fff;">permanently deleted on ${opts.finalDeletionDate}</strong>.
      </p>
      <p style="color:#aaa;font-size:16px;line-height:1.6;margin:0 0 16px;">
        Sign in now to reactivate and keep your account and all your data.
      </p>
    `),
  });
}
