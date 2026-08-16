/**
 * Unit tests — buildReportHtml() signature section rendering
 *
 * Three scenarios verified end-to-end:
 *
 *  1. Technician signed + owner marked Not Available:
 *       - "Not Available" notice appears in the output
 *       - No SVG sig-box is rendered for the owner slot
 *
 *  2. Both technician and owner signatures present:
 *       - Both sig-box elements appear in the output
 *
 *  3. Neither signature present:
 *       - The entire Signatures section is omitted
 *
 * React Native / Expo modules are replaced with the lightweight stubs
 * already set up in vitest.config.ts (expo-file-system/legacy alias).
 * No photos are added to the records so the FileSystem stub is never hit.
 */

import { describe, expect, it } from "vitest";

// ── Import module under test ──────────────────────────────────────────────────
// vitest.config.ts aliases expo-file-system/legacy → __mocks__/expo-file-system-legacy.ts
// so the import succeeds in plain Node.js.
import { buildReportHtml } from "../report-html";
import type { ReportData } from "../report-html";
import type { LocalInspection } from "@/lib/local/inspection-store";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Minimal LocalInspection — only the fields consumed by buildReportHtml. */
function makeRecord(overrides: Partial<LocalInspection> = {}): LocalInspection {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    localId: "test-local-id",
    serverId: null,
    createdAt: now,
    updatedAt: now,
    siteAddress: "123 Test Street",
    clientName: "Test Client",
    technicianName: "Jane Tech",
    propertyType: "residential",
    pestTypes: ["rodent"],
    notes: "",
    photos: [], // no photos → FileSystem.readAsStringAsync never called
    baitStations: [],
    completed: true,
    completedAt: now,
    serverCompleted: true,
    analyzedCount: 0,
    reportId: null,
    syncError: null,
    syncAttempts: 0,
    lastSyncSuccess: null,
    allFindingsReviewed: true,
    pendingCorrections: [],
    lastDeliveredAt: null,
    pendingDeliveries: [],
    technicianSignature: null,
    ownerSignature: null,
    ownerNotAvailable: false,
    signedAt: null,
    ...overrides,
  };
}

