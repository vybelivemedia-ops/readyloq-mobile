import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Radio,
  Loader2,
  Plug,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  LayoutDashboard,
  Inbox,
  Bot,
  Sparkles,
  CalendarClock,
  Compass,
  TrendingUp,
  Video,
  Trash2,
  Send,
  Eye,
  Users,
  ThumbsUp,
  MessageSquare,
  RefreshCw,
  RotateCcw,
  ExternalLink,
} from "lucide-react";
import {
  useGetSocialOverview,
  useGetSocialDashboard,
  useGetSocialInbox,
  getGetSocialInboxQueryKey,
  useReplyToSocialInbox,
  useListSocialAgents,
  useRunSocialAgent,
  useGenerateSocialContent,
  useListScheduledSocialPosts,
  getListScheduledSocialPostsQueryKey,
  useCreateScheduledSocialPost,
  useDecideScheduledSocialPost,
  useDeleteScheduledSocialPost,
  useRescheduleScheduledSocialPost,
  useGetSocialDiscovery,
  useGetSocialTrends,
  useGetSocialVybe,
  type SocialPlatformStatus,
  type SocialInboxItem,
  type SocialAgentResult,
  type SocialScheduledPost,
  type SocialContentInputContentType,
  type MarketingPost,
} from "@workspace/api-client-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

type PromoteDraft = {
  key: number;
  clipId: string;
  title: string;
  mediaUrl: string | null;
  thumbnailUrl: string | null;
  content: string;
};

const CONTENT_TYPES: { value: string; label: string }[] = [
  { value: "product_tip", label: "Product Tip" },
  { value: "feature_highlight", label: "Feature Highlight" },
  { value: "educational", label: "Educational" },
  { value: "community_engagement", label: "Community Engagement" },
  { value: "creator_spotlight", label: "Creator Spotlight" },
  { value: "launch_countdown", label: "Launch Countdown" },
  { value: "release_recap", label: "Release Recap" },
  { value: "partnership_announcement", label: "Partnership Announcement" },
];

const REASON_LABELS: Record<string, string> = {
  not_integrated: "Not integrated",
  not_configured: "Not configured",
  not_connected: "Not connected",
  reauth_needed: "Reconnect needed",
  unsupported: "Unsupported",
  api_error: "Live data error",
};

function platformOptionLabel(p: SocialPlatformStatus): string {
  if (p.connected && !p.unavailable) return `${p.label} — connected`;
  if (p.unavailable) return `${p.label} — ${REASON_LABELS[p.unavailable.reason] ?? "unavailable"}`;
  return p.label;
}

function pickDefaultPlatform(platforms: SocialPlatformStatus[], publishOnly: boolean): string {
  const pool = publishOnly ? platforms.filter((p) => p.publishSupported) : platforms;
  const connected = pool.find((p) => p.connected && !p.unavailable);
  return connected?.platform ?? pool[0]?.platform ?? "";
}

function fmtNum(n: number | null | undefined): string {
  if (n == null) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function toLocalDatetimeValue(d: Date): string {
  const off = d.getTimezoneOffset();
  const local = new Date(d.getTime() - off * 60_000);
  return local.toISOString().slice(0, 16);
}

/**
 * Build a public URL to a published post from its platform-specific external id.
 * Only returns a link for platforms whose id maps cleanly to a canonical URL —
 * otherwise we show the raw id rather than fabricate a broken link.
 */
function buildPostUrl(platform: string, externalPostId: string | null | undefined): string | null {
  if (!externalPostId) return null;
  switch (platform) {
    case "youtube":
      return `https://www.youtube.com/watch?v=${externalPostId}`;
    case "facebook":
      return `https://www.facebook.com/${externalPostId}`;
    default:
      return null;
  }
}

function groupByDay(posts: SocialScheduledPost[]): [string, SocialScheduledPost[]][] {
  const byKey = new Map<string, { label: string; ts: number; items: SocialScheduledPost[] }>();
  for (const p of posts) {
    const d = p.scheduledAt ? new Date(p.scheduledAt) : null;
    const valid = d && !Number.isNaN(d.getTime());
    const key = valid ? d.toISOString().slice(0, 10) : "unscheduled";
    const label = valid ? d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) : "Unscheduled";
    const ts = valid ? new Date(key).getTime() : Number.POSITIVE_INFINITY;
    if (!byKey.has(key)) byKey.set(key, { label, ts, items: [] });
    byKey.get(key)!.items.push(p);
  }
  return Array.from(byKey.values())
    .sort((a, b) => a.ts - b.ts)
    .map((g) => [g.label, g.items] as [string, SocialScheduledPost[]]);
}

