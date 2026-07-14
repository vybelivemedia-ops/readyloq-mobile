// ─── Chief of Staff: aggregate every executive's report into one briefing ─────
import type { ExecutiveReport, ReportStatus } from "./index.js";

export type ReportInput = {
  /** Display name of the executive (e.g. "Ada Mercer"). */
  name: string;
  /** Short title (e.g. "Chief Technology Officer"). */
  title: string;
  report: ExecutiveReport | null;
};

function worst(statuses: ReportStatus[]): ReportStatus {
  if (statuses.includes("critical")) return "critical";
  if (statuses.includes("attention")) return "attention";
  return "healthy";
}

/**
 * Synthesize the latest report from each executive into a single founder-facing
 * briefing. Surfaces overall posture, a one-line digest per executive, and the
 * consolidated list of critical/warning findings that need attention.
 */
export function aggregateChiefOfStaff(inputs: ReportInput[]): ExecutiveReport {
  type FiledReport = ReportInput & { report: ExecutiveReport };
  const reported = inputs.filter((i): i is FiledReport => i.report !== null);
  const missing = inputs.filter((i) => i.report === null);

  // Missing reports degrade overall posture: a briefing built on no data must
  // never read as "healthy". No reports at all is critical; some missing is at
  // least "attention".
  const reportedStatuses = reported.map((i) => i.report.status);
  const overall: ReportStatus =
    reported.length === 0
      ? "critical"
      : missing.length > 0
        ? worst([...reportedStatuses, "attention"])
        : worst(reportedStatuses);

  const criticalCount = reported.filter((i) => i.report.status === "critical").length;
  const attentionCount = reported.filter((i) => i.report.status === "attention").length;
  const healthyCount = reported.filter((i) => i.report.status === "healthy").length;

  // Consolidate the findings that matter, attributed to their executive.
  const findings: ExecutiveReport["findings"] = [];
  for (const sev of ["critical", "warning"] as const) {
    for (const i of reported) {
      for (const f of i.report.findings) {
        if (f.severity === sev) {
          findings.push({ severity: f.severity, text: `${i.title}: ${f.text}` });
        }
      }
    }
  }
  for (const m of missing) {
    findings.push({
      severity: "info",
      text: `${m.title} has not filed a report yet — run their capability to include it.`,
    });
  }
  if (findings.length === 0) {
    findings.push({ severity: "info", text: "All executives report healthy. Nothing needs attention." });
  }

  const digest = reported
    .map((i) => `• ${i.title} (${i.report.status}): ${i.report.headline}`)
    .join("\n");

  const summary =
    `${reported.length} of ${inputs.length} executive(s) have filed reports — ` +
    `${healthyCount} healthy, ${attentionCount} need attention, ${criticalCount} critical. ` +
    `${findings.filter((f) => f.severity === "critical").length} critical and ` +
    `${findings.filter((f) => f.severity === "warning").length} warning item(s) consolidated below.\n\n` +
    digest;

  const headline =
    reported.length === 0
      ? "No executive reports available — run capabilities to compile a briefing"
      : criticalCount > 0
        ? `Action needed: ${criticalCount} executive(s) flagged critical`
        : overall === "attention"
          ? missing.length > 0
            ? `${missing.length} report(s) missing; ${attentionCount} area(s) need attention`
            : `${attentionCount} area(s) need attention across the org`
          : `All systems healthy across ${reported.length} executive(s)`;

  // Trim consolidated findings to keep the briefing scannable.
  const trimmed = findings.slice(0, 12);

  return {
    status: overall,
    headline,
    summary,
    metrics: [
      { label: "Reports in", value: `${reported.length}/${inputs.length}` },
      { label: "Healthy", value: String(healthyCount) },
      { label: "Attention", value: String(attentionCount) },
      { label: "Critical", value: String(criticalCount) },
      { label: "Open findings", value: String(findings.filter((f) => f.severity !== "info").length) },
    ],
    findings: trimmed,
  };
}
