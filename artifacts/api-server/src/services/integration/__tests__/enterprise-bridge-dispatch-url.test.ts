/**
 * URL-contract tests for EnterpriseBridgeProductionService.dispatchToSystem.
 *
 * Verifies that the service appends the correct per-vendor operation path to
 * whatever base URL is passed via ResolvedEnterpriseConfig.endpointUrl.
 *
 *   PestPac:   <base>/ImportInspectionResult  (SOAP via HTTP POST)
 *   ServSuite: <base>/workorders              (REST JSON via HTTP POST)
 *
 * Tests cover two cases per vendor:
 *   1. Vendor production default (owner left apiBaseUrl blank → router passes
 *      the hard-coded default base; the service must append the path).
 *   2. Custom owner-supplied base URL (router passes config.apiBaseUrl; the
 *      service must still append the correct path).
 *
 * The ssrfSafeFetch module is spied on so we pin the exact URL each request
 * is sent to without making real network calls.
 */

import { beforeEach, afterEach, describe, expect, it, vi, type MockInstance } from "vitest";
import * as ssrfModule from "../../../lib/ssrf-safe-fetch";
import { EnterpriseBridgeProductionService } from "../enterprise-bridge-production";
import type { HardenedInspectionPayload } from "../../../types/enterprise-payload";

// ─── Minimal hardened payload fixture ────────────────────────────────────────

const MINIMAL_PAYLOAD: HardenedInspectionPayload = {
  inspectionId: "insp-42",
  companyId: "co-1",
  propertyId: "123 Test St",
  technicianId: "tech-abc",
  timestamp: "2026-08-17T12:00:00.000Z",
  signatures: {
    technicianUserId: "tech-abc",
    technicianSignatureUrl: "",
    customerSignatureUrl: "",
    signedAt: "2026-08-17T12:00:00.000Z",
    signatureVersion: "v1",
  },
  measurements: [],
  aiFindings: [],
};

// ─── Default base URLs (must match enterprise-router.ts hard-coded defaults) ──

const PESTPAC_DEFAULT_BASE = "https://api.pestpac.com/v1";
const SERVSUITE_DEFAULT_BASE = "https://api.servsuite.com/v1";

// ─── Setup ───────────────────────────────────────────────────────────────────

let fetchSpy: MockInstance;

beforeEach(() => {
  // Return a successful 200 response so dispatchToSystem does not short-circuit.
  fetchSpy = vi.spyOn(ssrfModule, "ssrfSafeFetch").mockResolvedValue(
    new Response("ok", { status: 200 }),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── PestPac ─────────────────────────────────────────────────────────────────

describe("PestPac — operation URL appended to base", () => {
  it("uses the default base + /ImportInspectionResult when no custom URL is provided", async () => {
    await EnterpriseBridgeProductionService.dispatchToSystem(
      {
        targetSystem: "pestpac",
        endpointUrl: PESTPAC_DEFAULT_BASE,
        decryptedApiKey: "test-key",
      },
      MINIMAL_PAYLOAD,
    );

    const calledUrl = fetchSpy.mock.calls[0]?.[0] as string;
    expect(calledUrl).toBe(`${PESTPAC_DEFAULT_BASE}/ImportInspectionResult`);
  });

  it("appends /ImportInspectionResult to a custom owner-supplied base URL", async () => {
    const customBase = "https://custom.example.com/pestpac/v2";

    await EnterpriseBridgeProductionService.dispatchToSystem(
      {
        targetSystem: "pestpac",
        endpointUrl: customBase,
        decryptedApiKey: "test-key",
      },
      MINIMAL_PAYLOAD,
    );

    const calledUrl = fetchSpy.mock.calls[0]?.[0] as string;
    expect(calledUrl).toBe(`${customBase}/ImportInspectionResult`);
  });

  it("strips a trailing slash from the base before appending the path", async () => {
    await EnterpriseBridgeProductionService.dispatchToSystem(
      {
        targetSystem: "pestpac",
        endpointUrl: PESTPAC_DEFAULT_BASE + "/",
        decryptedApiKey: "test-key",
      },
      MINIMAL_PAYLOAD,
    );

    const calledUrl = fetchSpy.mock.calls[0]?.[0] as string;
    expect(calledUrl).toBe(`${PESTPAC_DEFAULT_BASE}/ImportInspectionResult`);
    expect(calledUrl).not.toContain("//ImportInspectionResult");
  });
});

// ─── ServSuite ────────────────────────────────────────────────────────────────

describe("ServSuite — operation URL appended to base", () => {
  it("uses the default base + /workorders when no custom URL is provided", async () => {
    await EnterpriseBridgeProductionService.dispatchToSystem(
      {
        targetSystem: "servsuite",
        endpointUrl: SERVSUITE_DEFAULT_BASE,
        decryptedApiKey: "test-key",
      },
      MINIMAL_PAYLOAD,
    );

    const calledUrl = fetchSpy.mock.calls[0]?.[0] as string;
    expect(calledUrl).toBe(`${SERVSUITE_DEFAULT_BASE}/workorders`);
  });

  it("appends /workorders to a custom owner-supplied base URL", async () => {
    const customBase = "https://custom.example.com/ss/v2";

    await EnterpriseBridgeProductionService.dispatchToSystem(
      {
        targetSystem: "servsuite",
        endpointUrl: customBase,
        decryptedApiKey: "test-key",
      },
      MINIMAL_PAYLOAD,
    );

    const calledUrl = fetchSpy.mock.calls[0]?.[0] as string;
    expect(calledUrl).toBe(`${customBase}/workorders`);
  });

  it("strips a trailing slash from the base before appending /workorders", async () => {
    await EnterpriseBridgeProductionService.dispatchToSystem(
      {
        targetSystem: "servsuite",
        endpointUrl: SERVSUITE_DEFAULT_BASE + "/",
        decryptedApiKey: "test-key",
      },
      MINIMAL_PAYLOAD,
    );

    const calledUrl = fetchSpy.mock.calls[0]?.[0] as string;
    expect(calledUrl).toBe(`${SERVSUITE_DEFAULT_BASE}/workorders`);
    expect(calledUrl).not.toContain("//workorders");
  });
});

// ─── Shared behaviour ─────────────────────────────────────────────────────────

describe("dispatchToSystem — configuration guard", () => {
  it("returns INVALID_CONFIGURATION when endpointUrl is empty (never reaches fetch)", async () => {
    const outcome = await EnterpriseBridgeProductionService.dispatchToSystem(
      { targetSystem: "servsuite", endpointUrl: "", decryptedApiKey: "k" },
      MINIMAL_PAYLOAD,
    );
    // dispatchToSystem now returns a DispatchResult discriminated union.
    expect(outcome.status).toBe("INVALID_CONFIGURATION");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns INVALID_CONFIGURATION when decryptedApiKey is empty (never reaches fetch)", async () => {
    const outcome = await EnterpriseBridgeProductionService.dispatchToSystem(
      { targetSystem: "pestpac", endpointUrl: PESTPAC_DEFAULT_BASE, decryptedApiKey: "" },
      MINIMAL_PAYLOAD,
    );
    // dispatchToSystem now returns a DispatchResult discriminated union.
    expect(outcome.status).toBe("INVALID_CONFIGURATION");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
