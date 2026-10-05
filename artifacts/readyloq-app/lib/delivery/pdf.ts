import * as FileSystem from "expo-file-system/legacy";
import * as Print from "expo-print";

import { buildReportHtml, type ReportData } from "./report-html";

const REPORT_PREFIX = "readyloq-report-";
const REPORT_SUFFIX = ".pdf";
const STALE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const MIN_REPORT_PDF_BYTES = 1024;
let reportFileSequence = 0;

/**
 * Expo Print can return a syntactically valid but empty PDF when its WebView
 * renders a blank page. Validate both the file boundary and basic page content
 * before allowing the URI to reach any delivery channel.
 */
async function assertUsablePdf(uri: string): Promise<void> {
  const info = await FileSystem.getInfoAsync(uri);
  if (!info.exists || !("size" in info) || info.size < MIN_REPORT_PDF_BYTES) {
    throw new Error("Report PDF generation failed: the PDF is empty or incomplete. Please try again.");
  }

  const pdf = await FileSystem.readAsStringAsync(uri, {
    encoding: FileSystem.EncodingType.UTF8,
  });
  const eof = pdf.lastIndexOf("%%EOF");
  if (
    !pdf.startsWith("%PDF-") ||
    !/\/Type\s*\/Page\b/.test(pdf) ||
    !/\/Contents\b/.test(pdf) ||
    !/\bstream\b/.test(pdf) ||
    !/\bendstream\b/.test(pdf) ||
    !/\bxref\b|\/Type\s*\/XRef\b/.test(pdf) ||
    !/startxref\s+\d+/.test(pdf) ||
    eof < 0 ||
    pdf.slice(eof + "%%EOF".length).trim().length > 0
  ) {
    throw new Error("Report PDF generation failed: the PDF is truncated or has no rendered page content. Please try again.");
  }
}

/**
 * Best-effort cleanup: deletes any readyloq-report-*.pdf files in
 * documentDirectory that are older than 7 days. Errors are caught and logged
 * so they never interrupt report generation.
 */
async function purgeStaleReportPdfs(): Promise<void> {
  try {
    const dir = FileSystem.documentDirectory;
    if (!dir) return;

    const contents = await FileSystem.readDirectoryAsync(dir);
    const cutoff = Date.now() - STALE_MS;

    for (const name of contents) {
      if (!name.startsWith(REPORT_PREFIX) || !name.endsWith(REPORT_SUFFIX)) {
        continue;
      }
      // The filename encodes the creation timestamp: readyloq-report-<ms>.pdf
      const tsStr = name.slice(REPORT_PREFIX.length, -REPORT_SUFFIX.length);
      const ts = parseInt(tsStr, 10);
      if (isNaN(ts) || ts >= cutoff) continue;

      try {
        await FileSystem.deleteAsync(`${dir}${name}`, { idempotent: true });
      } catch (err) {
        console.warn("[pdf] Failed to delete stale report:", name, err);
      }
    }
  } catch (err) {
    console.warn("[pdf] purgeStaleReportPdfs error:", err);
  }
}

/**
 * Renders the inspection report to a PDF file on the device and returns its
 * file:// URI. Fully offline-capable — the HTML embeds local photos as
 * base64, so no network is touched.
 *
 * The PDF is written to documentDirectory (not the volatile print-cache temp
 * dir) so sharing channels — email, SMS, AirDrop — can still read the file
 * after iOS/Android prune the print cache between generation and delivery.
 *
 * Before writing, any readyloq-report-*.pdf files older than 7 days are
 * removed (best-effort; failures are logged and never thrown).
 */
export async function generateReportPdf(data: ReportData): Promise<string> {
  // Clean up stale PDFs before generating a new one.
  await purgeStaleReportPdfs();

  const html = await buildReportHtml(data);

  // width:612 = US Letter in PDF points (8.5 in × 72 pt/in).
  // Without an explicit width the WebView inside expo-print may lay out at
  // zero width on some Android versions, producing a blank page.
  const { uri: cacheUri } = await Print.printToFileAsync({
    html,
    width: 612,
    height: 792,
  });

  // Copy out of the volatile print cache into the app's durable documents
  // directory. Email clients, SMS apps, and AirDrop read from here after iOS/
  // Android have already pruned the temp cache that printToFileAsync uses.
  const filename = `${REPORT_PREFIX}${Date.now()}-${++reportFileSequence}${REPORT_SUFFIX}`;
  const docUri = `${FileSystem.documentDirectory}${filename}`;
  try {
    await FileSystem.copyAsync({ from: cacheUri, to: docUri });
    await assertUsablePdf(docUri);
  } catch (err) {
    await FileSystem.deleteAsync(docUri, { idempotent: true }).catch(() => {});
    throw err;
  } finally {
    // The durable copy is the only report URI retained for delivery.
    await FileSystem.deleteAsync(cacheUri, { idempotent: true }).catch(() => {});
  }

  return docUri;
}
