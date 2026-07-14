import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useListTasks, useListObjectives, getListObjectivesQueryKey } from "@workspace/api-client-react";
import { formatDistanceToNow } from "date-fns";
import {
  CheckCircle2,
  Circle,
  AlertCircle,
  Clock,
  Search,
  Eye,
  LayoutGrid,
  List,
  ArrowRight,
  Target,
} from "lucide-react";
import { Input } from "@/components/ui/input";

type TaskStatus = "backlog" | "in_progress" | "blocked" | "review" | "done";

const COLUMNS: { status: TaskStatus; label: string; accent: string }[] = [
  { status: "backlog", label: "Backlog", accent: "text-muted-foreground border-border" },
  { status: "in_progress", label: "In Progress", accent: "text-primary border-primary/30" },
  { status: "review", label: "Review", accent: "text-cyan-400 border-cyan-500/30" },
  { status: "blocked", label: "Blocked", accent: "text-destructive border-destructive/30" },
  { status: "done", label: "Done", accent: "text-emerald-400 border-emerald-500/30" },
];

const PRIORITIES = ["all", "critical", "high", "medium", "low"] as const;

export default function Tasks() {
  const { data: tasks = [], isLoading, isError } = useListTasks();
  const { data: objectives = [] } = useListObjectives({ query: { queryKey: getListObjectivesQueryKey() } });
  const [q, setQ] = useState("");
  const [priority, setPriority] = useState<(typeof PRIORITIES)[number]>("all");
  const [view, setView] = useState<"board" | "table">("board");

  const objectiveTitle = useMemo(() => {
    const m = new Map<string, string>();
    for (const o of objectives) m.set(o.id, o.title);
    return m;
  }, [objectives]);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return tasks.filter((t) => {
      if (priority !== "all" && t.priority !== priority) return false;
      if (!needle) return true;
      return (
        t.title.toLowerCase().includes(needle) ||
        (t.description ?? "").toLowerCase().includes(needle) ||
        t.executiveName.toLowerCase().includes(needle)
      );
    });
  }, [tasks, q, priority]);

  if (isLoading) {
    return <div className="text-center py-20 font-mono animate-pulse text-muted-foreground">[ FETCHING GLOBAL DIRECTIVES... ]</div>;
  }
  if (isError) {
    return (
      <div className="mx-auto max-w-md rounded-md border border-rose-500/30 bg-rose-500/10 p-4 text-center font-mono text-xs text-rose-300">
        Failed to load the global task board.
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <header className="flex flex-col gap-4 border-b border-border/50 pb-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="mb-1 font-sans text-3xl font-bold uppercase tracking-tight">Task Orchestration</h1>
            <p className="font-mono text-sm text-muted-foreground">
              Every directive across the executive team — routing, ownership, and delivery status.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative w-64">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search directives…"
                className="bg-card pl-9 font-mono text-sm"
              />
            </div>
            <div className="flex overflow-hidden rounded-md border border-border">
              <button
                onClick={() => setView("board")}
                className={`flex items-center gap-1.5 px-2.5 py-2 font-mono text-xs uppercase ${view === "board" ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-foreground"}`}
                title="Board view"
              >
                <LayoutGrid className="h-3.5 w-3.5" />
              </button>
              <button
                onClick={() => setView("table")}
                className={`flex items-center gap-1.5 px-2.5 py-2 font-mono text-xs uppercase ${view === "table" ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-foreground"}`}
                title="Table view"
              >
                <List className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          {PRIORITIES.map((p) => (
            <button
              key={p}
              onClick={() => setPriority(p)}
              className={`rounded border px-2.5 py-1 font-mono text-[10px] uppercase transition-colors ${
                priority === p ? "border-primary/50 bg-primary/15 text-primary" : "border-border text-muted-foreground hover:border-border/80"
              }`}
            >
              {p}
            </button>
          ))}
          <span className="ml-auto font-mono text-[11px] text-muted-foreground">
            {filtered.length} of {tasks.length} directives
          </span>
        </div>
      </header>

      {filtered.length === 0 ? (
        <div className="rounded-md border border-border bg-card p-8 text-center font-mono text-xs text-muted-foreground">
          No directives match the current filters.
        </div>
      ) : view === "board" ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
          {COLUMNS.map((col) => {
            const colTasks = filtered.filter((t) => t.status === col.status);
            return (
              <div key={col.status} className="flex flex-col gap-2">
                <div className={`flex items-center justify-between rounded-md border bg-card px-3 py-2 ${col.accent}`}>
                  <span className="font-mono text-[11px] font-bold uppercase tracking-wider">{col.label}</span>
                  <span className="font-mono text-[11px]">{colTasks.length}</span>
                </div>
                <div className="flex flex-col gap-2">
                  {colTasks.length === 0 ? (
                    <p className="rounded border border-dashed border-border/60 p-3 text-center font-mono text-[10px] text-muted-foreground/60">
                      Empty
                    </p>
                  ) : (
                    colTasks.map((t) => {
                      const objTitle = t.objectiveId ? objectiveTitle.get(t.objectiveId) : undefined;
                      const delegated = t.createdByName && t.createdByExecutiveId !== t.executiveId;
                      return (
                        <div key={t.id} className="rounded-md border border-border bg-card p-3">
                          <div className="flex items-start justify-between gap-2">
                            <span className="text-sm font-medium leading-tight">{t.title}</span>
                            <span className={`shrink-0 rounded border px-1.5 py-0.5 font-mono text-[9px] uppercase ${getPriorityColor(t.priority)}`}>
                              {t.priority}
                            </span>
                          </div>
                          {t.progress > 0 && t.progress < 100 && (
                            <div className="mt-2 h-1 overflow-hidden rounded-full bg-secondary">
                              <div className="h-full rounded-full bg-primary" style={{ width: `${t.progress}%` }} />
                            </div>
                          )}
                          <div className="mt-2 flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground">
                            {delegated ? (
                              <span className="flex items-center gap-1 truncate">
                                {t.createdByName} <ArrowRight className="h-3 w-3 shrink-0" /> {t.executiveName}
                              </span>
                            ) : (
                              <span className="truncate">{t.executiveName}</span>
                            )}
                          </div>
                          {objTitle && t.objectiveId && (
                            <Link
                              href={`/objectives/${t.objectiveId}`}
                              className="mt-1.5 flex items-center gap-1 font-mono text-[10px] text-primary/80 hover:text-primary"
                            >
                              <Target className="h-3 w-3 shrink-0" /> <span className="truncate">{objTitle}</span>
                            </Link>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-secondary/50 font-mono text-xs uppercase text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Directive</th>
                  <th className="px-4 py-3 font-medium">Routing</th>
                  <th className="px-4 py-3 font-medium">Objective</th>
                  <th className="px-4 py-3 font-medium">Priority</th>
                  <th className="px-4 py-3 font-medium">Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtered.map((t) => {
                  const objTitle = t.objectiveId ? objectiveTitle.get(t.objectiveId) : undefined;
                  const delegated = t.createdByName && t.createdByExecutiveId !== t.executiveId;
                  return (
                    <tr key={t.id} className="transition-colors hover:bg-secondary/20">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <StatusIcon status={t.status} />
                          <span className="font-mono text-[10px] uppercase text-muted-foreground">{t.status.replace(/_/g, " ")}</span>
                        </div>
                      </td>
                      <td className="max-w-[280px] truncate px-4 py-3 font-medium text-foreground">{t.title}</td>
                      <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                        {delegated ? `${t.createdByName} → ${t.executiveName}` : t.executiveName}
                      </td>
                      <td className="max-w-[180px] px-4 py-3 font-mono text-xs">
                        {objTitle && t.objectiveId ? (
                          <Link href={`/objectives/${t.objectiveId}`} className="truncate text-primary/80 hover:text-primary">
                            {objTitle}
                          </Link>
                        ) : (
                          <span className="text-muted-foreground/50">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`rounded border px-2 py-0.5 font-mono text-[10px] uppercase ${getPriorityColor(t.priority)}`}>
                          {t.priority}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-muted-foreground">
                        {formatDistanceToNow(new Date(t.updatedAt), { addSuffix: true })}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case "done":
      return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
    case "blocked":
      return <AlertCircle className="h-4 w-4 text-destructive" />;
    case "in_progress":
      return <Clock className="h-4 w-4 animate-pulse text-primary" />;
    case "review":
      return <Eye className="h-4 w-4 text-cyan-400" />;
    default:
      return <Circle className="h-4 w-4 text-muted-foreground" />;
  }
}

function getPriorityColor(priority: string) {
  switch (priority) {
    case "critical":
      return "bg-destructive/10 text-destructive border-destructive/20";
    case "high":
      return "bg-orange-500/10 text-orange-500 border-orange-500/20";
    case "medium":
      return "bg-blue-500/10 text-blue-500 border-blue-500/20";
    default:
      return "bg-secondary text-muted-foreground border-border";
  }
}
