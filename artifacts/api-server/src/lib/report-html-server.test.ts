import { describe, it, expect } from "vitest";
import { fmtIn, fmtArea, buildServerReportHtml } from "./report-html-server.js";

// Minimal stubs for buildServerReportHtml
function makeReport(overrides: Record<string, unknown> = {}) {
  return {
    id: 1, companyId: 1, inspectionId: 1, title: "Test Report",
    clientName: "Acme Corp", siteAddress: "123 Main St",
    status: "complete", severity: null, findings: [], recommendations: [],
    exclusionOpportunities: [], treatmentNotes: null, aiNarrative: null,
    technicianName: "Tech", inspectionDate: "2026-01-01",
    pdfUrl: null, shareToken: null, createdAt: new Date(),
    ...overrides,
  } as Parameters<typeof buildServerReportHtml>[0];
}

function makeInspection(overrides: Record<string, unknown> = {}) {
  return {
    id: 1, companyId: 1, siteAddress: "123 Main St", clientName: null,
    technicianName: "Tech", technicianId: null, status: "completed",
    pestTypes: [], severity: null, notes: null, mediaCount: 0,
    findingsCount: 0, aiAnalysisId: null, clientKey: null,
    scheduledDate: null, createdAt: new Date(), completedAt: new Date(),
    technicianSignature: null, ownerSignature: null,
    ownerNotAvailable: false, signedAt: null,
    ...overrides,
  } as Parameters<typeof buildServerReportHtml>[1];
}

describe("buildServerReportHtml — signature section", () => {
  it("omits the Signatures section when no signatures are present", () => {
    const html = buildServerReportHtml(makeReport(), makeInspection());
    expect(html).not.toContain("Signatures");
  });

  it("renders technician SVG signature as a base64 data URI inside an img tag", () => {
    const svg = "<svg><path d='M0 0 L10 10'/></svg>";
    const expected = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
    const html = buildServerReportHtml(
      makeReport(),
      makeInspection({ technicianSignature: svg }),
    );
    expect(html).toContain("Signatures");
    expect(html).toContain("Technician Signature");
    expect(html).toContain(expected);
    // Raw SVG markup must NOT appear as interpolated DOM — only inside the data URI
    expect(html).not.toContain("<path");
  });

  it("renders owner SVG signature as a base64 data URI", () => {
    const svg = "<svg><path d='M5 5 L50 50'/></svg>";
    const expected = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
    const html = buildServerReportHtml(
      makeReport(),
      makeInspection({ ownerSignature: svg }),
    );
    expect(html).toContain("Owner / Client Signature");
    expect(html).toContain(expected);
    expect(html).not.toContain("<path");
  });

  it("shows 'Owner not available' notice when ownerNotAvailable is true and no owner SVG", () => {
    const html = buildServerReportHtml(
      makeReport(),
      makeInspection({ ownerNotAvailable: true }),
    );
    expect(html).toContain("Signatures");
    expect(html).toContain("Owner not available");
  });

  it("renders both signatures when both are present", () => {
    const techSvg = "<svg><path d='M1 1'/></svg>";
    const ownerSvg = "<svg><path d='M2 2'/></svg>";
    const html = buildServerReportHtml(
      makeReport(),
      makeInspection({ technicianSignature: techSvg, ownerSignature: ownerSvg }),
    );
    expect(html).toContain("Technician Signature");
    expect(html).toContain("Owner / Client Signature");
    expect(html).toContain(Buffer.from(techSvg).toString("base64"));
    expect(html).toContain(Buffer.from(ownerSvg).toString("base64"));
  });

  it("includes the signedAt timestamp when present", () => {
    const signedAt = new Date("2026-06-15T14:30:00Z");
    const html = buildServerReportHtml(
      makeReport(),
      makeInspection({
        technicianSignature: "<svg/>",
        signedAt,
      }),
    );
    expect(html).toContain("Signed:");
  });

  // ── Adversarial / XSS tests ───────────────────────────────────────────────
  // Even if an attacker stores a malicious string via the PATCH endpoint, the
  // data-URI encoding inside <img> must prevent script execution when a manager
  // opens the HTML report. The raw payload must never appear as live markup.

  it("does not inject executable <script> tags when the signature contains a script payload", () => {
    const malicious = `<svg><script>alert('xss')</script></svg>`;
    const html = buildServerReportHtml(
      makeReport(),
      makeInspection({ technicianSignature: malicious }),
    );
    // The encoded form must be present (it renders as an img)
    expect(html).toContain(Buffer.from(malicious).toString("base64"));
    // The raw script tag must NOT be present as live markup in the document
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("alert(");
  });

  it("does not inject event handler attributes when the signature contains an onload payload", () => {
    const malicious = `<svg onload="alert('xss')"><rect/></svg>`;
    const html = buildServerReportHtml(
      makeReport(),
      makeInspection({ ownerSignature: malicious }),
    );
    expect(html).toContain(Buffer.from(malicious).toString("base64"));
    // Raw attribute must not appear in document markup
    expect(html).not.toContain("onload=");
    expect(html).not.toContain("alert(");
  });

  it("does not break the HTML document when the signature contains closing tags", () => {
    const malicious = `</div></body></html><script>alert(1)</script>`;
    const html = buildServerReportHtml(
      makeReport(),
      makeInspection({ technicianSignature: malicious }),
    );
    // Must be encoded, not raw
    expect(html).toContain(Buffer.from(malicious).toString("base64"));
    expect(html).not.toContain("<script>alert(1)</script>");
  });

  it("does not render foreignObject or external URL payloads as live markup", () => {
    const malicious = `<svg><foreignObject><body xmlns="http://www.w3.org/1999/xhtml"><script>alert(1)</script></body></foreignObject></svg>`;
    const html = buildServerReportHtml(
      makeReport(),
      makeInspection({ technicianSignature: malicious }),
    );
    expect(html).toContain(Buffer.from(malicious).toString("base64"));
    expect(html).not.toContain("<foreignObject");
    expect(html).not.toContain("alert(1)");
  });
});

