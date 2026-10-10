import PDFDocument from "pdfkit";
import type {
  inspectionMediaTable,
  inspectionsTable,
  reportsTable,
} from "@workspace/db";

type Report = typeof reportsTable.$inferSelect;
type Inspection = typeof inspectionsTable.$inferSelect;
type MediaRecord = typeof inspectionMediaTable.$inferSelect;

const MAX_PHOTO_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_PHOTO_BYTES = 30 * 1024 * 1024;
const MAX_PDF_BYTES = 40 * 1024 * 1024;

interface EvidencePhoto {
  url: string;
  buffer: Buffer;
  media?: MediaRecord;
}

function decodeImageData(url: string, imageData: string): Buffer {
  const match = /^data:image\/(png|jpe?g);base64,([A-Za-z0-9+/]+={0,2})$/i.exec(imageData);
  if (!match) {
    throw new Error(`Evidence photo ${url} is missing valid PNG/JPEG image data.`);
  }

  const buffer = Buffer.from(match[2], "base64");
  if (buffer.length === 0 || buffer.length > MAX_PHOTO_BYTES) {
    throw new Error(`Evidence photo ${url} exceeds the ${MAX_PHOTO_BYTES} byte per-photo limit or is empty.`);
  }
  if (match[1].toLowerCase() === "png" && !(buffer[0] === 0x89 && buffer[1] === 0x50)) {
    throw new Error(`Evidence photo ${url} contains invalid PNG data.`);
  }
  if (match[1].toLowerCase().startsWith("jp") && !(buffer[0] === 0xff && buffer[1] === 0xd8)) {
    throw new Error(`Evidence photo ${url} contains invalid JPEG data.`);
  }
  return buffer;
}

function normalizeImageUrl(url: string): string {
  return url.startsWith("/api/storage/objects/")
    ? url.slice("/api/storage".length)
    : url;
}

function appendText(doc: PDFKit.PDFDocument, label: string, content: unknown): void {
  if (content == null || content === "") return;
  doc.font("Helvetica-Bold").fontSize(10).fillColor("#475569").text(label.toUpperCase());
  doc.moveDown(0.25);
  doc.font("Helvetica").fontSize(11).fillColor("#172033").text(String(content), {
    lineGap: 2,
  });
  doc.moveDown(0.75);
}

function appendList(doc: PDFKit.PDFDocument, label: string, values: unknown): void {
  if (!Array.isArray(values) || values.length === 0) return;
  doc.font("Helvetica-Bold").fontSize(10).fillColor("#475569").text(label.toUpperCase());
  doc.moveDown(0.25);
  for (const value of values) {
    doc.font("Helvetica").fontSize(11).fillColor("#172033").text(`•  ${String(value)}`, {
      indent: 8,
      lineGap: 2,
    });
  }
  doc.moveDown(0.75);
}

function heading(doc: PDFKit.PDFDocument, title: string): void {
  doc.moveDown(0.4);
  doc.font("Helvetica-Bold").fontSize(15).fillColor("#0f172a").text(title);
  doc.moveDown(0.35);
}

/**
 * Render the report directly to PDF. Evidence must be completely available
 * before rendering so a generated report never silently omits expected photos.
 */
