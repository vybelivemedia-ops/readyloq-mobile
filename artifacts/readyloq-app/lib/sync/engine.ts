import { AppState } from "react-native";

import {
  addInspectionMedia,
  analyzeInspection,
  completeInspection,
  createInspection,
  updateInspection,
} from "@/lib/api-client";
import {
  createBaitStation,
  updateBaitStation,
} from "@/lib/api-client/bait-stations";
import {
  getLocalInspection,
  hasPendingWork,
  listLocalInspections,
  subscribeLocalInspections,
  updateLocalInspection,
  type LocalInspection,
} from "@/lib/local/inspection-store";
import { uploadPhoto } from "@/lib/upload";

/**
 * Offline-first sync engine.
 *
 * Pushes local inspections to the server in a strict, resumable order:
 *   1. create server inspection (idempotent via clientKey = localId)
 *   2. upload each photo to object storage        — photos first, always
 *   3. register each photo as an inspection_media row
 *   4. run draft AI analysis over the uploaded set
 *   5. PATCH notes / pest types
 *   6. explicit completion (only if the technician tapped Complete)
 *
 * The local record is saved after EVERY step, so a crash or network drop
 * resumes exactly where it left off — nothing is redone, nothing is lost.
 *
 * Triggers: local store changes, app foregrounding, a retry timer with
 * exponential backoff, and (once the netinfo native module is present in the
 * dev build) connectivity restoration. All triggers funnel into one
 * debounced, single-flight `syncAll()`.
 */

type EngineListener = () => void;

const state = {
  configured: false,
  getToken: null as (() => Promise<string | null>) | null,
  syncingIds: new Set<string>(),
  running: false,
  runQueued: false,
  debounceTimer: null as ReturnType<typeof setTimeout> | null,
  retryTimer: null as ReturnType<typeof setTimeout> | null,
  listeners: new Set<EngineListener>(),
  /** Called after an inspection fully syncs (server data changed). */
  onSynced: null as ((record: LocalInspection) => void) | null,
};

export function configureSyncEngine(opts: {
  getToken: () => Promise<string | null>;
  onSynced?: (record: LocalInspection) => void;
}) {
  state.getToken = opts.getToken;
  state.onSynced = opts.onSynced ?? null;
  if (state.configured) return;
  state.configured = true;

  // Any local mutation may create pending work.
  subscribeLocalInspections(() => requestSync());

  // Returning to the foreground is the strongest "connectivity may be back"
  // signal available without the netinfo native module.
  AppState.addEventListener("change", (s) => {
    if (s === "active") requestSync(0);
  });

  // Optional: react instantly to connectivity restoration once the netinfo
  // native module exists in the installed build. Soft-required so the engine
  // keeps working on builds that predate it.
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const NetInfo = require("@react-native-community/netinfo").default;
    NetInfo.addEventListener((netState: { isConnected: boolean | null }) => {
      if (netState.isConnected) requestSync(0);
    });
  } catch {
    // Module not in this build — foreground/retry triggers cover it.
  }

  requestSync(0);
}

/** Subscribe to engine activity changes (which inspections are syncing). */
export function subscribeSyncEngine(cb: EngineListener): () => void {
  state.listeners.add(cb);
  return () => state.listeners.delete(cb);
}

export function getSyncingIds(): ReadonlySet<string> {
  return state.syncingIds;
}

/** Ask the engine to sync soon (debounced; safe to call constantly). */
export function requestSync(delayMs = 1200) {
  if (!state.configured) return;
  if (state.debounceTimer) clearTimeout(state.debounceTimer);
  state.debounceTimer = setTimeout(() => {
    state.debounceTimer = null;
    void syncAll();
  }, delayMs);
}

/**
 * Sync one inspection immediately (used by explicit Complete / manual retry).
 * Shares the same single-flight lock as `syncAll` — if a pass is already
 * running (or this record is mid-sync), it queues another pass instead of
 * starting a concurrent one, so a photo can never be uploaded twice.
 */
export async function syncNow(localId: string): Promise<LocalInspection | null> {
  const record = await getLocalInspection(localId);
  if (!record) return null;
  if (!hasPendingWork(record)) return record;
  if (state.running || state.syncingIds.has(localId)) {
    state.runQueued = true;
    return record;
  }
  state.running = true;
  try {
    return await syncOne(record).catch(() => getLocalInspection(localId));
  } finally {
    state.running = false;
    if (state.runQueued) {
      state.runQueued = false;
      requestSync(0);
    } else {
      await scheduleRetryIfNeeded();
    }
  }
}

