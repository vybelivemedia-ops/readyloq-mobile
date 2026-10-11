/**
 * Thin email-sending wrapper.
 *
 * Transport selection (first match wins):
 *   1. RESEND_API_KEY is set → Resend (https://resend.com) via REST
 *   2. SMTP_HOST + SMTP_USER + SMTP_PASS are all set → SMTP via nodemailer
 *   3. Otherwise → warning logged, returns { delivered: false } — the caller
 *      must NOT count this as a successful delivery.
 *
 * FROM address: SMTP_FROM env var, falling back to "ReadyLoq <noreply@readyloq.com>".
 */

import nodemailer from "nodemailer";
import { logger } from "./logger";

export interface MailResult {
  delivered: boolean;
  /** Present when delivered is false; explains why no delivery happened. */
  reason?: "no_transport" | "resend_error" | "smtp_error";
}

export interface SendMailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
  /** Optional per-call transport deadline; existing callers keep their defaults. */
  timeoutMs?: number;
}

/**
 * Resolve the FROM address for the Resend transport.
 *
 * Returns null when neither RESEND_FROM nor SMTP_FROM is configured —
 * the caller must skip delivery in that case (onboarding@resend.dev is
 * intentionally NOT used as a fallback: it only delivers to the Resend
 * account owner's inbox and silently fails for all other recipients).
 */
function resolveResendFrom(): string | null {
  return process.env["RESEND_FROM"] ?? process.env["SMTP_FROM"] ?? null;
}

/**
 * Resolve the FROM address for the SMTP transport.
 * Always returns a non-null string (has a hardcoded fallback).
 */
function resolveSmtpFrom(): string {
  return process.env["RESEND_FROM"] ?? process.env["SMTP_FROM"] ?? "ReadyLoq <noreply@readyloq.com>";
}

// ── Resend transport ──────────────────────────────────────────────────────────

async function sendViaResend(opts: SendMailOptions): Promise<MailResult> {
  const apiKey = process.env["RESEND_API_KEY"]!;

  const from = resolveResendFrom();
  if (!from) {
    logger.warn(
      { to: opts.to },
      "mailer: RESEND_API_KEY is set but no verified sender configured — set RESEND_FROM to a Resend-verified address; email not delivered",
    );
    return { delivered: false, reason: "no_transport" };
  }

  const body: Record<string, unknown> = {
    from,
    to: [opts.to],
    subject: opts.subject,
    html: opts.html,
  };
  if (opts.text) body["text"] = opts.text;

  let res: Response;
  try {
    res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: opts.timeoutMs ? AbortSignal.timeout(opts.timeoutMs) : undefined,
    });
  } catch (err) {
    // Network-level error (DNS, TCP timeout, etc.) — treat as per-recipient
    // failure so the scheduler can continue with remaining recipients.
    logger.error({ err, to: opts.to }, "mailer: Resend fetch failed (network error)");
    return { delivered: false, reason: "resend_error" };
  }

  if (!res.ok) {
    const errBody = await res.text().catch(() => "(unreadable)");
    logger.error(
      { to: opts.to, status: res.status, body: errBody },
      "mailer: Resend delivery failed",
    );
    return { delivered: false, reason: "resend_error" };
  }

  logger.info({ to: opts.to, subject: opts.subject }, "mailer: email delivered via Resend");
  return { delivered: true };
}

// ── SMTP transport ────────────────────────────────────────────────────────────

async function sendViaSmtp(opts: SendMailOptions): Promise<MailResult> {
  const host = process.env["SMTP_HOST"]!;
  const user = process.env["SMTP_USER"]!;
  const pass = process.env["SMTP_PASS"]!;

  const transport = nodemailer.createTransport({
    host,
    port: Number(process.env["SMTP_PORT"] ?? 587),
    secure: process.env["SMTP_SECURE"] === "true",
    auth: { user, pass },
    ...(opts.timeoutMs ? {
      connectionTimeout: opts.timeoutMs,
      greetingTimeout: opts.timeoutMs,
      socketTimeout: opts.timeoutMs,
    } : {}),
  });

  try {
    await transport.sendMail({
      from: resolveSmtpFrom(),
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
      text: opts.text,
    });
    logger.info({ to: opts.to, subject: opts.subject }, "mailer: email delivered via SMTP");
    return { delivered: true };
  } catch (err) {
    logger.error({ err, to: opts.to }, "mailer: SMTP delivery failed");
    return { delivered: false, reason: "smtp_error" };
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Send an email using the configured transport.
 *
 * Returns { delivered: true } on success. Returns { delivered: false, reason }
 * when delivery did not happen — callers MUST NOT count this as a successful
 * send. When no transport is configured the function logs a warning and returns
 * without throwing so the scheduler continues processing other recipients.
 */
export async function sendMail(opts: SendMailOptions): Promise<MailResult> {
  if (process.env["RESEND_API_KEY"]) {
    return sendViaResend(opts);
  }

  const smtpReady =
    process.env["SMTP_HOST"] &&
    process.env["SMTP_USER"] &&
    process.env["SMTP_PASS"];

  if (smtpReady) {
    return sendViaSmtp(opts);
  }

  // No transport configured — warn and return without delivering.
  logger.warn(
    { to: opts.to, subject: opts.subject },
    "mailer: no transport configured (set RESEND_API_KEY or SMTP_HOST/SMTP_USER/SMTP_PASS) — email not delivered",
  );
  return { delivered: false, reason: "no_transport" };
}
