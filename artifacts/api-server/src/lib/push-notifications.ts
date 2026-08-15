/**
 * Expo push notification delivery helper.
 *
 * Sends notifications via the Expo Push Notification API.
 * Uses the simple JSON HTTP API (no SDK required on the server side).
 * Best-effort: failures are logged but never throw to the caller.
 */

import { db, usersTable } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
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
    const staleTokens: string[] = [];
    const failedTokens: string[] = [];
    for (let i = 0; i < tickets.length; i++) {
      const ticket = tickets[i];
      if (ticket.status !== "error") continue;
      const token = messages[i]?.to;
      if (ticket.details?.error === "DeviceNotRegistered") {
        // The token is no longer valid (device reinstall, OS reset, etc.).
        // Clear it so the owner is prompted to re-register on next app open.
        if (token) staleTokens.push(token);
      } else {
        void logErrorEvent("notification", {
          companyId: ctx.companyId,
          inspectionId: ctx.inspectionId,
          message: `Expo push ticket error: ${ticket.message ?? "unknown"}`,
          context: { stage: "push_ticket", reason: ticket.details?.error ?? "unknown" },
        });
        // Record the failure on the owner's row so the dashboard can surface it.
        if (token) failedTokens.push(token);
      }
    }
    // Clear all stale tokens and mark delivery failure in a single pass. Each
    // update is scoped to the exact token value so it is safe even across tenants.
    for (const staleToken of staleTokens) {
      void db
        .update(usersTable)
        .set({ pushToken: null, pushLastFailedAt: sql`now()` })
        .where(eq(usersTable.pushToken, staleToken))
        .catch((err: unknown) => {
          void logErrorEvent("notification", {
            companyId: ctx.companyId,
            inspectionId: ctx.inspectionId,
            message: `Failed to clear stale push token: ${err instanceof Error ? err.message : String(err)}`,
            context: { stage: "clear_stale_token" },
          });
        });
    }
    // For non-DeviceNotRegistered errors the token is still potentially valid,
    // but we still want to surface the failure to the owner.
    for (const failedToken of failedTokens) {
      void db
        .update(usersTable)
        .set({ pushLastFailedAt: sql`now()` })
        .where(eq(usersTable.pushToken, failedToken))
        .catch((err: unknown) => {
          void logErrorEvent("notification", {
            companyId: ctx.companyId,
            inspectionId: ctx.inspectionId,
            message: `Failed to record push delivery failure: ${err instanceof Error ? err.message : String(err)}`,
            context: { stage: "record_push_failure" },
          });
        });
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

/**
 * Notify a technician that their scheduled route was updated by a manager.
 *
 * Looks up the push token for each `technicianClerkId` in `technicianClerkIds`
 * (there may be two when an inspection is reassigned: the old and new tech).
 * Best-effort — never throws.
 */
export async function notifyTechnicianRouteUpdated(input: {
  companyId: number;
  inspectionId: number;
  /** Clerk user IDs of the technician(s) to notify. Deduplicated internally. */
  technicianClerkIds: string[];
  scheduledDate: Date | null;
  siteAddress: string;
}): Promise<void> {
  const { companyId, inspectionId, technicianClerkIds, scheduledDate, siteAddress } = input;
  if (technicianClerkIds.length === 0) return;

  const uniqueIds = [...new Set(technicianClerkIds)];
  const ctx: PushContext = { companyId, inspectionId };

  // Fetch push tokens for each technician in a single query.
  // Restricting to role = technician is defense-in-depth: even if a caller
  // mistakenly passes a manager or owner Clerk ID, they will not receive the push.
  let rows: { pushToken: string | null; clerkUserId: string }[] = [];
  try {
    rows = await db
      .select({ pushToken: usersTable.pushToken, clerkUserId: usersTable.clerkUserId })
      .from(usersTable)
      .where(
        and(
          eq(usersTable.companyId, companyId),
          eq(usersTable.role, "technician"),
          eq(usersTable.pushNotificationsEnabled, true),
        ),
      );
    // Filter to only the targeted technician Clerk IDs.
    rows = rows.filter((r) => uniqueIds.includes(r.clerkUserId));
  } catch (err) {
    void logErrorEvent("notification", {
      companyId,
      inspectionId,
      message: `Failed to fetch technician push tokens: ${err instanceof Error ? err.message : String(err)}`,
      context: { stage: "push_fetch_tokens" },
    });
    return;
  }

  const tokens = rows
    .map((r) => r.pushToken)
    .filter((t): t is string => typeof t === "string" && t.startsWith("ExponentPushToken["));

  if (tokens.length === 0) return;

  // Format the date as a human-readable string (e.g. "Mon Aug 17").
  const dateLabel = scheduledDate
    ? scheduledDate.toLocaleDateString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      })
    : "upcoming";

  const shortAddress = siteAddress.length > 50 ? siteAddress.slice(0, 47) + "…" : siteAddress;

  const messages: ExpoPushMessage[] = tokens.map((token) => ({
    to: token,
    title: "Route Updated",
    body: `Your ${dateLabel} route at ${shortAddress} has been updated by your manager`,
    sound: "default",
    channelId: "route-updates",
    data: {
      screen: "inspection",
      inspectionId,
      companyId,
    },
  }));

  await sendExpoPush(messages, ctx);
}
