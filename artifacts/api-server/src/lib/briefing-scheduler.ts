/**
 * Daily Executive Briefing Scheduler
 *
 * Runs once per day at 07:00 UTC. For every company that has at least one
 * owner who has not opted out, it:
 *   1. Generates yesterday's briefing via generateDailyExecutiveBriefing()
 *   2. Renders it into a branded HTML email
 *   3. Sends the email through the mailer service
 *
 * Owner opt-out is respected via the users.briefing_email_opt_out column.
 * Clerk is queried for each owner's primary email address.
 *
 * Only increments the "sent" counter when sendMail() reports delivered: true.
 * No-transport / provider errors are counted separately so callers can
 * distinguish real delivery from silent no-ops.
 */

import cron from "node-cron";
import { db, companiesTable, usersTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { generateDailyExecutiveBriefing } from "../services/briefing";
import { sendMail } from "./mailer";
import { logger } from "./logger";

// ── Clerk REST helper ─────────────────────────────────────────────────────────

const CLERK_API_BASE = "https://api.clerk.com/v1";

/**
 * Returns the primary email address for a Clerk user, or null if unavailable.
 */
export async function getClerkUserEmail(clerkUserId: string): Promise<string | null> {
  const secretKey = process.env["CLERK_SECRET_KEY"];
  if (!secretKey) {
    logger.warn("briefing-scheduler: CLERK_SECRET_KEY not set — cannot look up owner emails");
    return null;
  }

  try {
    const res = await fetch(`${CLERK_API_BASE}/users/${clerkUserId}`, {
      headers: { Authorization: `Bearer ${secretKey}` },
    });
    if (!res.ok) {
      logger.warn(
        { clerkUserId, status: res.status },
        "briefing-scheduler: Clerk user lookup failed",
      );
      return null;
    }

    const data = (await res.json()) as {
      primary_email_address_id?: string;
      email_addresses?: Array<{ id: string; email_address: string }>;
    };

    const primaryId = data.primary_email_address_id;
    const match = data.email_addresses?.find((e) => e.id === primaryId);
    return match?.email_address ?? null;
  } catch (err) {
    logger.warn({ err, clerkUserId }, "briefing-scheduler: Clerk user lookup error");
    return null;
  }
}

// ── HTML email builder ────────────────────────────────────────────────────────

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function buildBriefingEmail(opts: {
  companyName: string;
  date: string;
  summary: string;
  inspectionsCount: number;
  criticalRiskCount: number;
  newOpportunities: number;
  pipelineAdded: number;
  recommendation: string;
}): { html: string; text: string; subject: string } {
  const {
    companyName,
    date,
    summary,
    inspectionsCount,
    criticalRiskCount,
    newOpportunities,
    pipelineAdded,
    recommendation,
  } = opts;

  const companyNameHtml = escapeHtml(companyName);
  const summaryHtml = escapeHtml(summary);
  const recommendationHtml = escapeHtml(recommendation);

  const formattedDate = new Date(date + "T12:00:00Z").toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });

  const pipelineFormatted =
    pipelineAdded >= 1_000_000
      ? `$${(pipelineAdded / 1_000_000).toFixed(1)}M`
      : pipelineAdded >= 1_000
        ? `$${(pipelineAdded / 1_000).toFixed(0)}K`
        : `$${pipelineAdded.toLocaleString()}`;

  const criticalColor = criticalRiskCount > 0 ? "#F85149" : "#3FB950";
  const inspectionsColor = "#17C4D3";

  const subject = `Daily Briefing — ${companyName} · ${formattedDate}`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Daily Briefing — ${companyNameHtml}</title>
