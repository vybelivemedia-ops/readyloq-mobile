import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { renderReportPdf } from "./report-pdf.js";

const execFileAsync = promisify(execFile);

function makeReport(overrides: Record<string, unknown> = {}) {
  return {
    id: 74,
    companyId: 1,
    inspectionId: 915,
    title: "Quarterly Pest Inspection",
    clientName: "Northwind Retail",
    siteAddress: "240 Harbor Street, Portland, ME",
    status: "complete",
    findings: [{
      category: "Rodent activity",
      description: "Fresh droppings observed behind the loading dock.",
      severity: "high",
      location: "Loading dock",
      imageUrl: "/objects/evidence/dock.png",
    }],
    recommendations: ["Seal the gap behind the loading dock."],
    exclusionOpportunities: [],
    treatmentNotes: "No treatment applied during this visit.",
    technicianName: "Morgan Lee",
    inspectionDate: "2026-05-18",
    severity: "high",
    pdfUrl: null,
    aiNarrative: {
      executiveSummary: "Rodent activity requires prompt exclusion work.",
      inspectionFindings: "A fresh trail was seen at the loading dock.",
      evidenceObserved: "Fresh droppings behind the dock.",
      pestActivityAssessment: "Current activity is likely.",
      structuralDeficiencies: "A gap remains at the service entry.",
      sanitationConcerns: "Keep stored goods off the floor.",
      recommendedCorrectiveActions: ["Seal the service entry."],
      monitoringRecommendations: ["Check bait stations weekly."],
      followUpSchedule: "Return in two weeks.",
      technicianNotes: "Access was clear.",
      managerReviewNotes: "Review exclusion completion.",
      propertyType: "Retail",
      model: "test",
      generatedAt: "2026-05-18T12:00:00Z",
      conduciveConditions: "Unsealed service entry.",
      customerRecommendations: ["Store deliveries away from the wall."],
    },
    createdAt: new Date("2026-05-18T12:00:00Z"),
    ...overrides,
  } as unknown as Parameters<typeof renderReportPdf>[0];
}

function makeInspection(overrides: Record<string, unknown> = {}) {
  return {
    id: 915,
    companyId: 1,
    siteAddress: "240 Harbor Street, Portland, ME",
    clientName: "Northwind Retail",
    technicianName: "Morgan Lee",
    technicianId: null,
    status: "completed",
    pestTypes: ["Rodent"],
    severity: "high",
    notes: null,
    mediaCount: 1,
    findingsCount: 1,
    aiAnalysisId: null,
    clientKey: null,
    scheduledDate: null,
    createdAt: new Date("2026-05-18T12:00:00Z"),
    completedAt: new Date("2026-05-18T12:00:00Z"),
    technicianSignature: null,
    ownerSignature: null,
    ownerNotAvailable: false,
    signedAt: null,
    unitNumber: null,
    visitPurpose: "Routine inspection",
    ...overrides,
  } as Parameters<typeof renderReportPdf>[1];
}

const photo = {
  id: 1,
  companyId: 1,
  inspectionId: 915,
  mediaType: "photo",
  url: "/objects/evidence/dock.png",
  filename: "dock.png",
  caption: "Loading dock evidence",
  durationSec: null,
  captureSource: "phone_camera",
  qualityScore: null,
  zoomSubject: null,
  captureMetadata: null,
  capturedAt: null,
  createdAt: new Date("2026-05-18T12:00:00Z"),
  unitNumber: null,
} as Parameters<typeof renderReportPdf>[2][number];

const imageData =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/S1sAAAAASUVORK5CYII=";

async function extractPdfText(pdf: Buffer): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "report-pdf-test-"));
  const pdfPath = join(dir, "report.pdf");
  try {
    await writeFile(pdfPath, pdf);
    const { stdout } = await execFileAsync("pdftotext", [pdfPath, "-"]);
    return stdout;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("renderReportPdf", () => {
  it("returns a real PDF containing report details and narrative text", async () => {
    const findingUrl = "/api/storage/objects/evidence/dock.png";
    const pdf = await renderReportPdf(
      makeReport({
        findings: [{
          category: "Rodent activity",
          description: "Fresh droppings observed behind the loading dock.",
          severity: "high",
          location: "Loading dock",
          imageUrl: findingUrl,
        }],
      }),
      makeInspection(),
      [photo],
      new Map([[findingUrl, imageData]]),
    );
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");

    const text = await extractPdfText(pdf);
    expect(text).toContain("Inspection ID: #915");
    expect(text).toContain("240 Harbor Street, Portland, ME");
    expect(text).toContain("Morgan Lee");
    expect(text).toContain("2026-05-18");
    expect(text).toContain("Fresh droppings observed behind the loading dock.");
    expect(text).toContain("Seal the gap behind the loading dock.");
    expect(text).toContain("Rodent activity requires prompt exclusion work.");
    expect(text).toContain("Loading dock evidence");
    expect(text.match(/Loading dock evidence/g)).toHaveLength(1);
  });

  it("includes an evidence row whose mediaType is image", async () => {
    const imageRecord = {
      ...photo,
      mediaType: "image",
      url: "/objects/evidence/image-only.png",
      caption: "Standalone image evidence",
    } as typeof photo;
    const pdf = await renderReportPdf(
      makeReport({ findings: [] }),
      makeInspection(),
      [imageRecord],
      new Map([[imageRecord.url, imageData]]),
    );

    expect(await extractPdfText(pdf)).toContain("Standalone image evidence");
  });

  it("fails instead of silently omitting an expected photo", async () => {
    await expect(
      renderReportPdf(makeReport(), makeInspection(), [photo], new Map()),
    ).rejects.toThrow("Expected evidence photo is unavailable");
  });

  it("rejects an evidence photo that exceeds the bounded image size", async () => {
    const oversizedImage = `data:image/png;base64,${Buffer.alloc(10 * 1024 * 1024 + 1).toString("base64")}`;
    await expect(
      renderReportPdf(makeReport(), makeInspection(), [photo], new Map([[photo.url, oversizedImage]])),
    ).rejects.toThrow("per-photo limit");
  });
});