import { useEffect, useState } from 'react';
import { format } from 'date-fns';
import { ChevronLeft, ChevronRight, ImageOff, Loader2, Maximize2 } from 'lucide-react';
import { apiUrl } from '@/config';
import { useClientInspectionMedia, type ClientInspectionMedia } from '@/hooks/use-client-portal';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog';

function AuthenticatedEvidenceImage({
  media,
  className,
}: {
  media: ClientInspectionMedia;
  className: string;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | null = null;
    setSrc(null);
    setFailed(false);

    fetch(apiUrl(media.imageUrl), {
      credentials: 'include',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error('Evidence image unavailable');
        objectUrl = URL.createObjectURL(await response.blob());
        setSrc(objectUrl);
      })
      .catch((error: unknown) => {
        if ((error as { name?: string }).name !== 'AbortError') setFailed(true);
      });

    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [media.imageUrl]);

  if (failed) {
    return (
      <div className={`${className} flex items-center justify-center bg-muted text-muted-foreground`}>
        <ImageOff className="w-5 h-5" aria-label="Evidence image unavailable" />
      </div>
    );
  }

  if (!src) {
    return (
      <div className={`${className} flex items-center justify-center bg-muted`}>
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" aria-label="Loading evidence image" />
      </div>
    );
  }

  return <img src={src} alt={media.caption || media.filename || 'Inspection evidence'} className={className} />;
}

function evidenceLabel(media: ClientInspectionMedia): string {
  return media.caption || media.filename || `Inspection photo captured ${format(new Date(media.capturedAt), 'PPp')}`;
}

export function EvidenceGallery({ inspectionId }: { inspectionId: number }) {
  const { data: media, isLoading, error } = useClientInspectionMedia(inspectionId);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const active = activeIndex === null ? null : media?.[activeIndex] ?? null;

  useEffect(() => {
    if (activeIndex !== null && !active) setActiveIndex(null);
  }, [active, activeIndex]);

  function move(direction: -1 | 1) {
    setActiveIndex((current) => {
      if (current === null || !media) return current;
      return Math.min(Math.max(current + direction, 0), media.length - 1);
    });
  }

  useEffect(() => {
    if (!active || !media || media.length < 2) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        move(-1);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        move(1);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [active, media]);

  if (isLoading) {
    return <div className="h-36 rounded-xl animate-pulse bg-muted/60" aria-label="Loading inspection evidence" />;
  }

  if (error || !media || media.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border/70 bg-muted/20 px-4 py-5 text-sm text-muted-foreground">
        No inspection photos are available for this visit.
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {media.map((item, index) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setActiveIndex(index)}
            className="group relative overflow-hidden rounded-xl border border-border/60 bg-muted text-left shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
            aria-label={`Open ${evidenceLabel(item)}`}
          >
            <AuthenticatedEvidenceImage media={item} className="aspect-[4/3] w-full object-cover" />
            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-2.5 pb-2 pt-8 text-white">
              <p className="truncate text-[11px] font-medium">
                {format(new Date(item.capturedAt), 'MMM d, yyyy · h:mm a')}
              </p>
            </div>
            <Maximize2 className="absolute right-2 top-2 h-4 w-4 text-white opacity-0 drop-shadow transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
          </button>
        ))}
      </div>

      <Dialog open={activeIndex !== null && !!active} onOpenChange={(open) => !open && setActiveIndex(null)}>
        {active && media && activeIndex !== null && (
          <DialogContent className="max-w-5xl border-border/40 bg-slate-950 p-3 text-white sm:p-5">
            <DialogTitle className="sr-only">{evidenceLabel(active)}</DialogTitle>
            <DialogDescription className="sr-only">
              Inspection evidence photo {activeIndex + 1} of {media.length}
            </DialogDescription>
            <div className="relative">
              <AuthenticatedEvidenceImage
                media={active}
                className="max-h-[72vh] min-h-52 w-full rounded-lg object-contain"
              />
              {media.length > 1 && (
                <>
                  <Button
                    type="button"
                    variant="secondary"
                    size="icon"
                    className="absolute left-2 top-1/2 -translate-y-1/2 rounded-full"
                    onClick={() => move(-1)}
                    disabled={activeIndex === 0}
                    aria-label="Previous evidence photo"
                  >
                    <ChevronLeft className="h-5 w-5" />
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    size="icon"
                    className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full"
                    onClick={() => move(1)}
                    disabled={activeIndex === media.length - 1}
                    aria-label="Next evidence photo"
                  >
                    <ChevronRight className="h-5 w-5" />
                  </Button>
                </>
              )}
            </div>
            <div className="flex flex-col gap-1 px-1 pt-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm font-medium text-white">{evidenceLabel(active)}</p>
              <p className="text-xs text-slate-300" aria-live="polite">
                Captured {format(new Date(active.capturedAt), 'PPp')} · {activeIndex + 1} of {media.length}
              </p>
            </div>
          </DialogContent>
        )}
      </Dialog>
    </>
  );
}