import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Megaphone,
  Loader2,
  ShieldCheck,
  ShieldAlert,
  GraduationCap,
  Sparkles,
  CircleCheck,
  CircleX,
  Pencil,
  Power,
  TrendingUp,
} from "lucide-react";
import {
  useGetMarketingIntelligenceSnapshot,
  getGetMarketingIntelligenceSnapshotQueryKey,
  useListMarketingPosts,
  getListMarketingPostsQueryKey,
  useCreateMarketingDraftPost,
  useDecideMarketingPostRequest,
  useSetMarketingAutonomy,
  type MarketingPost,
} from "@workspace/api-client-react";

const CONTENT_TYPES: { value: string; label: string; risk: "low" | "high" }[] = [
  { value: "product_tip", label: "Product Tip", risk: "low" },
  { value: "feature_highlight", label: "Feature Highlight", risk: "low" },
  { value: "educational", label: "Educational", risk: "low" },
  { value: "community_engagement", label: "Community Engagement", risk: "low" },
  { value: "creator_spotlight", label: "Creator Spotlight", risk: "low" },
  { value: "launch_countdown", label: "Launch Countdown", risk: "low" },
  { value: "release_recap", label: "Release Recap", risk: "low" },
  { value: "legal_announcement", label: "Legal Announcement", risk: "high" },
  { value: "pricing_change", label: "Pricing Change", risk: "high" },
  { value: "partnership_announcement", label: "Partnership Announcement", risk: "high" },
  { value: "investor_communication", label: "Investor Communication", risk: "high" },
  { value: "crisis_communication", label: "Crisis Communication", risk: "high" },
  { value: "policy_change", label: "Policy Change", risk: "high" },
];

const PLATFORMS = ["twitter", "instagram", "tiktok", "linkedin", "youtube", "facebook"];

const STATUS_STYLES: Record<string, string> = {
  pending_approval: "border-amber-400/40 bg-amber-400/10 text-amber-300",
  approved: "border-emerald-400/40 bg-emerald-400/10 text-emerald-300",
  rejected: "border-rose-400/40 bg-rose-400/10 text-rose-300",
  auto_published: "border-sky-400/40 bg-sky-400/10 text-sky-300",
};

const STATUS_LABELS: Record<string, string> = {
  pending_approval: "Awaiting Approval",
  approved: "Approved",
  rejected: "Rejected",
  auto_published: "Auto-Published",
};

function typeLabel(value: string): string {
  return CONTENT_TYPES.find((t) => t.value === value)?.label ?? value.replace(/_/g, " ");
}

function ProgressBar({ value, max, tone }: { value: number; max: number; tone: string }) {
  const pct = Math.min(100, Math.round((value / Math.max(1, max)) * 100));
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
      <div className={`h-full rounded-full ${tone}`} style={{ width: `${Math.max(2, pct)}%` }} />
    </div>
  );
}