</head>
<body style="margin:0;padding:0;background:#0D1117;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0D1117;padding:24px 0;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">

          <!-- Header -->
          <tr>
            <td style="background:#161B22;border:1px solid #30363D;border-radius:16px 16px 0 0;padding:28px 32px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td>
                    <div style="color:#17C4D3;font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;margin-bottom:6px;">Daily Executive Briefing</div>
                    <div style="color:#E6EDF3;font-size:22px;font-weight:800;margin-bottom:4px;">${companyNameHtml}</div>
                    <div style="color:#8B949E;font-size:13px;">Operations snapshot · ${escapeHtml(formattedDate)}</div>
                  </td>
                  <td align="right" style="vertical-align:top;">
                    <div style="background:#17C4D322;border:1px solid #17C4D344;border-radius:10px;padding:8px 14px;display:inline-block;">
                      <span style="color:#17C4D3;font-size:11px;font-weight:700;letter-spacing:0.5px;">READYLOQ</span>
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- KPI Row -->
          <tr>
            <td style="padding:0;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td width="33%" style="background:#161B22;border:1px solid #30363D;border-top:none;padding:20px 24px;">
                    <div style="color:#8B949E;font-size:10px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;margin-bottom:8px;">Inspections</div>
                    <div style="color:${inspectionsColor};font-size:28px;font-weight:800;margin-bottom:4px;">${inspectionsCount}</div>
                    <div style="color:#8B949E;font-size:12px;">completed yesterday</div>
                  </td>
                  <td width="33%" style="background:#161B22;border:1px solid #30363D;border-top:none;border-left:none;padding:20px 24px;">
                    <div style="color:#8B949E;font-size:10px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;margin-bottom:8px;">Critical Risks</div>
                    <div style="color:${criticalColor};font-size:28px;font-weight:800;margin-bottom:4px;">${criticalRiskCount}</div>
                    <div style="color:#8B949E;font-size:12px;">sites flagged</div>
                  </td>
                  <td width="34%" style="background:#161B22;border:1px solid #30363D;border-top:none;border-left:none;padding:20px 24px;">
                    <div style="color:#8B949E;font-size:10px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;margin-bottom:8px;">New Pipeline</div>
                    <div style="color:#3FB950;font-size:28px;font-weight:800;margin-bottom:4px;">${escapeHtml(pipelineFormatted)}</div>
                    <div style="color:#8B949E;font-size:12px;">${newOpportunities} new opportunit${newOpportunities === 1 ? "y" : "ies"}</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Summary -->
          <tr>
            <td style="background:#161B22;border:1px solid #30363D;border-top:none;padding:20px 32px;">
              <div style="color:#8B949E;font-size:10px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;margin-bottom:10px;">Yesterday's Summary</div>
              <div style="color:#E6EDF3;font-size:15px;line-height:1.6;">${summaryHtml}</div>
            </td>
          </tr>

          <!-- Recommendation -->
          <tr>
            <td style="background:#161B22;border:1px solid #30363D;border-top:none;padding:20px 32px;">
              <div style="color:#8B949E;font-size:10px;font-weight:700;letter-spacing:0.8px;text-transform:uppercase;margin-bottom:10px;">Quinn's Recommendation</div>
              <div style="background:${criticalRiskCount > 0 ? "#F8514918" : "#3FB95018"};border-left:3px solid ${criticalRiskCount > 0 ? "#F85149" : "#3FB950"};border-radius:0 8px 8px 0;padding:14px 18px;">
                <div style="color:#E6EDF3;font-size:14px;line-height:1.6;">${recommendationHtml}</div>
              </div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#161B22;border:1px solid #30363D;border-top:none;border-radius:0 0 16px 16px;padding:20px 32px;text-align:center;">
              <div style="color:#8B949E;font-size:12px;margin-bottom:4px;">You're receiving this because you're an owner on ReadyLoq.</div>
              <div style="color:#8B949E;font-size:12px;margin-bottom:8px;">To unsubscribe, turn off Daily Briefing Email in your app settings.</div>
              <div style="color:#17C4D3;font-size:11px;font-weight:700;letter-spacing:0.5px;">Powered by ReadyLoq</div>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = [
    `DAILY EXECUTIVE BRIEFING`,
    `${companyName} · ${formattedDate}`,
    ``,
    `── YESTERDAY'S OPERATIONS ──────────────────`,
    `Inspections completed: ${inspectionsCount}`,
    `Critical risk sites:   ${criticalRiskCount}`,
    `New pipeline value:    ${pipelineFormatted} (${newOpportunities} new opportunit${newOpportunities === 1 ? "y" : "ies"})`,
    ``,
    `── SUMMARY ─────────────────────────────────`,
    summary,
    ``,
    `── QUINN'S RECOMMENDATION ──────────────────`,
    recommendation,
    ``,
    `You're receiving this because you're an owner on ReadyLoq.`,
    `To unsubscribe, turn off Daily Briefing Email in your app settings.`,
    ``,
    `Powered by ReadyLoq`,
  ].join("\n");

  return { html, text, subject };
}

// ── Idempotency guard ─────────────────────────────────────────────────────────

/**
 * How long (ms) after a job starts for a given date before a retry is allowed.
 * 1 hour covers any realistic scheduler double-fire or hot-reload scenario.
 */
const IDEMPOTENCY_WINDOW_MS = 60 * 60 * 1_000;

/**
 * Keyed by UTC date string (YYYY-MM-DD) → Unix timestamp (ms) when the job
 * was first accepted for that date.  A second invocation within the window is
 * rejected immediately.  Entries older than 25 h are pruned on each run to
 * prevent unbounded growth.
 */
const acceptedRuns = new Map<string, number>();

/**
 * Remove the idempotency entry for `dateKey`.  Call in tests to reset state
 * between cases without reloading the module.
 */
export function resetBriefingLockForDate(dateKey: string): void {
  acceptedRuns.delete(dateKey);
}

// ── Main job ──────────────────────────────────────────────────────────────────

