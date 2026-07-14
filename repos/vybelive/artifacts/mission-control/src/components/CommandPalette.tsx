import { useState, useEffect, useMemo, useRef } from "react";
import { useLocation } from "wouter";
import {
  useListExecutives,
  useListObjectives,
  useListTasks,
  getListExecutivesQueryKey,
  getListObjectivesQueryKey,
  getListTasksQueryKey,
} from "@workspace/api-client-react";
import {
  Search,
  BrainCircuit,
  Target,
  CheckSquare,
  Zap,
  History,
  CornerDownLeft,
  X,
  ArrowRight,
} from "lucide-react";

export type QuickAction = { label: string; command: string };

const QUICK_ACTIONS: QuickAction[] = [
  { label: "Status report", command: "Give me a full status report across all executives." },
  { label: "What needs my approval?", command: "What is currently waiting on my approval?" },
  { label: "Top blockers", command: "What are the top blockers right now and who owns them?" },
  { label: "Plan an objective", command: "Help me plan a new objective." },
  { label: "Today's priorities", command: "What should I focus on today?" },
];

type PaletteResult =
  | { kind: "executive"; id: string; title: string; subtitle: string; href: string }
  | { kind: "objective"; id: string; title: string; subtitle: string; href: string }
  | { kind: "task"; id: string; title: string; subtitle: string; href: string };

export function loadCommandHistory(): string[] {
  try {
    const raw = localStorage.getItem("mc:cmdHistory");
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string").slice(0, 8) : [];
  } catch {
    return [];
  }
}

export function pushCommandHistory(command: string): void {
  const trimmed = command.trim();
  if (!trimmed) return;
  try {
    const existing = loadCommandHistory().filter((c) => c !== trimmed);
    const next = [trimmed, ...existing].slice(0, 8);
    localStorage.setItem("mc:cmdHistory", JSON.stringify(next));
  } catch {
    /* ignore quota / disabled storage */
  }
}