function makeReportData(recordOverrides: Partial<LocalInspection> = {}): ReportData {
  return {
    record: makeRecord(recordOverrides),
    findings: [],
    recommendations: [],
    riskLevel: null,
    analysisComplete: true,
    companyName: "Test Co",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Owner marked Not Available
// ─────────────────────────────────────────────────────────────────────────────

describe('buildReportHtml — owner marked "Not Available"', () => {
  it('shows the "Not Available" notice in the owner slot', async () => {
    const html = await buildReportHtml(
      makeReportData({
        technicianSignature: '<svg><path d="M0 0 L10 10"/></svg>',
        ownerNotAvailable: true,
        ownerSignature: null,
      }),
    );

    expect(html).toContain("Not Available");
  });

  it("does not render an SVG sig-box in the owner slot when ownerNotAvailable is true", async () => {
    const TECH_SVG = '<svg><path d="M0 0 L10 10"/></svg>';
    const html = await buildReportHtml(
      makeReportData({
        technicianSignature: TECH_SVG,
        ownerNotAvailable: true,
        ownerSignature: null,
      }),
    );

    // Exactly one sig-box rendered — for the technician.
    const sigBoxCount = (html.match(/class="sig-box"/g) ?? []).length;
    expect(sigBoxCount).toBe(1);

    // The owner sig-na notice must be present.
    expect(html).toContain('class="sig-na"');
  });

  it('renders the Signatures section heading when ownerNotAvailable is true', async () => {
    const html = await buildReportHtml(
      makeReportData({
        technicianSignature: '<svg><path d="M1 1 L5 5"/></svg>',
        ownerNotAvailable: true,
        ownerSignature: null,
      }),
    );

    expect(html).toContain("<h2>Signatures</h2>");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Both signatures present
// ─────────────────────────────────────────────────────────────────────────────

describe("buildReportHtml — both signatures present", () => {
  it("renders two sig-box blocks when both technician and owner signed", async () => {
    const TECH_SVG = '<svg><path d="M0 0 L10 10"/></svg>';
    const OWNER_SVG = '<svg><path d="M5 5 L15 15"/></svg>';
    const html = await buildReportHtml(
      makeReportData({
        technicianSignature: TECH_SVG,
        ownerSignature: OWNER_SVG,
        ownerNotAvailable: false,
      }),
    );

    const sigBoxCount = (html.match(/class="sig-box"/g) ?? []).length;
    expect(sigBoxCount).toBe(2);
  });

  it("encodes both SVG payloads as base64 data URIs inside img elements (not raw markup)", async () => {
    const TECH_SVG = '<svg id="tech"><path d="M0 0"/></svg>';
    const OWNER_SVG = '<svg id="owner"><path d="M1 1"/></svg>';
    const html = await buildReportHtml(
      makeReportData({
        technicianSignature: TECH_SVG,
        ownerSignature: OWNER_SVG,
        ownerNotAvailable: false,
      }),
    );

    // Signatures must appear as data URIs, not as raw markup
    expect(html).toContain(`data:image/svg+xml;base64,${btoa(TECH_SVG)}`);
    expect(html).toContain(`data:image/svg+xml;base64,${btoa(OWNER_SVG)}`);
    // Raw SVG elements must NOT appear as live markup in the document
    expect(html).not.toContain('<svg id="tech">');
    expect(html).not.toContain('<svg id="owner">');
  });

  it("does not show the Not Available notice when both signatures are present", async () => {
    const html = await buildReportHtml(
      makeReportData({
        technicianSignature: '<svg><path d="M0 0"/></svg>',
        ownerSignature: '<svg><path d="M1 1"/></svg>',
        ownerNotAvailable: false,
      }),
    );

    expect(html).not.toContain('class="sig-na"');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Adversarial / XSS tests
// ─────────────────────────────────────────────────────────────────────────────
// Even if an attacker stores a malicious string via the API, the data-URI
// encoding inside <img> must prevent script execution when the report is
// opened. Raw payloads must never appear as live markup.

describe("buildReportHtml — XSS / injection safety", () => {
  it("does not inject executable <script> tags from a script-payload signature", async () => {
    const malicious = "<svg><script>alert('xss')</script></svg>";
    const html = await buildReportHtml(
      makeReportData({ technicianSignature: malicious }),
    );

    // Encoded form must be present (rendered as img)
    expect(html).toContain(`data:image/svg+xml;base64,${btoa(malicious)}`);
    // Raw script tag must NOT appear as live markup
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("alert(");
  });

  it("does not inject event handler attributes from an onload-payload signature", async () => {
    const malicious = "<svg onload=\"alert('xss')\"><rect/></svg>";
    const html = await buildReportHtml(
      makeReportData({ ownerSignature: malicious }),
    );

    expect(html).toContain(`data:image/svg+xml;base64,${btoa(malicious)}`);
    expect(html).not.toContain("onload=");
    expect(html).not.toContain("alert(");
  });

  it("does not break the HTML document when the signature contains closing tags", async () => {
    const malicious = "</div></body></html><script>alert(1)</script>";
    const html = await buildReportHtml(
      makeReportData({ technicianSignature: malicious }),
    );

    expect(html).toContain(`data:image/svg+xml;base64,${btoa(malicious)}`);
    expect(html).not.toContain("<script>alert(1)</script>");
  });

  it("does not render foreignObject payloads as live markup", async () => {
    const malicious = `<svg><foreignObject><body xmlns="http://www.w3.org/1999/xhtml"><script>alert(1)</script></body></foreignObject></svg>`;
    const html = await buildReportHtml(
      makeReportData({ technicianSignature: malicious }),
    );

    expect(html).toContain(`data:image/svg+xml;base64,${btoa(malicious)}`);
    expect(html).not.toContain("<foreignObject");
    expect(html).not.toContain("alert(1)");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Neither signature present
// ─────────────────────────────────────────────────────────────────────────────

describe("buildReportHtml — no signatures at all", () => {
  it("omits the Signatures section entirely when no signatures exist", async () => {
    const html = await buildReportHtml(
      makeReportData({
        technicianSignature: null,
        ownerSignature: null,
        ownerNotAvailable: false,
      }),
    );

    expect(html).not.toContain("<h2>Signatures</h2>");
    expect(html).not.toContain('class="sig-row"');
    expect(html).not.toContain('class="sig-box"');
  });

  it("still renders the rest of the report (header, findings, photos) with no signatures", async () => {
    const html = await buildReportHtml(
      makeReportData({
        technicianSignature: null,
        ownerSignature: null,
        ownerNotAvailable: false,
      }),
    );

    // Core report structure must be present.
    expect(html).toContain("Inspection Report");
    expect(html).toContain("Findings");
    expect(html).toContain("Photo evidence");
  });
});
