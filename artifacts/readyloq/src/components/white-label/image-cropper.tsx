import { useRef, useState, useCallback } from "react";
import ReactCrop, {
  type Crop,
  type PixelCrop,
  centerCrop,
  makeAspectCrop,
} from "react-image-crop";
import "react-image-crop/dist/ReactCrop.css";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface ImageCropperProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Source image as an object URL or data URL. */
  src: string | null;
  /** Fixed aspect ratio (e.g. 1 for square app icon). Omit for free crop. */
  aspect?: number;
  title?: string;
  description?: string;
  /** Longest output edge in pixels (image is downscaled to fit). */
  maxSize?: number;
  busy?: boolean;
  onCropped: (blob: Blob) => void;
}

function makeDefaultCrop(width: number, height: number, aspect?: number): Crop {
  if (aspect) {
    return centerCrop(
      makeAspectCrop({ unit: "%", width: 90 }, aspect, width, height),
      width,
      height,
    );
  }
  return centerCrop({ unit: "%", x: 0, y: 0, width: 90, height: 90 }, width, height);
}

async function cropToBlob(
  image: HTMLImageElement,
  crop: PixelCrop,
  maxSize: number,
): Promise<Blob> {
  const scaleX = image.naturalWidth / image.width;
  const scaleY = image.naturalHeight / image.height;
  const srcW = crop.width * scaleX;
  const srcH = crop.height * scaleY;

  const longest = Math.max(srcW, srcH);
  const scale = longest > maxSize ? maxSize / longest : 1;

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(srcW * scale));
  canvas.height = Math.max(1, Math.round(srcH * scale));

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not supported");
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(
    image,
    crop.x * scaleX,
    crop.y * scaleY,
    srcW,
    srcH,
    0,
    0,
    canvas.width,
    canvas.height,
  );

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Failed to render crop"))),
      "image/png",
    );
  });
}

export function ImageCropper({
  open,
  onOpenChange,
  src,
  aspect,
  title = "Crop image",
  description,
  maxSize = 512,
  busy = false,
  onCropped,
}: ImageCropperProps) {
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [crop, setCrop] = useState<Crop>();
  const [completed, setCompleted] = useState<PixelCrop>();

  const onImageLoad = useCallback(
    (e: React.SyntheticEvent<HTMLImageElement>) => {
      const { width, height } = e.currentTarget;
      setCrop(makeDefaultCrop(width, height, aspect));
    },
    [aspect],
  );

  const handleApply = async () => {
    if (!imgRef.current || !completed?.width || !completed?.height) return;
    const blob = await cropToBlob(imgRef.current, completed, maxSize);
    onCropped(blob);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>

        <div className="flex justify-center bg-muted/40 rounded-lg p-3 max-h-[60vh] overflow-auto">
          {src && (
            <ReactCrop
              crop={crop}
              onChange={(c) => setCrop(c)}
              onComplete={(c) => setCompleted(c)}
              aspect={aspect}
              keepSelection
            >
              {/* eslint-disable-next-line jsx-a11y/alt-text */}
              <img
                ref={imgRef}
                src={src}
                onLoad={onImageLoad}
                alt="To crop"
                className="max-h-[52vh] w-auto"
              />
            </ReactCrop>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={handleApply} disabled={busy || !completed?.width}>
            {busy ? "Uploading…" : "Apply & Upload"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
