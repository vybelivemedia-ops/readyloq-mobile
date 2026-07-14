import { useState, useEffect } from "react";
import {
  useSearchMemory,
  getSearchMemoryQueryKey,
  type MemorySearchEntry,
  type OrganizationEvent,
} from "@workspace/api-client-react";
import { BrainCircuit, Search, Loader2, Pin, Building2, Users } from "lucide-react";
import { Input } from "@/components/ui/input";
import { formatDistanceToNow } from "date-fns";

const KIND_COLOR: Record<string, string> = {
  directive: "text-amber-400 border-amber-500/30 bg-amber-500/10",
  decision: "text-violet-400 border-violet-500/30 bg-violet-500/10",
  fact: "text-cyan-400 border-cyan-500/30 bg-cyan-500/10",
  preference: "text-emerald-400 border-emerald-500/30 bg-emerald-500/10",
  context: "text-slate-400 border-border bg-secondary",
};

function kindClass(kind: string): string {
  return KIND_COLOR[kind] ?? "text-slate-400 border-border bg-secondary";
}

function ExecMemoryCard({ mem }: { mem: MemorySearchEntry }) {
  return (
    <div
      className="rounded-lg border border-border bg-card p-4 border-l-2"
      style={{ borderLeftColor: mem.accentColor }}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            className="flex h-6 w-6 items-center justify-center rounded font-mono text-[9px] font-bold"
            style={{ backgroundColor: `${mem.accentColor}20`, color: mem.accentColor }}
          >
            {mem.executiveName.slice(0, 2).toUpperCase()}
          </span>
          <span className="font-mono text-[11px] text-foreground">{mem.executiveName}</span>
          <span className={`rounded border px-1.5 py-0.5 font-mono text-[9px] uppercase ${kindClass(mem.kind)}`}>
            {mem.kind}
          </span>
          {mem.pinned && <Pin className="h-3 w-3 text-primary" />}
        </div>
        <span className="font-mono text-[10px] text-muted-foreground/60">
          {formatDistanceToNow(new Date(mem.createdAt), { addSuffix: true })}
        </span>
      </div>
      <p className="text-sm leading-relaxed text-foreground/90">{mem.content}</p>
    </div>
  );
}

function OrgEventCard({ ev }: { ev: OrganizationEvent }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 border-l-2 border-l-cyan-500/50">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="font-mono text-[10px] uppercase tracking-wider text-cyan-400">
          {String(ev.type).replace(/_/g, " ")}
        </span>
        <span className="font-mono text-[10px] text-muted-foreground/60">
          {formatDistanceToNow(new Date(ev.createdAt), { addSuffix: true })}
        </span>
      </div>
      <p className="text-sm font-medium leading-tight text-foreground">{ev.title}</p>
      {ev.summary && <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{ev.summary}</p>}
    </div>
  );
}

export default function Memory() {
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");

  useEffect(() => {
    const id = setTimeout(() => setQuery(input.trim()), 300);
    return () => clearTimeout(id);
  }, [input]);

  const params = query ? { q: query } : undefined;
  const { data, isLoading, isError } = useSearchMemory(params, {
    query: { queryKey: getSearchMemoryQueryKey(params) },
  });

  const execMem = data?.executiveMemory ?? [];
  const orgMem = data?.organizationMemory ?? [];
  const total = execMem.length + orgMem.length;

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <header className="border-b border-border/50 pb-6">
        <p className="mb-1 font-mono text-[11px] uppercase tracking-widest text-primary">Organization · Recall</p>
        <div className="flex items-center gap-3">
          <BrainCircuit className="h-6 w-6 text-primary" />
          <h1 className="font-sans text-3xl font-bold uppercase tracking-tight">Memory Engine</h1>
        </div>
        <p className="mt-1 font-mono text-xs text-muted-foreground">
          Search across every executive's long-term memory and the organization's recorded event timeline.
        </p>
      </header>

      <div className="relative max-w-xl">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Search memory & organization events…"
          className="bg-card pl-9 font-mono text-sm"
          autoFocus
        />
        {isLoading && (
          <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
        )}
      </div>

      {isError ? (
        <div className="rounded-md border border-rose-500/30 bg-rose-500/10 p-4 font-mono text-xs text-rose-300">
          Failed to search memory.
        </div>
      ) : isLoading ? (
        <div className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Searching memory banks…
        </div>
      ) : total === 0 ? (
        <div className="rounded-md border border-border bg-card p-8 text-center font-mono text-xs text-muted-foreground">
          {query
            ? `No memory or events matching "${query}".`
            : "No memory recorded yet. Executives accumulate memory as they work."}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <section className="space-y-3">
            <div className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-muted-foreground">
              <Users className="h-3.5 w-3.5" /> Executive Memory ({execMem.length})
            </div>
            {execMem.length === 0 ? (
              <p className="rounded-md border border-border bg-card p-4 font-mono text-[11px] text-muted-foreground">
                No executive memory{query ? " for this query" : ""}.
              </p>
            ) : (
              execMem.map((m) => <ExecMemoryCard key={m.id} mem={m} />)
            )}
          </section>
          <section className="space-y-3">
            <div className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-muted-foreground">
              <Building2 className="h-3.5 w-3.5" /> Organization Events ({orgMem.length})
            </div>
            {orgMem.length === 0 ? (
              <p className="rounded-md border border-border bg-card p-4 font-mono text-[11px] text-muted-foreground">
                No organization events{query ? " for this query" : ""}.
              </p>
            ) : (
              orgMem.map((e) => <OrgEventCard key={e.id} ev={e} />)
            )}
          </section>
        </div>
      )}
    </div>
  );
}