describe("fmtIn", () => {
  it("formats a normal inch value", () => {
    expect(fmtIn(1.5)).toBe("1.50 in");
  });

  it("formats zero", () => {
    expect(fmtIn(0)).toBe("0.00 in");
  });

  it("returns null for null", () => {
    expect(fmtIn(null)).toBeNull();
  });

  it("returns null for undefined", () => {
    expect(fmtIn(undefined)).toBeNull();
  });

  it("returns null for Infinity — produced by near-zero reference box division", () => {
    expect(fmtIn(Infinity)).toBeNull();
  });

  it("returns null for -Infinity", () => {
    expect(fmtIn(-Infinity)).toBeNull();
  });

  it("returns null for NaN — produced by 0/0 reference box computation", () => {
    expect(fmtIn(NaN)).toBeNull();
  });
});

describe("fmtArea", () => {
  it("formats small areas in sq in", () => {
    expect(fmtArea(12)).toBe("12.0 sq in");
  });

  it("formats large areas (≥ 144) in sq ft", () => {
    expect(fmtArea(144)).toBe("1.00 sq ft");
    expect(fmtArea(288)).toBe("2.00 sq ft");
  });

  it("returns null for null", () => {
    expect(fmtArea(null)).toBeNull();
  });

  it("returns null for undefined", () => {
    expect(fmtArea(undefined)).toBeNull();
  });

  it("returns null for Infinity — produced by near-zero reference box division", () => {
    expect(fmtArea(Infinity)).toBeNull();
  });

  it("returns null for -Infinity", () => {
    expect(fmtArea(-Infinity)).toBeNull();
  });

  it("returns null for NaN", () => {
    expect(fmtArea(NaN)).toBeNull();
  });
});
