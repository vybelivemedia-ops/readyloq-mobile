/**
 * Perceptual-hash near-duplicate detection.
 *
 * Uses a 64-bit difference hash (dHash): the bitmap is reduced to a 9×8 grid
 * of luminance averages and each bit records whether a cell is brighter than
 * its right-hand neighbour. dHash is robust to exposure/scale shifts and cheap
 * to compare via Hamming distance, so two shots of the same subject collapse
 * to hashes a few bits apart. Detection is ADVISORY — duplicates are flagged
 * (and skipped for AI analysis) but never deleted.
 */

import type { GrayscaleImage } from "./pixels";

/**
 * Max Hamming distance (out of 64 bits) still treated as a near-duplicate.
 * Conservative on purpose: over-suppression would hide distinct evidence.
 */
export const DUP_HAMMING_THRESHOLD = 8;

const HASH_COLS = 9;
const HASH_ROWS = 8;

function cellAverage(
  img: GrayscaleImage,
  cx: number,
  cy: number,
): number {
  const x0 = Math.floor((cx * img.width) / HASH_COLS);
  const x1 = Math.max(x0 + 1, Math.floor(((cx + 1) * img.width) / HASH_COLS));
  const y0 = Math.floor((cy * img.height) / HASH_ROWS);
  const y1 = Math.max(y0 + 1, Math.floor(((cy + 1) * img.height) / HASH_ROWS));
  let sum = 0;
  let n = 0;
  for (let y = y0; y < y1; y++) {
    const rb = y * img.width;
    for (let x = x0; x < x1; x++) {
      sum += img.data[rb + x];
      n++;
    }
  }
  return n ? sum / n : 0;
}

function bitsToHex(bits: string): string {
  let hex = "";
  for (let i = 0; i < bits.length; i += 4) {
    hex += parseInt(bits.slice(i, i + 4).padEnd(4, "0"), 2).toString(16);
  }
  return hex;
}

/** Compute a 64-bit dHash as a 16-char hex string. */
export function computeDHash(img: GrayscaleImage): string {
  const vals = new Array<number>(HASH_COLS * HASH_ROWS);
  for (let cy = 0; cy < HASH_ROWS; cy++) {
    for (let cx = 0; cx < HASH_COLS; cx++) {
      vals[cy * HASH_COLS + cx] = cellAverage(img, cx, cy);
    }
  }
  let bits = "";
  for (let y = 0; y < HASH_ROWS; y++) {
    for (let x = 0; x < HASH_COLS - 1; x++) {
      bits += vals[y * HASH_COLS + x] > vals[y * HASH_COLS + x + 1] ? "1" : "0";
    }
  }
  return bitsToHex(bits);
}

/** Hamming distance between two equal-length hex hashes (bit count of XOR). */
export function hammingDistance(a: string, b: string): number {
  if (a.length !== b.length) return Number.MAX_SAFE_INTEGER;
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    let x = (parseInt(a[i], 16) ^ parseInt(b[i], 16)) & 0xf;
    while (x) {
      d += x & 1;
      x >>= 1;
    }
  }
  return d;
}

/**
 * Return the localUri of the first existing photo whose hash is within
 * `threshold` bits of `hash`, or null when the shot is distinct.
 */
export function findNearDuplicate(
  hash: string,
  existing: ReadonlyArray<{ localUri: string; perceptualHash?: string }>,
  threshold = DUP_HAMMING_THRESHOLD,
): string | null {
  for (const p of existing) {
    if (!p.perceptualHash) continue;
    if (hammingDistance(hash, p.perceptualHash) <= threshold) return p.localUri;
  }
  return null;
}