export interface BriefingJobResult {
  /** Emails actually delivered by the transport provider. */
  sent: number;
  /** Owners skipped: opted out, no email on file, or no owners in company. */
  skipped: number;
  /** Transport provider reported a delivery error. */
  failed: number;
  /** Transport not configured — emails intentionally not delivered. */
  noTransport: number;
  /** Companies processed. */
  total: number;
  /**
   * True when this invocation was dropped because the job already ran (or is
   * already running) for the same UTC date within the idempotency window.
   */
  duplicate?: true;
}

export async function runDailyBriefingJob(): Promise<BriefingJobResult> {
  const yesterday = new Date();
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  yesterday.setUTCHours(0, 0, 0, 0);
  const dateKey = yesterday.toISOString().split("T")[0]!;

  // ── Idempotency check ──────────────────────────────────────────────────────
  // Prune stale entries (older than 25 h) on every invocation.
  const cutoff = Date.now() - 25 * 60 * 60 * 1_000;
  for (const [key, ts] of acceptedRuns) {
    if (ts < cutoff) acceptedRuns.delete(key);
  }

  const firstAccepted = acceptedRuns.get(dateKey);
  if (firstAccepted !== undefined && Date.now() - firstAccepted < IDEMPOTENCY_WINDOW_MS) {
    logger.warn(
      { dateKey, firstAcceptedAt: new Date(firstAccepted).toISOString() },
      "briefing-scheduler: duplicate invocation within 1-hour window — skipping",
    );
    return { sent: 0, skipped: 0, failed: 0, noTransport: 0, total: 0, duplicate: true };
  }

  // Record the acceptance timestamp *before* any async work so a concurrent
  // second call sees the lock immediately.
  acceptedRuns.set(dateKey, Date.now());

  logger.info({ date: dateKey }, "briefing-scheduler: job started");

  const companies = await db
    .select({ id: companiesTable.id, name: companiesTable.name })
    .from(companiesTable);

  let sent = 0;
  let skipped = 0;
  let failed = 0;
  let noTransport = 0;

  for (const company of companies) {
    try {
      // Owners who have NOT opted out of the briefing email
      const owners = await db
        .select({ id: usersTable.id, clerkUserId: usersTable.clerkUserId })
        .from(usersTable)
        .where(
          and(
            eq(usersTable.companyId, company.id),
            eq(usersTable.role, "owner"),
            eq(usersTable.briefingEmailOptOut, false),
          ),
        );

      if (owners.length === 0) {
        skipped++;
        continue;
      }

      // Generate the briefing once per company (shared across all its owners).
      // The scheduler uses UTC as the reference timezone because no per-company
      // timezone is stored in the schema.  The day window is therefore UTC
      // yesterday — clients that need owner-local boundaries should call the
      // /executive/briefing/yesterday HTTP endpoint with ?tz=<IANA>.
      const { briefing } = await generateDailyExecutiveBriefing(company.id, dateKey, "UTC");

      const { html, text, subject } = buildBriefingEmail({
        companyName: company.name,
        date: briefing.date,
        summary: briefing.summary,
        inspectionsCount: briefing.inspectionsCount,
        criticalRiskCount: briefing.criticalRiskCount,
        newOpportunities: briefing.newOpportunities,
        pipelineAdded: briefing.pipelineAdded,
        recommendation: briefing.recommendation,
      });

      for (const owner of owners) {
        const email = await getClerkUserEmail(owner.clerkUserId);
        if (!email) {
          logger.warn(
            { companyId: company.id, userId: owner.id },
            "briefing-scheduler: no email found for owner — skipping",
          );
          skipped++;
          continue;
        }

        const result = await sendMail({ to: email, subject, html, text });

        if (result.delivered) {
          sent++;
        } else if (result.reason === "no_transport") {
          noTransport++;
        } else {
          // resend_error | smtp_error
          failed++;
        }
      }
    } catch (err) {
      logger.error(
        { err, companyId: company.id },
        "briefing-scheduler: failed to process company",
      );
      failed++;
    }
  }

  const summary: BriefingJobResult = { sent, skipped, failed, noTransport, total: companies.length };
  logger.info(summary, "briefing-scheduler: job complete");
  return summary;
}

// ── Scheduler registration ────────────────────────────────────────────────────

/**
 * Registers the daily 07:00 UTC cron job.
 * Call once at server startup — node-cron handles subsequent invocations.
 */
export function startBriefingScheduler(): void {
  // "0 7 * * *" — every day at 07:00 UTC
  cron.schedule(
    "0 7 * * *",
    () => {
      void runDailyBriefingJob().catch((err) => {
        logger.error({ err }, "briefing-scheduler: unhandled job error");
      });
    },
    { timezone: "UTC" },
  );

  logger.info("briefing-scheduler: registered daily 07:00 UTC cron job");
}