function Metric({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-md border border-border bg-card p-3">
      <p className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-1 font-mono text-xl font-bold text-foreground">{value}</p>
      {sub && <p className="mt-0.5 text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

function PostCard({ post }: { post: MarketingPost }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [edited, setEdited] = useState(post.originalDraft);
  const decide = useDecideMarketingPostRequest();

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: getListMarketingPostsQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getGetMarketingIntelligenceSnapshotQueryKey() });
  };

  const submit = (decision: "approved" | "rejected") => {
    decide.mutate(
      {
        postId: post.id,
        data: {
          decision,
          editedContent: editing && edited.trim() !== post.originalDraft.trim() ? edited : null,
        },
      },
      { onSuccess: invalidate },
    );
  };

  const decidable = post.status === "pending_approval" || post.status === "auto_published";

  return (
    <div className="rounded-md border border-border bg-card p-4">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <span className={`rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider ${STATUS_STYLES[post.status] ?? ""}`}>
          {STATUS_LABELS[post.status] ?? post.status}
        </span>
        <span className="rounded border border-border bg-secondary px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
          {typeLabel(post.contentType)}
        </span>
        <span className="rounded border border-border bg-secondary px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
          {post.platform}
        </span>
        <span
          className={`rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider ${
            post.riskLevel === "high"
              ? "border-rose-400/40 bg-rose-400/10 text-rose-300"
              : "border-emerald-400/40 bg-emerald-400/10 text-emerald-300"
          }`}
        >
          {post.riskLevel} risk
        </span>
        {post.founderEdited && (
          <span className="rounded border border-amber-400/40 bg-amber-400/10 px-1.5 py-0.5 font-mono text-[10px] text-amber-300">
            Founder edited
          </span>
        )}
        <span className="ml-auto font-mono text-[10px] text-muted-foreground">
          {new Date(post.createdAt).toLocaleString()}
        </span>
      </div>

      <p className="mb-1 font-mono text-xs text-muted-foreground">Brief: {post.topic}</p>

      {editing && decidable ? (
        <textarea
          value={edited}
          onChange={(e) => setEdited(e.target.value)}
          rows={5}
          className="mb-2 w-full rounded-md border border-border bg-background p-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
        />
      ) : (
        <p className="mb-2 whitespace-pre-wrap rounded-md border border-border/60 bg-background/60 p-3 text-sm text-foreground">
          {post.status === "approved" || post.status === "auto_published" ? post.finalContent || post.originalDraft : post.originalDraft}
        </p>
      )}

      <div className="mb-2 flex items-center gap-2">
        <span className="font-mono text-[11px] text-muted-foreground">Predicted approval:</span>
        <div className="h-1.5 w-24 overflow-hidden rounded-full bg-secondary">
          <div
            className={`h-full rounded-full ${post.predictedConfidence >= 85 ? "bg-emerald-400" : post.predictedConfidence >= 60 ? "bg-amber-400" : "bg-rose-400"}`}
            style={{ width: `${Math.max(2, post.predictedConfidence)}%` }}
          />
        </div>
        <span className="font-mono text-[11px] text-foreground">{post.predictedConfidence}%</span>
        {post.predictionCorrect !== null && post.predictionCorrect !== undefined && (
          <span className={`font-mono text-[10px] ${post.predictionCorrect ? "text-emerald-300" : "text-rose-300"}`}>
            {post.predictionCorrect ? "prediction correct" : "prediction wrong"}
          </span>
        )}
      </div>
      {post.confidenceReasons.length > 0 && (
        <ul className="mb-3 space-y-0.5">
          {post.confidenceReasons.map((r, i) => (
            <li key={i} className="text-[11px] text-muted-foreground">
              • {r}
            </li>
          ))}
        </ul>
      )}

      {decidable && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => submit("approved")}
            disabled={decide.isPending}
            className="flex items-center gap-1.5 rounded-md border border-emerald-400/40 bg-emerald-400/10 px-3 py-1.5 font-mono text-xs text-emerald-300 transition-colors hover:bg-emerald-400/20 disabled:opacity-50"
          >
            {decide.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CircleCheck className="h-3.5 w-3.5" />}
            {post.status === "auto_published" ? "Confirm" : "Approve"}
          </button>
          <button
            onClick={() => submit("rejected")}
            disabled={decide.isPending}
            className="flex items-center gap-1.5 rounded-md border border-rose-400/40 bg-rose-400/10 px-3 py-1.5 font-mono text-xs text-rose-300 transition-colors hover:bg-rose-400/20 disabled:opacity-50"
          >
            <CircleX className="h-3.5 w-3.5" />
            {post.status === "auto_published" ? "Override & Reject" : "Reject"}
          </button>
          <button
            onClick={() => setEditing((v) => !v)}
            className="flex items-center gap-1.5 rounded-md border border-border bg-secondary px-3 py-1.5 font-mono text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <Pencil className="h-3.5 w-3.5" />
            {editing ? "Cancel edit" : "Edit before approving"}
          </button>
        </div>
      )}
    </div>
  );
}

