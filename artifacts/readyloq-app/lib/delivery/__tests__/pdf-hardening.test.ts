import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Finding } from "@/lib/api-client";
import type { LocalInspection } from "@/lib/local/inspection-store";

const nativeFs = vi.hoisted(() => ({
  content: "",
  getInfoAsync: vi.fn(),
  readAsStringAsync: vi.fn(),
  copyAsync: vi.fn(),
  deleteAsync: vi.fn(),
  readDirectoryAsync: vi.fn(),
}));
const print = vi.hoisted(() => ({ printToFileAsync: vi.fn() }));

vi.mock("expo-file-system/legacy", () => ({
  documentDirectory: "/documents/",
  EncodingType: { Base64: "base64", UTF8: "utf8" },
  ...nativeFs,
}));
vi.mock("expo-print", () => print);
vi.mock("@/lib/privacy/image-sanitizer", () => ({
  createSanitizedPhotoCopy: vi.fn(async () => "file:///sanitized.jpg"),
}));

import { buildReportHtml } from "../report-html";
import { generateReportPdf } from "../pdf";

function makeRecord(overrides: Partial<LocalInspection> = {}): LocalInspection {
  const now = new Date("2026-01-01T12:00:00.000Z").toISOString();
  return {
    schemaVersion: 1,
    ownerUserId: null,
    localId: "pdf-hardening-test",
    serverId: 42,
    createdAt: now,
    updatedAt: now,
    siteAddress: "123 Test Street",
    clientName: "Test Client",
    technicianName: "Taylor Technician",
    propertyType: "residential",
    visitPurpose: null,
    pestTypes: ["rodent"],
    notes: "Checked the kitchen and pantry.",
    photos: [],
    baitStations: [],
    completed: true,
    completedAt: now,
    serverCompleted: true,
    analyzedCount: 0,
    analyzedPhotoPaths: [],
    reportId: null,
    syncError: null,
    syncAttempts: 0,
    lastSyncSuccess: null,
    allFindingsReviewed: true,
    pendingCorrections: [],
    lastDeliveredAt: null,
    pendingDeliveries: [],
    unitNumber: "4B",
    unitNumberSynced: true,
    technicianSignature: null,
    ownerSignature: null,
    ownerNotAvailable: false,
    signedAt: null,
    sigRev: 0,
    techSigClear: false,
    ownerSigConsent: false,
    signaturesSynced: true,
    ...overrides,
  };
}

function makePdfReport(overrides: Partial<LocalInspection> = {}) {
  return {
    record: makeRecord(overrides),
    findings: [
      {
        description: "Rodent droppings observed beside the pantry.",
        category: "rodent",
        severity: "medium",
        location: "Pantry",
        treatment: "Seal entry point and monitor.",
        reviewStatus: "accepted",
      } as Finding,
    ],
    recommendations: ["Seal the pantry entry point."],
    riskLevel: "medium",
    analysisComplete: true,
    companyName: "Test Pest Services",
  };
}

function makePdf(streamBody: string): string {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${streamBody.length} >>\nstream\n${streamBody}endstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (let i = 0; i < objects.length; i++) {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${objects[i]}\nendobj\n`;
  }
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("");
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return pdf;
}

function makeBlankPdf(): string {
  // A complete, standards-shaped one-page PDF with an empty page content stream.
  return makePdf("");
}

function makeContentPdf(): string {
  const body = "BT /F1 12 Tf (Inspection report details and findings) Tj ET\n".repeat(24);
  return makePdf(body);
}

describe("native report PDF hardening", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    nativeFs.readDirectoryAsync.mockResolvedValue([]);
    nativeFs.copyAsync.mockResolvedValue(undefined);
    nativeFs.deleteAsync.mockResolvedValue(undefined);
    nativeFs.getInfoAsync.mockImplementation(async () => ({
      exists: true,
      size: nativeFs.content.length,
    }));
    nativeFs.readAsStringAsync.mockImplementation(async () => nativeFs.content);
    print.printToFileAsync.mockResolvedValue({ uri: "file:///cache/report.pdf" });
    nativeFs.content = makeContentPdf();
  });

  it("keeps inspection details, finding text, and photo evidence in the HTML report", async () => {
    const record = makeRecord({
      photos: [
        {
          localUri: "file:///photo.jpg",
          storagePath: "evidence/photo.jpg",
          description: "Droppings under the sink.",
          capturedAt: "2026-01-01T11:00:00.000Z",
          qualityScore: 90,
        },
      ],
    });
    nativeFs.readAsStringAsync.mockImplementation(async (uri: string) =>
      uri === "file:///sanitized.jpg" ? "cGhvdG9ieXRlcw==" : nativeFs.content,
    );

    const html = await buildReportHtml({
      ...makePdfReport(record),
      record,
    });

    expect(html).toContain("Checked the kitchen and pantry.");
    expect(html).toContain("Rodent droppings observed beside the pantry.");
    expect(html).toContain("Droppings under the sink.");
    expect(html).toContain("data:image/jpeg;base64,cGhvdG9ieXRlcw==");
  });

  it("fails report construction when an included photo cannot be embedded", async () => {
    const record = makeRecord({
      photos: [
        {
          localUri: "file:///missing-photo.jpg",
          capturedAt: "2026-01-01T11:00:00.000Z",
          qualityScore: 90,
        },
      ],
    });
    nativeFs.readAsStringAsync.mockRejectedValue(new Error("missing photo"));

    await expect(buildReportHtml({ ...makePdfReport(record), record })).rejects.toThrow(
      /captured photo could not be loaded/,
    );
  });

  it("rejects a standards-shaped but blank PDF instead of delivering it", async () => {
    nativeFs.content = makeBlankPdf();
    await expect(generateReportPdf(makePdfReport())).rejects.toThrow(/empty or incomplete/);
    expect(nativeFs.deleteAsync).toHaveBeenCalledWith(
      expect.stringMatching(/readyloq-report-.*\.pdf$/),
      { idempotent: true },
    );
  });

  it("rejects a sufficiently large PDF that is truncated before its EOF marker", async () => {
    nativeFs.content = makeContentPdf().replace("%%EOF", "");
    await expect(generateReportPdf(makePdfReport())).rejects.toThrow(/truncated/);
  });

  it("uses a newly rendered durable file for each generation", async () => {
    const first = await generateReportPdf(makePdfReport());
    const second = await generateReportPdf(makePdfReport());

    expect(first).not.toBe(second);
    expect(print.printToFileAsync).toHaveBeenCalledTimes(2);
    expect(first).toMatch(/readyloq-report-.*\.pdf$/);
  });
});