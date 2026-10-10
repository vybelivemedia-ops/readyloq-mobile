import { useEffect, useState } from "react";
import { Link } from "wouter";
import {
  Lightbulb, Crosshair, Repeat, Camera, History, StickyNote,
  AlertTriangle, CheckCircle2, ChevronRight, Loader2, MapPin,
} from "lucide-react";
import { useLookupProperty } from "@workspace/api-client-react";
import type { PropertyFeed, PropertySummary } from "@workspace/api-client-react";
import { cn } from "@/lib/utils";

export const PROPERTY_TYPES = [
  "Multifamily", "Single Family", "Commercial", "Restaurant",
  "Warehouse", "School", "Healthcare", "Hospitality",
];

export function formatDate(iso?: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function severityClass(severity?: string | null): string {
  const s = (severity ?? "").toLowerCase();
  if (s.includes("critical") || s.includes("severe")) return "border-red-500/40 bg-red-500/10 text-red-400";
  if (s.includes("high")) return "border-orange-500/40 bg-orange-500/10 text-orange-400";
  if (s.includes("med") || s.includes("moderate")) return "border-amber-500/40 bg-amber-500/10 text-amber-400";
  if (s.includes("low") || s.includes("minor")) return "border-emerald-500/40 bg-emerald-500/10 text-emerald-400";
  return "border-border/60 bg-muted/30 text-muted-foreground";
}

function SeverityBadge({ severity }: { severity?: string | null }) {
  if (!severity) return null;
  return (
    <span className={cn("px-2 py-0.5 rounded-full border text-[10px] font-semibold uppercase tracking-wide shrink-0", severityClass(severity))}>
      {severity}
    </span>
  );
}

function Section({ icon: Icon, title, count, children }: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
        <Icon className="h-3.5 w-3.5 text-primary/70" /> {title}
        {typeof count === "number" && count > 0 && (
          <span className="text-[10px] text-primary font-semibold">· {count}</span>
        )}
      </p>
      {children}
    </div>
  );
}

/**
 * Read-only render of the intelligence attached to a property. `compact` hides
 * the full visit history and notes lists (used in the pre-inspection card).
 */