export default function Marketing() {
  const queryClient = useQueryClient();
  const { data: intel, isLoading: intelLoading } = useGetMarketingIntelligenceSnapshot();
  const { data: postsData, isLoading: postsLoading } = useListMarketingPosts();
  const createDraft = useCreateMarketingDraftPost();
  const setAutonomy = useSetMarketingAutonomy();

  const [topic, setTopic] = useState("");
  const [platform, setPlatform] = useState("twitter");
  const [contentType, setContentType] = useState("product_tip");

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: getListMarketingPostsQueryKey() });
    void queryClient.invalidateQueries({ queryKey: getGetMarketingIntelligenceSnapshotQueryKey() });
  };

  const posts = postsData?.posts ?? [];
  const pending = posts.filter((p) => p.status === "pending_approval");
  const others = posts.filter((p) => p.status !== "pending_approval");
  const selectedType = CONTENT_TYPES.find((t) => t.value === contentType);
  const trusted = intel?.autonomy.mode === "trusted";

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div className="flex items-center gap-3">
        <Megaphone className="h-6 w-6 text-primary" />
        <div>
          <h1 className="font-mono text-xl font-bold text-foreground">Marketing Intelligence</h1>
          <p className="text-sm text-muted-foreground">
            Dario Sol's learning-based publishing system — monitored by Quinn
          </p>
        </div>
      </div>

      {intelLoading || !intel ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading intelligence…
        </div>
      ) : (
        <>
          {/* Autonomy status */}
          <div className={`rounded-md border p-4 ${trusted ? "border-emerald-400/40 bg-emerald-400/5" : "border-amber-400/40 bg-amber-400/5"}`}>
            <div className="flex flex-wrap items-center gap-3">
              {trusted ? <ShieldCheck className="h-5 w-5 text-emerald-400" /> : <GraduationCap className="h-5 w-5 text-amber-400" />}
              <div className="min-w-0 flex-1">
                <p className="font-mono text-sm font-bold text-foreground">
                  {trusted ? "Trusted Marketing Mode" : "Learning Mode"}
                  {intel.autonomy.founderDisabled && (
                    <span className="ml-2 rounded border border-rose-400/40 bg-rose-400/10 px-1.5 py-0.5 font-mono text-[10px] text-rose-300">
                      Founder disabled autonomy
                    </span>
                  )}
                </p>
                <p className="text-xs text-muted-foreground">
                  {trusted
                    ? "Low-risk content auto-publishes at ≥85% confidence. High-risk content always needs your approval."
                    : "Every post requires your approval. Dario is learning your style from each decision."}
                </p>
              </div>
              <button
                onClick={() => setAutonomy.mutate({ data: { founderDisabled: !intel.autonomy.founderDisabled } }, { onSuccess: invalidate })}
                disabled={setAutonomy.isPending}
                className={`flex items-center gap-1.5 rounded-md border px-3 py-1.5 font-mono text-xs transition-colors disabled:opacity-50 ${
                  intel.autonomy.founderDisabled
                    ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-300 hover:bg-emerald-400/20"
                    : "border-rose-400/40 bg-rose-400/10 text-rose-300 hover:bg-rose-400/20"
                }`}
              >
                {setAutonomy.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Power className="h-3.5 w-3.5" />}
                {intel.autonomy.founderDisabled ? "Re-allow autonomy" : "Disable autonomy"}
              </button>
            </div>

            {!trusted && (
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <div>
                  <div className="mb-1 flex justify-between font-mono text-[11px] text-muted-foreground">
                    <span>Approved posts</span>
                    <span>
                      {intel.learningProgress.approvedPosts}/{intel.learningProgress.requiredApprovals}
                    </span>
                  </div>
                  <ProgressBar value={intel.learningProgress.approvedPosts} max={intel.learningProgress.requiredApprovals} tone="bg-amber-400" />
                </div>
                <div>
                  <div className="mb-1 flex justify-between font-mono text-[11px] text-muted-foreground">
                    <span>Prediction accuracy</span>
                    <span>
                      {intel.learningProgress.predictionAccuracy}% / {intel.learningProgress.requiredAccuracy}% required
                    </span>
                  </div>
                  <ProgressBar value={intel.learningProgress.predictionAccuracy} max={100} tone="bg-amber-400" />
                </div>
              </div>
            )}

            {intel.autonomy.suspensionReason && (
              <div className="mt-3 flex items-start gap-2 rounded-md border border-rose-400/30 bg-rose-400/5 p-2.5">
                <ShieldAlert className="mt-0.5 h-4 w-4 flex-shrink-0 text-rose-400" />
                <p className="text-xs text-rose-200">{intel.autonomy.suspensionReason}</p>
              </div>
            )}
          </div>

          {/* Metrics */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Metric label="Drafted" value={String(intel.postsDrafted)} />
            <Metric label="Approved" value={String(intel.postsApproved)} sub={`${intel.postsRejected} rejected`} />
            <Metric label="Auto-published" value={String(intel.postsAutoPublished)} sub={`${intel.autonomy.suspensionCount} suspensions`} />
            <Metric label="Edit rate" value={`${intel.founderEditRate}%`} sub={`brand consistency ${intel.brandConsistencyScore}%`} />
          </div>

          {/* Style profile + confidence trend */}
          <div className="grid gap-3 md:grid-cols-2">
            <div className="rounded-md border border-border bg-card p-4">
              <div className="mb-2 flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                <h2 className="font-mono text-sm font-bold text-foreground">Learned style profile</h2>
              </div>
              {intel.profile.approvedCount === 0 ? (
                <p className="text-xs text-muted-foreground">No approvals yet — the profile builds as you approve posts.</p>
              ) : (
                <div className="space-y-1.5 text-xs text-muted-foreground">
                  <p>
                    <span className="font-mono text-[10px] uppercase tracking-wider">Tones:</span>{" "}
                    {intel.profile.topTones.join(", ") || "—"}
                  </p>
                  <p>
                    <span className="font-mono text-[10px] uppercase tracking-wider">CTAs:</span>{" "}
                    {intel.profile.topCtas.join(", ") || "—"}
                  </p>
                  <p>
                    <span className="font-mono text-[10px] uppercase tracking-wider">Hashtags:</span>{" "}
                    {intel.profile.topHashtags.map((h) => `#${h}`).join(" ") || "—"}
                  </p>
                  <p>
                    <span className="font-mono text-[10px] uppercase tracking-wider">Target length:</span>{" "}
                    ≈{intel.profile.avgLengthChars} chars
                  </p>
                </div>
              )}
            </div>
            <div className="rounded-md border border-border bg-card p-4">
              <div className="mb-2 flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-primary" />
                <h2 className="font-mono text-sm font-bold text-foreground">Confidence trend</h2>
              </div>
              {intel.confidenceTrend.length === 0 ? (
                <p className="text-xs text-muted-foreground">No drafts yet.</p>
              ) : (
                <div className="flex h-16 items-end gap-1">
                  {intel.confidenceTrend.map((point, i) => (
                    <div
                      key={i}
                      title={`${point.confidence}%`}
                      className={`flex-1 rounded-sm ${point.confidence >= 85 ? "bg-emerald-400/70" : point.confidence >= 60 ? "bg-amber-400/70" : "bg-rose-400/70"}`}
                      style={{ height: `${Math.max(6, point.confidence)}%` }}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {/* Draft form */}
      <div className="rounded-md border border-border bg-card p-4">
        <h2 className="mb-3 font-mono text-sm font-bold text-foreground">Ask Dario to draft a post</h2>
        <div className="space-y-3">
          <textarea
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder="Topic or brief — e.g. Announce the new GoPro pairing flow for POV streamers"
            rows={2}
            className="w-full rounded-md border border-border bg-background p-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          />
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={platform}
              onChange={(e) => setPlatform(e.target.value)}
              className="rounded-md border border-border bg-background px-2 py-1.5 font-mono text-xs text-foreground focus:outline-none"
            >
              {PLATFORMS.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
            <select
              value={contentType}
              onChange={(e) => setContentType(e.target.value)}
              className="rounded-md border border-border bg-background px-2 py-1.5 font-mono text-xs text-foreground focus:outline-none"
            >
              {CONTENT_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label} {t.risk === "high" ? "(high risk)" : ""}
                </option>
              ))}
            </select>
            {selectedType?.risk === "high" && (
              <span className="font-mono text-[10px] text-rose-300">High-risk — always requires your approval</span>
            )}
            <button
              onClick={() =>
                createDraft.mutate(
                  { data: { topic: topic.trim(), platform, contentType: contentType as never } },
                  { onSuccess: () => { setTopic(""); invalidate(); } },
                )
              }
              disabled={createDraft.isPending || topic.trim().length < 3}
              className="ml-auto flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-3 py-1.5 font-mono text-xs text-primary transition-colors hover:bg-primary/20 disabled:opacity-50"
            >
              {createDraft.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
              Draft with Dario
            </button>
          </div>
        </div>
      </div>

      {/* Posts */}
      {postsLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading posts…
        </div>
      ) : (
        <>
          {pending.length > 0 && (
            <div className="space-y-3">
              <h2 className="font-mono text-sm font-bold text-foreground">Awaiting your decision ({pending.length})</h2>
              {pending.map((p) => (
                <PostCard key={p.id} post={p} />
              ))}
            </div>
          )}
          <div className="space-y-3">
            <h2 className="font-mono text-sm font-bold text-foreground">History ({others.length})</h2>
            {others.length === 0 ? (
              <p className="text-sm text-muted-foreground">No decided posts yet.</p>
            ) : (
              others.map((p) => <PostCard key={p.id} post={p} />)
            )}
          </div>
        </>
      )}
    </div>
  );
}
