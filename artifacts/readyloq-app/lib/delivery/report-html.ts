import * as FileSystem from "expo-file-system/legacy";

import type { Finding } from "@/lib/api-client";
import type { LocalInspection } from "@/lib/local/inspection-store";

/**
 * Builds the printable inspection report as a self-contained HTML document.
 *
 * Everything is sourced from the DEVICE — photos are embedded as base64 data
 * URIs read from the durable local copies — so the PDF can be generated and
 * delivered fully offline. Server-side AI results (findings, recommendations,
 * risk level) are layered in when they have arrived; when they haven't, the
 * report says so instead of silently omitting them.
 */
export interface ReportData {
  record: LocalInspection;
  findings: Finding[];
  recommendations: string[];
  riskLevel: string | null;
  /** True once the server finished analysis, so empty findings means "clean". */
  analysisComplete: boolean;
  companyName: string | null;
  /** AI-generated narrative section: conditions that sustain/attract pests. */
  conduciveConditions?: string | null;
  /** AI-generated plain-language actions the customer should take themselves. */
  customerRecommendations?: string[] | null;
}

function esc(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmt(value: string | null | undefined): string {
  if (!value) return "";
  return esc(
    value
      .replace(/[_-]/g, " ")
      .replace(/\b\w/g, (c) => c.toUpperCase()),
  );
}

async function photoDataUri(localUri: string): Promise<string | null> {
  try {
    const base64 = await FileSystem.readAsStringAsync(localUri, {
      encoding: FileSystem.EncodingType.Base64,
    });
    return `data:image/jpeg;base64,${base64}`;
  } catch {
    return null; // Photo file missing — render placeholder rather than fail.
  }
}

const SEVERITY_COLORS: Record<string, string> = {
  critical: "#dc2626",
  high: "#ea580c",
  medium: "#d97706",
  low: "#65a30d",
};

/** Human-readable label for a capture source code. */
function captureSourceLabel(source: string | undefined): string {
  if (!source) return "Photo";
  const LABELS: Record<string, string> = {
    phone_camera: "Photo",
    media_import: "Imported photo",
    wifi_stream: "Wi-Fi camera",
    usb_camera: "USB scope",
    smart_glasses: "Smart glasses",
    wearable_camera: "Wearable cam",
  };
  return LABELS[source] ?? "Photo";
}

/** Quality score below which a photo is excluded from the PDF report. */
const REPORT_QUALITY_MIN = 50;

export async function buildReportHtml(data: ReportData): Promise<string> {
  const { record, findings, recommendations, riskLevel, analysisComplete, companyName } = data;

  // ── Finding filter ───────────────────────────────────────────────────────
  // Dismissed findings are excluded from the report entirely — they are not
  // shown in the findings section, not counted, and not mentioned anywhere.
  // Accepted, corrected, pending, and un-reviewed findings are all included.
  const reportFindings = findings.filter((f) => f.reviewStatus !== "dismissed");

  // ── Photo filter ──────────────────────────────────────────────────────────
  // Two separate exclusion rules, both silent (no "X excluded" notice):
  //   1. Quality gate: photos scored below the acceptance threshold are dropped.
  //   2. Dismissed evidence: if every AI finding attached to a photo was
  //      dismissed by the technician the photo carries no accepted evidence —
  //      exclude it silently so it does not appear in the report at all.
  // Photos with no findings (pure photo evidence) and photos with at least one
  // accepted/pending finding are always kept.
  const goodPhotos = record.photos.filter((p) => {
    if (typeof p.qualityScore === "number" && p.qualityScore < REPORT_QUALITY_MIN) {
      return false; // quality gate
    }
    if (p.storagePath) {
      const photoFindingAll = findings.filter(
        (f) => f.imageUrl && f.imageUrl === p.storagePath,
      );
      if (
        photoFindingAll.length > 0 &&
        photoFindingAll.every((f) => f.reviewStatus === "dismissed")
      ) {
        return false; // all findings dismissed — exclude photo silently
      }
    }
    return true;
  });

  // skippedCount only covers quality-excluded photos; dismissed photos are
  // excluded silently and never mentioned.
  const skippedCount = record.photos.filter(
    (p) => typeof p.qualityScore === "number" && p.qualityScore < REPORT_QUALITY_MIN,
  ).length;

  const photoUris = await Promise.all(goodPhotos.map((p) => photoDataUri(p.localUri)));

  // Findings keyed to photos by storage path (the AI reports imageUrl =
  // storage path of the analyzed photo). Uses reportFindings so dismissed
  // findings never appear under any photo's caption.
  const findingsForPhoto = (index: number): Finding[] => {
    const sp = goodPhotos[index]?.storagePath;
    if (!sp) return [];
    return reportFindings.filter((f) => f.imageUrl && f.imageUrl === sp);
  };

  const completedAt = record.completedAt ? new Date(record.completedAt) : new Date();
  const dateStr = completedAt.toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const timeStr = completedAt.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });

  const findingsSection = analysisComplete
    ? reportFindings.length === 0
      ? `<p class="muted">No pest activity or conducive conditions were detected in the captured evidence.</p>`
      : reportFindings
          .map((f) => {
            const sev = (f.severity || "").toLowerCase();
            const color = SEVERITY_COLORS[sev] ?? "#475569";
            return `
              <div class="finding">
                <div class="finding-head">
                  <span class="chip" style="background:${color}1a;color:${color};border-color:${color}55">${fmt(f.category)}</span>
                  ${f.severity ? `<span class="sev" style="color:${color}">${fmt(f.severity)}</span>` : ""}
                  ${f.location ? `<span class="loc">${esc(f.location)}</span>` : ""}
                </div>
                <p>${esc(f.description)}</p>
                ${f.treatment ? `<p class="treat"><strong>Recommended treatment:</strong> ${esc(f.treatment)}</p>` : ""}
              </div>`;
          })
          .join("")
    : `<p class="muted">AI analysis is still processing — findings will appear in the online report once this inspection finishes syncing.</p>`;

  const recsSection =
    analysisComplete && recommendations.length > 0
      ? `<div class="section">
          <h2>Recommendations</h2>
          <ul>${recommendations.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>
        </div>`
      : "";

  const { conduciveConditions, customerRecommendations } = data;

  const conduciveSection =
    conduciveConditions
      ? `<div class="section">
          <h2>Conducive conditions</h2>
          <p>${esc(conduciveConditions)}</p>
        </div>`
      : "";

  const customerRecsSection =
    customerRecommendations && customerRecommendations.length > 0
      ? `<div class="section">
          <h2>Actions for you (the client)</h2>
          <ul>${customerRecommendations.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>
        </div>`
      : "";

  // ── Signatures section ───────────────────────────────────────────────────
  // Render whichever slots have content. ownerNotAvailable replaces the owner
  // signature box with an explanatory notice. Slots with no data are omitted.
  const techSigSlot = record.technicianSignature
    ? `<div class="sig-slot">
        <div class="sig-label">Technician</div>
        <div class="sig-box">${record.technicianSignature}</div>
      </div>`
    : "";

  const ownerSigSlot = record.ownerNotAvailable
    ? `<div class="sig-slot">
        <div class="sig-label">Owner / Tenant</div>
        <div class="sig-na">Not Available — technician signed on behalf</div>
      </div>`
    : record.ownerSignature
      ? `<div class="sig-slot">
          <div class="sig-label">Owner / Tenant</div>
          <div class="sig-box">${record.ownerSignature}</div>
        </div>`
      : "";

  const signaturesSection =
    techSigSlot || ownerSigSlot
      ? `<div class="section">
          <h2>Signatures</h2>
          <div class="sig-row">
            ${techSigSlot}
            ${ownerSigSlot}
          </div>
        </div>`
      : "";

  const photosSection = goodPhotos
    .map((photo, i) => {
      const uri = photoUris[i];
      const photoFindings = findingsForPhoto(i);
      const srcLabel = captureSourceLabel(photo.captureSource);
      const timeStr = photo.capturedAt
        ? new Date(photo.capturedAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
        : null;
      const isNonDefault = photo.captureSource && photo.captureSource !== "phone_camera";
      return `
        <div class="photo-block">
          ${
            uri
              ? `<img src="${uri}" alt="${esc(srcLabel)} ${i + 1}" />`
              : `<div class="photo-missing">${esc(srcLabel)} ${i + 1} unavailable</div>`
          }
          <div class="photo-caption">
            <div class="cap-row">
              <strong>${esc(srcLabel)} ${i + 1}</strong>
              ${timeStr ? `<span class="cap-time">${timeStr}</span>` : ""}
              ${isNonDefault ? `<span class="cap-src">${esc(srcLabel)}</span>` : ""}
            </div>
            ${photo.description ? `<p class="cap-desc">${esc(photo.description)}</p>` : ""}
            ${
              photoFindings.length > 0
                ? `<ul class="photo-findings">${photoFindings
                    .map((f) => `<li><strong>${fmt(f.category)}</strong>${f.location ? ` · ${esc(f.location)}` : ""}: ${esc(f.description)}</li>`)
                    .join("")}</ul>`
                : `<p class="cap-none">No AI findings on this photo.</p>`
            }
          </div>
        </div>`;
    })
    .join("");

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #0f172a; padding: 32px; font-size: 13px; line-height: 1.55; }
  header { border-bottom: 3px solid #0f766e; padding-bottom: 14px; margin-bottom: 20px; }
  header h1 { font-size: 22px; color: #0f766e; }
  header .sub { color: #475569; margin-top: 2px; }
  .meta-grid { display: flex; flex-wrap: wrap; gap: 6px 28px; margin: 14px 0 4px; }
  .meta-grid div { min-width: 180px; }
  .meta-grid .k { font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; color: #64748b; }
  .meta-grid .v { font-weight: 600; }
  .risk { display: inline-block; padding: 3px 12px; border-radius: 999px; font-weight: 700; font-size: 12px; }
  .section { margin-top: 22px; }
  .section h2 { font-size: 15px; color: #0f766e; border-bottom: 1px solid #e2e8f0; padding-bottom: 5px; margin-bottom: 10px; }
  .muted { color: #64748b; }
  .finding { margin-bottom: 12px; padding: 10px 12px; border: 1px solid #e2e8f0; border-radius: 8px; page-break-inside: avoid; }
  .finding-head { display: flex; gap: 10px; align-items: center; margin-bottom: 4px; flex-wrap: wrap; }
  .chip { border: 1px solid; border-radius: 999px; padding: 1px 10px; font-size: 11px; font-weight: 700; }
  .sev { font-size: 11px; font-weight: 700; text-transform: uppercase; }
  .loc { color: #64748b; font-size: 11px; }
  .treat { margin-top: 4px; color: #334155; }
  ul { padding-left: 18px; }
  li { margin-bottom: 4px; }
  .photo-block { page-break-inside: avoid; margin-bottom: 16px; border: 1px solid #e2e8f0; border-radius: 8px; overflow: hidden; }
  .photo-block img { width: 100%; max-height: 380px; object-fit: contain; background: #f1f5f9; display: block; }
  .photo-missing { padding: 40px; text-align: center; color: #94a3b8; background: #f8fafc; }
  .photo-caption { padding: 10px 14px; }
  .cap-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 6px; }
  .cap-time { color: #64748b; font-size: 11px; }
  .cap-src { background: #0f766e1a; color: #0f766e; border: 1px solid #0f766e33; border-radius: 999px; padding: 1px 8px; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; }
  .cap-none { color: #94a3b8; font-size: 11px; margin-top: 2px; }
  .cap-desc { color: #1e293b; font-size: 12px; line-height: 1.6; margin: 6px 0 4px; padding: 6px 10px; background: #f8fafc; border-left: 3px solid #0f766e; border-radius: 0 4px 4px 0; }
  .photo-findings { margin-top: 4px; color: #334155; font-size: 12px; line-height: 1.6; }
  .photo-skipped { background: #fff7ed; border: 1px solid #fed7aa; border-radius: 8px; padding: 10px 14px; color: #92400e; font-size: 12px; margin-bottom: 16px; }
  .sig-row { display: flex; gap: 24px; flex-wrap: wrap; margin-top: 10px; }
  .sig-slot { flex: 1; min-width: 200px; }
  .sig-label { font-size: 10px; text-transform: uppercase; letter-spacing: 0.06em; color: #64748b; margin-bottom: 6px; }
  .sig-box { border: 1px solid #e2e8f0; border-radius: 8px; background: #f8fafc; padding: 8px; min-height: 90px; display: flex; align-items: center; justify-content: center; overflow: hidden; }
  .sig-box svg { max-width: 100%; max-height: 120px; display: block; }
  .sig-na { color: #92400e; background: #fff7ed; border: 1px solid #fed7aa; border-radius: 8px; padding: 10px 14px; font-size: 12px; }
  footer { margin-top: 28px; padding-top: 10px; border-top: 1px solid #e2e8f0; color: #94a3b8; font-size: 10px; }
</style>
</head>
<body>
  <header>
    <h1>${companyName ? esc(companyName) : "ReadyLoq"} — Inspection Report</h1>
    <div class="sub">${esc(record.siteAddress || "Untitled inspection")}</div>
  </header>

  <div class="meta-grid">
    <div><div class="k">Client</div><div class="v">${esc(record.clientName || "—")}</div></div>
    <div><div class="k">Technician</div><div class="v">${esc(record.technicianName || "—")}</div></div>
    <div><div class="k">Completed</div><div class="v">${dateStr} at ${timeStr}</div></div>
    <div><div class="k">Photos</div><div class="v">${goodPhotos.length}${skippedCount > 0 ? ` <span style="color:#94a3b8;font-weight:400;font-size:11px">(${skippedCount} low-quality excluded)</span>` : ""}</div></div>
    ${
      riskLevel
        ? `<div><div class="k">Risk level</div><div class="v"><span class="risk" style="background:${
            (SEVERITY_COLORS[riskLevel.toLowerCase()] ?? "#475569") + "1a"
          };color:${SEVERITY_COLORS[riskLevel.toLowerCase()] ?? "#475569"}">${fmt(riskLevel)}</span></div></div>`
        : ""
    }
  </div>

  ${record.notes ? `<div class="section"><h2>Inspection notes</h2><p>${esc(record.notes)}</p></div>` : ""}

  <div class="section">
    <h2>Findings (${analysisComplete ? reportFindings.length : "pending"})</h2>
    ${findingsSection}
  </div>

  ${recsSection}

  ${conduciveSection}

  ${customerRecsSection}

  <div class="section">
    <h2>Photo evidence (${goodPhotos.length}${skippedCount > 0 ? ` of ${record.photos.length}` : ""})</h2>
    ${skippedCount > 0 ? `<div class="photo-skipped">⚠ ${skippedCount} photo${skippedCount > 1 ? "s were" : " was"} excluded from this report due to low image quality (blurry, too dark, or near-uniform). All evidence is preserved in the inspection record.</div>` : ""}
    ${photosSection}
  </div>

  ${signaturesSection}

  <footer>Generated by ReadyLoq · AI-assisted inspection intelligence · ${new Date().toLocaleString()}</footer>
</body>
</html>`;
}
