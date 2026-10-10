/**
 * Enterprise Bridge — outgoing fetch body assertions (task #652).
 *
 * Verifies that the exact JSON bodies dispatched to PestPac, FieldRoutes, and
 * ServSuite match the Enterprise Bridge schema spec, covering:
 *
 *   • A finding whose measurements were derived from a stamped laserMeasurement
 *     (captureMetadata.laserMeasurement) — widthMm only, with confidence.
 *
 *   • A finding whose measurements were derived from a vision measurementEstimate
 *     — widthMm + heightMm, with confidence and surfaceType.
 *
 * Both the FieldRoutes dual-token auth headers (authenticationKey +
 * authenticationToken) and the ServSuite Bearer-token header are pinned so
 * auth-contract drift surfaces as a test failure rather than a silent 401.
 *
 * The tests call the service layer directly (syncInspectionToExternalSystem /
 * sendServSuiteREST) with pre-computed SyncPayload/EnterpriseSyncPayload
 * values — the measurement-derivation logic that converts raw
 * captureMetadata.laserMeasurement / measurementEstimate into mm lives in the
 * integrations route handler and is already exercised by integrations-sync.test.ts.
 * Here we pin the wire format: the exact body each external system receives.
 */

import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";

import {
  syncInspectionToExternalSystem,
  type SyncPayload,
  type SyncFindingItem,
} from "./field-integration";

import { sendServSuiteREST } from "./integration/adapters/servsuiteAdapter";
import type { EnterpriseSyncPayload } from "../types/enterprise-payload";
import * as ssrfModule from "../lib/ssrf-safe-fetch";

// ─── Shared fixtures ──────────────────────────────────────────────────────────

const INSPECTION_DATE = "2026-08-17";
const ACCOUNT_ID = "customer-7711";
const API_KEY = "test-api-key-abc";
const API_TOKEN = "test-api-token-xyz";
const SIGNED_AT = "2026-08-17T12:00:00.000Z";

/**
 * Finding 1: measurements derived from captureMetadata.laserMeasurement.
 *
 * The route converts the raw laser reading (3.42 in → 87 mm) and attaches
 * the sensor confidence (0.61). heightMm is absent because the laser blob
 * in this fixture has no heightInches.
 */
const LASER_FINDING: SyncFindingItem = {
  category: "Rodent Entry",
  severity: "high",
  evidencePhotoUrl: "https://storage.example.com/companies/1/photo-laser.jpg",
  measurements: {
    widthMm: 87,   // 3.42 in × 25.4
    confidence: 0.61,
  },
};

/**
 * Finding 2: measurements derived from vision measurementEstimate only (no laser).
 *
 * The route converts imperial estimates: gapWidthIn=2 → 51 mm, heightFt=5 → 1524 mm.
 * surfaceType is populated from f.structuralIssue.
 */
const ESTIMATE_FINDING: SyncFindingItem = {
  category: "Structural Gap",
  severity: "medium",
  evidencePhotoUrl: null,
  measurements: {
    widthMm: 51,    // 2 in × 25.4
    heightMm: 1524, // 5 ft × 304.8
    confidence: 0.83,
    surfaceType: "concrete_foundation",
  },
};

/** Finding with no measurement (neither laser nor estimate present). */
const BARE_FINDING: SyncFindingItem = {
  category: "Pest Activity",
  severity: "low",
  evidencePhotoUrl: null,
};

const SIGNATURE_AUDIT = {
  technicianSigned: true,
  ownerSigned: false,
  ownerNotAvailable: true,
  signedAt: SIGNED_AT,
};

const PHOTOS = [
  { url: "https://storage.example.com/companies/1/photo-laser.jpg", caption: "Entry gap", severity: "high" },
];

const TREATMENT = {
  pestsFound: ["Norway Rat"],
  chemicalsUsed: ["Contrac Blox"],
  temperature: 72,
  notes: "Bait stations placed at entry points.",
};

// ─── Setup / teardown ─────────────────────────────────────────────────────────

let fetchSpy: MockInstance;

