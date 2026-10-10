/**
 * FAIE Dataset & Training Ingest Utilities
 *
 * Three fire-and-forget helpers that push photos into the FAIE learning
 * pipeline at different stages of the inspection workflow:
 *
 *   1. sendPhotoToFaieDataset     — called on finding Accept (positive reinforce)
 *   2. ingestAllUploadedPhotos    — called on every field photo upload (global training)
 *   3. ingestAnonymizedFaieData   — called on finding Correct (anonymised pest/defect)
 *
 * All calls are non-blocking. Failures are logged but never bubble up to the UI.
 * Normal Clerk authentication is required. Training remains best-effort and
 * never blocks durable evidence saving or inspection completion.
 */

import * as FileSystem from "expo-file-system/legacy";
import * as Crypto from "expo-crypto";
import { API_BASE } from "@/lib/api";
import { createSanitizedPhotoCopy } from "@/lib/privacy/image-sanitizer";

// ── helpers ──────────────────────────────────────────────────────────────────

async function readBase64(uri: string, token: string): Promise<string> {
  let downloadedUri: string | undefined;
  let sanitizedUri: string | undefined;
  try {
    let localUri = uri;
    if (!/^(file|content):\/\//i.test(uri)) {
      const remoteUri = /^https?:\/\//i.test(uri) ? uri : `${API_BASE}${uri}`;
      if (!/^https?:\/\//i.test(remoteUri)) {
        throw new Error("Cannot sanitize an image without a resolvable source URL.");
      }
      downloadedUri = `${FileSystem.cacheDirectory}faie-source-${Crypto.randomUUID()}`;
      const sameApi = new URL(remoteUri).origin === new URL(API_BASE).origin;
      const download = await FileSystem.downloadAsync(remoteUri, downloadedUri,
        sameApi ? { headers: { Authorization: `Bearer ${token}` } } : {});
      if (download.status < 200 || download.status >= 300) {
        throw new Error(`Image download for FAIE sanitization failed (${download.status}).`);
      }
      localUri = download.uri;
    }
    sanitizedUri = await createSanitizedPhotoCopy(localUri);
    return await FileSystem.readAsStringAsync(sanitizedUri, { encoding: "base64" });
  } finally {
    if (downloadedUri) await FileSystem.deleteAsync(downloadedUri, { idempotent: true }).catch(() => {});
    if (sanitizedUri) await FileSystem.deleteAsync(sanitizedUri, { idempotent: true }).catch(() => {});
  }
}

async function postFaie(path: string, body: object, token: string): Promise<void> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`FAIE ${path} → ${res.status} ${res.statusText}`);
  }
}

// ── 1. Finding accept — positive reinforcement ────────────────────────────────

/**
 * Send an accepted finding's evidence photo to the FAIE per-company dataset.
 * Only called when the technician taps "Accept" on a finding card.
 */
export async function sendPhotoToFaieDataset({
  photoUri,
  findingId,
  label,
  confidence,
  companyId,
  getToken,
}: {
  photoUri: string;
  findingId: string | number;
  label: string;
  confidence: number;
  companyId?: string;
  getToken: () => Promise<string | null>;
}): Promise<void> {
  try {
    const token = await getToken();
    if (!token) throw new Error("FAIE training requires authentication");
    const imageBytes = await readBase64(photoUri, token);
    await postFaie("/api/v1/faie/dataset/ingest", {
      companyId,
      findingId: String(findingId),
      label,
      confidence,
      imageBytes,
      timestamp: new Date().toISOString(),
    }, token);
  } catch (err) {
    console.warn("[FAIE] dataset ingest error:", err);
  }
}

// ── 2. Every field upload — global training pool ──────────────────────────────

/**
 * Push a photo to the global FAIE training dataset whenever a technician
 * uploads a field photo. Runs non-blocking after the durable copy is made.
 */
export async function ingestAllUploadedPhotos({
  photoUri,
  companyId,
  technicianId,
  source = "mobile_upload",
  getToken,
}: {
  photoUri: string;
  companyId?: string;
  technicianId: string;
  source?: string;
  getToken: () => Promise<string | null>;
}): Promise<void> {
  try {
    const token = await getToken();
    if (!token) throw new Error("FAIE training requires authentication");
    const imageBytes = await readBase64(photoUri, token);
    await postFaie("/api/v1/faie/training/ingest-global", {
      companyId,
      technicianId,
      source,
      imageBytes,
      timestamp: new Date().toISOString(),
    }, token);
  } catch (err) {
    console.warn("[FAIE] global training ingest error:", err);
  }
}

// ── 3. Finding correct — anonymised pest/defect record ────────────────────────

/**
 * Send an anonymised pest/defect record to the FAIE training core when a
 * technician corrects a finding. This label does not guarantee that the image
 * contains no PII; tenant provenance remains attached by the authenticated API.
 */
export async function ingestAnonymizedFaieData({
  photoUri,
  pestOrDefectCategory,
  visualConfidence,
  structuralContext,
  getToken,
}: {
  photoUri: string;
  /** e.g. "German Cockroach", "Subterranean Termite Shelter Tube", "Open Gap/Void" */
  pestOrDefectCategory: string;
  visualConfidence: number;
  /** e.g. "Kitchen baseboard", "Roofline eave", "Window trim void" */
  structuralContext: string;
  getToken: () => Promise<string | null>;
}): Promise<void> {
  try {
    const token = await getToken();
    if (!token) throw new Error("FAIE training requires authentication");
    const imageBytes = await readBase64(photoUri, token);
    await postFaie("/api/v1/faie/training/ingest-anonymized", {
      category: pestOrDefectCategory,
      confidence: visualConfidence,
      context: structuralContext,
      imageBytes,
      timestamp: new Date().toISOString(),
    }, token);
  } catch (err) {
    console.warn("[FAIE] anonymized ingest error:", err);
  }
}
