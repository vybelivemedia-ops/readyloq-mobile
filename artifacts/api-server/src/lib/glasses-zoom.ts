/**
 * glasses-zoom — digital zoom helper for Meta glasses frames.
 *
 * Given a raw JPEG buffer, locates the most inspection-relevant subject via a
 * Gemini vision clarification pass, then crops and upscales the image so that
 * the stored frame is a tight, evidence-quality crop rather than a wide-angle
 * snapshot.
 *
 * Fallback: if any step fails the original buffer is returned unchanged so no
 * evidence is ever lost.
 */

import sharp from "sharp";
import { ai } from "@workspace/integrations-gemini-ai";

// ─── Types ────────────────────────────────────────────────────────────────────

interface BoundingBox {
  /** Left edge as a fraction of image width, 0–1. */
  x: number;
  /** Top edge as a fraction of image height, 0–1. */
  y: number;
  /** Width as a fraction of image width, 0–1. */
  width: number;
  /** Height as a fraction of image height, 0–1. */
  height: number;
}

export interface ZoomResult {
  /** Cropped + upscaled JPEG buffer, or the original if zoom failed. */
  buffer: Buffer;
  /** One-word subject label returned by Gemini, e.g. "cockroach". Null if unidentified. */
  subject: string | null;
  /** True when a crop was successfully applied; false means the original frame was kept. */
  cropped: boolean;
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** Minimum output size (shorter side) in pixels. */
const MIN_OUTPUT_PX = 800;
/** Padding added on each edge of the detected bounding box (fraction of box size). */
const PADDING_FRACTION = 0.15;
/** Below this confidence the first-pass AI finding is considered uncertain. */
const CONFIDENCE_THRESHOLD = 0.6;

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Zoom into the most inspection-relevant subject in a glasses frame JPEG.
 *
 * @param imageBuffer  Raw JPEG bytes from the Meta glasses webhook.
 * @param confidence   Confidence score from the first-pass AI analysis (0–1).
 * @param subjectHint  Subject hint from the first pass (e.g. possiblePest).
 * @param existingBox  Pre-computed bounding box (skips the Gemini clarification pass).
 */
export async function zoomGlassesFrame(
  imageBuffer: Buffer,
  confidence?: number,
  subjectHint?: string,
  existingBox?: BoundingBox,
): Promise<ZoomResult> {
  try {
    let box: BoundingBox | null = existingBox ?? null;
    let subject: string | null = subjectHint ?? null;

    // Always ask Gemini for a bounding box unless a pre-computed one was supplied.
    // (The first-pass analyzePhotoFromBase64 returns category/species but not a bbox.)
    const needsClarification = !box || (confidence ?? 0) < CONFIDENCE_THRESHOLD;
    if (needsClarification) {
      const clarified = await askGeminiForBoundingBox(imageBuffer);
      if (clarified) {
        box = clarified.box;
        subject = clarified.subject;
      }
    }

    if (!box) {
      return { buffer: imageBuffer, subject, cropped: false };
    }

    const cropped = await cropAndUpscale(imageBuffer, box);
    return { buffer: cropped, subject, cropped: true };
  } catch {
    // Never lose evidence — return the original on any failure.
    return { buffer: imageBuffer, subject: subjectHint ?? null, cropped: false };
  }
}

// ─── Gemini clarification pass ────────────────────────────────────────────────

const GEMINI_PROMPT = `You are a pest inspection AI. Identify the single most inspection-relevant object in this image — a pest (insect, rodent, wildlife), bait/snap trap, structural damage, or conducive condition (moisture, mold, crack, gap).

Return ONLY a JSON object with these exact fields:
{
  "subject": "<one-word label, e.g. cockroach, mousetrap, crack, moisture>",
  "x": <left edge as fraction of image width, 0.0–1.0>,
  "y": <top edge as fraction of image height, 0.0–1.0>,
  "width": <width as fraction of image width, 0.0–1.0>,
  "height": <height as fraction of image height, 0.0–1.0>
}

If no inspection-relevant object is clearly visible, return:
{"subject":"none","x":0,"y":0,"width":1,"height":1}`;

async function askGeminiForBoundingBox(
  imageBuffer: Buffer,
): Promise<{ box: BoundingBox; subject: string } | null> {
  try {
    const base64 = imageBuffer.toString("base64");

    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: [
        {
          role: "user",
          parts: [
            { inlineData: { mimeType: "image/jpeg", data: base64 } },
            { text: GEMINI_PROMPT },
          ],
        },
      ],
      config: {
        responseMimeType: "application/json",
        maxOutputTokens: 256,
      },
    });

    const raw = (response.text ?? "").trim();
    // Strip markdown code fences if the model adds them
    const clean = raw.replace(/^```json\s*/i, "").replace(/```\s*$/, "").trim();
    const parsed = JSON.parse(clean) as Record<string, unknown>;

    const { subject, x, y, width, height } = parsed;

    if (
      typeof subject !== "string" ||
      subject === "none" ||
      typeof x !== "number" ||
      typeof y !== "number" ||
      typeof width !== "number" ||
      typeof height !== "number"
    ) {
      return null;
    }

    // Validate fractions are sensible
    if (
      x < 0 || x > 1 ||
      y < 0 || y > 1 ||
      width <= 0.02 || width > 1 ||
      height <= 0.02 || height > 1
    ) {
      return null;
    }

    return {
      box: { x, y, width, height },
      subject: subject.toLowerCase().replace(/\s+/g, "_"),
    };
  } catch {
    return null;
  }
}

// ─── Crop + upscale ───────────────────────────────────────────────────────────

async function cropAndUpscale(imageBuffer: Buffer, box: BoundingBox): Promise<Buffer> {
  const meta = await sharp(imageBuffer).metadata();
  const imgW = meta.width ?? 0;
  const imgH = meta.height ?? 0;

  if (imgW === 0 || imgH === 0) return imageBuffer;

  // Add padding around the detected region, clamped to image bounds.
  const padX = Math.round(box.width * PADDING_FRACTION * imgW);
  const padY = Math.round(box.height * PADDING_FRACTION * imgH);

  const left   = Math.max(0, Math.round(box.x * imgW) - padX);
  const top    = Math.max(0, Math.round(box.y * imgH) - padY);
  const right  = Math.min(imgW, Math.round((box.x + box.width)  * imgW) + padX);
  const bottom = Math.min(imgH, Math.round((box.y + box.height) * imgH) + padY);

  const cropW = right - left;
  const cropH = bottom - top;

  // If the crop covers almost the whole image, it's not useful — return original.
  if (cropW <= 0 || cropH <= 0 || cropW > imgW * 0.95 || cropH > imgH * 0.95) {
    return imageBuffer;
  }

  // Upscale so the shorter side is at least MIN_OUTPUT_PX.
  const scale = Math.max(1, MIN_OUTPUT_PX / Math.min(cropW, cropH));
  const outW = Math.round(cropW * scale);
  const outH = Math.round(cropH * scale);

  return sharp(imageBuffer)
    .extract({ left, top, width: cropW, height: cropH })
    .resize(outW, outH, { kernel: sharp.kernel.lanczos3 })
    .jpeg({ quality: 90 })
    .toBuffer();
}
