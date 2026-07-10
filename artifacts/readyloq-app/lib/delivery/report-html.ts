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

export async function buildReportHtml(data: ReportData): Promise<string> {
  const { record, findings, recommendations, riskLevel, analysisComplete, companyName } = data;

  const photoUris = await Promise.all(record.photos.map((p) => photoDataUri(p.localUri)));

  // Findings keyed to photos by storage path (the AI reports imageUrl =
  // storage path of the analyzed photo).
  const findingsForPhoto = (index: number): Finding[] => {
    const sp = record.photos[index]?.storagePath;
    if (!sp) return [];
    return findings.filter((f) => f.imageUrl && f.imageUrl === sp);
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
    ? findings.length === 0
      ? `<p class="muted">No pest activity or conducive conditions were detected in the captured evidence.</p>`
      : findings
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

  const photosSection = record.photos
    .map((photo, i) => {
      const uri = photoUris[i];
      const photoFindings = findingsForPhoto(i);
      return `
        <div class="photo-block">
          ${
            uri
              ? `<img src="${uri}" alt="Photo ${i + 1}" />`
              : `<div class="photo-missing">Photo ${i + 1} unavailable</div>`
          }
          <div class="photo-caption">
            <strong>Photo ${i + 1}</strong>${
              photo.capturedAt
                ? ` — ${new Date(photo.capturedAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`
                : ""
            }
            ${
              photoFindings.length > 0
                ? `<ul class="photo-findings">${photoFindings
                    .map((f) => `<li>${fmt(f.category)}: ${esc(f.description)}</li>`)
                    .join("")}</ul>`
                : ""
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
  .photo-caption { padding: 8px 12px; }
  .photo-findings { margin-top: 4px; color: #334155; }
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
    <div><div class="k">Photos</div><div class="v">${record.photos.length}</div></div>
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
    <h2>Findings (${analysisComplete ? findings.length : "pending"})</h2>
    ${findingsSection}
  </div>

  ${recsSection}

  <div class="section">
    <h2>Photo evidence (${record.photos.length})</h2>
    ${photosSection}
  </div>

  <footer>Generated by ReadyLoq · AI-assisted inspection intelligence · ${new Date().toLocaleString()}</footer>
</body>
</html>`;
}
