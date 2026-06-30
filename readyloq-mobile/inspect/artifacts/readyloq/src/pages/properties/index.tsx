import { useState } from "react";
import { Link } from "wouter";
import { useListProperties } from "@workspace/api-client-react";
import type { PropertySummary } from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import {
  Building2, MapPin, Crosshair, StickyNote, AlertTriangle,
  ChevronRight, Search, Loader2,
} from "lucide-react";
import { formatDate } from "@/components/property-intel";

function PropertyRow({ p }: { p: PropertySummary }) {
  return (
    <Link href={`/properties/${p.addressKey}`}>
      <div className="flex items-center gap-3 rounded-2xl border border-border/60 bg-card/60 px-4 py-3.5 hover:border-primary/30 transition-colors cursor-pointer">
        <div className="w-9 h-9 rounded-xl bg-primary/15 flex items-center justify-center shrink-0">
          <Building2 className="h-4 w-4 text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground truncate flex items-center gap-2">
            {p.siteAddress}
            {p.hasProfile && (
              <span className="text-[9px] text-primary font-semibold uppercase tracking-wide border border-primary/30 bg-primary/10 rounded-full px-1.5 py-0.5">Profile</span>
            )}
          </p>
          <p className="text-[11px] text-muted-foreground truncate">
            {p.clientName ? `${p.clientName} · ` : ""}{p.propertyType}
          </p>
          <div className="flex items-center flex-wrap gap-x-3 gap-y-0.5 mt-1 text-[10px] text-muted-foreground/80">
            <span className="flex items-center gap-1"><MapPin className="h-3 w-3" /> {p.inspectionCount} visit{p.inspectionCount === 1 ? "" : "s"}</span>
            {p.hotspotCount > 0 && <span className="flex items-center gap-1"><Crosshair className="h-3 w-3" /> {p.hotspotCount}</span>}
            {p.openIssueCount > 0 && <span className="flex items-center gap-1 text-amber-400"><AlertTriangle className="h-3 w-3" /> {p.openIssueCount} open</span>}
            {p.noteCount > 0 && <span className="flex items-center gap-1"><StickyNote className="h-3 w-3" /> {p.noteCount}</span>}
            {p.lastVisit && <span>· Last {formatDate(p.lastVisit)}</span>}
          </div>
        </div>
        <ChevronRight className="h-4 w-4 text-muted-foreground/50 shrink-0" />
      </div>
    </Link>
  );
}

export default function PropertiesList() {
  const { data: properties, isLoading } = useListProperties();
  const [query, setQuery] = useState("");

  const filtered = (properties ?? []).filter((p) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return (
      p.siteAddress.toLowerCase().includes(q) ||
      (p.clientName ?? "").toLowerCase().includes(q) ||
      p.propertyType.toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Building2 className="h-6 w-6 text-primary" /> Properties
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          Every site you've inspected, with its knowledge, hotspots, and field history.
        </p>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
        <Input
          placeholder="Search by address, client, or type"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="bg-card border-border/60 rounded-xl h-11 pl-9"
        />
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          <Building2 className="h-10 w-10 mx-auto mb-3 opacity-40" />
          <p className="font-medium">{query ? "No matching properties" : "No properties yet"}</p>
          <p className="text-sm mt-1">
            {query ? "Try a different search." : "Start an inspection to begin building property intelligence."}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((p) => (
            <PropertyRow key={p.addressKey} p={p} />
          ))}
        </div>
      )}
    </div>
  );
}