function Panel({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-border bg-card/60 backdrop-blur p-5 ${className}`}>{children}</div>
  );
}

function SectionTitle({ icon: Icon, title, subtitle }: { icon: React.ComponentType<{ className?: string }>; title: string; subtitle?: string }) {
  return (
    <div className="mb-4 flex items-start gap-3">
      <div className="rounded-lg border border-primary/30 bg-primary/10 p-2">
        <Icon className="h-5 w-5 text-primary" />
      </div>
      <div>
        <h2 className="font-mono text-sm font-bold uppercase tracking-widest text-foreground">{title}</h2>
        {subtitle && <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>}
      </div>
    </div>
  );
}

function Loading() {
  return (
    <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" /> Loading real platform data…
    </div>
  );
}

// ─── Connections ─────────────────────────────────────────────────────────────

function PlatformCard({ p, onRefresh, refreshing }: { p: SocialPlatformStatus; onRefresh: () => void; refreshing: boolean }) {
  const connected = p.connected && !p.unavailable;
  const needsReconnect = p.unavailable?.reason === "reauth_needed";
  return (
    <div className="rounded-lg border border-border bg-secondary/30 p-4">
      <div className="flex items-center justify-between">
        <span className="font-mono text-sm font-semibold text-foreground">{p.label}</span>
        {connected ? (
          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-400/40 bg-emerald-400/10 px-2 py-0.5 text-[10px] font-semibold uppercase text-emerald-300">
            <CheckCircle2 className="h-3 w-3" /> Connected
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/30 px-2 py-0.5 text-[10px] font-semibold uppercase text-muted-foreground">
            <XCircle className="h-3 w-3" /> {p.unavailable ? REASON_LABELS[p.unavailable.reason] ?? "Unavailable" : "Offline"}
          </span>
        )}
      </div>
      {connected && p.accountName && (
        <p className="mt-2 text-xs text-muted-foreground">Account: {p.accountName}</p>
      )}
      {p.unavailable && <p className="mt-2 text-xs text-muted-foreground">{p.unavailable.message}</p>}
      <div className="mt-3 flex flex-wrap gap-1">
        {p.publishSupported && <Cap label="Publish" />}
        {p.analyticsSupported && <Cap label="Analytics" />}
        {p.inboxSupported && <Cap label="Inbox" />}
        {!p.publishSupported && !p.analyticsSupported && !p.inboxSupported && (
          <span className="text-[10px] text-muted-foreground">No live capabilities yet</span>
        )}
      </div>
      {p.oauthSupported && p.configured && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {!connected && (
            <a
              href={`/api/mission-control/social/oauth/${p.platform}/init`}
              className="inline-flex items-center gap-1 rounded-md border border-primary/50 bg-primary/15 px-3 py-1.5 text-xs font-semibold text-primary transition hover:bg-primary/25"
              title={`Authorize VYBE to manage your ${p.label} account`}
            >
              <Plug className="h-3 w-3" />
              {needsReconnect ? "Reconnect" : `Connect ${p.label}`}
            </a>
          )}
          {(connected || needsReconnect) && (
            <button
              onClick={onRefresh}
              disabled={refreshing}
              className="inline-flex items-center gap-1 rounded-md border border-border bg-secondary/40 px-3 py-1.5 text-xs font-semibold text-muted-foreground transition hover:text-foreground disabled:opacity-50"
              title="Re-check status and refresh the OAuth token if it expired"
            >
              <RefreshCw className={`h-3 w-3 ${refreshing ? "animate-spin" : ""}`} />
              {needsReconnect ? "Retry token refresh" : "Refresh status"}
            </button>
          )}
        </div>
      )}
      {p.oauthSupported && !p.configured && (
        <p className="mt-3 text-[11px] text-muted-foreground">Credentials required — coming soon.</p>
      )}
      {!p.oauthSupported && (
        <p className="mt-3 text-[11px] text-muted-foreground">Not integrated yet — coming soon.</p>
      )}
    </div>
  );
}

function Cap({ label }: { label: string }) {
  return (
    <span className="rounded border border-border bg-muted/30 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
      {label}
    </span>
  );
}

function ConnectionsTab() {
  const { data, isLoading, refetch, isFetching } = useGetSocialOverview();
  const [banner, setBanner] = useState<{ kind: "success" | "error"; message: string } | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get("connected");
    const connectError = params.get("connect_error");
    const platform = params.get("platform");
    if (connected) {
      const account = params.get("account");
      setBanner({
        kind: "success",
        message: `Connected ${connected}${account ? ` as ${account}` : ""}.`,
      });
      refetch();
    } else if (connectError) {
      setBanner({
        kind: "error",
        message: `Couldn't connect ${platform ?? "platform"}: ${connectError}`,
      });
    }
    if (connected || connectError) {
      const url = new URL(window.location.href);
      url.search = "";
      window.history.replaceState({}, "", url.toString());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (isLoading) return <Loading />;
  const platforms = data?.platforms ?? [];
  return (
    <Panel>
      {banner && (
        <div
          className={`mb-4 flex items-start justify-between gap-3 rounded-lg border px-4 py-3 text-sm ${
            banner.kind === "success"
              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-200"
              : "border-red-500/40 bg-red-500/10 text-red-200"
          }`}
        >
          <span className="flex items-center gap-2">
            {banner.kind === "success" ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <XCircle className="h-4 w-4 shrink-0" />}
            {banner.message}
          </span>
          <button onClick={() => setBanner(null)} className="shrink-0 text-xs underline opacity-70 hover:opacity-100">
            Dismiss
          </button>
        </div>
      )}
      <div className="mb-4 flex items-start justify-between gap-3">
        <SectionTitle icon={Plug} title="Platform Connections" subtitle="Connect accounts directly here, or from the VYBE mobile app. Live data appears once connected." />
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border bg-secondary/40 px-3 py-1.5 text-xs font-semibold text-muted-foreground transition hover:text-foreground disabled:opacity-50"
        >
          <RefreshCw className={`h-3 w-3 ${isFetching ? "animate-spin" : ""}`} /> Refresh all
        </button>
      </div>
      {data?.founder ? (
        <p className="mb-4 text-xs text-muted-foreground">
          Managing social presence for <span className="text-foreground">{data.founder.displayName}</span> (@{data.founder.username})
        </p>
      ) : (
        <p className="mb-4 text-xs text-amber-300">No founder account resolved yet — create/seed a user to manage connections.</p>
      )}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {platforms.map((p) => (
          <PlatformCard key={p.platform} p={p} onRefresh={() => refetch()} refreshing={isFetching} />
        ))}
      </div>
    </Panel>
  );
}

// ─── Dashboard ───────────────────────────────────────────────────────────────

