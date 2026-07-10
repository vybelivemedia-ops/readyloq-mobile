/**
 * Pure-JS pixel decode for on-device evidence analysis (Route A — no native
 * image pipeline, ships over Metro/OTA).
 *
 * A single JPEG decode produces one bounded grayscale bitmap that BOTH the
 * perceptual-hash de-duplicator and the Laplacian sharpness analyzer read
 * from — the decode is the expensive part, so it happens exactly once per
 * photo and is deliberately run OFF the capture path (deferred) so the camera
 * stays snappy. Every failure path returns null: pixel analysis is advisory,
 * never required, and must never throw into the capture pipeline.
 */

import * as FileSystem from "expo-file-system/legacy";
import { decode as jpegDecode } from "jpeg-js";

/** A downscaled, single-channel (0–255 luminance) bitmap. */
export type GrayscaleImage = {
  width: number;
  height: number;
  /** Row-major luminance, length === width * height. */
  data: Uint8Array;
};

/**
 * Longest edge of the working bitmap. 512px keeps enough high-frequency detail
 * for reliable blur discrimination while bounding memory/CPU on device.
 */
const DEFAULT_MAX_EDGE = 512;

// Manual base64 → bytes so we never depend on a runtime `atob`/Buffer polyfill.
const B64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const B64_LOOKUP = (() => {
  const t = new Uint8Array(256);
  for (let i = 0; i < B64_ALPHABET.length; i++) t[B64_ALPHABET.charCodeAt(i)] = i;
  return t;
})();

function base64ToBytes(b64: string): Uint8Array {
  const len = b64.length;
  let pad = 0;
  if (len > 0 && b64[len - 1] === "=") pad++;
  if (len > 1 && b64[len - 2] === "=") pad++;
  const outLen = ((len * 3) >> 2) - pad;
  const out = new Uint8Array(Math.max(0, outLen));
  let o = 0;
  for (let i = 0; i < len; i += 4) {
    const a = B64_LOOKUP[b64.charCodeAt(i)];
    const b = B64_LOOKUP[b64.charCodeAt(i + 1)];
    const c = B64_LOOKUP[b64.charCodeAt(i + 2)];
    const d = B64_LOOKUP[b64.charCodeAt(i + 3)];
    const chunk = (a << 18) | (b << 12) | ((c & 63) << 6) | (d & 63);
    if (o < outLen) out[o++] = (chunk >> 16) & 255;
    if (o < outLen) out[o++] = (chunk >> 8) & 255;
    if (o < outLen) out[o++] = chunk & 255;
  }
  return out;
}

/**
 * Decode a photo file:// URI into a bounded grayscale bitmap (box-averaged
 * downsample, aspect-ratio preserved). Returns null on any failure — callers
 * treat a null result as "pixel analysis unavailable" and fall back to the
 * metadata-only quality gate.
 */
export async function loadGrayscaleImage(
  uri: string,
  maxEdge = DEFAULT_MAX_EDGE,
): Promise<GrayscaleImage | null> {
  try {
    const b64 = await FileSystem.readAsStringAsync(uri, { encoding: "base64" });
    if (!b64) return null;
    const bytes = base64ToBytes(b64);
    if (bytes.length === 0) return null;

    const decoded = jpegDecode(bytes, {
      useTArray: true,
      formatAsRGBA: false,
      tolerantDecoding: true,
      maxMemoryUsageInMB: 300,
    });
    const sw = decoded.width;
    const sh = decoded.height;
    const src = decoded.data;
    if (!sw || !sh || !src || src.length === 0) return null;

    const channels = Math.max(1, Math.round(src.length / (sw * sh)));
    const scale = Math.min(1, maxEdge / Math.max(sw, sh));
    const dw = Math.max(1, Math.round(sw * scale));
    const dh = Math.max(1, Math.round(sh * scale));

    const sum = new Float64Array(dw * dh);
    const cnt = new Uint32Array(dw * dh);
    for (let y = 0; y < sh; y++) {
      const ty = Math.min(dh - 1, ((y * dh) / sh) | 0);
      const rowBase = y * sw * channels;
      const tRow = ty * dw;
      for (let x = 0; x < sw; x++) {
        const i = rowBase + x * channels;
        const lum =
          channels >= 3
            ? 0.299 * src[i] + 0.587 * src[i + 1] + 0.114 * src[i + 2]
            : src[i];
        const tx = Math.min(dw - 1, ((x * dw) / sw) | 0);
        const t = tRow + tx;
        sum[t] += lum;
        cnt[t]++;
      }
    }

    const data = new Uint8Array(dw * dh);
    for (let i = 0; i < data.length; i++) data[i] = cnt[i] ? (sum[i] / cnt[i]) | 0 : 0;
    return { width: dw, height: dh, data };
  } catch {
    return null;
  }
}