export default function CommandPalette({
  open,
  onClose,
  onRunCommand,
}: {
  open: boolean;
  onClose: () => void;
  onRunCommand: (command: string) => void;
}) {
  const [, setLocation] = useLocation();
  const [query, setQuery] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  const { data: execs = [], isFetching: execsFetching, isError: execsError } = useListExecutives({ query: { queryKey: getListExecutivesQueryKey(), enabled: open } });
  const { data: objectives = [], isFetching: objsFetching, isError: objsError } = useListObjectives({ query: { queryKey: getListObjectivesQueryKey(), enabled: open } });
  const { data: tasks = [], isFetching: tasksFetching, isError: tasksError } = useListTasks(undefined, { query: { queryKey: getListTasksQueryKey(), enabled: open } });
  const searchLoading = execsFetching || objsFetching || tasksFetching;
  const searchError = execsError || objsError || tasksError;

  useEffect(() => {
    if (!open) return;
    setHistory(loadCommandHistory());
    setQuery("");
    const t = setTimeout(() => inputRef.current?.focus(), 30);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const results = useMemo<PaletteResult[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const out: PaletteResult[] = [];
    for (const e of execs) {
      if (e.name.toLowerCase().includes(q) || e.role.toLowerCase().includes(q) || (e.title ?? "").toLowerCase().includes(q)) {
        out.push({ kind: "executive", id: e.id, title: e.name, subtitle: e.title ?? e.role, href: e.role === "chief_of_staff" ? "/quinn" : `/executives/${e.id}` });
      }
    }
    for (const o of objectives) {
      if (o.title.toLowerCase().includes(q)) {
        out.push({ kind: "objective", id: o.id, title: o.title, subtitle: `Objective · ${o.status.replace(/_/g, " ")}`, href: `/objectives/${o.id}` });
      }
    }
    for (const t of tasks) {
      if (t.title.toLowerCase().includes(q)) {
        out.push({ kind: "task", id: t.id, title: t.title, subtitle: `Task · ${t.executiveName} · ${t.status.replace(/_/g, " ")}`, href: `/executives/${t.executiveId}` });
      }
    }
    return out.slice(0, 20);
  }, [query, execs, objectives, tasks]);

  const canSendAsCommand = query.trim().length > 2 && results.length === 0 && !searchLoading && !searchError;

  if (!open) return null;

  const go = (href: string) => {
    setLocation(href);
    onClose();
  };

  const runCommand = (command: string) => {
    onRunCommand(command);
    onClose();
  };

  const iconFor = (kind: PaletteResult["kind"]) =>
    kind === "executive" ? BrainCircuit : kind === "objective" ? Target : CheckSquare;

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center pt-[12vh] px-4" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-2xl glass-card rounded-xl border border-primary/20 shadow-[0_0_40px_rgba(160,100,255,0.15)] overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
          <Search className="w-4 h-4 text-primary shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                if (results.length > 0) go(results[0]!.href);
                else if (searchLoading || searchError) return;
                else if (canSendAsCommand) runCommand(query.trim());
              }
            }}
            placeholder="Search executives, objectives, tasks — or type a command for Quinn…"
            className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
            data-testid="input-command-palette"
          />
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground p-1 rounded" aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="max-h-[52vh] overflow-y-auto custom-scrollbar p-2">
          {/* Search results */}
          {query.trim() && results.length > 0 && (
            <div className="mb-2">
              <p className="px-2 py-1 text-[10px] font-mono uppercase tracking-wider text-muted-foreground">Results</p>
              {results.map((r) => {
                const Icon = iconFor(r.kind);
                return (
                  <button
                    key={`${r.kind}-${r.id}`}
                    onClick={() => go(r.href)}
                    className="w-full flex items-center gap-3 px-2 py-2 rounded-md hover:bg-secondary text-left group"
                    data-testid={`palette-result-${r.kind}`}
                  >
                    <Icon className="w-4 h-4 text-primary/70 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-foreground truncate">{r.title}</p>
                      <p className="text-[11px] font-mono text-muted-foreground truncate uppercase">{r.subtitle}</p>
                    </div>
                    <ArrowRight className="w-3.5 h-3.5 text-muted-foreground/40 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </button>
                );
              })}
            </div>
          )}

          {/* No matches → offer to send as command */}
          {canSendAsCommand && (
            <button
              onClick={() => runCommand(query.trim())}
              className="w-full flex items-center gap-3 px-2 py-2.5 rounded-md hover:bg-primary/10 border border-primary/20 bg-primary/5 text-left"
              data-testid="palette-send-command"
            >
              <Zap className="w-4 h-4 text-primary shrink-0" />
              <span className="text-sm text-foreground flex-1 truncate">Ask Quinn: <span className="text-primary">“{query.trim()}”</span></span>
              <CornerDownLeft className="w-3.5 h-3.5 text-muted-foreground/60" />
            </button>
          )}

          {/* Empty query → quick actions + history */}
          {!query.trim() && (
            <>
              <div className="mb-2">
                <p className="px-2 py-1 text-[10px] font-mono uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                  <Zap className="w-3 h-3" /> Quick Actions
                </p>
                {QUICK_ACTIONS.map((a) => (
                  <button
                    key={a.label}
                    onClick={() => runCommand(a.command)}
                    className="w-full flex items-center gap-3 px-2 py-2 rounded-md hover:bg-secondary text-left group"
                    data-testid="palette-quick-action"
                  >
                    <Zap className="w-3.5 h-3.5 text-accent/70 shrink-0" />
                    <span className="text-sm text-foreground flex-1 truncate">{a.label}</span>
                    <CornerDownLeft className="w-3.5 h-3.5 text-muted-foreground/40 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </button>
                ))}
              </div>

              {history.length > 0 && (
                <div>
                  <p className="px-2 py-1 text-[10px] font-mono uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                    <History className="w-3 h-3" /> Recent Commands
                  </p>
                  {history.map((h, i) => (
                    <button
                      key={i}
                      onClick={() => runCommand(h)}
                      className="w-full flex items-center gap-3 px-2 py-2 rounded-md hover:bg-secondary text-left group"
                      data-testid="palette-history-item"
                    >
                      <History className="w-3.5 h-3.5 text-muted-foreground/60 shrink-0" />
                      <span className="text-sm text-muted-foreground group-hover:text-foreground flex-1 truncate">{h}</span>
                      <CornerDownLeft className="w-3.5 h-3.5 text-muted-foreground/40 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </button>
                  ))}
                </div>
              )}
            </>
          )}

          {/* Search datasets failed to load */}
          {searchError && (
            <p className="px-2 py-6 text-center text-xs font-mono text-destructive">Search unavailable — could not load executives, objectives, or tasks.</p>
          )}

          {/* Loading search data */}
          {query.trim() && results.length === 0 && searchLoading && !searchError && (
            <p className="px-2 py-6 text-center text-xs font-mono text-muted-foreground animate-pulse">Searching…</p>
          )}

          {/* Nothing at all */}
          {query.trim() && results.length === 0 && !canSendAsCommand && !searchLoading && !searchError && (
            <p className="px-2 py-6 text-center text-xs font-mono text-muted-foreground">Type a bit more to search or send a command…</p>
          )}
        </div>

        <div className="flex items-center justify-between px-4 py-2 border-t border-border bg-black/20 text-[10px] font-mono text-muted-foreground">
          <span>↵ Open · Esc Close</span>
          <span className="text-primary/60">Quinn Command Bridge</span>
        </div>
      </div>
    </div>
  );
}
