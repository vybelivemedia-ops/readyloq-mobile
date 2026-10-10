/**
 * Advanced SSRF tests for the integrations config and probe pipeline (task #653).
 *
 * Covers:
 *   1. DNS-level validation at PUT /config save time — hostname resolving to a
 *      private IPv4 address is rejected before the row is persisted.
 *   2. Redirect safety — probe fetch is called with redirect:'error' so a
 *      public-host-to-private-host redirect is never followed.
 *   3. The catch blocks in probePestPac / probeFieldRoutes surface network_error
 *      for the TypeError that redirect:'error' throws on a 3xx response.
 */

import { beforeAll, afterAll, beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

// ── Clerk mock ────────────────────────────────────────────────────────────────

const { authState } = vi.hoisted(() => ({
  authState: { userId: null as string | null },
}));

vi.mock("@clerk/express", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@clerk/express")>();
  return {
    ...actual,
    getAuth: () => authState,
    clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  };
});

// ── node:dns mock — controlled per test ──────────────────────────────────────

const dnsResolve4 = vi.fn<() => Promise<string[]>>().mockResolvedValue([]);
const dnsResolve6 = vi.fn<() => Promise<string[]>>().mockResolvedValue([]);

vi.mock("node:dns", () => ({
  promises: {
    resolve4: (...args: unknown[]) => dnsResolve4(...(args as [])),
    resolve6: (...args: unknown[]) => dnsResolve6(...(args as [])),
  },
}));

// ── Imports ───────────────────────────────────────────────────────────────────

