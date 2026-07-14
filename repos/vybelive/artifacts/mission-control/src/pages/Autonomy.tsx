import { Cpu, Zap, AlertTriangle, CircleCheck, CircleSlash, CircleX, Loader2, Clock } from "lucide-react";
import { useGetAutonomyCycles } from "@workspace/api-client-react";

function statusTone(status: string): { text: string; label: string; Icon: typeof CircleCheck } {
  switch (status) {
    case "completed":
      return { text: "text-emerald-300", label: "Completed", Icon: CircleCheck };
    case "noop":
      return { text: "text-zinc-400", label: "No action", Icon: CircleSlash };
    case "failed":
      return { text: "text-rose-300", label: "Failed", Icon: CircleX };
    default:
      return { text: "text-zinc-400", label: status, Icon: CircleSlash };
  }
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function Autonomy() {
  const { data, isLoading, isError } = useGetAutonomyCycles();

  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      <header className="border-b border-border/50 pb-6">
        <p className="mb-1 font-mono text-[11px] uppercase tracking-widest text-primary">Quinn · Autonomy</p>
        <h1 className="font-sans text-3xl font-bold uppercase tracking-tight">Autonomy Cycles</h1>
        <p className="mt-1 font-mono text-xs text-muted-foreground">
          Quinn runs an autonomous Chief-of-Staff cycle every 15 minutes in production (manual in dev). Each cycle acts on
          safe actions and escalates only what needs founder approval.
        </p>
      </header>

      {isLoading && (
        <div className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading autonomy cycles…
        </div>
      )}

      {isError && (
        <div className="rounded-md border border-rose-500/30 bg-rose-500/10 p-4 font-mono text-xs text-rose-300">
          Failed to load autonomy cycles.
        </div>
      )}

      {data && data.cycles.length === 0 && (
        <div className="rounded-md border border-border bg-card p-6 text-center font-mono text-xs text-muted-foreground">
          No autonomy cycles yet. Run one from Developer Tools → Autonomy &amp; Learning.
        </div>
      )}

      <div className="space-y-4">
        {data?.cycles.map((cycle) => {
          const tone = statusTone(cycle.status);
          return (
            <div key={cycle.id} className="rounded-lg border border-border bg-card p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-md border border-primary/30 bg-primary/10 text-primary">
                    <Cpu className="h-4 w-4" />
                  </div>
                  <div>
                    <span className={`flex items-center gap-1.5 text-sm font-semibold ${tone.text}`}>
                      <tone.Icon className="h-4 w-4" />
                      {tone.label}
                    </span>
                    <span className="mt-0.5 inline-flex items-center gap-1 rounded border border-border bg-secondary px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                      {cycle.trigger}
                    </span>
                  </div>
                </div>
                <div className="text-right font-mono text-[10px] text-muted-foreground">
                  <span className="flex items-center justify-end gap-1">
                    <Clock className="h-3 w-3" />
                    {formatWhen(cycle.startedAt)}
                  </span>
                  <span>{cycle.durationMs} ms</span>
                </div>
              </div>

              {cycle.summary && <p className="mt-3 text-xs leading-relaxed text-foreground/90">{cycle.summary}</p>}

              <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <p className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-emerald-400">
                    <Zap className="h-3 w-3" /> Safe actions ({cycle.actions.length})
                  </p>
                  {cycle.actions.length === 0 ? (
                    <p className="mt-1 font-mono text-[11px] text-muted-foreground">None this cycle.</p>
                  ) : (
                    <ul className="mt-1.5 space-y-1.5">
                      {cycle.actions.map((a, i) => (
                        <li key={i} className="flex items-start gap-2">
                          <span className="mt-0.5 flex-shrink-0 rounded border border-border bg-secondary px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-emerald-300">
                            {a.type}
                          </span>
                          <span className="text-[11px] leading-relaxed text-foreground/90">{a.detail}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div>
                  <p className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-amber-400">
                    <AlertTriangle className="h-3 w-3" /> Escalations ({cycle.escalations.length})
                  </p>
                  {cycle.escalations.length === 0 ? (
                    <p className="mt-1 font-mono text-[11px] text-muted-foreground">Nothing escalated.</p>
                  ) : (
                    <ul className="mt-1.5 space-y-1.5">
                      {cycle.escalations.map((e, i) => (
                        <li key={i} className="flex items-start gap-2">
                          <span className="mt-0.5 flex-shrink-0 rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-amber-300">
                            {e.reason}
                          </span>
                          <span className="text-[11px] leading-relaxed text-foreground/90">{e.detail}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
