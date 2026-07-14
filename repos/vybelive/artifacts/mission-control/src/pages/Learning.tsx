import { GraduationCap, BookOpen, Sparkles, Loader2, ClipboardList, Cpu } from "lucide-react";
import { useGetLearningOverview } from "@workspace/api-client-react";

const KIND_LABELS: Record<string, string> = {
  lesson_learned: "Lesson",
  successful_decision: "Win",
  failed_decision: "Miss",
  collaboration: "Collab",
  communication: "Comms",
  founder_feedback: "Founder",
  improvement: "Improve",
};

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-1 font-sans text-2xl font-bold text-foreground">{value}</p>
    </div>
  );
}

export default function Learning() {
  const { data, isLoading, isError } = useGetLearningOverview();

  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      <header className="border-b border-border/50 pb-6">
        <p className="mb-1 font-mono text-[11px] uppercase tracking-widest text-primary">Org · Learning</p>
        <h1 className="font-sans text-3xl font-bold uppercase tracking-tight">Executive Learning</h1>
        <p className="mt-1 font-mono text-xs text-muted-foreground">
          Every completed objective produces a retrospective; each executive accumulates a permanent knowledge base. Quinn
          distills lessons weekly and distributes them across the team.
        </p>
      </header>

      {isLoading && (
        <div className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading learning overview…
        </div>
      )}

      {isError && (
        <div className="rounded-md border border-rose-500/30 bg-rose-500/10 p-4 font-mono text-xs text-rose-300">
          Failed to load learning overview.
        </div>
      )}

      {data && (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Stat label="Total Lessons" value={data.totals.lessons} />
            <Stat label="Retrospectives" value={data.totals.retrospectives} />
            <Stat label="Weekly Reviews" value={data.totals.weeklyReviews} />
          </div>

          {/* Per-executive knowledge base */}
          <section className="space-y-4">
            <div className="flex items-center gap-2">
              <GraduationCap className="h-4 w-4 text-primary" />
              <h2 className="font-sans text-lg font-bold uppercase tracking-tight">Knowledge by Executive</h2>
            </div>
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
              {data.executives.map((exec) => (
                <div key={exec.role} className="rounded-lg border border-border bg-card p-5">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-semibold text-foreground">{exec.name}</h3>
                      <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{exec.title}</p>
                    </div>
                    <span className="rounded border border-border bg-secondary px-2 py-0.5 font-mono text-[11px] text-muted-foreground">
                      {exec.totalLessons} lesson{exec.totalLessons === 1 ? "" : "s"}
                    </span>
                  </div>

                  {exec.recentLessons.length === 0 ? (
                    <p className="mt-3 font-mono text-[11px] text-muted-foreground">No lessons recorded yet.</p>
                  ) : (
                    <ul className="mt-3 space-y-2">
                      {exec.recentLessons.map((lesson) => (
                        <li key={lesson.id} className="flex items-start gap-2">
                          <span className="mt-0.5 flex-shrink-0 rounded border border-border bg-secondary px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                            {KIND_LABELS[lesson.kind] ?? lesson.kind}
                          </span>
                          <span className="text-[11px] leading-relaxed text-foreground/90">{lesson.content}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              ))}
            </div>
          </section>

          {/* Recent retrospectives */}
          <section className="space-y-4">
            <div className="flex items-center gap-2">
              <ClipboardList className="h-4 w-4 text-primary" />
              <h2 className="font-sans text-lg font-bold uppercase tracking-tight">Recent Retrospectives</h2>
            </div>
            {data.recentRetrospectives.length === 0 ? (
              <p className="font-mono text-xs text-muted-foreground">No retrospectives yet — they're generated when objectives complete.</p>
            ) : (
              <div className="space-y-3">
                {data.recentRetrospectives.map((retro) => (
                  <div key={retro.id} className="rounded-lg border border-border bg-card p-4">
                    <h3 className="text-sm font-semibold text-foreground">{retro.objectiveTitle ?? "Objective"}</h3>
                    <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
                      <div>
                        <p className="font-mono text-[10px] uppercase tracking-wider text-emerald-400">What worked</p>
                        <p className="mt-0.5 text-[11px] leading-relaxed text-foreground/90">{retro.whatWorked}</p>
                      </div>
                      <div>
                        <p className="font-mono text-[10px] uppercase tracking-wider text-rose-400">What failed</p>
                        <p className="mt-0.5 text-[11px] leading-relaxed text-foreground/90">{retro.whatFailed}</p>
                      </div>
                      <div>
                        <p className="font-mono text-[10px] uppercase tracking-wider text-amber-400">Do differently</p>
                        <p className="mt-0.5 text-[11px] leading-relaxed text-foreground/90">{retro.whatToDoDifferently}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* AI Provider Reliability */}
          {(() => {
            const reliability = (data as unknown as { providerReliability?: { id: string; provider: string; model: string; successCount: number; failureCount: number; avgLatencyMs: number; totalTokens: number; lastSeenAt: string }[] }).providerReliability;
            if (!reliability || reliability.length === 0) return null;
            const byKey = new Map<string, { provider: string; model: string; ok: number; fail: number; totalMs: number; count: number }>();
            for (const r of reliability) {
              const key = `${r.provider}::${r.model}`;
              const prev = byKey.get(key) ?? { provider: r.provider, model: r.model, ok: 0, fail: 0, totalMs: 0, count: 0 };
              prev.ok += r.successCount;
              prev.fail += r.failureCount;
              prev.totalMs += r.avgLatencyMs * (r.successCount + r.failureCount);
              prev.count += r.successCount + r.failureCount;
              byKey.set(key, prev);
            }
            const rows = [...byKey.values()].sort((a, b) => b.ok - a.ok);
            return (
              <section className="space-y-4">
                <div className="flex items-center gap-2">
                  <Cpu className="h-4 w-4 text-primary" />
                  <h2 className="font-sans text-lg font-bold uppercase tracking-tight">AI Provider Reliability</h2>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {rows.map((r) => {
                    const total = r.ok + r.fail;
                    const pct = total > 0 ? Math.round((r.ok / total) * 100) : 0;
                    const avgMs = r.count > 0 ? Math.round(r.totalMs / r.count) : 0;
                    return (
                      <div key={`${r.provider}::${r.model}`} className="rounded-lg border border-border bg-card p-4">
                        <div className="flex items-center justify-between gap-2">
                          <div>
                            <p className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">{r.provider}</p>
                            <p className="text-sm font-semibold text-foreground">{r.model}</p>
                          </div>
                          <span className={`font-mono text-lg font-bold ${pct >= 80 ? "text-emerald-400" : pct >= 40 ? "text-amber-400" : "text-rose-400"}`}>{pct}%</span>
                        </div>
                        <div className="mt-3 flex gap-4 font-mono text-[11px] text-muted-foreground">
                          <span className="text-emerald-400">{r.ok} ok</span>
                          <span className="text-rose-400">{r.fail} fail</span>
                          <span>avg {avgMs}ms</span>
                        </div>
                        <div className="mt-2 h-1 w-full rounded-full bg-border">
                          <div className={`h-1 rounded-full ${pct >= 80 ? "bg-emerald-500" : pct >= 40 ? "bg-amber-500" : "bg-rose-500"}`} style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })()}

          {/* Weekly reviews */}
          <section className="space-y-4">
            <div className="flex items-center gap-2">
              <BookOpen className="h-4 w-4 text-primary" />
              <h2 className="font-sans text-lg font-bold uppercase tracking-tight">Weekly Reviews</h2>
            </div>
            {data.weeklyReviews.length === 0 ? (
              <p className="font-mono text-xs text-muted-foreground">No weekly reviews yet.</p>
            ) : (
              <div className="space-y-3">
                {data.weeklyReviews.map((review) => (
                  <div key={review.id} className="rounded-lg border border-border bg-card p-4">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="flex items-center gap-2 text-sm font-semibold text-foreground">
                        <Sparkles className="h-4 w-4 text-primary" />
                        Week of {review.weekOf}
                      </h3>
                      <span className="font-mono text-[11px] text-muted-foreground">
                        {review.distributedCount} distributed
                      </span>
                    </div>
                    <p className="mt-2 text-[11px] leading-relaxed text-foreground/90">{review.summary}</p>
                    <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                      {review.recurringSuccesses.length > 0 && (
                        <div>
                          <p className="font-mono text-[10px] uppercase tracking-wider text-emerald-400">Recurring successes</p>
                          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[11px] text-foreground/90">
                            {review.recurringSuccesses.map((s, i) => (
                              <li key={i}>{s}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {review.recurringMistakes.length > 0 && (
                        <div>
                          <p className="font-mono text-[10px] uppercase tracking-wider text-rose-400">Recurring mistakes</p>
                          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[11px] text-foreground/90">
                            {review.recurringMistakes.map((s, i) => (
                              <li key={i}>{s}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}
