import { sendMail } from "./mailer";
import { logger } from "./logger";

export type PilotEmailOutcome = "accepted" | "unconfigured" | "failed";

/** Mirrors the existing mailer's transport precedence without exposing values. */
export function pilotEmailConfigured(): boolean {
  const present = (key: string) => Boolean(process.env[key]?.trim());
  if (present("RESEND_API_KEY")) {
    return present("RESEND_FROM") || present("SMTP_FROM");
  }
  return present("SMTP_HOST") && present("SMTP_USER") && present("SMTP_PASS");
}

const subject = "ReadyLoq pilot details";
const text = `Thanks for your interest in the ReadyLoq pilot.

ReadyLoq helps turn completed inspections, photos and findings into an owner-ready morning review for home, apartment, restaurant and commercial inspection teams.

We've received your interest and will follow up with next steps and pilot availability.

The ReadyLoq team`;
const html = `<p>Thanks for your interest in the ReadyLoq pilot.</p>
<p>ReadyLoq helps turn completed inspections, photos and findings into an owner-ready morning review for home, apartment, restaurant and commercial inspection teams.</p>
<p>We've received your interest and will follow up with next steps and pilot availability.</p>
<p>The ReadyLoq team</p>`;

export async function sendPilotDetails(email: string, leadId: number): Promise<PilotEmailOutcome> {
  if (!pilotEmailConfigured()) {
    logger.warn({ leadId }, "pilot email: transport or sender is not configured");
    return "unconfigured";
  }
  try {
    const result = await sendMail({ to: email, subject, text, html, timeoutMs: 10_000 });
    if (result.delivered) return "accepted";
    logger.warn({ leadId, reason: result.reason }, "pilot email: provider did not accept delivery");
    return result.reason === "no_transport" ? "unconfigured" : "failed";
  } catch {
    logger.warn({ leadId }, "pilot email: transport failed");
    return "failed";
  }
}