import app from "../../app";
import { db, companiesTable, usersTable, companyFieldIntegrationsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { probeIntegrationCredentials } from "../../services/field-integration";
import * as ssrfModule from "../../lib/ssrf-safe-fetch";

// ── Per-run unique identifiers ────────────────────────────────────────────────

const RUN_ID = Date.now();
const OWNER_CLERK_ID = `test_ssrf_adv_owner_${RUN_ID}`;

let companyId: number;
let userId: number;

// ── Test DB setup / teardown ──────────────────────────────────────────────────

beforeAll(async () => {
  const [company] = await db
    .insert(companiesTable)
    .values({ name: `SSRF Advanced Test Co ${RUN_ID}`, slug: `ssrf-adv-${RUN_ID}` })
    .returning();
  companyId = company.id;

  const [user] = await db
    .insert(usersTable)
    .values({ clerkUserId: OWNER_CLERK_ID, role: "owner", companyId })
    .returning();
  userId = user.id;

  authState.userId = OWNER_CLERK_ID;
});

afterAll(async () => {
  authState.userId = null;
  await db
    .delete(companyFieldIntegrationsTable)
    .where(eq(companyFieldIntegrationsTable.companyId, companyId));
  await db.delete(usersTable).where(eq(usersTable.id, userId));
  await db.delete(companiesTable).where(eq(companiesTable.id, companyId));
});

beforeEach(() => {
  dnsResolve4.mockResolvedValue([]);
  dnsResolve6.mockResolvedValue([]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ── DNS-level validation ──────────────────────────────────────────────────────

describe("PUT /api/integrations/config — DNS-level private IP rejection", () => {
  it("rejects a hostname that DNS resolves to a private RFC1918 IPv4 address (400)", async () => {
    // Simulate an attacker-controlled public hostname that resolves to 192.168.1.1.
    dnsResolve4.mockResolvedValue(["192.168.1.1"]);
    dnsResolve6.mockResolvedValue([]);

    const res = await request(app)
      .put("/api/integrations/config")
      .send({
        systemType: "pestpac",
        accountId: "acct-dns",
        apiKey: "key-dns",
        apiBaseUrl: "https://evil-public-host.example.com",
      })
      .expect(400);

    expect(res.body.error).toMatch(/Invalid config/i);
    const issue = (res.body.issues as Array<{ message: string; path: string[] }>).find(
      (i) => i.path.includes("apiBaseUrl"),
    );
    expect(issue).toBeDefined();
    expect(issue!.message).toMatch(/private|reserved/i);
  });

  it("rejects a hostname that DNS resolves to 10.x.x.x (RFC1918 class A)", async () => {
    dnsResolve4.mockResolvedValue(["10.0.0.1"]);

    const res = await request(app)
      .put("/api/integrations/config")
      .send({
        systemType: "pestpac",
        accountId: "acct-dns",
        apiKey: "key-dns",
        apiBaseUrl: "https://another-evil-host.example.com",
      })
      .expect(400);

    const issue = (res.body.issues as Array<{ message: string; path: string[] }>).find(
      (i) => i.path.includes("apiBaseUrl"),
    );
    expect(issue).toBeDefined();
  });

  it("rejects a hostname that DNS resolves to 127.0.0.1 (loopback)", async () => {
    dnsResolve4.mockResolvedValue(["127.0.0.1"]);

    const res = await request(app)
      .put("/api/integrations/config")
      .send({
        systemType: "pestpac",
        accountId: "acct-loopback",
        apiKey: "key-loopback",
        apiBaseUrl: "https://sneaky-loopback.example.com",
      })
      .expect(400);

    const issue = (res.body.issues as Array<{ message: string; path: string[] }>).find(
      (i) => i.path.includes("apiBaseUrl"),
    );
    expect(issue).toBeDefined();
  });

  it("accepts a hostname that DNS resolves to a public IPv4 address (200)", async () => {
    // 8.8.8.8 is 8.8.8.8 is a globally-routable public IP (Google DNS) used as a stand-in.
    dnsResolve4.mockResolvedValue(["8.8.8.8"]);

    const res = await request(app)
      .put("/api/integrations/config")
      .send({
        systemType: "pestpac",
        accountId: "acct-public",
        apiKey: "key-public",
        apiBaseUrl: "https://api.pestpac.com",
      })
      .expect(200);

    expect(res.body.configured).toBe(true);
  });

  it("allows save when DNS resolution fails (hostname may not exist yet or network unavailable)", async () => {
    // DNS NXDOMAIN / timeout — do not block the save; the sync itself will fail clearly.
    dnsResolve4.mockRejectedValue(new Error("ENOTFOUND future-host.example.com"));
    dnsResolve6.mockRejectedValue(new Error("ENOTFOUND future-host.example.com"));

    const res = await request(app)
      .put("/api/integrations/config")
      .send({
        systemType: "pestpac",
        accountId: "acct-nxdomain",
        apiKey: "key-nxdomain",
        apiBaseUrl: "https://future-host.example.com",
      })
      .expect(200);

    expect(res.body.configured).toBe(true);
  });
});

// ── TOCTOU / DNS rebinding ────────────────────────────────────────────────────

describe("POST /api/integrations/test — strict DNS re-validation prevents DNS rebinding", () => {
  it("rejects test when stored hostname now resolves to a private address (TOCTOU rebinding)", async () => {
    // Phase 1 — save time: hostname resolves to a public IP → save succeeds.
    dnsResolve4.mockResolvedValueOnce(["8.8.8.8"]); // public
    dnsResolve6.mockResolvedValueOnce([]);

    const saveRes = await request(app)
      .put("/api/integrations/config")
      .send({
        systemType: "pestpac",
        accountId: "acct-rebind",
        apiKey: "key-rebind",
        apiBaseUrl: "https://rebindable.example.com",
      })
      .expect(200);
    expect(saveRes.body.configured).toBe(true);

    // Phase 2 — attacker rebinds the DNS: same hostname now resolves to a private IP.
    dnsResolve4.mockResolvedValue(["192.168.1.100"]); // private — rebinding attack
    dnsResolve6.mockResolvedValue([]);

    // Test connection must fail closed — not send credentials to the private host.
    const testRes = await request(app)
      .post("/api/integrations/test")
      .send({})
      .expect(200); // endpoint returns 200 with ok:false (not HTTP 4xx)

    expect(testRes.body.ok).toBe(false);
    expect(testRes.body.reason).toBe("network_error");
    expect(testRes.body.message).toMatch(/private|reserved/i);
  });

  it("rejects test when DNS resolution returns zero records (fail-closed strict mode)", async () => {
    // Save with public resolution
    dnsResolve4.mockResolvedValueOnce(["8.8.8.8"]);
    dnsResolve6.mockResolvedValueOnce([]);

    await request(app)
      .put("/api/integrations/config")
      .send({
        systemType: "pestpac",
        accountId: "acct-nodns",
        apiKey: "key-nodns",
        apiBaseUrl: "https://no-dns-at-test-time.example.com",
      })
      .expect(200);

    // At test time, DNS returns empty (NXDOMAIN or resolution error) — fail closed.
    dnsResolve4.mockResolvedValue([]);
    dnsResolve6.mockResolvedValue([]);

    const testRes = await request(app)
      .post("/api/integrations/test")
      .send({})
      .expect(200);

    expect(testRes.body.ok).toBe(false);
    expect(testRes.body.reason).toBe("network_error");
  });
});

// ── Redirect safety and SSRF-safe fetch options ───────────────────────────────

describe("Probe adapters — ssrfSafeFetch is used with redirect:'error' options", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("probePestPac calls ssrfSafeFetch with redirect:'error'", async () => {
    // DNS must resolve (mock as public IP so ssrfAgent connect callback passes).
    dnsResolve4.mockResolvedValue(["8.8.8.8"]);
    dnsResolve6.mockResolvedValue([]);

    const ssrfSpy = vi
      .spyOn(ssrfModule, "ssrfSafeFetch")
      .mockResolvedValue(new Response("{}", { status: 200 }));

    await probeIntegrationCredentials(
      "pestpac",
      "test-api-key",
      "test-account",
      "https://api.pestpac.com/v1",
    );

    expect(ssrfSpy).toHaveBeenCalledWith(
      expect.stringContaining("/customers/"),
      expect.objectContaining({ redirect: "error" }),
    );
  });

  it("probeFieldRoutes calls ssrfSafeFetch with redirect:'error'", async () => {
    dnsResolve4.mockResolvedValue(["8.8.8.8"]);
    dnsResolve6.mockResolvedValue([]);

    const ssrfSpy = vi
      .spyOn(ssrfModule, "ssrfSafeFetch")
      .mockResolvedValue(new Response("{}", { status: 200 }));

    await probeIntegrationCredentials(
      "fieldroutes",
      "test-api-key",
      "test-account",
      "https://api.fieldroutes.com/api/v1",
      "test-api-token",
    );

    expect(ssrfSpy).toHaveBeenCalledWith(
      expect.stringContaining("/customer/"),
      expect.objectContaining({ redirect: "error" }),
    );
  });

  it("probePestPac returns network_error when ssrfSafeFetch throws TypeError (redirect interception)", async () => {
    // Simulate undici throwing TypeError when redirect:'error' and a 3xx is received.
    vi.spyOn(ssrfModule, "ssrfSafeFetch").mockRejectedValue(
      Object.assign(new TypeError("fetch failed"), {
        cause: new Error("redirect mode is set to error: https://192.168.1.1/api"),
      }),
    );

    const result = await probeIntegrationCredentials(
      "pestpac",
      "key",
      "acct",
      "https://api.pestpac.com/v1",
    );

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("network_error");
    expect(result.message).toMatch(/Could not reach/i);
  });

  it("probeFieldRoutes returns network_error when ssrfSafeFetch throws TypeError (redirect interception)", async () => {
    vi.spyOn(ssrfModule, "ssrfSafeFetch").mockRejectedValue(
      Object.assign(new TypeError("fetch failed"), {
        cause: new Error("redirect mode is set to error: https://10.0.0.1/api"),
      }),
    );

    const result = await probeIntegrationCredentials(
      "fieldroutes",
      "key",
      "acct",
      "https://api.fieldroutes.com/api/v1",
      "token",
    );

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("network_error");
  });

  it("ssrfSafeFetch DNS-pinning blocks SSRF: SSRF guard error surfaces as network_error", async () => {
    // Simulate ssrfSafeFetch's connect hook blocking a private-resolving hostname.
    // The agent rejects with the SSRF guard Error (not a TypeError).
    vi.spyOn(ssrfModule, "ssrfSafeFetch").mockRejectedValue(
      new Error("SSRF guard: 'internal.vendor.com' resolves to blocked address 10.0.0.5 — refusing connection"),
    );

    const result = await probeIntegrationCredentials(
      "pestpac",
      "key",
      "acct",
      "https://internal.vendor.com/api",
    );

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("network_error");
  });
});
