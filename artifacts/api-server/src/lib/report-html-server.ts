import type { reportsTable, inspectionsTable } from "@workspace/db";

type Report = typeof reportsTable.$inferSelect;
type Inspection = typeof inspectionsTable.$inferSelect;

interface Finding {
  category?: string;
  description?: string;
  severity?: string;
  location?: string;
  exclusionOpportunity?: boolean;
}

const SEVERITY_COLOR: Record<string, string> = {
  critical: "#dc2626",
  high: "#ea580c",
  medium: "#d97706",
  low: "#16a34a",
};

const SEVERITY_BG: Record<string, string> = {
  critical: "#fee2e2",
  high: "#ffedd5",
  medium: "#fef9c3",
  low: "#dcfce7",
};

function badge(text: string, color: string, bg: string) {
  return `<span style="display:inline-block;padding:2px 8px;border-radius:9999px;font-size:11px;font-weight:600;color:${color};background:${bg};text-transform:uppercase;letter-spacing:.5px">${esc(text)}</span>`;
}

function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function section(title: string, content: string) {
  return `
    <div style="margin-bottom:28px">
      <h2 style="font-size:14px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:#6b7280;margin:0 0 12px 0;padding-bottom:6px;border-bottom:1px solid #e5e7eb">${esc(title)}</h2>
      ${content}
    </div>`;
}

export function buildServerReportHtml(report: Report, inspection: Inspection): string {
  const findings = ((report.findings ?? []) as Finding[]).filter(
    (f) => f.category || f.description,
  );
  const recommendations = (report.recommendations ?? []) as string[];
  const exclusions = (report.exclusionOpportunities ?? []) as string[];
  const sev = (report.severity ?? inspection.severity ?? "").toLowerCase();
  const sevColor = SEVERITY_COLOR[sev] ?? "#6b7280";
  const sevBg = SEVERITY_BG[sev] ?? "#f3f4f6";

  const findingsHtml =
    findings.length === 0
      ? `<p style="color:#6b7280;font-style:italic">No findings recorded.</p>`
      : findings
          .map((f) => {
            const fsev = (f.severity ?? "").toLowerCase();
            const fc = SEVERITY_COLOR[fsev] ?? "#6b7280";
            const fb = SEVERITY_BG[fsev] ?? "#f9fafb";
            return `
          <div style="border:1px solid #e5e7eb;border-radius:8px;padding:12px 14px;margin-bottom:10px;background:${fb}">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:4px">
              <strong style="font-size:13px;color:#111827">${esc(f.category ?? "Finding")}</strong>
              ${fsev ? badge(fsev, fc, fb) : ""}
            </div>
            ${f.description ? `<p style="margin:4px 0 0 0;color:#374151;font-size:13px">${esc(f.description)}</p>` : ""}
            ${f.location ? `<p style="margin:4px 0 0 0;color:#6b7280;font-size:12px">📍 ${esc(f.location)}</p>` : ""}
            ${f.exclusionOpportunity ? `<p style="margin:6px 0 0 0;font-size:11px;color:#0369a1">🔒 Exclusion opportunity identified</p>` : ""}
          </div>`;
          })
          .join("");

  const recsHtml =
    recommendations.length === 0
      ? `<p style="color:#6b7280;font-style:italic">No recommendations recorded.</p>`
      : `<ul style="margin:0;padding-left:18px">${recommendations.map((r) => `<li style="margin-bottom:6px;color:#374151;font-size:13px">${esc(r)}</li>`).join("")}</ul>`;

  const exclHtml =
    exclusions.length === 0
      ? ""
      : section(
          "Exclusion Opportunities",
          `<ul style="margin:0;padding-left:18px">${exclusions.map((e) => `<li style="margin-bottom:6px;color:#374151;font-size:13px">${esc(e)}</li>`).join("")}</ul>`,
        );

  const narrativeHtml = report.aiNarrative
    ? section(
        "AI Narrative",
        `<div style="color:#374151;font-size:13px;line-height:1.7;white-space:pre-wrap">${esc(report.aiNarrative)}</div>`,
      )
    : "";

  const treatmentHtml = report.treatmentNotes
    ? section(
        "Treatment Notes",
        `<div style="color:#374151;font-size:13px;line-height:1.6;white-space:pre-wrap">${esc(report.treatmentNotes)}</div>`,
      )
    : "";

  const pestTypes = ((inspection.pestTypes ?? []) as string[]).join(", ");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>${esc(report.title)}</title>
  <style>
    *{box-sizing:border-box}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;margin:0;background:#f9fafb;color:#111827;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    .page{max-width:820px;margin:0 auto;background:#fff;padding:40px 48px;min-height:100vh}
    @media print{body{background:#fff}.page{padding:24px;box-shadow:none}}
    @media(max-width:640px){.page{padding:24px 20px}}
    .print-btn{position:fixed;bottom:24px;right:24px;background:#0ea5e9;color:#fff;border:none;border-radius:8px;padding:10px 18px;font-size:13px;font-weight:600;cursor:pointer;box-shadow:0 4px 12px rgba(14,165,233,.35)}
    .print-btn:hover{background:#0284c7}
    @media print{.print-btn{display:none}}
  </style>
</head>
<body>
  <div class="page">
    <!-- Header -->
    <div style="margin-bottom:32px;padding-bottom:24px;border-bottom:2px solid #0ea5e9">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px">
        <div>
          <p style="margin:0 0 4px 0;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.8px;color:#0ea5e9">ReadyLoq Inspection Report</p>
          <h1 style="margin:0 0 6px 0;font-size:22px;font-weight:800;color:#111827">${esc(report.title)}</h1>
          <p style="margin:0;color:#6b7280;font-size:13px">${esc(report.siteAddress)}</p>
        </div>
        <div style="text-align:right">
          ${sev ? badge(sev + " severity", sevColor, sevBg) : ""}
        </div>
      </div>
    </div>

    <!-- Meta grid -->
    ${section(
      "Inspection Details",
      `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px">
        ${[
          ["Date", report.inspectionDate],
          ["Technician", report.technicianName],
          ["Client", report.clientName],
          ["Pest Types", pestTypes || null],
        ]
          .filter(([, v]) => v)
          .map(
            ([label, value]) => `
          <div style="background:#f9fafb;border-radius:6px;padding:10px 12px">
            <p style="margin:0 0 2px 0;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#9ca3af">${esc(label)}</p>
            <p style="margin:0;font-size:13px;color:#111827;font-weight:500">${esc(value)}</p>
          </div>`,
          )
          .join("")}
      </div>`,
    )}

    ${section("Findings", findingsHtml)}
    ${section("Recommendations", recsHtml)}
    ${exclHtml}
    ${narrativeHtml}
    ${treatmentHtml}

    <!-- Footer -->
    <div style="margin-top:40px;padding-top:16px;border-top:1px solid #e5e7eb;text-align:center;color:#9ca3af;font-size:11px">
      Generated by ReadyLoq · ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}
    </div>
  </div>
  <button class="print-btn" onclick="window.print()">🖨 Print / Save PDF</button>
</body>
</html>`;
}
