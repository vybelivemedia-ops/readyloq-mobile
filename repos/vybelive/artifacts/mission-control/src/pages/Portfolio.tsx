import { useState } from "react";
import {
  Building2,
  Radar,
  CircleCheck,
  CircleAlert,
  CircleX,
  CircleDashed,
  Loader2,
  Plus,
  Settings2,
  Globe,
  Github,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetPortfolioHealth,
  useCreatePortfolioAsset,
  useUpdatePortfolioAsset,
  getGetPortfolioHealthQueryKey,
} from "@workspace/api-client-react";

function statusTone(status: string): { dot: string; text: string; label: string; border: string } {
  switch (status) {
    case "healthy":
      return { dot: "bg-emerald-400", text: "text-emerald-300", label: "Healthy", border: "border-emerald-500/30" };
    case "attention":
      return { dot: "bg-amber-400", text: "text-amber-300", label: "Attention", border: "border-amber-500/30" };
    case "critical":
      return { dot: "bg-rose-400", text: "text-rose-300", label: "Critical", border: "border-rose-500/30" };
    default:
      return { dot: "bg-zinc-500", text: "text-zinc-400", label: "Unknown", border: "border-border" };
  }
}

function StatusIcon({ status }: { status: string }) {
  if (status === "healthy") return <CircleCheck className="h-4 w-4 text-emerald-400" />;
  if (status === "attention") return <CircleAlert className="h-4 w-4 text-amber-400" />;
  if (status === "critical") return <CircleX className="h-4 w-4 text-rose-400" />;
  return <CircleDashed className="h-4 w-4 text-zinc-500" />;
}

const inputCls =
  "w-full rounded-md border border-border bg-secondary px-2.5 py-1.5 font-mono text-xs text-foreground placeholder:text-muted-foreground/60 focus:border-primary/50 focus:outline-none";

