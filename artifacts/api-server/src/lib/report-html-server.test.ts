import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fmtIn, fmtArea, buildServerReportHtml, buildFindingImageMap } from "./report-html-server.js";

// Minimal stubs for buildServerReportHtml
function makeReport(overrides: Record<string, unknown> = {}) {
  return {
    id: 1, companyId: 1, inspectionId: 1, title: "Test Report",
    clientName: "Acme Corp", siteAddress: "123 Main St",
    status: "complete", severity: null, findings: [], recommendations: [],
    exclusionOpportunities: [], treatmentNotes: null, aiNarrative: null,
    technicianName: "Tech", inspectionDate: "2026-01-01",
    pdfUrl: null, approvedByUserId: null, approvedAt: null,
    shareToken: null, createdAt: new Date(),
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
    unitNumber: null, visitPurpose: null,
    ...overrides,
  } as Parameters<typeof buildServerReportHtml>[1];
}

describe("buildServerReportHtml — inspection ID", () => {
  it("prints the inspection's ID, not the report's ID", () => {
    const html = buildServerReportHtml(
      makeReport({ id: 111, inspectionId: 110 }),
      makeInspection({ id: 110 }),
    );
    expect(html).toContain("Inspection ID");
    expect(html).toContain("#110");
  });
});

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

// ─── buildFindingImageMap ─────────────────────────────────────────────────────
// Mocks ObjectStorageService so no real GCS calls are made.
// Each test exercises a distinct code path in the helper.

// A minimal JPEG byte sequence (SOI marker 0xFF 0xD8) padded to 4 bytes so
// the MIME-type detector sees the correct magic bytes.
const FAKE_JPEG_BYTES = Buffer.from([0xff, 0xd8, 0x00, 0x00]);
// A minimal PNG byte sequence (0x89 0x50 'N' 'G').
const FAKE_PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

// Spy on ObjectStorageService prototype methods so no real GCS calls are made.
// Cast method names via `as any` to avoid TypeScript widening the spy to a
// union of all method signatures (which loses .mockResolvedValue etc.), and
// re-assert as `Mock` so the vitest mock API is fully available in the tests.
import type { Mock } from "vitest";
import { ObjectStorageService } from "./objectStorage.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockGetObjectEntityFile = vi.spyOn(ObjectStorageService.prototype, "getObjectEntityFile" as any) as unknown as Mock;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockDownloadObject = vi.spyOn(ObjectStorageService.prototype, "downloadObject" as any) as unknown as Mock;

