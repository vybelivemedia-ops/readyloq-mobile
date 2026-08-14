/**
 * SDK 54 / expo-notifications v0.32.x compatibility checks.
 *
 * These tests guard against regressions if the library is upgraded again to an
 * incompatible version.  They validate:
 *
 *  1. The app.json expo-notifications plugin config contains only fields that
 *     are recognised by the v0.32.x plugin (icon, color, sounds).  Fields that
 *     belonged to other versions (androidMode, androidCollapsedTitle) must be
 *     absent — they are silently ignored by the build plugin, which means icon
 *     and color customisations work but the missing-field warning fires during
 *     `eas build`, causing confusion.
 *
 *  2. The server-side push payload always includes `channelId: "critical-alerts"`
 *     so Android 8+ routes the notification to the correct channel (the one the
 *     app creates at startup with MAX importance).  Without this, Android
 *     delivers the push to the default channel with normal importance.
 *
 *  3. The server-side push payload never includes non-Expo token formats —
 *     the token filter guards against accidentally forwarding FCM/APNs tokens
 *     to the Expo push API.
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import * as fs from "fs";
import * as path from "path";

// ── fetch stub (keeps tests hermetic) ──────────────────────────────────────────
const { fetchState } = vi.hoisted(() => ({
  fetchState: {
    calls: [] as { url: string; body: unknown }[],
  },
}));

vi.stubGlobal(
  "fetch",
  vi.fn(async (url: string, options?: RequestInit) => {
    const body =
      options?.body != null ? JSON.parse(options.body as string) : null;
    fetchState.calls.push({ url, body });
    return {
      ok: true,
      status: 200,
      json: async () => ({ data: [{ status: "ok", id: "ticket-sdk54" }] }),
      text: async () => '{"data":[{"status":"ok","id":"ticket-sdk54"}]}',
    } as Response;
  }),
);

// Mocks required by imports pulled in transitively through push-notifications.ts
vi.mock("../scorecard", () => ({
  runScorecardComputation: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../opportunity-ai", () => ({
  runOpportunitySynthesis: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../report-narrative-ai", () => ({
  generateReportNarrative: vi.fn().mockResolvedValue("mocked narrative"),
  derivePropertyType: vi.fn().mockReturnValue("residential"),
}));
vi.mock("../customer-summary-ai", () => ({
  generateCustomerSummaryBody: vi.fn().mockResolvedValue("mocked summary"),
  SummaryFidelityError: class SummaryFidelityError extends Error {},
}));
vi.mock("../property-memory-writer", () => ({
  writePropertyMemory: vi.fn().mockResolvedValue(undefined),
}));

import {
  db,
  usersTable,
  companiesTable,
  inspectionsTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { notifyCriticalInspection } from "../push-notifications";

// ─────────────────────────────────────────────────────────────────────────────
// 1.  app.json plugin config — valid fields only for v0.32.x
// ─────────────────────────────────────────────────────────────────────────────

describe("expo-notifications v0.32.x app.json plugin config", () => {
  // Resolve app.json relative to this test file so the path works regardless
  // of the working directory used by vitest.
  const appJsonPath = path.resolve(
    __dirname,
    "../../../../readyloq-app/app.json",
  );

  let pluginConfig: Record<string, unknown>;

  beforeAll(() => {
    const raw = fs.readFileSync(appJsonPath, "utf8");
    const appJson = JSON.parse(raw) as {
      expo: { plugins: Array<string | [string, Record<string, unknown>]> };
    };

    const entry = appJson.expo.plugins.find(
      (p): p is [string, Record<string, unknown>] =>
        Array.isArray(p) && p[0] === "expo-notifications",
    );
    expect(entry, "expo-notifications plugin entry must exist in app.json").toBeDefined();
    pluginConfig = entry![1];
  });

  it("has an icon field pointing to the notification icon asset", () => {
    expect(typeof pluginConfig.icon).toBe("string");
    expect(pluginConfig.icon).toContain("icon");
  });

  it("has a color field for the notification icon tint", () => {
    expect(typeof pluginConfig.color).toBe("string");
    // Must be a valid hex color.
    expect(pluginConfig.color).toMatch(/^#[0-9a-fA-F]{3,8}$/);
  });

  it("has a sounds array (may be empty)", () => {
    expect(Array.isArray(pluginConfig.sounds)).toBe(true);
  });

  it("does NOT include androidMode — unsupported in v0.32.x plugin", () => {
    expect(pluginConfig).not.toHaveProperty("androidMode");
  });

  it("does NOT include androidCollapsedTitle — unsupported in v0.32.x plugin", () => {
    expect(pluginConfig).not.toHaveProperty("androidCollapsedTitle");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2.  Server-side payload always includes channelId: "critical-alerts"
// ─────────────────────────────────────────────────────────────────────────────

const COMPAT_COMPANY_SLUG = "sdk54-compat-test-co";
const OWNER_CLERK = "sdk54_compat_owner";
const VALID_TOKEN = "ExponentPushToken[sdk54compattoken000]";
const SITE = "1 SDK54 Compat Lane";

let companyId: number;
let inspectionId: number;

beforeAll(async () => {
  const [existing] = await db
    .select()
    .from(companiesTable)
    .where(eq(companiesTable.slug, COMPAT_COMPANY_SLUG));
  companyId = existing
    ? existing.id
    : (
        await db
          .insert(companiesTable)
          .values({ name: "SDK54 Compat Test Co", slug: COMPAT_COMPANY_SLUG })
          .returning()
      )[0].id;
});

beforeEach(async () => {
  fetchState.calls = [];
  await db.delete(usersTable).where(eq(usersTable.companyId, companyId));
  await db.delete(inspectionsTable).where(eq(inspectionsTable.companyId, companyId));

  await db.insert(usersTable).values({
    clerkUserId: OWNER_CLERK,
    role: "owner",
    companyId,
    pushToken: VALID_TOKEN,
    pushNotificationsEnabled: true,
  });

  const [insp] = await db
    .insert(inspectionsTable)
    .values({
      companyId,
      siteAddress: SITE,
      technicianName: "SDK Tester",
      clientName: "SDK Client",
      pestTypes: ["rodents"],
    })
    .returning();
  inspectionId = insp.id;
});

function expoCalls() {
  return fetchState.calls.filter(
    (c) => typeof c.url === "string" && c.url.includes("exp.host"),
  );
}

describe("notifyCriticalInspection — Android channel routing (SDK 54)", () => {
  it("includes channelId 'critical-alerts' in every push message so Android 8+ routes to the high-importance channel", async () => {
    await notifyCriticalInspection({
      companyId,
      inspectionId,
      siteAddress: SITE,
      technicianName: "SDK Tester",
    });

    const calls = expoCalls();
    expect(calls).toHaveLength(1);
    const messages = calls[0].body as Array<Record<string, unknown>>;
    expect(messages).toHaveLength(1);
    expect(messages[0].channelId).toBe("critical-alerts");
  });

  it("never sends to a non-ExponentPushToken format token (FCM / APNs guard)", async () => {
    // Replace the owner's token with an FCM-style token.
    await db
      .update(usersTable)
      .set({ pushToken: "fcm:APA91bSomeGCMToken" })
      .where(eq(usersTable.clerkUserId, OWNER_CLERK));

    await notifyCriticalInspection({
      companyId,
      inspectionId,
      siteAddress: SITE,
      technicianName: null,
    });

    // Non-Expo tokens must be filtered out — Expo must not be called at all.
    expect(expoCalls()).toHaveLength(0);
  });
});
