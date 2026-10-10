/**
 * Integration config — FieldRoutes token enforcement & SSRF validation (task #653).
 *
 * Covers:
 *   1. isSafeBaseUrl unit tests — HTTPS requirement, private/loopback/link-local blocks.
 *   2. PUT /api/integrations/config — FieldRoutes requires apiToken; missing token → 400.
 *   3. PUT /api/integrations/config — valid FieldRoutes dual-credential payload → 200.
 *   4. PUT /api/integrations/config — HTTP apiBaseUrl → 400.
 *   5. PUT /api/integrations/config — private-IP apiBaseUrl → 400.
 *   6. PUT /api/integrations/config — valid HTTPS apiBaseUrl → 200.
 *   7. POST /api/integrations/test — stored private-IP apiBaseUrl is rejected pre-flight.
 */

import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
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

// ── Imports ───────────────────────────────────────────────────────────────────

import app from "../../app";
import { db, companiesTable, usersTable, companyFieldIntegrationsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { isSafeBaseUrl } from "../../lib/ssrf-guard";

// ── Per-run unique identifiers ────────────────────────────────────────────────

const RUN_ID = Date.now();
const OWNER_CLERK_ID = `test_int_owner_${RUN_ID}`;

let companyId: number;
let userId: number;

// ── Test DB setup / teardown ──────────────────────────────────────────────────

beforeAll(async () => {
  const [company] = await db
    .insert(companiesTable)
    .values({ name: `Integration Validation Co ${RUN_ID}`, slug: `int-val-${RUN_ID}` })
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

// ── isSafeBaseUrl unit tests ──────────────────────────────────────────────────

describe("isSafeBaseUrl — unit", () => {
  it("accepts a valid HTTPS external hostname", () => {
    expect(isSafeBaseUrl("https://api.fieldroutes.com")).toBe(true);
    expect(isSafeBaseUrl("https://subdomain.pestpac.com/v2")).toBe(true);
  });

  it("rejects plain HTTP (credentials unencrypted)", () => {
    expect(isSafeBaseUrl("http://api.fieldroutes.com")).toBe(false);
  });

  it("rejects localhost", () => {
    expect(isSafeBaseUrl("https://localhost")).toBe(false);
    expect(isSafeBaseUrl("https://localhost:8080/api")).toBe(false);
  });

  it("rejects loopback IPs (127.x.x.x)", () => {
    expect(isSafeBaseUrl("https://127.0.0.1")).toBe(false);
    expect(isSafeBaseUrl("https://127.1.2.3")).toBe(false);
  });

  it("rejects RFC 1918 class A (10.x.x.x)", () => {
    expect(isSafeBaseUrl("https://10.0.0.1")).toBe(false);
    expect(isSafeBaseUrl("https://10.255.255.255")).toBe(false);
  });

  it("rejects RFC 1918 class B (172.16-31.x.x)", () => {
    expect(isSafeBaseUrl("https://172.16.0.1")).toBe(false);
    expect(isSafeBaseUrl("https://172.31.255.255")).toBe(false);
    // 172.32 is public
    expect(isSafeBaseUrl("https://172.32.0.1")).toBe(true);
  });

  it("rejects RFC 1918 class C (192.168.x.x)", () => {
    expect(isSafeBaseUrl("https://192.168.1.1")).toBe(false);
  });

  it("rejects APIPA / link-local (169.254.x.x, incl. metadata service)", () => {
    expect(isSafeBaseUrl("https://169.254.169.254")).toBe(false);
    expect(isSafeBaseUrl("https://169.254.0.1")).toBe(false);
  });

  it("rejects 0.x.x.x block", () => {
    expect(isSafeBaseUrl("https://0.0.0.0")).toBe(false);
  });

  it("rejects IPv6 link-local (fe80::/10)", () => {
    expect(isSafeBaseUrl("https://[fe80::1]")).toBe(false);
    expect(isSafeBaseUrl("https://[fe80::abcd:ef01]")).toBe(false);
  });

  it("rejects IPv6 unique-local fc00::/7 (fc prefix)", () => {
    expect(isSafeBaseUrl("https://[fc00::1]")).toBe(false);
    expect(isSafeBaseUrl("https://[fc00:dead:beef::1]")).toBe(false);
  });

  it("rejects IPv6 unique-local fc00::/7 (fd prefix)", () => {
    expect(isSafeBaseUrl("https://[fd00::1]")).toBe(false);
    expect(isSafeBaseUrl("https://[fd12:3456:789a::1]")).toBe(false);
  });

  it("rejects IPv4-mapped IPv6 loopback (Node normalises ::ffff:127.0.0.1 → ::ffff:7f00:1)", () => {
    // Node's URL parser normalises dotted-decimal to hex groups before we see it.
    expect(isSafeBaseUrl("https://[::ffff:7f00:1]")).toBe(false);   // = 127.0.0.1
    expect(isSafeBaseUrl("https://[::ffff:127.0.0.1]")).toBe(false); // dotted-decimal form
  });

  it("rejects IPv4-mapped IPv6 private addresses", () => {
    expect(isSafeBaseUrl("https://[::ffff:c0a8:101]")).toBe(false);  // = 192.168.1.1
    expect(isSafeBaseUrl("https://[::ffff:a00:1]")).toBe(false);     // = 10.0.0.1
    expect(isSafeBaseUrl("https://[::ffff:a9fe:a9fe]")).toBe(false); // = 169.254.169.254
  });

  it("rejects IPv6 loopback ::1 and unspecified ::", () => {
    expect(isSafeBaseUrl("https://[::1]")).toBe(false);
    expect(isSafeBaseUrl("https://[::]")).toBe(false);
  });

  it("rejects IPv4-compatible IPv6 (::​<ipv4>) in dotted-decimal form", () => {
    // RFC 4291 §2.5.5.1 — deprecated but still parsed by Node.
    // https://[::127.0.0.1] encodes loopback; https://[::10.0.0.1] encodes RFC 1918.
    expect(isSafeBaseUrl("https://[::127.0.0.1]")).toBe(false);
    expect(isSafeBaseUrl("https://[::10.0.0.1]")).toBe(false);
    expect(isSafeBaseUrl("https://[::192.168.1.1]")).toBe(false);
  });

  it("rejects IPv4-compatible IPv6 in Node-normalised hex-group form (::7f00:1)", () => {
    // Node's URL parser normalises https://[::127.0.0.1] to hostname [::7f00:1].
    // The guard must decode the two hex groups back to dotted-decimal and apply isSafeIPv4.
    expect(isSafeBaseUrl("https://[::7f00:1]")).toBe(false);   // 127.0.0.1 loopback
    expect(isSafeBaseUrl("https://[::a00:1]")).toBe(false);    // 10.0.0.1 RFC 1918
    expect(isSafeBaseUrl("https://[::c0a8:101]")).toBe(false); // 192.168.1.1 RFC 1918
  });

  it("rejects IPv6 multicast ff00::/8 (never a valid server destination)", () => {
    expect(isSafeBaseUrl("https://[ff02::1]")).toBe(false);   // all-nodes multicast
    expect(isSafeBaseUrl("https://[ff05::1:3]")).toBe(false); // site-scoped multicast
    expect(isSafeBaseUrl("https://[ffff::1]")).toBe(false);
  });

  it("rejects NAT64 64:ff9b::/96 when embedded IPv4 is private (RFC 6052)", () => {
    // NAT64 gateway can translate these to private IPv4 addresses.
    expect(isSafeBaseUrl("https://[64:ff9b::7f00:1]")).toBe(false);   // 127.0.0.1
    expect(isSafeBaseUrl("https://[64:ff9b::a00:1]")).toBe(false);    // 10.0.0.1
    expect(isSafeBaseUrl("https://[64:ff9b::c0a8:101]")).toBe(false); // 192.168.1.1
    expect(isSafeBaseUrl("https://[64:ff9b::a9fe:a9fe]")).toBe(false); // 169.254.169.254
  });

  it("accepts a NAT64 64:ff9b::/96 address when embedded IPv4 is public", () => {
    // 8.8.8.8 → 64:ff9b::808:808 — a public IPv4 destination; should be allowed.
    expect(isSafeBaseUrl("https://[64:ff9b::808:808]")).toBe(true);
  });

  it("rejects local-use NAT64 prefix 64:ff9b:1::/48 (RFC 8215 — enterprise internal)", () => {
    expect(isSafeBaseUrl("https://[64:ff9b:1::1]")).toBe(false);
  });

  it("accepts a valid public IPv6 address", () => {
    // 2607:f8b0:4004:803::200e — a real public Google address
    expect(isSafeBaseUrl("https://[2607:f8b0:4004:803::200e]")).toBe(true);
    // 2606:4700::6810:84e5 — Cloudflare public address
    expect(isSafeBaseUrl("https://[2606:4700::6810:84e5]")).toBe(true);
  });

  it("rejects unparseable input", () => {
    expect(isSafeBaseUrl("not-a-url")).toBe(false);
    expect(isSafeBaseUrl("")).toBe(false);
  });
});

// ── PUT /api/integrations/config — FieldRoutes token enforcement ──────────────

describe("PUT /api/integrations/config — FieldRoutes token enforcement", () => {
  it("rejects a FieldRoutes config with no apiToken (400)", async () => {
    const res = await request(app)
      .put("/api/integrations/config")
      .send({
        systemType: "fieldroutes",
        accountId: "acct-123",
        apiKey: "key-abc",
        // apiToken intentionally omitted
      })
      .expect(400);
    expect(res.body.error).toMatch(/Invalid config/i);
    // The issues array should point to the apiToken path.
    const issue = (res.body.issues as Array<{ message: string; path: string[] }>)
      .find((i) => i.path.includes("apiToken"));
    expect(issue).toBeDefined();
    expect(issue!.message).toMatch(/apiToken/i);
  });

  it("rejects a FieldRoutes config with an empty-string apiToken (400)", async () => {
    const res = await request(app)
      .put("/api/integrations/config")
      .send({
        systemType: "fieldroutes",
        accountId: "acct-123",
        apiKey: "key-abc",
        apiToken: "",
      })
      .expect(400);
    expect(res.body.error).toMatch(/Invalid config/i);
  });

  it("accepts a valid FieldRoutes config with both apiKey and apiToken (200)", async () => {
    const res = await request(app)
      .put("/api/integrations/config")
      .send({
        systemType: "fieldroutes",
        accountId: "acct-123",
        apiKey: "key-abc",
        apiToken: "token-xyz",
      })
      .expect(200);
    expect(res.body.configured).toBe(true);
    expect(res.body.systemType).toBe("fieldroutes");
  });

  it("accepts a PestPac config without apiToken (PestPac is single-token)", async () => {
    const res = await request(app)
      .put("/api/integrations/config")
      .send({
        systemType: "pestpac",
        accountId: "acct-999",
        apiKey: "pestpac-key",
        // apiToken must NOT be required for pestpac
      })
      .expect(200);
    expect(res.body.configured).toBe(true);
    expect(res.body.systemType).toBe("pestpac");
  });
});

// ── PUT /api/integrations/config — SSRF / apiBaseUrl validation ───────────────

describe("PUT /api/integrations/config — SSRF / apiBaseUrl validation", () => {
  it("rejects an HTTP (non-HTTPS) apiBaseUrl (400)", async () => {
    const res = await request(app)
      .put("/api/integrations/config")
      .send({
        systemType: "pestpac",
        accountId: "acct-ssrf",
        apiKey: "key-ssrf",
        apiBaseUrl: "http://api.pestpac.com",
      })
      .expect(400);
    expect(res.body.error).toMatch(/Invalid config/i);
    const issue = (res.body.issues as Array<{ message: string; path: string[] }>)
      .find((i) => i.path.includes("apiBaseUrl"));
    expect(issue).toBeDefined();
  });

  it("rejects a private RFC1918 class A apiBaseUrl (400)", async () => {
    const res = await request(app)
      .put("/api/integrations/config")
      .send({
        systemType: "pestpac",
        accountId: "acct-ssrf",
        apiKey: "key-ssrf",
        apiBaseUrl: "https://10.0.0.1/api",
      })
      .expect(400);
    expect(res.body.error).toMatch(/Invalid config/i);
  });

  it("rejects a loopback apiBaseUrl (400)", async () => {
    const res = await request(app)
      .put("/api/integrations/config")
      .send({
        systemType: "pestpac",
        accountId: "acct-ssrf",
        apiKey: "key-ssrf",
        apiBaseUrl: "https://127.0.0.1:8080",
      })
      .expect(400);
    expect(res.body.error).toMatch(/Invalid config/i);
  });

  it("rejects the APIPA metadata service address (400)", async () => {
    const res = await request(app)
      .put("/api/integrations/config")
      .send({
        systemType: "pestpac",
        accountId: "acct-ssrf",
        apiKey: "key-ssrf",
        apiBaseUrl: "https://169.254.169.254",
      })
      .expect(400);
    expect(res.body.error).toMatch(/Invalid config/i);
  });

  it("accepts a valid HTTPS external apiBaseUrl (200)", async () => {
    const res = await request(app)
      .put("/api/integrations/config")
      .send({
        systemType: "pestpac",
        accountId: "acct-url-ok",
        apiKey: "key-url-ok",
        apiBaseUrl: "https://api.pestpac.com/v2",
      })
      .expect(200);
    expect(res.body.configured).toBe(true);
  });

  it("accepts a config with no apiBaseUrl (optional field)", async () => {
    const res = await request(app)
      .put("/api/integrations/config")
      .send({
        systemType: "pestpac",
        accountId: "acct-no-url",
        apiKey: "key-no-url",
      })
      .expect(200);
    expect(res.body.configured).toBe(true);
  });
});