describe("buildFindingImageMap", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.clearAllMocks());

  it("returns an empty map when there are no findings", async () => {
    const map = await buildFindingImageMap([]);
    expect(map.size).toBe(0);
  });

  it("returns an empty map when all findings lack imageUrl", async () => {
    const map = await buildFindingImageMap([{ imageUrl: null }, { imageUrl: undefined }]);
    expect(map.size).toBe(0);
  });

  // Shorthand: return a fake GCS File object typed to satisfy ObjectStorageService.
  // The implementation only passes this to downloadObject, so {} suffices.
  const fakeFile = () => ({}) as unknown as File;

  it("normalizes /objects/… paths so getObjectEntityFile receives /objects/… unchanged", async () => {
    mockGetObjectEntityFile.mockResolvedValue(fakeFile());
    mockDownloadObject.mockResolvedValue(new Response(FAKE_JPEG_BYTES, { status: 200 }));

    const imageUrl = "/objects/companies/1/uploads/photo.jpg";
    await buildFindingImageMap([{ imageUrl }]);

    expect(mockGetObjectEntityFile).toHaveBeenCalledWith("/objects/companies/1/uploads/photo.jpg");
  });

  it("strips /api/storage prefix so getObjectEntityFile receives /objects/… for intelligence-AI paths", async () => {
    mockGetObjectEntityFile.mockResolvedValue(fakeFile());
    mockDownloadObject.mockResolvedValue(new Response(FAKE_JPEG_BYTES, { status: 200 }));

    const imageUrl = "/api/storage/objects/companies/2/uploads/ai-photo.jpg";
    await buildFindingImageMap([{ imageUrl }]);

    // Must strip /api/storage → /objects/…
    expect(mockGetObjectEntityFile).toHaveBeenCalledWith("/objects/companies/2/uploads/ai-photo.jpg");
  });

  it("keys the returned map by the original imageUrl (not the normalized path)", async () => {
    mockGetObjectEntityFile.mockResolvedValue(fakeFile());
    mockDownloadObject.mockResolvedValue(new Response(FAKE_JPEG_BYTES, { status: 200 }));

    const imageUrl = "/api/storage/objects/companies/3/uploads/photo.png";
    const map = await buildFindingImageMap([{ imageUrl }]);

    // The key must be the original /api/storage/… URL so it matches finding.imageUrl
    expect(map.has(imageUrl)).toBe(true);
    expect(map.has("/objects/companies/3/uploads/photo.png")).toBe(false);
  });

  it("detects JPEG from magic bytes and returns a data:image/jpeg URI", async () => {
    mockGetObjectEntityFile.mockResolvedValue(fakeFile());
    mockDownloadObject.mockResolvedValue(new Response(FAKE_JPEG_BYTES, { status: 200 }));

    const imageUrl = "/objects/companies/1/uploads/img.jpg";
    const map = await buildFindingImageMap([{ imageUrl }]);

    const value = map.get(imageUrl)!;
    expect(value).toMatch(/^data:image\/jpeg;base64,/);
  });

  it("detects PNG from magic bytes and returns a data:image/png URI", async () => {
    mockGetObjectEntityFile.mockResolvedValue(fakeFile());
    mockDownloadObject.mockResolvedValue(new Response(FAKE_PNG_BYTES, { status: 200 }));

    const imageUrl = "/objects/companies/1/uploads/img.png";
    const map = await buildFindingImageMap([{ imageUrl }]);

    const value = map.get(imageUrl)!;
    expect(value).toMatch(/^data:image\/png;base64,/);
  });

  it("omits an image from the map when downloadObject returns a non-OK response", async () => {
    mockGetObjectEntityFile.mockResolvedValue(fakeFile());
    mockDownloadObject.mockResolvedValue(new Response("Not Found", { status: 404 }));

    const map = await buildFindingImageMap([{ imageUrl: "/objects/companies/1/uploads/missing.jpg" }]);
    expect(map.size).toBe(0);
  });

  it("omits an image from the map when getObjectEntityFile throws", async () => {
    mockGetObjectEntityFile.mockRejectedValue(new Error("not found"));

    const map = await buildFindingImageMap([{ imageUrl: "/objects/companies/1/uploads/gone.jpg" }]);
    expect(map.size).toBe(0);
  });

  it("omits a timed-out image but still returns successful ones", async () => {
    // First call: never resolves (simulates a hung storage connection)
    // Second call: resolves immediately
    mockGetObjectEntityFile
      .mockImplementationOnce(() => new Promise<File>(() => { /* intentionally never resolves */ }))
      .mockImplementation(() => Promise.resolve(fakeFile()));
    mockDownloadObject.mockResolvedValue(new Response(FAKE_JPEG_BYTES, { status: 200 }));

    vi.useFakeTimers();
    const pendingMap = buildFindingImageMap([
      { imageUrl: "/objects/companies/1/uploads/hung.jpg" },
      { imageUrl: "/objects/companies/1/uploads/ok.jpg" },
    ]);
    // Advance past the 4 s per-image timeout so the hung download times out.
    await vi.runAllTimersAsync();
    const map = await pendingMap;
    vi.useRealTimers();

    expect(map.has("/objects/companies/1/uploads/hung.jpg")).toBe(false);
    expect(map.has("/objects/companies/1/uploads/ok.jpg")).toBe(true);
  });

  it("deduplicates findings that share the same imageUrl (one download per unique URL)", async () => {
    mockGetObjectEntityFile.mockResolvedValue(fakeFile());
    mockDownloadObject.mockResolvedValue(new Response(FAKE_JPEG_BYTES, { status: 200 }));

    const imageUrl = "/objects/companies/1/uploads/shared.jpg";
    await buildFindingImageMap([{ imageUrl }, { imageUrl }, { imageUrl }]);

    expect(mockGetObjectEntityFile).toHaveBeenCalledTimes(1);
  });
});

describe("buildServerReportHtml — evidence photo embedding", () => {
  it("embeds a finding photo as an <img> tag when imageDataMap has an entry for its imageUrl", () => {
    const imageUrl = "/objects/companies/1/uploads/evidence.jpg";
    const dataUri = "data:image/jpeg;base64,/9j/TEST";
    const imageDataMap = new Map([[imageUrl, dataUri]]);

    const html = buildServerReportHtml(
      makeReport({ findings: [{ category: "Rodent", imageUrl }] }),
      makeInspection(),
      [],
      imageDataMap,
    );

    expect(html).toContain(`src="${dataUri}"`);
    expect(html).toContain("<img");
  });

  it("renders the finding card without an <img> tag when imageDataMap does not contain its imageUrl", () => {
    const imageUrl = "/objects/companies/1/uploads/no-fetch.jpg";
    const html = buildServerReportHtml(
      makeReport({ findings: [{ category: "Cockroach", imageUrl }] }),
      makeInspection(),
      [],
      new Map(), // empty map — image not fetched
    );

    expect(html).not.toContain("data:image/");
    expect(html).toContain("Cockroach");
  });

  it("renders correctly when no imageDataMap is supplied (backward compat)", () => {
    const html = buildServerReportHtml(
      makeReport({ findings: [{ category: "Ant", imageUrl: "/objects/1.jpg" }] }),
      makeInspection(),
    );
    expect(html).toContain("Ant");
    expect(html).not.toContain("data:image/");
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
