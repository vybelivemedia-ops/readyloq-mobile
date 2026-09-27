import { useEffect } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { PhotoMeta } from "@/lib/photo-meta";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { mediaUrl } from "@/config";

interface PhotoLightboxProps {
  photos: PhotoMeta[];
  index: number | null;
  onOpenChange: (open: boolean) => void;
  onNavigate: (index: number) => void;
}

function captureTime(value: string | null): string {
  if (!value) return "Timestamp unavailable";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function PhotoLightbox({ photos, index, onOpenChange, onNavigate }: PhotoLightboxProps) {
  const open = index != null;
  const current = index == null ? null : photos[index];
  const currentIndex = index ?? 0;

  useEffect(() => {
    if (!open || index == null) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft" && index > 0) {
        event.preventDefault();
        onNavigate(index - 1);
      }
      if (event.key === "ArrowRight" && index < photos.length - 1) {
        event.preventDefault();
        onNavigate(index + 1);
      }
      if (event.key === "Escape") onOpenChange(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [index, onNavigate, onOpenChange, open, photos.length]);

  if (!current) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-6xl p-0 overflow-hidden">
        <DialogTitle className="sr-only">Photo evidence viewer</DialogTitle>
        <DialogDescription className="sr-only">
          Use left and right arrow keys to navigate photos, or Escape to close.
        </DialogDescription>
        <div className="grid min-h-[65vh] grid-cols-1 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="relative flex min-h-[420px] items-center justify-center bg-black p-8">
            <img src={mediaUrl(current.url)} alt={current.classificationTag} className="max-h-[65vh] max-w-full object-contain" />
            {currentIndex > 0 ? (
              <Button
                type="button"
                variant="secondary"
                size="icon"
                onClick={() => onNavigate(currentIndex - 1)}
                aria-label="Previous photo"
                className="absolute left-4 top-1/2 -translate-y-1/2 rounded-full bg-white/90"
              >
                <ChevronLeft className="h-5 w-5" />
              </Button>
            ) : null}
            {currentIndex < photos.length - 1 ? (
              <Button
                type="button"
                variant="secondary"
                size="icon"
                onClick={() => onNavigate(currentIndex + 1)}
                aria-label="Next photo"
                className="absolute right-4 top-1/2 -translate-y-1/2 rounded-full bg-white/90"
              >
                <ChevronRight className="h-5 w-5" />
              </Button>
            ) : null}
            <span className="absolute bottom-4 rounded-full bg-black/65 px-3 py-1 text-xs font-medium text-white">
              {currentIndex + 1} of {photos.length}
            </span>
          </div>
          <aside className="max-h-[65vh] overflow-y-auto bg-background p-6">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-lg font-bold">{current.classificationTag}</h3>
              {current.unitNumber ? <span className="rounded-full bg-primary px-2.5 py-1 text-xs font-semibold text-primary-foreground">Unit {current.unitNumber}</span> : null}
            </div>
            <p className="mt-2 text-sm text-muted-foreground">Captured {captureTime(current.capturedAt)}</p>
            <div className="mt-6 space-y-5 text-sm">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">AI review</p>
                <p className="mt-1">
                  {current.technicianCorrectionLabel
                    ? `Technician correction: ${current.technicianCorrectionLabel}`
                    : current.confidenceScore == null
                      ? "AI confidence unavailable"
                      : `${Math.round(current.confidenceScore * 100)}% confidence`}
                </p>
              </div>
              {current.structuredDescription ? (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Description</p>
                  <p className="mt-1 leading-6">{current.structuredDescription}</p>
                </div>
              ) : null}
              {current.chemicalLogReference ? (
                <div className="border-t pt-5">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Treatment log</p>
                  <p className="mt-1 leading-6">{current.chemicalLogReference}</p>
                </div>
              ) : null}
            </div>
          </aside>
        </div>
      </DialogContent>
    </Dialog>
  );
}