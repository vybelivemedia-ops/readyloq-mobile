import type { reportsTable, inspectionsTable } from "@workspace/db";

type Report = typeof reportsTable.$inferSelect;
type Inspection = typeof inspectionsTable.$inferSelect;

interface Finding {
  category?: string;
  description?: string;
  severity?: string;
  location?: string;
  exclusionOpportunity?: boolean;
  /** URL of the evidence photo — used to look up captureMetadata in media records. */
  imageUrl?: string | null;
}

/** Minimal shape of an InspectionMedia row needed for measurement lookup. */
interface MediaRecord {
  url: string;
  captureMetadata?: Record<string, unknown> | null;
}

/** Sub-object stored inside captureMetadata.laserMeasurement */
interface LaserMeasurement {
  kind?: string;
  value?: number;
  unit?: string;
  signalQuality?: number;
  metadata?: {
    method?: string;
    heightInches?: number;
    areaSqInches?: number;
    confidence?: number;
    warnings?: string[];
  };
}

/** Resolve a LaserMeasurement from a raw captureMetadata blob. */
function resolveLaserMeasurement(
  captureMetadata: Record<string, unknown> | null | undefined,
): LaserMeasurement | null {
  if (!captureMetadata) return null;
  const laser = captureMetadata.laserMeasurement;
  if (!laser || typeof laser !== "object") return null;
  return laser as LaserMeasurement;
}

/** Look up captureMetadata for a finding's imageUrl by scanning media records. */
function lookupCaptureMetadata(
  media: MediaRecord[],
  imageUrl: string | null | undefined,
): Record<string, unknown> | null {
  if (!imageUrl) return null;
  const match = media.find((m) => m.url === imageUrl);
  if (!match) return null;
  return match.captureMetadata ?? null;
}

/** True when the laser measurement was produced by the burst-reference pipeline. */
function isBurstMeasurement(laser: LaserMeasurement): boolean {
  return laser.metadata?.method === "burst_reference";
}

/** Best available confidence for a laser measurement. */
function measurementConfidence(laser: LaserMeasurement): number | null {
  const inner = laser.metadata?.confidence;
  if (inner != null) return inner;
  const outer = laser.signalQuality;
  if (outer != null) return outer;
  return null;
}

/** True when the resolved confidence score is below the 50% amber threshold. */
function isLowConfidence(conf: number | null): boolean {
  return conf != null && conf < 0.5;
}

/** Format a decimal inch value as a tidy string, e.g. 1.5 → "1.50 in".
 *  Returns null for null/undefined, Infinity, -Infinity, or NaN so that
 *  a near-zero reference box (which can produce Infinity via division) is
 *  silently omitted from the report rather than printed as garbage.
 * @internal exported for unit tests only */
export function fmtIn(value: number | undefined | null): string | null {
  if (value == null) return null;
  if (!Number.isFinite(value)) return null;
  return `${value.toFixed(2)} in`;
}

/** Format square inches as sq ft when ≥ 144, otherwise in².
 *  Returns null for null/undefined, Infinity, -Infinity, or NaN.
 * @internal exported for unit tests only */
export function fmtArea(areaSqIn: number | undefined | null): string | null {
  if (areaSqIn == null) return null;
  if (!Number.isFinite(areaSqIn)) return null;
  if (areaSqIn >= 144) {
    return `${(areaSqIn / 144).toFixed(2)} sq ft`;
  }
  return `${areaSqIn.toFixed(1)} sq in`;
}

/**
 * Build the HTML for a laser-measurement strip to embed inside a finding card.
 * Returns an empty string when no measurement is present.
 */