export async function renderReportPdf(
  report: Report,
  inspection: Inspection,
  media: MediaRecord[],
  imageDataMap: ReadonlyMap<string, string>,
): Promise<Buffer> {
  const findings = (report.findings ?? []) as Array<{
    category?: string;
    species?: string | null;
    description?: string;
    severity?: string;
    location?: string;
    imageUrl?: string | null;
  }>;
  const photosByUrl = new Map<string, MediaRecord | undefined>();
  for (const item of media) {
    if ((item.mediaType === "photo" || item.mediaType === "image") && item.url) {
      photosByUrl.set(normalizeImageUrl(item.url), item);
    }
  }
  for (const finding of findings) {
    if (finding.imageUrl) {
      const normalizedUrl = normalizeImageUrl(finding.imageUrl);
      photosByUrl.set(normalizedUrl, photosByUrl.get(normalizedUrl));
    }
  }

  const normalizedImageDataMap = new Map<string, string>();
  for (const [url, imageData] of imageDataMap) {
    normalizedImageDataMap.set(normalizeImageUrl(url), imageData);
  }

  const photos: EvidencePhoto[] = [];
  let totalPhotoBytes = 0;
  for (const [url, photoRecord] of photosByUrl) {
    const imageData = normalizedImageDataMap.get(url);
    if (!imageData) throw new Error(`Expected evidence photo is unavailable: ${url}`);
    const buffer = decodeImageData(url, imageData);
    totalPhotoBytes += buffer.length;
    if (totalPhotoBytes > MAX_TOTAL_PHOTO_BYTES) {
      throw new Error(`Evidence photos exceed the ${MAX_TOTAL_PHOTO_BYTES} byte combined limit.`);
    }
    photos.push({ url, buffer, media: photoRecord });
  }

  const doc = new PDFDocument({
    autoFirstPage: true,
    margins: { top: 54, bottom: 54, left: 54, right: 54 },
    info: { Title: report.title, Author: report.technicianName },
  });
  const chunks: Buffer[] = [];

  return await new Promise<Buffer>((resolve, reject) => {
    let outputBytes = 0;
    let settled = false;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    doc.on("data", (chunk: Buffer) => {
      if (settled) return;
      outputBytes += chunk.length;
      if (outputBytes > MAX_PDF_BYTES) {
        fail(new Error(`Generated PDF exceeds the ${MAX_PDF_BYTES} byte size limit.`));
        (doc as PDFKit.PDFDocument & { destroy(): void }).destroy();
        return;
      }
      chunks.push(chunk);
    });
    doc.on("error", (error: Error) => fail(error));
    doc.on("end", () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks, outputBytes));
    });

    try {
      doc.font("Helvetica-Bold").fontSize(22).fillColor("#0f172a").text(report.title);
      doc.moveDown(0.5);
      doc.font("Helvetica").fontSize(10).fillColor("#475569")
        .text(`Inspection ID: #${inspection.id}`)
        .text(`Site address: ${report.siteAddress || inspection.siteAddress}`)
        .text(`Technician: ${report.technicianName || inspection.technicianName}`)
        .text(`Inspection date: ${report.inspectionDate}`);

      heading(doc, "Findings");
      if (findings.length === 0) {
        doc.font("Helvetica").fontSize(11).fillColor("#172033").text("No findings recorded.");
      }
      for (const [index, finding] of findings.entries()) {
        const name = finding.category || finding.species || `Finding ${index + 1}`;
        doc.font("Helvetica-Bold").fontSize(12).fillColor("#0f172a").text(name);
        if (finding.severity) {
          doc.font("Helvetica-Bold").fontSize(9).fillColor("#475569").text(`Severity: ${finding.severity}`);
        }
        appendText(doc, "Description", finding.description);
        appendText(doc, "Location", finding.location);
        doc.moveDown(0.35);
      }

      appendList(doc, "Recommendations", report.recommendations);
      appendList(doc, "Exclusion opportunities", report.exclusionOpportunities);
      appendText(doc, "Treatment notes", report.treatmentNotes);
      appendText(doc, "Inspection notes", inspection.notes);

      const narrative = report.aiNarrative;
      if (narrative) {
        heading(doc, "Narrative report");
        appendText(doc, "Executive summary", narrative.executiveSummary);
        appendText(doc, "Inspection findings", narrative.inspectionFindings);
        appendText(doc, "Evidence observed", narrative.evidenceObserved);
        appendText(doc, "Pest activity assessment", narrative.pestActivityAssessment);
        appendText(doc, "Structural deficiencies", narrative.structuralDeficiencies);
        appendText(doc, "Sanitation concerns", narrative.sanitationConcerns);
        appendList(doc, "Recommended corrective actions", narrative.recommendedCorrectiveActions);
        appendList(doc, "Monitoring recommendations", narrative.monitoringRecommendations);
        appendText(doc, "Follow-up schedule", narrative.followUpSchedule);
        appendText(doc, "Technician notes", narrative.technicianNotes);
        appendText(doc, "Manager review notes", narrative.managerReviewNotes);
        appendText(doc, "Conducive conditions", narrative.conduciveConditions);
        appendList(doc, "Customer recommendations", narrative.customerRecommendations);
        appendText(doc, "Property type", narrative.propertyType);
      }

      if (photos.length > 0) {
        heading(doc, "Evidence photos");
        for (const photo of photos) {
          const finding = findings.find(
            (item) => item.imageUrl && normalizeImageUrl(item.imageUrl) === photo.url,
          );
          const caption =
            photo.media?.caption ||
            finding?.species ||
            finding?.category ||
            "Inspection evidence";
          const requiredHeight = 300;
          if (doc.y + requiredHeight > doc.page.height - doc.page.margins.bottom) doc.addPage();
          doc.font("Helvetica-Bold").fontSize(10).fillColor("#172033").text(caption);
          doc.moveDown(0.2);
          doc.image(photo.buffer, {
            fit: [doc.page.width - doc.page.margins.left - doc.page.margins.right, 250],
            align: "center",
          });
          if (photo.media?.unitNumber) {
            doc.moveDown(0.2);
            doc.font("Helvetica").fontSize(9).fillColor("#475569").text(`Unit ${photo.media.unitNumber}`);
          }
          doc.moveDown(0.8);
        }
      }
      doc.end();
    } catch (error) {
      fail(error instanceof Error ? error : new Error(String(error)));
      (doc as PDFKit.PDFDocument & { destroy(): void }).destroy();
    }
  });
}