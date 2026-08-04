import * as FileSystem from "expo-file-system/legacy";
import * as Print from "expo-print";

import { buildReportHtml, type ReportData } from "./report-html";

/**
 * Renders the inspection report to a PDF file on the device and returns its
 * file:// URI. Fully offline-capable — the HTML embeds local photos as
 * base64, so no network is touched.
 *
 * The PDF is written to documentDirectory (not the volatile print-cache temp
 * dir) so sharing channels — email, SMS, AirDrop — can still read the file
 * after iOS/Android prune the print cache between generation and delivery.
 */
export async function generateReportPdf(data: ReportData): Promise<string> {
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
  const filename = `readyloq-report-${Date.now()}.pdf`;
  const docUri = `${FileSystem.documentDirectory}${filename}`;
  await FileSystem.copyAsync({ from: cacheUri, to: docUri });

  return docUri;
}