function ConfigForm({
  slug,
  onDone,
}: {
  slug: string;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const [liveUrl, setLiveUrl] = useState("");
  const [githubRepo, setGithubRepo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const update = useUpdatePortfolioAsset();

  const save = () => {
    setError(null);
    update.mutate(
      {
        slug,
        data: {
          ...(liveUrl.trim() !== "" ? { liveUrl: liveUrl.trim() } : {}),
          ...(githubRepo.trim() !== "" ? { githubRepo: githubRepo.trim() } : {}),
        },
      },
      {
        onSuccess: () => {
          void queryClient.invalidateQueries({ queryKey: getGetPortfolioHealthQueryKey() });
          onDone();
        },
        onError: () => setError("Couldn't save — check the URL / repo format."),
      },
    );
  };

  return (
    <div className="mt-3 space-y-2 rounded-md border border-border bg-secondary/40 p-3">
      <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        Connect telemetry
      </p>
      <div className="flex items-center gap-2">
        <Globe className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
        <input
          className={inputCls}
          placeholder="Live URL (https://…)"
          value={liveUrl}
          onChange={(e) => setLiveUrl(e.target.value)}
        />
      </div>
      <div className="flex items-center gap-2">
        <Github className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
        <input
          className={inputCls}
          placeholder="GitHub repo (owner/repo)"
          value={githubRepo}
          onChange={(e) => setGithubRepo(e.target.value)}
        />
      </div>
      {error && <p className="font-mono text-[10px] text-rose-300">{error}</p>}
      <div className="flex gap-2">
        <button
          onClick={save}
          disabled={update.isPending || (liveUrl.trim() === "" && githubRepo.trim() === "")}
          className="rounded-md border border-primary/40 bg-primary/15 px-3 py-1 font-mono text-[11px] uppercase tracking-wider text-primary hover:bg-primary/25 disabled:opacity-40"
        >
          {update.isPending ? "Saving…" : "Save"}
        </button>
        <button
          onClick={onDone}
          className="rounded-md border border-border px-3 py-1 font-mono text-[11px] uppercase tracking-wider text-muted-foreground hover:text-foreground"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function AddCompanyForm({ onDone }: { onDone: () => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [liveUrl, setLiveUrl] = useState("");
  const [githubRepo, setGithubRepo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const create = useCreatePortfolioAsset();

  const save = () => {
    setError(null);
    const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    if (!slug) {
      setError("Company name is required.");
      return;
    }
    create.mutate(
      {
        data: {
          slug,
          name: name.trim(),
          description: description.trim(),
          ...(liveUrl.trim() !== "" ? { liveUrl: liveUrl.trim() } : {}),
          ...(githubRepo.trim() !== "" ? { githubRepo: githubRepo.trim() } : {}),
        },
      },
      {
        onSuccess: () => {
          void queryClient.invalidateQueries({ queryKey: getGetPortfolioHealthQueryKey() });
          onDone();
        },
        onError: () => setError("Couldn't add company — the name may already exist or a field is invalid."),
      },
    );
  };

  return (
    <div className="rounded-lg border border-primary/30 bg-card p-5">
      <p className="mb-3 font-mono text-[11px] uppercase tracking-widest text-primary">Add company</p>
      <div className="space-y-2">
        <input className={inputCls} placeholder="Company name" value={name} onChange={(e) => setName(e.target.value)} />
        <input
          className={inputCls}
          placeholder="One-line description (optional)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <div className="flex items-center gap-2">
          <Globe className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
          <input
            className={inputCls}
            placeholder="Live URL (https://…) — optional"
            value={liveUrl}
            onChange={(e) => setLiveUrl(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-2">
          <Github className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
          <input
            className={inputCls}
            placeholder="GitHub repo (owner/repo) — optional"
            value={githubRepo}
            onChange={(e) => setGithubRepo(e.target.value)}
          />
        </div>
        {error && <p className="font-mono text-[10px] text-rose-300">{error}</p>}
        <div className="flex gap-2 pt-1">
          <button
            onClick={save}
            disabled={create.isPending}
            className="rounded-md border border-primary/40 bg-primary/15 px-3 py-1 font-mono text-[11px] uppercase tracking-wider text-primary hover:bg-primary/25 disabled:opacity-40"
          >
            {create.isPending ? "Adding…" : "Add to portfolio"}
          </button>
          <button
            onClick={onDone}
            className="rounded-md border border-border px-3 py-1 font-mono text-[11px] uppercase tracking-wider text-muted-foreground hover:text-foreground"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Portfolio() {
  const { data, isLoading, isError } = useGetPortfolioHealth();
  const [adding, setAdding] = useState(false);
  const [configuring, setConfiguring] = useState<string | null>(null);

  return (
    <div className="space-y-8 animate-in fade-in duration-300">
      <header className="flex items-end justify-between gap-4 border-b border-border/50 pb-6">
        <div>
          <p className="mb-1 font-mono text-[11px] uppercase tracking-widest text-primary">Portfolio · Health</p>
          <h1 className="font-sans text-3xl font-bold uppercase tracking-tight">Portfolio Monitor</h1>
          <p className="mt-1 font-mono text-xs text-muted-foreground">
            Health across every company Mission Control oversees — live URL pings, GitHub activity, and internal
            telemetry roll into the daily briefing.
          </p>
        </div>
        <button
          onClick={() => setAdding((v) => !v)}
          className="flex flex-shrink-0 items-center gap-1.5 rounded-md border border-primary/40 bg-primary/15 px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-primary hover:bg-primary/25"
        >
          <Plus className="h-3.5 w-3.5" /> Add company
        </button>
      </header>

      {adding && <AddCompanyForm onDone={() => setAdding(false)} />}

      {isLoading && (
        <div className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading portfolio health…
        </div>
      )}

      {isError && (
        <div className="rounded-md border border-rose-500/30 bg-rose-500/10 p-4 font-mono text-xs text-rose-300">
          Failed to load portfolio health.
        </div>
      )}

      {data && data.assets.length === 0 && (
        <div className="rounded-md border border-border bg-card p-6 text-center font-mono text-xs text-muted-foreground">
          No portfolio assets registered yet.
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {data?.assets.map((asset) => {
          const tone = statusTone(asset.overall);
          return (
            <div key={asset.slug} className={`rounded-lg border bg-card p-5 ${tone.border}`}>
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-md border border-primary/30 bg-primary/10 text-primary">
                  <Building2 className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="truncate text-sm font-semibold text-foreground">{asset.name}</h3>
                    <span className={`flex items-center gap-1.5 font-mono text-[11px] ${tone.text}`}>
                      <StatusIcon status={asset.overall} />
                      {tone.label}
                    </span>
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{asset.description}</p>
                  <div className="mt-2 flex items-center gap-2">
                    <span className="inline-flex items-center gap-1 rounded border border-border bg-secondary px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                      {asset.monitorType === "live" ? <Radar className="h-3 w-3" /> : <CircleDashed className="h-3 w-3" />}
                      {asset.monitorType} monitor
                    </span>
                    <button
                      onClick={() => setConfiguring((c) => (c === asset.slug ? null : asset.slug))}
                      className="inline-flex items-center gap-1 rounded border border-border bg-secondary px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground hover:text-foreground"
                    >
                      <Settings2 className="h-3 w-3" /> Connect
                    </button>
                  </div>
                </div>
              </div>

              {configuring === asset.slug && (
                <ConfigForm slug={asset.slug} onDone={() => setConfiguring(null)} />
              )}

              <div className="mt-4 divide-y divide-border/60 border-t border-border/60">
                {asset.dimensions.map((dim) => {
                  const dt = statusTone(dim.status);
                  return (
                    <div key={dim.key} className="flex items-start gap-3 py-2.5">
                      <span className={`mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full ${dt.dot}`} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs font-medium text-foreground">{dim.label}</span>
                          <span className={`font-mono text-[10px] uppercase ${dt.text}`}>{dt.label}</span>
                        </div>
                        <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{dim.detail}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
