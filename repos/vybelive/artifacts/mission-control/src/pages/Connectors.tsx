import {
  useGetConnectors,
  getGetConnectorsQueryKey,
  type PlatformConnector,
  type SocialConnector,
} from "@workspace/api-client-react";
import { Plug, Loader2, CheckCircle2, XCircle, Radio, Share2, Server } from "lucide-react";

function PlatformCard({ c }: { c: PlatformConnector }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <Server className="h-4 w-4 text-muted-foreground" />
          <span className="font-mono text-sm font-medium text-foreground">{c.label}</span>
        </div>
        {c.available ? (
          <span className="flex items-center gap-1 rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 font-mono text-[10px] uppercase text-emerald-300">
            <CheckCircle2 className="h-3 w-3" /> Available
          </span>
        ) : (
          <span className="flex items-center gap-1 rounded border border-border bg-secondary px-2 py-0.5 font-mono text-[10px] uppercase text-muted-foreground">
            <XCircle className="h-3 w-3" /> Not configured
          </span>
        )}
      </div>
      <p className="mt-2 font-mono text-[11px] leading-relaxed text-muted-foreground">{c.reason}</p>
      <p className="mt-2 font-mono text-[9px] uppercase tracking-wider text-muted-foreground/50">{c.provider}</p>
    </div>
  );
}

function SocialCard({ c }: { c: SocialConnector }) {
  const pct = c.totalCount > 0 ? Math.round((c.connectedCount / c.totalCount) * 100) : 0;
  const statusEntries = Object.entries(c.statusCounts);
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <Radio className="h-4 w-4 text-primary" />
          <span className="font-mono text-sm font-medium text-foreground">{c.label}</span>
        </div>
        <span className="font-mono text-xs text-foreground">
          {c.connectedCount}
          <span className="text-muted-foreground">/{c.totalCount}</span>
        </span>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-secondary">
        <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
      </div>
      {statusEntries.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {statusEntries.map(([status, count]) => (
            <span
              key={status}
              className="rounded border border-border bg-secondary px-1.5 py-0.5 font-mono text-[9px] uppercase text-muted-foreground"
            >
              {status.replace(/_/g, " ")}: {count}
            </span>
          ))}
        </div>
      ) : (
        <p className="mt-3 font-mono text-[10px] text-muted-foreground/60">No accounts connected yet.</p>
      )}
    </div>
  );
}

export default function Connectors() {
  const { data, isLoading, isError } = useGetConnectors({
    query: { queryKey: getGetConnectorsQueryKey(), refetchInterval: 30_000 },
  });

  const platform = data?.platformConnectors ?? [];
  const social = data?.socialConnectors ?? [];

  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <header className="border-b border-border/50 pb-6">
        <p className="mb-1 font-mono text-[11px] uppercase tracking-widest text-primary">Integrations · Surface</p>
        <div className="flex items-center gap-3">
          <Plug className="h-6 w-6 text-primary" />
          <h1 className="font-sans text-3xl font-bold uppercase tracking-tight">Connector Framework</h1>
        </div>
        <p className="mt-1 font-mono text-xs text-muted-foreground">
          External services the AI workforce can reach — platform integrations detected in the environment and social
          streaming destinations connected by creators.
        </p>
      </header>

      {isError ? (
        <div className="rounded-md border border-rose-500/30 bg-rose-500/10 p-4 font-mono text-xs text-rose-300">
          Failed to load connectors.
        </div>
      ) : isLoading ? (
        <div className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Detecting connectors…
        </div>
      ) : (
        <div className="space-y-8">
          <section className="space-y-3">
            <div className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-muted-foreground">
              <Server className="h-3.5 w-3.5" /> Platform Integrations ({platform.length})
            </div>
            {platform.length === 0 ? (
              <p className="rounded-md border border-border bg-card p-6 text-center font-mono text-xs text-muted-foreground">
                No platform integrations detected.
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
                {platform.map((c) => (
                  <PlatformCard key={c.provider} c={c} />
                ))}
              </div>
            )}
          </section>

          <section className="space-y-3">
            <div className="flex items-center gap-2 font-mono text-xs uppercase tracking-wider text-muted-foreground">
              <Share2 className="h-3.5 w-3.5" /> Social Streaming Destinations ({social.length})
            </div>
            {social.length === 0 ? (
              <p className="rounded-md border border-border bg-card p-6 text-center font-mono text-xs text-muted-foreground">
                No social destinations connected yet.
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
                {social.map((c) => (
                  <SocialCard key={c.platform} c={c} />
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
