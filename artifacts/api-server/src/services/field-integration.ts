/**
 * Field-service platform sync service.
 *
 * Packages a finalized ReadyLoq inspection into the payload format expected by
 * PestPac or FieldRoutes and fires the outgoing API calls. Uses native fetch —
 * no extra HTTP library dependencies.
 *
 * API keys are loaded from the database by the calling route and are NEVER
 * logged or forwarded to any client.
 */

import type { FieldIntegrationSystem } from "@workspace/db";

export interface PhotoSyncItem {
  url: string;
  caption: string | null;
  severity: string;
}

export interface TreatmentConditions {
  pestsFound: string[];
  chemicalsUsed: string[];
  temperature?: number | null;
  notes?: string | null;
}

export interface SyncPayload {
  externalSystem: FieldIntegrationSystem;
  /** Account / customer ID within the external platform. */
  accountId: string;
  /** Caller-supplied API credential — never log this value. */
  apiKey: string;
  /** Optional base URL override (defaults to production endpoint). */
  apiBaseUrl?: string | null;
  inspectionDate: string;
  reportSummary: string;
  photos: PhotoSyncItem[];
  treatmentConditions: TreatmentConditions;
}

export interface SyncResult {
  success: boolean;
  externalSystem: FieldIntegrationSystem;
  postedNotes: boolean;
  attachmentsPosted: number;
  error?: string;
}

// ─── PestPac ──────────────────────────────────────────────────────────────────

const PESTPAC_DEFAULT_BASE = "https://api.pestpac.com/v1";

async function syncToPestPac(payload: SyncPayload): Promise<SyncResult> {
  const base = payload.apiBaseUrl?.replace(/\/$/, "") ?? PESTPAC_DEFAULT_BASE;
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${payload.apiKey}`,
  };
  const customerId = payload.accountId;

  // 1 — Post AI narrative as a service note
  const noteRes = await fetch(`${base}/customers/${customerId}/notes`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      note: `[ReadyLoq AI Report] ${payload.reportSummary}`,
      date: payload.inspectionDate,
    }),
  });
  if (!noteRes.ok) {
    const body = await noteRes.text();
    throw new Error(`PestPac note POST failed (${noteRes.status}): ${body}`);
  }

  // 2 — Attach photos
  let attachmentsPosted = 0;
  for (const photo of payload.photos) {
    const attachRes = await fetch(`${base}/customers/${customerId}/attachments`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        fileUrl: photo.url,
        description: `${photo.severity.toUpperCase()}: ${photo.caption ?? ""}`,
      }),
    });
    if (attachRes.ok) attachmentsPosted++;
    // Non-fatal — log but continue uploading remaining photos.
    else {
      const body = await attachRes.text();
      console.warn(`PestPac attachment POST failed (${attachRes.status}): ${body}`);
    }
  }

  return { success: true, externalSystem: "pestpac", postedNotes: true, attachmentsPosted };
}

// ─── FieldRoutes ──────────────────────────────────────────────────────────────

const FIELDROUTES_DEFAULT_BASE = "https://api.fieldroutes.com/api/v1";

async function syncToFieldRoutes(payload: SyncPayload): Promise<SyncResult> {
  const base = payload.apiBaseUrl?.replace(/\/$/, "") ?? FIELDROUTES_DEFAULT_BASE;
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${payload.apiKey}`,
  };
  const customerId = payload.accountId;

  const histRes = await fetch(
    `${base}/customer/${customerId}/service-history`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        summary: payload.reportSummary,
        conditions: {
          pestsFound: payload.treatmentConditions.pestsFound,
          chemicalsUsed: payload.treatmentConditions.chemicalsUsed,
          temperature: payload.treatmentConditions.temperature ?? null,
          notes: payload.treatmentConditions.notes ?? null,
        },
        mediaUrls: payload.photos.map((p) => p.url),
        date: payload.inspectionDate,
      }),
    },
  );

  if (!histRes.ok) {
    const body = await histRes.text();
    throw new Error(`FieldRoutes service-history POST failed (${histRes.status}): ${body}`);
  }

  return {
    success: true,
    externalSystem: "fieldroutes",
    postedNotes: true,
    attachmentsPosted: payload.photos.length,
  };
}

// ─── Public entrypoint ────────────────────────────────────────────────────────

export async function syncInspectionToExternalSystem(
  payload: SyncPayload,
): Promise<SyncResult> {
  switch (payload.externalSystem) {
    case "pestpac":
      return syncToPestPac(payload);
    case "fieldroutes":
      return syncToFieldRoutes(payload);
    default: {
      const exhaustive: never = payload.externalSystem;
      throw new Error(`Unknown external system: ${String(exhaustive)}`);
    }
  }
}
