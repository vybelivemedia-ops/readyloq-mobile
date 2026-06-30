import { useState } from "react";
import { useListDatasetImages, useListDatasetCategories } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, Image as ImageIcon, X } from "lucide-react";
import { Button } from "@/components/ui/button";

const CATEGORY_ICONS: Record<string, string> = {
  pest_activity: "Pest Activity",
  exclusion: "Exclusion Issues",
  sanitation: "Sanitation Concerns",
  moisture: "Moisture Conditions",
  structural: "Structural Deficiencies",
};

function severityBadge(severity: string | null) {
  if (!severity) return null;
  const colors: Record<string, string> = {
    critical: "bg-red-500/15 text-red-400",
    high: "bg-orange-500/15 text-orange-400",
    medium: "bg-amber-500/15 text-amber-400",
    low: "bg-slate-500/15 text-slate-400",
  };
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${colors[severity] ?? colors.low}`}>
      {severity}
    </span>
  );
}

export default function DatasetLibrary() {
  const [search, setSearch] = useState("");
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [activePest, setActivePest] = useState<string | null>(null);

  const { data: categories } = useListDatasetCategories();
  const { data: pageData, isLoading } = useListDatasetImages(
    { category: activeCategory ?? undefined, search: search || undefined, limit: 24 },
    { query: { enabled: true } }
  );

  const images = pageData?.items ?? [];
  const total = pageData?.total ?? 0;

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center gap-3">
        <div>
          <h1 className="text-2xl font-bold">Dataset Library</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {total} inspection images for training and reference
          </p>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search by pest type, category, or tags..."
          className="pl-9"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        {search && (
          <Button variant="ghost" size="icon" className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
            onClick={() => setSearch("")}>
            <X className="h-3 w-3" />
          </Button>
        )}
      </div>

      {/* Category Filter */}
      <div className="flex gap-2 flex-wrap">
        <button
          onClick={() => setActiveCategory(null)}
          className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
            !activeCategory ? "bg-primary text-primary-foreground border-primary" : "bg-transparent text-muted-foreground border-border hover:border-primary hover:text-primary"
          }`}>
          All ({categories?.reduce((s, c) => s + c.count, 0) ?? 0})
        </button>
        {(categories ?? []).map(cat => (
          <button
            key={cat.slug}
            onClick={() => setActiveCategory(activeCategory === cat.slug ? null : cat.slug)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
              activeCategory === cat.slug ? "bg-primary text-primary-foreground border-primary" : "bg-transparent text-muted-foreground border-border hover:border-primary hover:text-primary"
            }`}>
            {cat.name} ({cat.count})
          </button>
        ))}
      </div>

      {/* Grid */}
      {isLoading ? (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {Array.from({ length: 12 }).map((_, i) => <Skeleton key={i} className="aspect-square rounded-lg" />)}
        </div>
      ) : images.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-16 text-center text-muted-foreground">
            <ImageIcon className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p className="font-medium">No images found</p>
            <p className="text-sm mt-1">Try a different search or category</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {images.map(img => (
            <div key={img.id} className="group rounded-lg overflow-hidden border border-border bg-card hover:border-primary/50 transition-colors cursor-pointer">
              <div className="aspect-square relative overflow-hidden bg-muted">
                <img
                  src={img.imageUrl}
                  alt={img.title}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                <div className="absolute bottom-2 left-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  {(img.tags ?? []).slice(0, 2).map(tag => (
                    <span key={tag} className="text-[10px] text-white/80 bg-white/10 px-1.5 py-0.5 rounded mr-1">{tag}</span>
                  ))}
                </div>
              </div>
              <div className="p-2.5">
                <p className="text-xs font-medium leading-tight truncate">{img.title}</p>
                <div className="flex items-center gap-1 mt-1">
                  <span className="text-[10px] text-muted-foreground truncate">{img.pestType}</span>
                  <div className="ml-auto">{severityBadge(img.severity)}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