export function PropertyFeedSections({ feed, compact = false }: { feed: PropertyFeed; compact?: boolean }) {
  const hasKnowledge = !!feed.technicianKnowledge?.trim();
  const hasHotspots = feed.hotspots.length > 0;
  const hasRecurring = feed.recurringIssues.length > 0;
  const hasPhotos = feed.historicalPhotos.length > 0;
  const hasVisits = feed.visitHistory.length > 0;
  const hasNotes = feed.notes.length > 0;

  const nothing = !hasKnowledge && !hasHotspots && !hasRecurring && !hasPhotos && (compact || (!hasVisits && !hasNotes));

  if (nothing) {
    return (
      <p className="text-xs text-muted-foreground/70 italic">
        No intelligence on file yet. Add technician knowledge, hotspots, or field notes to build this property's history.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {hasKnowledge && (
        <Section icon={Lightbulb} title="Technician Knowledge">
          <p className="text-sm text-foreground/90 leading-relaxed whitespace-pre-wrap">{feed.technicianKnowledge}</p>
        </Section>
      )}

      {hasHotspots && (
        <Section icon={Crosshair} title="Hotspots" count={feed.hotspots.length}>
          <div className="space-y-1.5">
            {feed.hotspots.map((h, i) => (
              <div key={i} className="flex items-start gap-2 rounded-lg border border-border/50 bg-card/60 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground flex items-center gap-1.5">
                    <MapPin className="h-3.5 w-3.5 text-primary/70 shrink-0" /> {h.zone}
                  </p>
                  {h.description && <p className="text-xs text-muted-foreground mt-0.5">{h.description}</p>}
                </div>
                <SeverityBadge severity={h.severity} />
              </div>
            ))}
          </div>
        </Section>
      )}

      {hasRecurring && (
        <Section icon={Repeat} title="Recurring Issues" count={feed.recurringIssues.length}>
          <div className="space-y-1.5">
            {feed.recurringIssues.map((r, i) => (
              <div key={i} className="flex items-start gap-2 rounded-lg border border-border/50 bg-card/60 px-3 py-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground flex items-center gap-2">
                    {r.category}
                    <span className="text-[10px] text-muted-foreground font-normal">seen {r.count}×</span>
                  </p>
                  {r.sampleDescription && <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{r.sampleDescription}</p>}
                  {r.lastSeen && <p className="text-[10px] text-muted-foreground/60 mt-0.5">Last seen {formatDate(r.lastSeen)}</p>}
                </div>
                <SeverityBadge severity={r.severity} />
              </div>
            ))}
          </div>
        </Section>
      )}

      {hasPhotos && (
        <Section icon={Camera} title="Historical Photos" count={feed.historicalPhotos.length}>
          <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
            {feed.historicalPhotos.map((p, i) => (
              <div key={i} className="shrink-0 w-28">
                <div className="w-28 h-28 rounded-lg overflow-hidden border border-border/50 bg-muted/30">
                  <img src={p.url} alt={p.caption ?? "Historical evidence"} className="w-full h-full object-cover" loading="lazy" />
                </div>
                {p.caption && <p className="text-[10px] text-muted-foreground mt-1 line-clamp-2">{p.caption}</p>}
                <p className="text-[9px] text-muted-foreground/50">{formatDate(p.createdAt)}</p>
              </div>
            ))}
          </div>
        </Section>
      )}

      {!compact && hasVisits && (
        <Section icon={History} title="Visit History" count={feed.visitHistory.length}>
          <div className="space-y-1.5">
            {feed.visitHistory.map((v) => (
              <Link key={v.inspectionId} href={`/inspections/${v.inspectionId}`}>
                <div className="flex items-center gap-2 rounded-lg border border-border/50 bg-card/60 px-3 py-2 hover:border-primary/30 transition-colors cursor-pointer">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground">{formatDate(v.createdAt)}</p>
                    <p className="text-xs text-muted-foreground">
                      {v.technicianName || "Unknown tech"} · {v.findingsCount} finding{v.findingsCount === 1 ? "" : "s"} · {v.status}
                    </p>
                  </div>
                  {v.severity && <SeverityBadge severity={v.severity} />}
                  <ChevronRight className="h-4 w-4 text-muted-foreground/50 shrink-0" />
                </div>
              </Link>
            ))}
          </div>
        </Section>
      )}

      {!compact && hasNotes && (
        <Section icon={StickyNote} title="Field Notes" count={feed.notes.length}>
          <div className="space-y-1.5">
            {feed.notes.map((n) => (
              <div key={n.id} className="rounded-lg border border-border/50 bg-card/60 px-3 py-2">
                <p className="text-sm text-foreground/90 whitespace-pre-wrap">{n.note}</p>
                <div className="flex items-center flex-wrap gap-x-2 gap-y-0.5 mt-1 text-[10px] text-muted-foreground/70">
                  {n.zone && <span className="text-primary/70 font-medium">{n.zone}</span>}
                  {n.category && <span>· {n.category}</span>}
                  <span>· {n.authorName || "Anonymous"}</span>
                  <span>· {formatDate(n.createdAt)}</span>
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}
    </div>
  );
}

/**
 * Pre-inspection lookup card shown on the New Inspection setup step. Debounces
 * the entered site address and surfaces any prior intelligence before recording.
 */
export function PreInspectionIntel({ siteAddress }: { siteAddress: string }) {
  const [debounced, setDebounced] = useState("");

  useEffect(() => {
    const t = setTimeout(() => setDebounced(siteAddress.trim()), 400);
    return () => clearTimeout(t);
  }, [siteAddress]);

  const enabled = debounced.length >= 4;
  const { data, isFetching } = useLookupProperty(
    { siteAddress: debounced },
  );

  if (!enabled) return null;

  if (isFetching && !data) {
    return (
      <div className="rounded-2xl border border-border/60 bg-card/60 p-4 flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Checking property intelligence…
      </div>
    );
  }

  if (!data) return null;

  if (data.matchStatus === "exact" && data.feed) {
    return (
      <div className="rounded-2xl border border-primary/30 bg-primary/5 p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-semibold text-primary flex items-center gap-1.5">
            <CheckCircle2 className="h-4 w-4" /> Property on file
          </p>
          <Link href={`/properties/${data.feed.addressKey}`}>
            <span className="text-[11px] text-primary/80 font-medium flex items-center gap-0.5 hover:text-primary cursor-pointer">
              Full profile <ChevronRight className="h-3 w-3" />
            </span>
          </Link>
        </div>
        <p className="text-xs text-muted-foreground -mt-1">{data.feed.siteAddress}</p>
        <PropertyFeedSections feed={data.feed} compact />
      </div>
    );
  }

  if (data.matchStatus === "possible" && data.suggestions.length > 0) {
    return (
      <div className="rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 space-y-2.5">
        <p className="text-sm font-semibold text-amber-400 flex items-center gap-1.5">
          <AlertTriangle className="h-4 w-4" /> Possible match on file
        </p>
        <p className="text-xs text-muted-foreground -mt-1">
          We found {data.suggestions.length} similar propert{data.suggestions.length === 1 ? "y" : "ies"}. Tap to review prior intelligence.
        </p>
        <div className="space-y-1.5">
          {data.suggestions.map((s: PropertySummary) => (
            <Link key={s.addressKey} href={`/properties/${s.addressKey}`}>
              <div className="flex items-center gap-2 rounded-lg border border-border/50 bg-card/60 px-3 py-2 hover:border-primary/30 transition-colors cursor-pointer">
                <MapPin className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground truncate">{s.siteAddress}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {s.inspectionCount} visit{s.inspectionCount === 1 ? "" : "s"} · {s.hotspotCount} hotspot{s.hotspotCount === 1 ? "" : "s"} · {s.openIssueCount} open
                  </p>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground/50 shrink-0" />
              </div>
            </Link>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-border/50 bg-card/40 p-3 flex items-center gap-2 text-xs text-muted-foreground">
      <MapPin className="h-3.5 w-3.5 shrink-0" /> No prior intelligence on file — this will start a new property history.
    </div>
  );
}
