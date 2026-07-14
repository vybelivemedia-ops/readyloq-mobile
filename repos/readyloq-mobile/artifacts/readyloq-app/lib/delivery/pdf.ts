import * as Print from "expo-print";

import { buildReportHtml, type ReportData } from "./report-html";

/**
 * Renders the inspection report to a PDF file on the device and returns its
 * file:// URI. Fully offline-capable — the HTML embeds local photos as
 * base64, so no network is touched.
 */
export async function generateReportPdf(data: ReportData): Promise<string> {
  const html = await buildReportHtml(data);
  const { uri } = await Print.printToFileAsync({ html });
  return uri;
}