// ─── Internals ───────────────────────────────────────────────────────────────

function notifyEngine() {
  for (const cb of state.listeners) {
    try {
      cb();
    } catch {
      /* listener errors never break sync */
    }
  }
}

async function syncAll(): Promise<void> {
  if (state.running) {
    state.runQueued = true;
    return;
  }
  state.running = true;
  try {
    const records = (await listLocalInspections()).filter(hasPendingWork);
    // Oldest first: finish earlier inspections before newer ones.
    records.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    for (const record of records) {
      await syncOne(record).catch(() => null);
    }
  } finally {
    state.running = false;
    if (state.runQueued) {
      state.runQueued = false;
      requestSync(0);
    } else {
      await scheduleRetryIfNeeded();
    }
  }
}

async function syncOne(record: LocalInspection): Promise<LocalInspection> {
  // A second concurrent run over the same record would double-upload photos.
  if (state.syncingIds.has(record.localId)) return record;
  state.syncingIds.add(record.localId);
  notifyEngine();

  // Every write goes through the store's atomic read-modify-write, so a save
  // here can never clobber a photo the capture UI added mid-sync (and vice
  // versa). `rec` is refreshed after each merge so later steps see the truth.
  let rec = record;
  const merge = async (mutate: (r: LocalInspection) => void): Promise<void> => {
    const updated = await updateLocalInspection(rec.localId, mutate);
    if (updated) rec = updated;
  };

  try {
    // 1. Create the server inspection (idempotent — clientKey = localId).
    if (rec.serverId == null) {
      const composedNotes = [
        rec.propertyType ? `Property type: ${rec.propertyType}` : "",
        rec.notes.trim(),
      ]
        .filter(Boolean)
        .join("\n\n");
      const created = await createInspection({
        siteAddress: rec.siteAddress.trim(),
        clientName: rec.clientName.trim() || undefined,
        technicianName: rec.technicianName.trim(),
        notes: composedNotes || undefined,
        pestTypes: rec.pestTypes.length ? rec.pestTypes : undefined,
        clientKey: rec.localId,
      });
      await merge((r) => {
        r.serverId = created.id;
      });
    }
    const serverId = rec.serverId;
    if (serverId == null) throw new Error("Sync failed: no server id after create");

    // 2 + 3. Photos first: upload bytes, then register the media row.
    // Progress is merged after each photo (keyed by localUri) so a drop
    // mid-batch never re-uploads and a mid-sync capture is never lost.
    const snapshot = [...rec.photos];
    for (let i = 0; i < snapshot.length; i++) {
      const localUri = snapshot[i].localUri;
      let photo = rec.photos.find((p) => p.localUri === localUri);
      if (!photo) continue; // removed while syncing
      if (!photo.storagePath && !photo.uploading) {
        // Mark as in-flight BEFORE the network request so removePhoto sees it
        // and refuses to delete a photo that is mid-upload. The flag is cleared
        // whether the upload succeeds or throws.
        await merge((r) => {
          const p = r.photos.find((x) => x.localUri === localUri);
          if (p) p.uploading = true;
        });
        let storagePath: string;
        try {
          const token = state.getToken ? await state.getToken() : null;
          storagePath = await uploadPhoto(
            token,
            localUri,
            `inspection-${serverId}-${Date.now()}-${i}.jpg`,
          );
        } catch (uploadErr) {
          await merge((r) => {
            const p = r.photos.find((x) => x.localUri === localUri);
            if (p) p.uploading = false;
          });
          throw uploadErr;
        }
        await merge((r) => {
          const p = r.photos.find((x) => x.localUri === localUri);
          if (p) {
            if (!p.storagePath) p.storagePath = storagePath;
            p.uploading = false;
          }
        });
        photo = rec.photos.find((p) => p.localUri === localUri);
      }
      if (photo?.storagePath && photo.mediaRowId == null) {
        const media = await addInspectionMedia(serverId, {
          mediaType: "photo",
          url: photo.storagePath,
          // Vision Platform provenance — where the evidence came from and how
          // the on-device quality gate scored it.
          captureSource: photo.captureSource,
          qualityScore: photo.qualityScore,
          captureMetadata: photo.captureMetadata,
          // Technician-authored note (set during or after capture). Stored as
          // caption on the server so AI analysis and reports can reference it.
          caption: photo.description ?? undefined,
        });
        await merge((r) => {
          const p = r.photos.find((x) => x.localUri === localUri);
          if (p && p.mediaRowId == null) p.mediaRowId = media.id;
        });
      }
    }

    // 4. Draft AI analysis over the full uploaded set (server-side vision).
    // `draft: true` — Opportunity Intelligence and the scorecard wait for
    // the explicit completion step.
    if (rec.photos.length > 0 && rec.analyzedCount < rec.photos.length) {
      const uploaded = rec.photos.filter((p) => p.storagePath);
      // Near-duplicate photos are still uploaded and kept as evidence, but
      // excluded from AI analysis to avoid redundant detections and cost.
      // They still count toward analyzedCount so the pending-work invariant
      // (photos.length > analyzedCount) can settle.
      const toAnalyze = uploaded.filter((p) => !p.duplicateOf);
      if (toAnalyze.length > 0) {
        await analyzeInspection({
          inspectionId: serverId,
          images: toAnalyze.map((p) => ({ imageUrl: p.storagePath as string })),
          draft: true,
        });
      }
      await merge((r) => {
        r.analyzedCount = Math.max(r.analyzedCount, uploaded.length);
      });
    }

    // 5. Field sync — notes / pest types may have changed after creation.
    const composedNotes = [
      rec.propertyType ? `Property type: ${rec.propertyType}` : "",
      rec.notes.trim(),
    ]
      .filter(Boolean)
      .join("\n\n");
    await updateInspection(serverId, {
      notes: composedNotes || undefined,
      pestTypes: rec.pestTypes.length ? rec.pestTypes : undefined,
    });

    // 5.5. Bait station sync — each station is created once on the server
    // (tracked by serverId) and subsequently kept up-to-date via PATCH.
    // Idempotent: POST only fires for stations without a serverId; PATCH
    // always overwrites so a status change made offline is never lost.
    const stations = (rec.baitStations ?? []).slice();
    for (const station of stations) {
      try {
        const input = {
          label: station.label,
          locationType: station.locationType,
          status: station.status,
          notes: station.notes,
          lastCheckedAt: station.lastCheckedAt,
        };
        if (!station.serverId) {
          const created = await createBaitStation(serverId, input);
          await merge((r) => {
            const s = r.baitStations?.find((b) => b.id === station.id);
            if (s) s.serverId = created.id;
          });
        } else {
          await updateBaitStation(serverId, station.serverId, input);
        }
      } catch {
        // Non-fatal: bait station errors must never block the main sync path.
      }
    }

    // 6. Explicit completion — idempotent server-side; runs the full
    // finalization pipeline (report, narrative, summary, opportunities,
    // scorecard) exactly once.
    if (rec.completed && !rec.serverCompleted) {
      const result = await completeInspection(serverId);
      await merge((r) => {
        r.serverCompleted = true;
        r.reportId = result.reportId ?? r.reportId;
      });
    }

    await merge((r) => {
      r.syncError = null;
      r.syncAttempts = 0;
    });
    state.onSynced?.(rec);
    return rec;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Sync failed";
    console.error("[Sync] syncOne failed for", record.localId, "—", msg, e);
    await merge((r) => {
      r.syncError = msg;
      r.syncAttempts += 1;
    });
    throw e;
  } finally {
    state.syncingIds.delete(record.localId);
    notifyEngine();
  }
}

/** Exponential backoff retry while anything is pending: 10s → 20s → … → 5min. */
async function scheduleRetryIfNeeded() {
  if (state.retryTimer) {
    clearTimeout(state.retryTimer);
    state.retryTimer = null;
  }
  const records = await listLocalInspections();
  const pending = records.filter(hasPendingWork);
  if (pending.length === 0) return;
  const attempts = Math.max(...pending.map((r) => r.syncAttempts), 0);
  const delay = Math.min(10_000 * 2 ** Math.max(attempts - 1, 0), 300_000);
  state.retryTimer = setTimeout(() => {
    state.retryTimer = null;
    void syncAll();
  }, delay);
}
