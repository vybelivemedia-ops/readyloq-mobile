/**
 * Expo push notification delivery helper.
 *
 * Sends notifications via the Expo Push Notification API.
 * Uses the simple JSON HTTP API (no SDK required on the server side).
 * Best-effort: failures are logged but never throw to the caller.
 */

import { db, usersTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { logErrorEvent } from "./error-events";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

interface ExpoPushMessage {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: "default" | null;
  badge?: number;
  channelId?: string;
}

interface ExpoPushTicket {
  status: "ok" | "error";
  id?: string;
  message?: string;
  details?: { error?: string };
}

/** Tenant context forwarded to error-event logging when delivery fails. */
interface PushContext {
  companyId: number;
  inspectionId: number;
}

/**
 * Send Expo push notifications in a single batch request.
 * Errors are logged under the originating tenant, never thrown.
 */
async function sendExpoPush(messages: ExpoPushMessage[], ctx: PushContext): Promise<void> {
  if (messages.length === 0) return;
  try {
    const response = await fetch(EXPO_PUSH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(messages),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "(unreadable)");
      void logErrorEvent("notification", {
        companyId: ctx.companyId,
        inspectionId: ctx.inspectionId,
        message: `Expo push API returned ${response.status}: ${body}`,
        context: { stage: "push_send", tokenCount: messages.length },
      });
      return;
    }
    const json = (await response.json()) as { data?: ExpoPushTicket[] };
    const tickets = json.data ?? [];
    for (const ticket of tickets) {
      if (ticket.status === "error") {
        void logErrorEvent("notification", {
          companyId: ctx.companyId,
          inspectionId: ctx.inspectionId,
          message: `Expo push ticket error: ${ticket.message ?? "unknown"}`,
          context: { errorCode: ticket.details?.error },
        });
      }
    }
  } catch (err) {
    void logErrorEvent("notification", {
      companyId: ctx.companyId,
      inspectionId: ctx.inspectionId,
      message: `Expo push send failed: ${err instanceof Error ? err.message : String(err)}`,
      context: { stage: "push_send", tokenCount: messages.length },
    });
  }
}

/**
 * Notify all owner push tokens for a company that a critical-risk inspection
 * was just completed. Only owners with notifications enabled and a token on
 * file receive the push. Best-effort — never throws.
 */
export async function notifyCriticalInspection(input: {
  companyId: number;
  inspectionId: number;
  siteAddress: string;
  technicianName: string | null;
}): Promise<void> {
  const { companyId, inspectionId, siteAddress, technicianName } = input;
  const ctx: PushContext = { companyId, inspectionId };

  // Fetch all owner tokens for this company that have opted in.
  let owners: { pushToken: string | null }[] = [];
  try {
    owners = await db
      .select({ pushToken: usersTable.pushToken })
      .from(usersTable)
      .where(
        and(
          eq(usersTable.companyId, companyId),
          eq(usersTable.role, "owner"),
          eq(usersTable.pushNotificationsEnabled, true),
        ),
      );
  } catch (err) {
    void logErrorEvent("notification", {
      companyId,
      inspectionId,
      message: `Failed to fetch owner push tokens: ${err instanceof Error ? err.message : String(err)}`,
      context: { stage: "push_fetch_tokens" },
    });
    return;
  }

  const tokens = owners
    .map((o) => o.pushToken)
    .filter((t): t is string => typeof t === "string" && t.startsWith("ExponentPushToken["));

  if (tokens.length === 0) return;

  const tech = technicianName ? ` by ${technicianName}` : "";
  const shortAddress = siteAddress.length > 60 ? siteAddress.slice(0, 57) + "…" : siteAddress;

  const messages: ExpoPushMessage[] = tokens.map((token) => ({
    to: token,
    title: "🚨 Critical Risk Inspection Completed",
    body: `${shortAddress}${tech} — tap to view`,
    sound: "default",
    channelId: "critical-alerts",
    data: {
      screen: "inspection",
      inspectionId,
      companyId,
    },
  }));

  await sendExpoPush(messages, ctx);
}
