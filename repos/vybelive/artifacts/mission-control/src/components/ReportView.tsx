import type { AgentReport, ReportFinding, ReportRecommendation } from "@workspace/api-client-react";
import { AlertTriangle, AlertCircle, Info, CheckCircle2, Lightbulb, ListTodo, Clock, Gauge } from "lucide-react";

const IMPACT_STYLE: Record<string, string> = {
  high: "text-destructive border-destructive/40 bg-destructive/10",
  medium: "text-amber-400 border-amber-500/40 bg-amber-500/10",
  low: "text-muted-foreground border-border bg-muted/10",
};

const STATUS_STYLE: Record<string, { label: string; text: string; bg: string; border: string; dot: string }> = {
  healthy: {
    label: "Healthy",
    text: "text-emerald-400",
    bg: "bg-emerald-500/10",
    border: "border-emerald-500/30",
    dot: "bg-emerald-500",
  },
  attention: {
    label: "Needs Attention",
    text: "text-amber-400",
    bg: "bg-amber-500/10",
    border: "border-amber-500/30",
    dot: "bg-amber-500",
  },
  critical: {
    label: "Critical",
    text: "text-destructive",
    bg: "bg-destructive/10",
    border: "border-destructive/30",
    dot: "bg-destructive",
  },
};

export function StatusBadge({ status }: { status: string }) {
  const s = STATUS_STYLE[status] ?? STATUS_STYLE.healthy;
  return (
    <span
      className={`inline-flex items-center gap-2 px-2.5 py-1 rounded text-[10px] font-mono uppercase tracking-wider border ${s.bg} ${s.text} ${s.border}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
      {s.label}
    </span>
  );
}

function FindingRow({ finding }: { finding: ReportFinding }) {
  const Icon =
    finding.severity === "critical" ? AlertCircle : finding.severity === "warning" ? AlertTriangle : Info;
  const color =
    finding.severity === "critical"
      ? "text-destructive"
      : finding.severity === "warning"
        ? "text-amber-400"
        : "text-muted-foreground";
  return (
    <div className="flex items-start gap-2.5 text-sm">
      <Icon className={`w-4 h-4 mt-0.5 shrink-0 ${color}`} />
      <span className="text-foreground/90 leading-relaxed">{finding.text}</span>
    </div>
  );
}

export function ReportView({ report }: { report: AgentReport }) {
  const confidencePct = Math.round(report.confidence ?? 0);
  return (
    <div className="space-y-5">
      <div>
        <div className="flex items-center gap-3 mb-2 flex-wrap">
          <StatusBadge status={report.status} />
          {typeof report.confidence === "number" && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-[10px] font-mono uppercase tracking-wider border border-border bg-background text-muted-foreground">
              <Gauge className="w-3 h-3" /> {confidencePct}% confidence
            </span>
          )}
          {report.estimatedEffort && (
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-[10px] font-mono uppercase tracking-wider border border-border bg-background text-muted-foreground">
              <Clock className="w-3 h-3" /> {report.estimatedEffort}
            </span>
          )}
        </div>
        <h3 className="text-lg font-bold text-foreground leading-snug">{report.headline}</h3>
        <p className="text-sm text-muted-foreground leading-relaxed mt-2 whitespace-pre-line">
          {report.summary}
        </p>
      </div>

      {report.metrics.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {report.metrics.map((m, i) => (
            <div key={i} className="rounded border border-border bg-background p-3">
              <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground mb-1">
                {m.label}
              </div>
              <div className="text-lg font-bold font-mono text-foreground truncate" title={m.value}>
                {m.value}
              </div>
            </div>
          ))}
        </div>
      )}

      {report.findings.length > 0 && (
        <div className="space-y-2.5">
          <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground flex items-center gap-2">
            <CheckCircle2 className="w-3 h-3" /> Findings
          </div>
          {report.findings.map((f, i) => (
            <FindingRow key={i} finding={f} />
          ))}
        </div>
      )}

      {report.recommendations.length > 0 && (
        <div className="space-y-2.5">
          <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground flex items-center gap-2">
            <Lightbulb className="w-3 h-3" /> Recommendations
          </div>
          {report.recommendations.map((r: ReportRecommendation, i) => (
            <div key={i} className="flex items-start gap-2.5 text-sm">
              <span
                className={`mt-0.5 shrink-0 px-1.5 py-0.5 rounded text-[9px] font-mono uppercase tracking-wider border ${IMPACT_STYLE[r.impact] ?? IMPACT_STYLE.low}`}
              >
                {r.impact}
              </span>
              <span className="text-foreground/90 leading-relaxed">{r.text}</span>
            </div>
          ))}
        </div>
      )}

      {report.followUps.length > 0 && (
        <div className="space-y-2.5">
          <div className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground flex items-center gap-2">
            <ListTodo className="w-3 h-3" /> Follow-ups
          </div>
          <ul className="space-y-1.5">
            {report.followUps.map((f, i) => (
              <li key={i} className="flex items-start gap-2.5 text-sm text-foreground/90 leading-relaxed">
                <span className="text-muted-foreground mt-0.5">›</span>
                {f}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