function buildMeasurementStripHtml(laser: LaserMeasurement): string {
  const conf = measurementConfidence(laser);
  const lowConf = isLowConfidence(conf);
  const isBurst = isBurstMeasurement(laser);

  // Colour tokens
  const accentColor = lowConf ? "#d97706" : "#0ea5e9";
  const bgColor = lowConf ? "#fef9c3" : "#e0f2fe";
  const borderColor = lowConf ? "#fcd34d" : "#bae6fd";

  const widthLine = fmtIn(laser.value);
  const heightLine = isBurst ? fmtIn(laser.metadata?.heightInches) : null;
  const areaLine = isBurst ? fmtArea(laser.metadata?.areaSqInches) : null;
  const warnings = laser.metadata?.warnings ?? [];

  const rows: string[] = [];
  if (widthLine) {
    rows.push(
      `<span><strong>W:</strong> ${esc(widthLine)}</span>`,
    );
  }
  if (heightLine) {
    rows.push(`<span><strong>H:</strong> ${esc(heightLine)}</span>`);
  }
  if (areaLine) {
    rows.push(`<span><strong>Area:</strong> ${esc(areaLine)}</span>`);
  }

  if (rows.length === 0) return "";

  const lowConfLabel = lowConf
    ? `<span style="margin-left:8px;font-size:10px;color:${accentColor};font-style:italic">(low confidence)</span>`
    : "";

  const warningsHtml =
    warnings.length > 0
      ? `<div style="margin-top:4px;font-size:10px;color:#92400e">${warnings.map((w) => esc(w)).join(" · ")}</div>`
      : "";

  return `
    <div style="margin-top:8px;padding:8px 10px;border-radius:6px;background:${bgColor};border:1px solid ${borderColor}">
      <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:${accentColor};margin-bottom:4px">
        📏 Laser Measurement${lowConfLabel}
      </div>
      <div style="display:flex;gap:16px;flex-wrap:wrap;font-size:12px;color:#1e3a5f;font-weight:500">
        ${rows.join("")}
      </div>
      ${warningsHtml}
    </div>`;
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

export function buildServerReportHtml(
  report: Report,
  inspection: Inspection,
  media: MediaRecord[] = [],
): string {
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

            // Look up laser measurement from the evidence photo's captureMetadata
            const captureMetadata = lookupCaptureMetadata(media, f.imageUrl);
            const laser = resolveLaserMeasurement(captureMetadata);
            const measurementHtml = laser ? buildMeasurementStripHtml(laser) : "";

            return `
          <div style="border:1px solid #e5e7eb;border-radius:8px;padding:12px 14px;margin-bottom:10px;background:${fb}">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:4px">
              <strong style="font-size:13px;color:#111827">${esc(f.category ?? "Finding")}</strong>
              ${fsev ? badge(fsev, fc, fb) : ""}
            </div>
            ${f.description ? `<p style="margin:4px 0 0 0;color:#374151;font-size:13px">${esc(f.description)}</p>` : ""}
            ${f.location ? `<p style="margin:4px 0 0 0;color:#6b7280;font-size:12px">📍 ${esc(f.location)}</p>` : ""}
            ${f.exclusionOpportunity ? `<p style="margin:6px 0 0 0;font-size:11px;color:#0369a1">🔒 Exclusion opportunity identified</p>` : ""}
            ${measurementHtml}
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

  // ── Signature section ──────────────────────────────────────────────────────
  // SVG signature strings are encoded as base64 data URIs and rendered via
  // <img> tags. Embedding SVG inside <img src="data:image/svg+xml;base64,...">
  // is the standard XSS-safe technique: browsers place SVG-in-img in a
  // restricted context where scripts, event handlers, foreignObject, and
  // external resource loads cannot execute — regardless of SVG content.
  // This means no server-side allowlist sanitizer is needed; the browser's own
  // security model is the defence-in-depth boundary.
  //
  // ownerNotAvailable renders a plain-text notice (run through esc()) instead
  // of a signature image; no raw user content ever reaches the DOM as markup.

  function svgToDataUri(svg: string): string {
    return `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
  }

  const signedAtLabel = inspection.signedAt
    ? new Date(inspection.signedAt).toLocaleString("en-US", {
        year: "numeric", month: "short", day: "numeric",
        hour: "2-digit", minute: "2-digit",
      })
    : null;

  function sigBox(label: string, svgOrNotice: string, isSvg: boolean): string {
    return `
      <div style="flex:1;min-width:200px">
        <p style="margin:0 0 4px 0;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#9ca3af">${esc(label)}</p>
        <div style="border:1px solid #e5e7eb;border-radius:6px;background:#f9fafb;padding:8px;min-height:80px;display:flex;align-items:center;justify-content:center">
          ${isSvg
            ? `<img src="${svgToDataUri(svgOrNotice)}" alt="${esc(label)}" style="width:100%;max-width:300px;height:80px;object-fit:contain" />`
            : `<p style="margin:0;font-size:12px;color:#6b7280;font-style:italic">${esc(svgOrNotice)}</p>`}
        </div>
        ${signedAtLabel ? `<p style="margin:4px 0 0 0;font-size:10px;color:#9ca3af">Signed: ${esc(signedAtLabel)}</p>` : ""}
      </div>`;
  }

  const hasTechSig = typeof inspection.technicianSignature === "string" && inspection.technicianSignature.length > 0;
  const hasOwnerSig = typeof inspection.ownerSignature === "string" && inspection.ownerSignature.length > 0;
  const hasAnySig = hasTechSig || hasOwnerSig || inspection.ownerNotAvailable;

  const sigHtml = hasAnySig
    ? section(
        "Signatures",
        `<div style="display:flex;flex-wrap:wrap;gap:16px">
          ${hasTechSig ? sigBox("Technician Signature", inspection.technicianSignature as string, true) : ""}
          ${hasOwnerSig
            ? sigBox("Owner / Client Signature", inspection.ownerSignature as string, true)
            : inspection.ownerNotAvailable
              ? sigBox("Owner / Client Signature", "Owner not available — technician acknowledged on behalf", false)
              : ""}
        </div>`,
      )
    : "";

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
    ${sigHtml}

    <!-- Footer -->
    <div style="margin-top:40px;padding-top:16px;border-top:1px solid #e5e7eb;text-align:center;color:#9ca3af;font-size:11px">
      Generated by ReadyLoq · ${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}
    </div>
  </div>
  <button class="print-btn" onclick="window.print()">🖨 Print / Save PDF</button>
</body>
</html>`;
}