beforeEach(() => {
  // Adapters call ssrfSafeFetch (undici-backed DNS-pinning fetch), not globalThis.fetch.
  fetchSpy = vi.spyOn(ssrfModule, "ssrfSafeFetch").mockResolvedValue(
    new Response("", { status: 200 }),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Parses the JSON body from the Nth fetch call (0-indexed). */
function parsedBody(callIndex = 0): unknown {
  const [, init] = fetchSpy.mock.calls[callIndex] as [string, RequestInit];
  return JSON.parse(init.body as string);
}

/** Returns the URL from the Nth fetch call (0-indexed). */
function calledUrl(callIndex = 0): string {
  return fetchSpy.mock.calls[callIndex][0] as string;
}

/** Returns the headers from the Nth fetch call (0-indexed). */
function calledHeaders(callIndex = 0): Record<string, string> {
  const [, init] = fetchSpy.mock.calls[callIndex] as [string, RequestInit];
  return init.headers as Record<string, string>;
}

// ─────────────────────────────────────────────────────────────────────────────
// PestPac
// ─────────────────────────────────────────────────────────────────────────────

describe("PestPac — outgoing POST /customers/:id/notes body", () => {
  const payload: SyncPayload = {
    externalSystem: "pestpac",
    accountId: ACCOUNT_ID,
    apiKey: API_KEY,
    inspectionDate: INSPECTION_DATE,
    reportSummary: "Rodent Entry: gap found. Structural Gap: concrete crack.",
    photos: PHOTOS,
    treatmentConditions: TREATMENT,
    findings: [LASER_FINDING, ESTIMATE_FINDING, BARE_FINDING],
    signatureAudit: SIGNATURE_AUDIT,
  };

  it("posts to the correct PestPac endpoint", async () => {
    await syncInspectionToExternalSystem({ ...payload, apiBaseUrl: "https://pest.example.com/v1" });
    expect(calledUrl(0)).toBe(`https://pest.example.com/v1/customers/${ACCOUNT_ID}/notes`);
  });

  it("body.note contains the AI narrative prefixed with [ReadyLoq AI Report]", async () => {
    await syncInspectionToExternalSystem(payload);
    const body = parsedBody(0) as Record<string, unknown>;
    expect(typeof body.note).toBe("string");
    expect(body.note).toMatch(/^\[ReadyLoq AI Report\]/);
    expect(body.note).toContain(payload.reportSummary);
  });

  it("body.date equals the inspectionDate", async () => {
    await syncInspectionToExternalSystem(payload);
    const body = parsedBody(0) as Record<string, unknown>;
    expect(body.date).toBe(INSPECTION_DATE);
  });

  it("body.findings[0] carries laserMeasurement-derived widthMm + confidence in customFields", async () => {
    await syncInspectionToExternalSystem(payload);
    const body = parsedBody(0) as {
      findings: Array<{ category: string; severity: string; evidencePhotoUrl: string | null; customFields?: Record<string, unknown> }>;
    };

    const f = body.findings[0];
    expect(f.category).toBe("Rodent Entry");
    expect(f.severity).toBe("high");
    expect(f.evidencePhotoUrl).toBe(LASER_FINDING.evidencePhotoUrl);
    expect(f.customFields).toEqual({
      widthMm: 87,
      confidence: 0.61,
    });
  });

  it("body.findings[1] carries estimate-derived widthMm + heightMm + confidence + surfaceType in customFields", async () => {
    await syncInspectionToExternalSystem(payload);
    const body = parsedBody(0) as {
      findings: Array<{ customFields?: Record<string, unknown> }>;
    };

    expect(body.findings[1].customFields).toEqual({
      widthMm: 51,
      heightMm: 1524,
      confidence: 0.83,
      surfaceType: "concrete_foundation",
    });
  });

  it("body.findings[2] has no customFields key when the finding has no measurements", async () => {
    await syncInspectionToExternalSystem(payload);
    const body = parsedBody(0) as {
      findings: Array<{ customFields?: unknown }>;
    };
    // Bare findings must not carry an empty customFields object — the key
    // should be absent entirely (field-integration.ts uses a conditional spread).
    expect("customFields" in body.findings[2]).toBe(false);
  });

  it("body.signatureAudit matches the signatureAudit block verbatim", async () => {
    await syncInspectionToExternalSystem(payload);
    const body = parsedBody(0) as Record<string, unknown>;
    expect(body.signatureAudit).toEqual(SIGNATURE_AUDIT);
  });

  it("uses Bearer token from apiKey in Authorization header", async () => {
    await syncInspectionToExternalSystem(payload);
    expect(calledHeaders(0)["Authorization"]).toBe(`Bearer ${API_KEY}`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FieldRoutes
// ─────────────────────────────────────────────────────────────────────────────

describe("FieldRoutes — outgoing POST /customer/:id/service-history body and headers", () => {
  const payload: SyncPayload = {
    externalSystem: "fieldroutes",
    accountId: ACCOUNT_ID,
    apiKey: API_KEY,
    apiToken: API_TOKEN,
    inspectionDate: INSPECTION_DATE,
    reportSummary: "Rodent Entry: gap found. Structural Gap: concrete crack.",
    photos: PHOTOS,
    treatmentConditions: TREATMENT,
    findings: [LASER_FINDING, ESTIMATE_FINDING, BARE_FINDING],
    signatureAudit: SIGNATURE_AUDIT,
  };

  it("posts to the correct FieldRoutes endpoint", async () => {
    await syncInspectionToExternalSystem({ ...payload, apiBaseUrl: "https://fr.example.com/api/v1" });
    expect(calledUrl(0)).toBe(`https://fr.example.com/api/v1/customer/${ACCOUNT_ID}/service-history`);
  });

  // ── Auth headers — dual-token contract ──────────────────────────────────────

  it("sends authenticationKey header set to apiKey", async () => {
    await syncInspectionToExternalSystem(payload);
    expect(calledHeaders(0)["authenticationKey"]).toBe(API_KEY);
  });

  it("sends authenticationToken header set to apiToken", async () => {
    await syncInspectionToExternalSystem(payload);
    expect(calledHeaders(0)["authenticationToken"]).toBe(API_TOKEN);
  });

  it("also sends Bearer Authorization header for gateway compatibility", async () => {
    await syncInspectionToExternalSystem(payload);
    expect(calledHeaders(0)["Authorization"]).toBe(`Bearer ${API_KEY}`);
  });

  it("omits authenticationToken header when apiToken is not provided", async () => {
    const noToken = { ...payload, apiToken: undefined };
    await syncInspectionToExternalSystem(noToken);
    expect(calledHeaders(0)).not.toHaveProperty("authenticationToken");
  });

  // ── Body shape ──────────────────────────────────────────────────────────────

  it("body.summary contains the report summary", async () => {
    await syncInspectionToExternalSystem(payload);
    const body = parsedBody(0) as Record<string, unknown>;
    expect(body.summary).toBe(payload.reportSummary);
  });

  it("body.date equals the inspectionDate", async () => {
    await syncInspectionToExternalSystem(payload);
    const body = parsedBody(0) as Record<string, unknown>;
    expect(body.date).toBe(INSPECTION_DATE);
  });

  it("body.conditions mirrors treatmentConditions", async () => {
    await syncInspectionToExternalSystem(payload);
    const body = parsedBody(0) as { conditions: Record<string, unknown> };
    expect(body.conditions).toEqual({
      pestsFound: TREATMENT.pestsFound,
      chemicalsUsed: TREATMENT.chemicalsUsed,
      temperature: TREATMENT.temperature,
      notes: TREATMENT.notes,
    });
  });

  it("body.mediaUrls contains the photo URLs", async () => {
    await syncInspectionToExternalSystem(payload);
    const body = parsedBody(0) as { mediaUrls: string[] };
    expect(body.mediaUrls).toEqual(PHOTOS.map((p) => p.url));
  });

  it("body.findings[0] carries laserMeasurement-derived measurements in customFields", async () => {
    await syncInspectionToExternalSystem(payload);
    const body = parsedBody(0) as {
      findings: Array<{ category: string; severity: string; evidencePhotoUrl: string | null; customFields?: Record<string, unknown> }>;
    };

    const f = body.findings[0];
    expect(f.category).toBe("Rodent Entry");
    expect(f.severity).toBe("high");
    expect(f.evidencePhotoUrl).toBe(LASER_FINDING.evidencePhotoUrl);
    expect(f.customFields).toEqual({ widthMm: 87, confidence: 0.61 });
  });

  it("body.findings[1] carries estimate-derived widthMm + heightMm + surfaceType in customFields", async () => {
    await syncInspectionToExternalSystem(payload);
    const body = parsedBody(0) as {
      findings: Array<{ customFields?: Record<string, unknown> }>;
    };
    expect(body.findings[1].customFields).toEqual({
      widthMm: 51,
      heightMm: 1524,
      confidence: 0.83,
      surfaceType: "concrete_foundation",
    });
  });

  it("body.findings[2] has no customFields key for a finding with no measurements", async () => {
    await syncInspectionToExternalSystem(payload);
    const body = parsedBody(0) as { findings: Array<Record<string, unknown>> };
    expect("customFields" in body.findings[2]).toBe(false);
  });

  it("body.signatureAudit matches the signatureAudit block verbatim", async () => {
    await syncInspectionToExternalSystem(payload);
    const body = parsedBody(0) as Record<string, unknown>;
    expect(body.signatureAudit).toEqual(SIGNATURE_AUDIT);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ServSuite
// ─────────────────────────────────────────────────────────────────────────────

describe("ServSuite — outgoing POST /workorders body", () => {
  /**
   * Full EnterpriseSyncPayload built the same way the integrations route and
   * EnterpriseAdapterRouter build it: PascalCase keys, Code slug, CustomFields
   * with WidthMm/HeightMm/VerifiedConfidence/SurfaceType.
   */
  const servsuitePaylod: EnterpriseSyncPayload = {
    ExternalWorkOrderId: "42",
    LocationReference: { PropertyCode: "99 Test Blvd" },
    ServiceDetails: {
      CompletedByEmployeeId: "tech-001",
      ServiceDate: `${INSPECTION_DATE}T00:00:00.000Z`,
      TechnicianName: "Jane Doe",
    },
    InspectionFindings: [
      {
        // Finding derived from laserMeasurement: width + confidence only.
        Code: "RODENT_ENTRY_HIGH",
        Description: "Rodent entry gap observed at foundation.",
        Severity: "high",
        CustomFields: {
          WidthMm: 87,
          VerifiedConfidence: 0.61,
        },
        AttachmentUrl: "https://storage.example.com/companies/1/photo-laser.jpg",
      },
      {
        // Finding derived from measurementEstimate: width + height + surfaceType.
        Code: "STRUCTURAL_GAP_MEDIUM",
        Description: "Concrete crack at building perimeter.",
        Severity: "medium",
        CustomFields: {
          WidthMm: 51,
          HeightMm: 1524,
          VerifiedConfidence: 0.83,
          SurfaceType: "concrete_foundation",
        },
      },
    ],
    SignatureAudit: SIGNATURE_AUDIT,
  };

  it("posts to the correct ServSuite endpoint", async () => {
    await sendServSuiteREST(servsuitePaylod, {
      apiKey: API_KEY,
      apiBaseUrl: "https://ss.example.com/v1",
    });
    expect(calledUrl(0)).toBe("https://ss.example.com/v1/workorders");
  });

  it("sends Bearer Authorization header from apiKey", async () => {
    await sendServSuiteREST(servsuitePaylod, { apiKey: API_KEY });
    expect(calledHeaders(0)["Authorization"]).toBe(`Bearer ${API_KEY}`);
  });

  it("body is the EnterpriseSyncPayload serialised verbatim", async () => {
    await sendServSuiteREST(servsuitePaylod, { apiKey: API_KEY });
    const body = parsedBody(0);
    expect(body).toEqual(servsuitePaylod);
  });

  it("InspectionFindings[0] carries laser-derived WidthMm + VerifiedConfidence in CustomFields", async () => {
    await sendServSuiteREST(servsuitePaylod, { apiKey: API_KEY });
    const body = parsedBody(0) as typeof servsuitePaylod;
    const f = body.InspectionFindings[0];
    expect(f.Code).toBe("RODENT_ENTRY_HIGH");
    expect(f.CustomFields).toEqual({
      WidthMm: 87,
      VerifiedConfidence: 0.61,
    });
    expect(f.AttachmentUrl).toBe("https://storage.example.com/companies/1/photo-laser.jpg");
  });

  it("InspectionFindings[1] carries estimate-derived WidthMm + HeightMm + SurfaceType in CustomFields", async () => {
    await sendServSuiteREST(servsuitePaylod, { apiKey: API_KEY });
    const body = parsedBody(0) as typeof servsuitePaylod;
    const f = body.InspectionFindings[1];
    expect(f.Code).toBe("STRUCTURAL_GAP_MEDIUM");
    expect(f.CustomFields).toEqual({
      WidthMm: 51,
      HeightMm: 1524,
      VerifiedConfidence: 0.83,
      SurfaceType: "concrete_foundation",
    });
    expect("AttachmentUrl" in f).toBe(false);
  });

  it("SignatureAudit block is forwarded verbatim", async () => {
    await sendServSuiteREST(servsuitePaylod, { apiKey: API_KEY });
    const body = parsedBody(0) as typeof servsuitePaylod;
    expect(body.SignatureAudit).toEqual(SIGNATURE_AUDIT);
  });

  it("throws a descriptive error when ServSuite returns a non-2xx status", async () => {
    fetchSpy.mockResolvedValueOnce(new Response("Bad request", { status: 400 }));
    await expect(sendServSuiteREST(servsuitePaylod, { apiKey: API_KEY })).rejects.toThrow(
      /ServSuite REST failed \(400\)/,
    );
  });
});