function DashboardTab() {
  const { data, isLoading } = useGetSocialDashboard();
  if (isLoading) return <Loading />;
  const totals = data?.totals;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon={Users} label="Total Followers" value={fmtNum(totals?.followers)} />
        <Stat icon={Eye} label="Total Views" value={fmtNum(totals?.totalViews)} />
        <Stat icon={Video} label="Content Items" value={fmtNum(totals?.contentCount)} />
        <Stat icon={Plug} label="Connected" value={String(totals?.connectedCount ?? 0)} />
      </div>
      <Panel>
        <SectionTitle icon={LayoutDashboard} title="Per-Platform Audience" subtitle="Real metrics from connected platforms only." />
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {(data?.platforms ?? []).map((p) => (
            <div key={p.platform} className="rounded-lg border border-border bg-secondary/30 p-4">
              <div className="flex items-center justify-between">
                <span className="font-mono text-sm font-semibold text-foreground">{p.label}</span>
                {p.unavailable ? (
                  <span className="text-[10px] uppercase text-muted-foreground">{REASON_LABELS[p.unavailable.reason] ?? "Unavailable"}</span>
                ) : (
                  <span className="text-[10px] uppercase text-emerald-300">Live</span>
                )}
              </div>
              {p.unavailable ? (
                <p className="mt-2 text-xs text-muted-foreground">{p.unavailable.message}</p>
              ) : (
                <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                  <MiniStat label="Followers" value={fmtNum(p.stats?.followers)} />
                  <MiniStat label="Views" value={fmtNum(p.stats?.totalViews)} />
                  <MiniStat label="Content" value={fmtNum(p.stats?.contentCount)} />
                </div>
              )}
            </div>
          ))}
        </div>
      </Panel>
      <Panel>
        <SectionTitle icon={TrendingUp} title="Recent Posts" subtitle="Latest real content across connected platforms." />
        {(data?.recent ?? []).length === 0 ? (
          <p className="text-xs text-muted-foreground">No recent posts available. Connect a platform with analytics (e.g. YouTube).</p>
        ) : (
          <div className="space-y-2">
            {(data?.recent ?? []).map((r) => (
              <div key={r.id} className="flex items-center gap-3 rounded-lg border border-border bg-secondary/20 p-3">
                {r.thumbnailUrl ? (
                  <img src={r.thumbnailUrl} alt="" className="h-10 w-16 rounded object-cover" />
                ) : (
                  <div className="flex h-10 w-16 items-center justify-center rounded bg-muted/40"><Video className="h-4 w-4 text-muted-foreground" /></div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-foreground">{r.title}</p>
                  <p className="text-[11px] text-muted-foreground">{r.platform} · {fmtDate(r.publishedAt)}</p>
                </div>
                <div className="flex gap-3 text-[11px] text-muted-foreground">
                  <span className="inline-flex items-center gap-1"><Eye className="h-3 w-3" />{fmtNum(r.views)}</span>
                  <span className="inline-flex items-center gap-1"><ThumbsUp className="h-3 w-3" />{fmtNum(r.likes)}</span>
                  <span className="inline-flex items-center gap-1"><MessageSquare className="h-3 w-3" />{fmtNum(r.comments)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

function Stat({ icon: Icon, label, value }: { icon: React.ComponentType<{ className?: string }>; label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-card/60 p-4">
      <div className="flex items-center gap-2 text-muted-foreground"><Icon className="h-4 w-4" /><span className="text-[11px] uppercase tracking-wide">{label}</span></div>
      <p className="mt-2 font-mono text-2xl font-bold text-foreground">{value}</p>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="font-mono text-sm font-bold text-foreground">{value}</p>
      <p className="text-[10px] uppercase text-muted-foreground">{label}</p>
    </div>
  );
}

// ─── Inbox ───────────────────────────────────────────────────────────────────

function InboxItemRow({ it }: { it: SocialInboxItem }) {
  const queryClient = useQueryClient();
  const reply = useReplyToSocialInbox();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<{ text: string; url: string | null } | null>(null);

  const onSend = async () => {
    const body = text.trim();
    if (!body) return;
    setError(null);
    try {
      const r = await reply.mutateAsync({ data: { platform: it.platform, itemId: it.id, text: body } });
      setSent({ text: r.text ?? body, url: it.contextUrl ?? null });
      setText("");
      setOpen(false);
      await queryClient.invalidateQueries({ queryKey: getGetSocialInboxQueryKey() });
    } catch (err) {
      const message =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        (err instanceof Error ? err.message : "Failed to post reply.");
      setError(message);
    }
  };

  return (
    <div className="rounded-lg border border-border bg-secondary/20 p-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold text-foreground">{it.authorName}</span>
        <span className="text-[10px] uppercase text-muted-foreground">{it.platform} · {it.kind} · {fmtDate(it.createdAt)}</span>
      </div>
      {it.ownerLabel && (
        <p className="mt-1 text-[11px] font-medium text-primary/80">
          as {it.ownerLabel}
        </p>
      )}
      <p className="mt-1 text-sm text-muted-foreground">{it.text}</p>
      <div className="mt-1 flex items-center gap-3">
        {it.contextTitle && <p className="text-[11px] text-muted-foreground/70">on: {it.contextTitle}</p>}
        {it.likeCount != null && <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground/70"><ThumbsUp className="h-3 w-3" />{fmtNum(it.likeCount)}</span>}
      </div>

      {sent && (
        <div className="mt-2 flex items-start gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
          <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            Reply posted: <span className="text-emerald-100">“{sent.text}”</span>
            {sent.url && (
              <>
                {" "}
                <a href={sent.url} target="_blank" rel="noreferrer" className="underline opacity-80 hover:opacity-100">View on platform</a>
              </>
            )}
          </span>
        </div>
      )}

      {error && (
        <div className="mt-2 flex items-start gap-2 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200">
          <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="mt-2">
        {!it.replySupported ? (
          <p className="text-[11px] text-muted-foreground/70">Replies not supported for {it.platform}.</p>
        ) : !open ? (
          !sent && (
            <button
              onClick={() => { setOpen(true); setError(null); }}
              className="inline-flex items-center gap-1 rounded-md border border-primary/50 bg-primary/15 px-3 py-1.5 text-xs font-semibold text-primary transition hover:bg-primary/25"
            >
              <Send className="h-3 w-3" /> Reply
            </button>
          )
        ) : (
          <div className="space-y-2">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={`Reply to ${it.authorName}…`}
              rows={2}
              autoFocus
              className="w-full rounded-lg border border-border bg-secondary/30 p-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
            />
            <div className="flex items-center gap-2">
              <button
                onClick={onSend}
                disabled={reply.isPending || !text.trim()}
                className="inline-flex items-center gap-1 rounded-md border border-primary/50 bg-primary/15 px-3 py-1.5 text-xs font-semibold text-primary transition hover:bg-primary/25 disabled:opacity-50"
              >
                {reply.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                {reply.isPending ? "Posting…" : "Post reply"}
              </button>
              <button
                onClick={() => { setOpen(false); setText(""); setError(null); }}
                disabled={reply.isPending}
                className="rounded-md border border-border bg-secondary/40 px-3 py-1.5 text-xs font-semibold text-muted-foreground transition hover:text-foreground disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function InboxTab() {
  const { data, isLoading } = useGetSocialInbox();
  const [platformFilter, setPlatformFilter] = useState("all");
  const [kindFilter, setKindFilter] = useState("all");
  const [ownerFilter, setOwnerFilter] = useState("all");
  const [sortBy, setSortBy] = useState<"recent" | "oldest" | "engagement">("recent");

  const items = data?.items ?? [];
  const ownersInInbox = Array.from(
    new Set(items.map((it) => it.ownerLabel).filter((o): o is string => !!o)),
  );

  // If the selected Page disappears from the inbox (data refresh, or all
  // non-Facebook items), reset the filter so results can never be silently
  // trapped empty with no visible control to clear it.
  useEffect(() => {
    if (ownerFilter !== "all" && !ownersInInbox.includes(ownerFilter)) {
      setOwnerFilter("all");
    }
  }, [ownerFilter, ownersInInbox]);

  if (isLoading) return <Loading />;
  const platformsInInbox = Array.from(new Set(items.map((it) => it.platform)));
  const kindsInInbox = Array.from(new Set(items.map((it) => it.kind)));

  const filtered = items
    .filter((it) => (platformFilter === "all" ? true : it.platform === platformFilter))
    .filter((it) => (kindFilter === "all" ? true : it.kind === kindFilter))
    .filter((it) => (ownerFilter === "all" ? true : it.ownerLabel === ownerFilter))
    .sort((a, b) => {
      if (sortBy === "engagement") return (b.likeCount ?? 0) - (a.likeCount ?? 0);
      const ta = a.createdAt ? Date.parse(a.createdAt) : 0;
      const tb = b.createdAt ? Date.parse(b.createdAt) : 0;
      return sortBy === "oldest" ? ta - tb : tb - ta;
    });

  const selectCls = "rounded-md border border-border bg-secondary/30 px-2 py-1.5 text-xs text-foreground focus:border-primary focus:outline-none";

  return (
    <div className="space-y-4">
      <Panel>
        <SectionTitle icon={Inbox} title="Unified Inbox" subtitle="Real comments & mentions from connected platforms that support inbox access." />
        {items.length > 0 && (
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <select value={platformFilter} onChange={(e) => setPlatformFilter(e.target.value)} className={selectCls}>
              <option value="all">All platforms</option>
              {platformsInInbox.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
            <select value={kindFilter} onChange={(e) => setKindFilter(e.target.value)} className={selectCls}>
              <option value="all">All types</option>
              {kindsInInbox.map((k) => <option key={k} value={k}>{k}</option>)}
            </select>
            {ownersInInbox.length > 0 && (
              <select value={ownerFilter} onChange={(e) => setOwnerFilter(e.target.value)} className={selectCls}>
                <option value="all">All Pages</option>
                {ownersInInbox.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            )}
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value as typeof sortBy)} className={selectCls}>
              <option value="recent">Newest first</option>
              <option value="oldest">Oldest first</option>
              <option value="engagement">Most engagement</option>
            </select>
            <span className="text-[11px] text-muted-foreground">{filtered.length} of {items.length}</span>
          </div>
        )}
        {items.length === 0 ? (
          <p className="text-xs text-muted-foreground">No inbox items. Connect YouTube to pull real comments.</p>
        ) : filtered.length === 0 ? (
          <p className="text-xs text-muted-foreground">No items match the current filters.</p>
        ) : (
          <div className="space-y-2">
            {filtered.map((it) => (
              <InboxItemRow key={it.id} it={it} />
            ))}
          </div>
        )}
      </Panel>
      <Panel>
        <SectionTitle icon={AlertTriangle} title="Source Coverage" subtitle="Which platforms can and cannot provide a live inbox." />
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {(data?.sources ?? []).map((s) => (
            <div key={s.platform} className="flex items-center justify-between rounded-md border border-border bg-secondary/20 px-3 py-2">
              <span className="text-sm text-foreground">{s.label}</span>
              {s.available ? (
                <span className="text-[10px] uppercase text-emerald-300">Live</span>
              ) : (
                <span className="text-[10px] text-muted-foreground">{s.message}</span>
              )}
            </div>
          ))}
        </div>
      </Panel>
    </div>
  );
}

// ─── AI Agents ───────────────────────────────────────────────────────────────

function AgentsTab() {
  const { data, isLoading } = useListSocialAgents();
  const run = useRunSocialAgent();
  const [prompt, setPrompt] = useState("");
  const [result, setResult] = useState<SocialAgentResult | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);

  if (isLoading) return <Loading />;

  const onRun = async (agentId: string) => {
    setActiveId(agentId);
    try {
      const r = await run.mutateAsync({ data: { agentId, prompt: prompt.trim() || null } });
      setResult(r);
    } finally {
      setActiveId(null);
    }
  };

  return (
    <div className="space-y-4">
      <Panel>
        <SectionTitle icon={Bot} title="AI Social Agents" subtitle="Each agent analyzes your REAL connected-platform and VYBE data." />
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Optional focus for the agent (e.g. 'grow YouTube subscribers')"
          className="mb-4 w-full rounded-lg border border-border bg-secondary/30 p-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
          rows={2}
        />
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {(data?.agents ?? []).map((a) => (
            <div key={a.id} className="flex flex-col rounded-lg border border-border bg-secondary/30 p-4">
              <span className="font-mono text-sm font-semibold text-foreground">{a.name}</span>
              <span className="mt-0.5 text-[11px] uppercase text-primary/80">{a.role}</span>
              <p className="mt-2 flex-1 text-xs text-muted-foreground">{a.description}</p>
              <button
                onClick={() => onRun(a.id)}
                disabled={run.isPending}
                className="mt-3 inline-flex items-center justify-center gap-1 rounded-md border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary transition hover:bg-primary/20 disabled:opacity-50"
              >
                {run.isPending && activeId === a.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                Run analysis
              </button>
            </div>
          ))}
        </div>
      </Panel>
      {result && (
        <Panel>
          <SectionTitle icon={Sparkles} title={`${result.agentName} — Analysis`} subtitle={result.usedAI ? "Generated by AI over your real data" : "Deterministic analysis (AI unavailable)"} />
          <p className="mb-3 text-sm text-foreground">{result.summary}</p>
          <ul className="space-y-2">
            {result.recommendations.map((rec, i) => (
              <li key={i} className="flex items-start gap-2 rounded-md border border-border bg-secondary/20 p-3 text-sm text-muted-foreground">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />{rec}
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}

// ─── Content Studio ──────────────────────────────────────────────────────────

function StudioTab() {
  const { data: overview } = useGetSocialOverview();
  const gen = useGenerateSocialContent();
  const [topic, setTopic] = useState("");
  const [platform, setPlatform] = useState("");
  const [contentType, setContentType] = useState<SocialContentInputContentType>("product_tip");
  const [post, setPost] = useState<MarketingPost | null>(null);

  const platforms = overview?.platforms ?? [];
  const effectivePlatform = platform || pickDefaultPlatform(platforms, false);

  const onGenerate = async () => {
    if (topic.trim().length < 3 || !effectivePlatform) return;
    const r = await gen.mutateAsync({ data: { topic: topic.trim(), platform: effectivePlatform, contentType } });
    setPost(r.post);
  };

  return (
    <div className="space-y-4">
      <Panel>
        <SectionTitle icon={Sparkles} title="Content Studio" subtitle="Generate on-brand social content using the VYBE marketing AI engine." />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="mb-1 block text-[11px] uppercase text-muted-foreground">Topic</label>
            <input
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="What's the post about?"
              className="w-full rounded-lg border border-border bg-secondary/30 p-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none"
            />
          </div>
          <div>
            <label className="mb-1 block text-[11px] uppercase text-muted-foreground">Platform</label>
            <select value={effectivePlatform} onChange={(e) => setPlatform(e.target.value)} className="w-full rounded-lg border border-border bg-secondary/30 p-3 text-sm text-foreground focus:border-primary focus:outline-none">
              {platforms.length === 0 && <option value="">No platforms available</option>}
              {platforms.map((p) => (
                <option key={p.platform} value={p.platform}>{platformOptionLabel(p)}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-[11px] uppercase text-muted-foreground">Content Type</label>
            <select value={contentType} onChange={(e) => setContentType(e.target.value as SocialContentInputContentType)} className="w-full rounded-lg border border-border bg-secondary/30 p-3 text-sm text-foreground focus:border-primary focus:outline-none">
              {CONTENT_TYPES.map((t) => (
                <option key={t.value} value={t.value}>{t.label}</option>
              ))}
            </select>
          </div>
        </div>
        <p className="mt-3 text-[11px] text-muted-foreground">Drafts are generated for any platform; publishing requires a connected account.</p>
        <button
          onClick={onGenerate}
          disabled={gen.isPending || topic.trim().length < 3 || !effectivePlatform}
          className="mt-2 inline-flex items-center gap-2 rounded-md border border-primary/40 bg-primary/10 px-4 py-2 text-sm font-semibold text-primary transition hover:bg-primary/20 disabled:opacity-50"
        >
          {gen.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          Generate content
        </button>
      </Panel>
      {post && (
        <Panel>
          <SectionTitle icon={Video} title="Generated Draft" subtitle={`${post.platform} · ${post.contentType.replace(/_/g, " ")}`} />
          <p className="whitespace-pre-wrap rounded-lg border border-border bg-secondary/20 p-4 text-sm text-foreground">{post.finalContent}</p>
          {post.hashtags.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1">
              {post.hashtags.map((h) => (
                <span key={h} className="rounded border border-primary/30 bg-primary/10 px-2 py-0.5 text-[11px] text-primary">#{h.replace(/^#/, "")}</span>
              ))}
            </div>
          )}
          <p className="mt-3 text-[11px] text-muted-foreground">Predicted confidence: {post.predictedConfidence}% · This draft is also saved to Marketing.</p>
        </Panel>
      )}
    </div>
  );
}

// ─── Scheduling ──────────────────────────────────────────────────────────────

const SCHED_STATUS_STYLES: Record<string, string> = {
  pending_approval: "border-amber-400/40 bg-amber-400/10 text-amber-300",
  scheduled: "border-sky-400/40 bg-sky-400/10 text-sky-300",
  publishing: "border-violet-400/40 bg-violet-400/10 text-violet-300",
  published: "border-emerald-400/40 bg-emerald-400/10 text-emerald-300",
  failed: "border-rose-400/40 bg-rose-400/10 text-rose-300",
  cancelled: "border-border bg-muted/30 text-muted-foreground",
};

function ScheduleTab({ promoteDraft }: { promoteDraft: PromoteDraft | null }) {
  const qc = useQueryClient();
  const { data: overview } = useGetSocialOverview();
  const { data, isLoading } = useListScheduledSocialPosts();
  const create = useCreateScheduledSocialPost();
  const decide = useDecideScheduledSocialPost();
  const del = useDeleteScheduledSocialPost();
  const reschedule = useRescheduleScheduledSocialPost();

  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);
  const [content, setContent] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [requiresApproval, setRequiresApproval] = useState(true);
  const [view, setView] = useState<"list" | "calendar">("list");
  const [clip, setClip] = useState<{ clipId: string; title: string; mediaUrl: string | null; thumbnailUrl: string | null } | null>(null);

  const publishable = (overview?.platforms ?? []).filter((p) => p.publishSupported);
  const readyPlatforms = publishable.filter((p) => p.connected && !p.unavailable);

  useEffect(() => {
    if (!promoteDraft) return;
    setContent(promoteDraft.content);
    setClip({
      clipId: promoteDraft.clipId,
      title: promoteDraft.title,
      mediaUrl: promoteDraft.mediaUrl,
      thumbnailUrl: promoteDraft.thumbnailUrl,
    });
    const firstReady = readyPlatforms[0]?.platform;
    if (firstReady) setSelectedPlatforms([firstReady]);
    setScheduledAt((prev) => prev || toLocalDatetimeValue(new Date(Date.now() + 60 * 60 * 1000)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [promoteDraft?.key]);

  const togglePlatform = (id: string) =>
    setSelectedPlatforms((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const canSubmit = content.trim().length >= 1 && !!scheduledAt && selectedPlatforms.length > 0;

  const invalidate = () => qc.invalidateQueries({ queryKey: getListScheduledSocialPostsQueryKey() });

  const clearClip = () => setClip(null);

  const onCreate = async () => {
    if (!canSubmit) return;
    const iso = new Date(scheduledAt).toISOString();
    for (const platform of selectedPlatforms) {
      await create.mutateAsync({
        data: {
          platform,
          content: content.trim(),
          scheduledAt: iso,
          requiresApproval,
          ...(clip ? { clipId: clip.clipId, mediaUrl: clip.mediaUrl } : {}),
        },
      });
    }
    setContent("");
    setScheduledAt("");
    setSelectedPlatforms([]);
    setClip(null);
    invalidate();
  };

  const onDecide = async (scheduleId: string, decision: "approve" | "cancel") => {
    await decide.mutateAsync({ scheduleId, data: { decision } });
    invalidate();
  };
  const onDelete = async (scheduleId: string) => {
    await del.mutateAsync({ scheduleId });
    invalidate();
  };
  const onReschedule = async (scheduleId: string) => {
    // Requeue a failed post for the earliest next queue run.
    await reschedule.mutateAsync({ scheduleId, data: { scheduledAt: new Date().toISOString() } });
    invalidate();
  };

  const posts = data?.posts ?? [];

  return (
    <div className="space-y-4">
      <Panel>
        <SectionTitle icon={CalendarClock} title="Schedule a Post" subtitle="Cross-post to multiple connected platforms at once, with an optional founder approval gate." />
        {clip && (
          <div className="mb-4 flex items-center gap-3 rounded-lg border border-primary/40 bg-primary/10 p-3">
            {clip.thumbnailUrl ? (
              <img src={clip.thumbnailUrl} alt="" className="h-12 w-20 shrink-0 rounded object-cover" />
            ) : (
              <div className="flex h-12 w-20 shrink-0 items-center justify-center rounded bg-muted/40"><Video className="h-4 w-4 text-muted-foreground" /></div>
            )}
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-primary">Promoting VYBE clip</p>
              <p className="truncate text-sm text-foreground">{clip.title}</p>
            </div>
            <button
              onClick={clearClip}
              title="Remove the attached clip"
              className="inline-flex shrink-0 items-center gap-1 rounded border border-border bg-muted/20 px-2 py-1 text-[11px] text-muted-foreground transition hover:bg-muted/40"
            >
              <XCircle className="h-3 w-3" /> Clear
            </button>
          </div>
        )}
        <div className="grid grid-cols-1 gap-3">
          <div>
            <label className="mb-1 block text-[11px] uppercase text-muted-foreground">Platforms (cross-post)</label>
            {publishable.length === 0 ? (
              <p className="text-xs text-muted-foreground">No publish-capable platforms exist yet.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {publishable.map((p) => {
                  const ready = p.connected && !p.unavailable;
                  const active = selectedPlatforms.includes(p.platform);
                  return (
                    <button
                      key={p.platform}
                      type="button"
                      disabled={!ready}
                      onClick={() => togglePlatform(p.platform)}
                      title={ready ? undefined : p.unavailable?.message ?? `${p.label} is not connected.`}
                      className={`inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                        active
                          ? "border-primary/60 bg-primary/20 text-primary"
                          : ready
                          ? "border-border bg-secondary/30 text-muted-foreground hover:text-foreground"
                          : "cursor-not-allowed border-border bg-muted/20 text-muted-foreground/50"
                      }`}
                    >
                      {active && <CheckCircle2 className="h-3 w-3" />}
                      {platformOptionLabel(p)}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-[11px] uppercase text-muted-foreground">Scheduled Time</label>
              <input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)} className="w-full rounded-lg border border-border bg-secondary/30 p-3 text-sm text-foreground focus:border-primary focus:outline-none" />
            </div>
            <div className="flex items-end">
              <button
                type="button"
                onClick={() => setScheduledAt(toLocalDatetimeValue(new Date()))}
                className="rounded-lg border border-border bg-secondary/30 px-3 py-3 text-xs font-semibold text-muted-foreground transition hover:text-foreground"
                title="Set the scheduled time to now — publishes at the earliest queue run"
              >
                Set to now
              </button>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-[11px] uppercase text-muted-foreground">Content</label>
            <textarea value={content} onChange={(e) => setContent(e.target.value)} rows={3} placeholder="Post copy…" className="w-full rounded-lg border border-border bg-secondary/30 p-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none" />
          </div>
        </div>
        {readyPlatforms.length === 0 && (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-400/30 bg-amber-400/10 p-3 text-xs text-amber-300">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>No publish-capable platform is connected. Connect a publish-capable account (YouTube, Facebook, or Instagram) in the VYBE app before scheduling.</span>
          </div>
        )}
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input type="checkbox" checked={requiresApproval} onChange={(e) => setRequiresApproval(e.target.checked)} className="accent-primary" />
            Require founder approval before it can publish
          </label>
          <button onClick={onCreate} disabled={create.isPending || !canSubmit} className="inline-flex items-center gap-2 rounded-md border border-primary/40 bg-primary/10 px-4 py-2 text-sm font-semibold text-primary transition hover:bg-primary/20 disabled:opacity-50">
            {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarClock className="h-4 w-4" />}
            {selectedPlatforms.length > 1 ? `Schedule ×${selectedPlatforms.length}` : "Schedule"}
          </button>
        </div>
      </Panel>
      <Panel>
        <div className="mb-4 flex items-start justify-between gap-3">
          <SectionTitle icon={Send} title="Scheduled Queue" subtitle="All server-persisted scheduled posts." />
          <div className="flex shrink-0 overflow-hidden rounded-md border border-border">
            <button onClick={() => setView("list")} className={`px-3 py-1.5 text-xs font-semibold transition ${view === "list" ? "bg-primary/20 text-primary" : "bg-secondary/30 text-muted-foreground hover:text-foreground"}`}>List</button>
            <button onClick={() => setView("calendar")} className={`px-3 py-1.5 text-xs font-semibold transition ${view === "calendar" ? "bg-primary/20 text-primary" : "bg-secondary/30 text-muted-foreground hover:text-foreground"}`}>Calendar</button>
          </div>
        </div>
        {isLoading ? (
          <Loading />
        ) : posts.length === 0 ? (
          <p className="text-xs text-muted-foreground">Nothing scheduled yet.</p>
        ) : view === "calendar" ? (
          <div className="space-y-4">
            {groupByDay(posts).map(([day, dayPosts]) => (
              <div key={day}>
                <p className="mb-2 font-mono text-[11px] font-semibold uppercase tracking-widest text-primary/80">{day} · {dayPosts.length}</p>
                <div className="space-y-2">
                  {dayPosts.map((p) => <SchedRow key={p.id} p={p} onDecide={onDecide} onDelete={onDelete} onReschedule={onReschedule} />)}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-2">
            {posts.map((p: SocialScheduledPost) => <SchedRow key={p.id} p={p} onDecide={onDecide} onDelete={onDelete} onReschedule={onReschedule} />)}
          </div>
        )}
      </Panel>
    </div>
  );
}

function SchedRow({
  p,
  onDecide,
  onDelete,
  onReschedule,
}: {
  p: SocialScheduledPost;
  onDecide: (id: string, decision: "approve" | "cancel") => void;
  onDelete: (id: string) => void;
  onReschedule: (id: string) => void;
}) {
  const postUrl = p.status === "published" ? buildPostUrl(p.platform, p.externalPostId) : null;
  return (
    <div className="rounded-lg border border-border bg-secondary/20 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="font-mono text-xs font-semibold text-foreground">{p.platform}</span>
          <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase ${SCHED_STATUS_STYLES[p.status] ?? "border-border text-muted-foreground"}`}>{p.status.replace(/_/g, " ")}</span>
        </div>
        <span className="text-[11px] text-muted-foreground">{fmtDate(p.scheduledAt)}</span>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">{p.content}</p>

      {p.status === "published" && (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-emerald-400/25 bg-emerald-400/5 px-2.5 py-1.5 text-[11px] text-emerald-300">
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
          <span>Published {fmtDate(p.publishedAt)}</span>
          {postUrl ? (
            <a href={postUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold underline underline-offset-2 hover:text-emerald-200">
              View post <ExternalLink className="h-3 w-3" />
            </a>
          ) : p.externalPostId ? (
            <span className="font-mono text-emerald-300/70">id: {p.externalPostId}</span>
          ) : null}
        </div>
      )}

      {p.status === "failed" && (
        <div className="mt-2 flex items-start gap-2 rounded-md border border-rose-400/25 bg-rose-400/5 px-2.5 py-1.5 text-[11px] text-rose-300">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 break-words">{p.errorMessage ?? "Publishing failed after automatic retries."}</span>
        </div>
      )}

      <div className="mt-2 flex items-center gap-2">
        {p.status === "pending_approval" && (
          <>
            <button onClick={() => onDecide(p.id, "approve")} className="rounded border border-emerald-400/40 bg-emerald-400/10 px-2 py-1 text-[11px] font-semibold text-emerald-300 hover:bg-emerald-400/20">Approve</button>
            <button onClick={() => onDecide(p.id, "cancel")} className="rounded border border-rose-400/40 bg-rose-400/10 px-2 py-1 text-[11px] font-semibold text-rose-300 hover:bg-rose-400/20">Cancel</button>
          </>
        )}
        {(p.status === "failed" || p.status === "cancelled") && (
          <button onClick={() => onReschedule(p.id)} title="Requeue this post to publish at the next queue run" className="inline-flex items-center gap-1 rounded border border-sky-400/40 bg-sky-400/10 px-2 py-1 text-[11px] font-semibold text-sky-300 hover:bg-sky-400/20">
            <RotateCcw className="h-3 w-3" /> Retry now
          </button>
        )}
        <button onClick={() => onDelete(p.id)} className="ml-auto inline-flex items-center gap-1 rounded border border-border bg-muted/20 px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted/40">
          <Trash2 className="h-3 w-3" /> Delete
        </button>
      </div>
    </div>
  );
}

// ─── Discover + Trends ───────────────────────────────────────────────────────

function DiscoverTab() {
  const { data: disc, isLoading: dl } = useGetSocialDiscovery();
  const { data: trends, isLoading: tl } = useGetSocialTrends();
  return (
    <div className="space-y-4">
      <Panel>
        <SectionTitle icon={Compass} title="Creator Discovery" subtitle={`Real VYBE creators for outreach & collaboration${disc ? ` · ${disc.total} active` : ""}`} />
        {dl ? (
          <Loading />
        ) : (disc?.creators ?? []).length === 0 ? (
          <p className="text-xs text-muted-foreground">No other creators found yet.</p>
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {(disc?.creators ?? []).map((c) => (
              <div key={c.id} className="rounded-lg border border-border bg-secondary/30 p-3">
                <div className="flex items-center gap-2">
                  {c.avatarUrl ? (
                    <img src={c.avatarUrl} alt="" className="h-8 w-8 rounded-full object-cover" />
                  ) : (
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">{c.displayName.charAt(0)}</div>
                  )}
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-foreground">{c.displayName}</p>
                    <p className="truncate text-[11px] text-muted-foreground">@{c.username}</p>
                  </div>
                </div>
                <div className="mt-2 flex gap-3 text-[11px] text-muted-foreground">
                  <span>{fmtNum(c.followersCount)} followers</span>
                  <span>{c.totalStreams} streams</span>
                </div>
                {c.category && <span className="mt-2 inline-block rounded border border-border bg-muted/30 px-1.5 py-0.5 text-[10px] text-muted-foreground">{c.category}</span>}
              </div>
            ))}
          </div>
        )}
      </Panel>
      <Panel>
        <SectionTitle icon={TrendingUp} title="Trend Intelligence" subtitle="Signals derived from real VYBE content & creators." />
        {tl ? (
          <Loading />
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <TrendList title="Top Categories" trends={(trends?.categories ?? []).map((t) => ({ label: t.label, count: t.count }))} />
            <TrendList title="Content Types" trends={(trends?.contentTypes ?? []).map((t) => ({ label: t.label.replace(/_/g, " "), count: t.count }))} />
            <TrendList title="Hashtags" trends={(trends?.hashtags ?? []).map((t) => ({ label: `#${t.label.replace(/^#/, "")}`, count: t.count }))} />
          </div>
        )}
      </Panel>
    </div>
  );
}

function TrendList({ title, trends }: { title: string; trends: { label: string; count: number }[] }) {
  return (
    <div>
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
      {trends.length === 0 ? (
        <p className="text-xs text-muted-foreground/70">No data yet.</p>
      ) : (
        <div className="space-y-1">
          {trends.map((t) => (
            <div key={t.label} className="flex items-center justify-between rounded-md border border-border bg-secondary/20 px-3 py-1.5 text-sm">
              <span className="truncate text-foreground">{t.label}</span>
              <span className="ml-2 font-mono text-xs text-primary">{t.count}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── VYBE Live ───────────────────────────────────────────────────────────────

function VybeTab({ onPromote }: { onPromote: (draft: PromoteDraft) => void }) {
  const { data, isLoading } = useGetSocialVybe();
  const { data: overview } = useGetSocialOverview();
  const gen = useGenerateSocialContent();
  const [promotingId, setPromotingId] = useState<string | null>(null);

  const promote = async (c: { id: string; title: string; videoUrl?: string | null; thumbnailUrl?: string | null }) => {
    setPromotingId(c.id);
    const platforms = overview?.platforms ?? [];
    const captionPlatform = pickDefaultPlatform(platforms, true);
    let content = `${c.title}\n\nWatch the full clip 👇`;
    try {
      if (captionPlatform) {
        const r = await gen.mutateAsync({
          data: { topic: c.title, platform: captionPlatform, contentType: "release_recap" },
        });
        const tags = r.post.hashtags.map((h) => `#${h.replace(/^#/, "")}`).join(" ");
        content = tags ? `${r.post.finalContent}\n\n${tags}` : r.post.finalContent;
      }
    } catch {
      // Fall back to the title-based caption if AI generation is unavailable.
    } finally {
      setPromotingId(null);
    }
    onPromote({
      key: Date.now(),
      clipId: c.id,
      title: c.title,
      mediaUrl: c.videoUrl ?? null,
      thumbnailUrl: c.thumbnailUrl ?? null,
      content,
    });
  };

  if (isLoading) return <Loading />;
  const t = data?.totals;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <Stat icon={Radio} label="Streams" value={String(t?.totalStreams ?? 0)} />
        <Stat icon={Video} label="Clips" value={String(t?.totalClips ?? 0)} />
        <Stat icon={Send} label="Publishable Clips" value={String(t?.publishableClips ?? 0)} />
      </div>
      <Panel>
        <SectionTitle icon={Video} title="Clips Ready to Promote" subtitle="Turn your real VYBE clips into scheduled social posts." />
        {(data?.clips ?? []).length === 0 ? (
          <p className="text-xs text-muted-foreground">No clips yet. Create clips from your VYBE streams.</p>
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {(data?.clips ?? []).map((c) => (
              <div key={c.id} className="rounded-lg border border-border bg-secondary/30 p-3">
                {c.thumbnailUrl ? (
                  <img src={c.thumbnailUrl} alt="" className="mb-2 h-24 w-full rounded object-cover" />
                ) : (
                  <div className="mb-2 flex h-24 w-full items-center justify-center rounded bg-muted/30"><Video className="h-5 w-5 text-muted-foreground" /></div>
                )}
                <p className="truncate text-sm text-foreground">{c.title}</p>
                <div className="mt-1 flex items-center justify-between">
                  <span className="text-[11px] text-muted-foreground">{fmtDate(c.createdAt)}</span>
                  <span className={`rounded px-1.5 py-0.5 text-[10px] uppercase ${c.status === "ready" ? "text-emerald-300" : "text-muted-foreground"}`}>{c.status}</span>
                </div>
                {c.status === "ready" && (
                  <button
                    onClick={() => promote(c)}
                    disabled={promotingId === c.id}
                    title="Pre-fill the scheduler with this clip and an AI-suggested caption"
                    className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary transition hover:bg-primary/20 disabled:opacity-50"
                  >
                    {promotingId === c.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                    {promotingId === c.id ? "Preparing…" : "Promote"}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </Panel>
      <Panel>
        <SectionTitle icon={Radio} title="Recent Streams" subtitle="Your latest VYBE broadcasts." />
        {(data?.streams ?? []).length === 0 ? (
          <p className="text-xs text-muted-foreground">No streams yet.</p>
        ) : (
          <div className="space-y-2">
            {(data?.streams ?? []).map((s) => (
              <div key={s.id} className="flex items-center justify-between rounded-lg border border-border bg-secondary/20 p-3">
                <div>
                  <p className="text-sm text-foreground">{s.title}</p>
                  <p className="text-[11px] text-muted-foreground">{fmtDate(s.createdAt)}</p>
                </div>
                <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                  <span className="inline-flex items-center gap-1"><Eye className="h-3 w-3" />{fmtNum(s.peakViewers)} peak</span>
                  <span className="uppercase">{s.status}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

const TABS = [
  { value: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { value: "connections", label: "Connections", icon: Plug },
  { value: "inbox", label: "Inbox", icon: Inbox },
  { value: "agents", label: "AI Agents", icon: Bot },
  { value: "studio", label: "Content Studio", icon: Sparkles },
  { value: "schedule", label: "Scheduling", icon: CalendarClock },
  { value: "discover", label: "Discover", icon: Compass },
  { value: "vybe", label: "VYBE Live", icon: Radio },
];

export default function Social() {
  const [activeTab, setActiveTab] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("connected") || params.get("connect_error") ? "connections" : "dashboard";
  });
  const [promoteDraft, setPromoteDraft] = useState<PromoteDraft | null>(null);

  const onPromote = (draft: PromoteDraft) => {
    setPromoteDraft(draft);
    setActiveTab("schedule");
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 md:px-8">
      <div className="mb-6 flex items-center gap-3">
        <div className="rounded-xl border border-primary/30 bg-primary/10 p-2.5">
          <Radio className="h-6 w-6 text-primary" />
        </div>
        <div>
          <h1 className="font-mono text-lg font-bold uppercase tracking-widest text-foreground neon-text-primary">Social Command Center</h1>
          <p className="text-xs text-muted-foreground">Manage VYBE's social presence on real platform data — no placeholders.</p>
        </div>
      </div>
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="mb-5 flex h-auto flex-wrap gap-1 bg-transparent p-0">
          {TABS.map((t) => (
            <TabsTrigger key={t.value} value={t.value} className="gap-1.5 rounded-lg border border-border bg-card/40 px-3 py-2 text-xs data-[state=active]:border-primary/50 data-[state=active]:bg-primary/10 data-[state=active]:text-primary">
              <t.icon className="h-3.5 w-3.5" />{t.label}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="dashboard"><DashboardTab /></TabsContent>
        <TabsContent value="connections"><ConnectionsTab /></TabsContent>
        <TabsContent value="inbox"><InboxTab /></TabsContent>
        <TabsContent value="agents"><AgentsTab /></TabsContent>
        <TabsContent value="studio"><StudioTab /></TabsContent>
        <TabsContent value="schedule"><ScheduleTab promoteDraft={promoteDraft} /></TabsContent>
        <TabsContent value="discover"><DiscoverTab /></TabsContent>
        <TabsContent value="vybe"><VybeTab onPromote={onPromote} /></TabsContent>
      </Tabs>
    </div>
  );
}
