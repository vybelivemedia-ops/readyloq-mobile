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
import { correctFinding } from "@/lib/api-client/corrections";
import { getDeliveryMethod } from "@/lib/delivery/registry";
import {
  getLocalInspection,
  hasPendingWork,
  listLocalInspections,
  subscribeLocalInspections,
  updateLocalInspection,
  canonicalStoragePath,
  type LocalInspection,
} from "@/lib/local/inspection-store";
import { doUpload, probeStoragePath, reserveUploadPath } from "@/lib/upload";
import { retryDelayMs } from "./retry-policy";

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
  // Local store notifications emitted by our own checkpoint writes must not
  // queue an immediate second pass while the first pass is still running.
  if (state.running) return;
  if (state.debounceTimer) clearTimeout(state.debounceTimer);
  state.debounceTimer = setTimeout(() => {
    state.debounceTimer = null;
    void syncAll();
  }, delayMs);
}

/**
 * Sync one inspection immediately (used by explicit Complete / manual retry).
 * Shares the single-flight lock with all other triggers. A busy worker leaves
 * scheduling to its finally block rather than creating a second retry loop.
 */
export async function syncNow(localId: string): Promise<LocalInspection | null> {
  const record = await getLocalInspection(localId);
  if (!record) return null;
  if (!hasPendingWork(record)) return record;
  if (!isDue(record)) {
    if (state.configured) void scheduleRetryIfNeeded();
    return record;
  }
  if (state.running || state.syncingIds.has(localId)) {
    return record;
  }
  state.running = true;
  try {
    return await syncOne(record).catch(() => getLocalInspection(localId));
  } finally {
    state.running = false;
    if (state.configured) await scheduleRetryIfNeeded();
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
  if (state.running) return;
  state.running = true;
  try {
    const records = (await listLocalInspections()).filter((r) => hasPendingWork(r) && isDue(r));
    // Oldest first: finish earlier inspections before newer ones.
    records.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    for (const record of records) {
      await syncOne(record).catch(() => null);
    }
  } finally {
    state.running = false;
    await scheduleRetryIfNeeded();
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
        // Preserve the unit selected at booking when the mobile record is
        // first created server-side (offline-first or unscheduled captures).
        unitNumber: rec.unitNumber ?? null,
        visitPurpose: rec.visitPurpose?.trim() || undefined,
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
    //
    // Crash-safety: the upload is split into three persisted checkpoints so
    // the worst-case crash window never causes a silent data loss or an
    // undetected double-upload:
    //
    //   Checkpoint A — `pendingStoragePath` written BEFORE any bytes are sent.
    //   Checkpoint B — bytes PUT to object storage.
    //   Checkpoint C — `storagePath` promoted from `pendingStoragePath`.
    //
    // On the next launch `parseRecord` resets `uploading: false` (was `true`),
    // but intentionally leaves `pendingStoragePath` intact.  The engine then
    // probes whether the object was already written and either reuses the path
    // (no re-upload) or uploads fresh (rare orphaned object, but safe because
    // the server's `POST /media` endpoint deduplicates by URL).
    const snapshot = [...rec.photos];
    for (let i = 0; i < snapshot.length; i++) {
      const localUri = snapshot[i].localUri;
      let photo = rec.photos.find((p) => p.localUri === localUri);
      if (!photo) continue; // removed while syncing
      if (!photo.storagePath && !photo.uploading) {
        // Mark as in-flight BEFORE the network request so removePhoto sees it
        // and refuses to delete a photo that is mid-upload.
        await merge((r) => {
          const p = r.photos.find((x) => x.localUri === localUri);
          if (p) p.uploading = true;
        });
        photo = rec.photos.find((p) => p.localUri === localUri);

        try {
          const token = state.getToken ? await state.getToken() : null;
          let resolvedPath: string;

          if (photo?.pendingStoragePath) {
            // ── Crash-recovery path ──────────────────────────────────────────
            // A path was reserved in a previous run (Checkpoint A reached) but
            // the process died before Checkpoint C was written.  Probe whether
            // the bytes actually landed so we can skip a redundant PUT.
            const alreadyUploaded = await probeStoragePath(photo.pendingStoragePath, token);
            if (alreadyUploaded) {
              // Object exists — reuse the pre-reserved path, no PUT needed.
              resolvedPath = photo.pendingStoragePath;
            } else {
              // Object wasn't written (died before or during the PUT).
              // Reserve a fresh path and upload.
              const { uploadURL, storagePath: freshPath } = await reserveUploadPath(
                token,
                `inspection-${serverId}-${Date.now()}-${i}.jpg`,
                localUri,
              );
              // Update the stored candidate to the new reservation.
              await merge((r) => {
                const p = r.photos.find((x) => x.localUri === localUri);
                if (p) p.pendingStoragePath = freshPath;
              });
              await doUpload(uploadURL, localUri); // Checkpoint B
              resolvedPath = freshPath;
            }
          } else {
            // ── Normal (first-attempt) path ──────────────────────────────────
            // Reserve the upload path and persist it BEFORE sending any bytes
            // (Checkpoint A).  If the process dies after this write but before
            // Checkpoint C the next launch takes the crash-recovery path above.
            const { uploadURL, storagePath: candidatePath } = await reserveUploadPath(
              token,
              `inspection-${serverId}-${Date.now()}-${i}.jpg`,
              localUri,
            );
            // Checkpoint A: durable marker written before the PUT.
            await merge((r) => {
              const p = r.photos.find((x) => x.localUri === localUri);
              if (p) p.pendingStoragePath = candidatePath;
            });
            await doUpload(uploadURL, localUri); // Checkpoint B
            resolvedPath = candidatePath;
          }

          // Checkpoint C: promote pendingStoragePath → storagePath.
          await merge((r) => {
            const p = r.photos.find((x) => x.localUri === localUri);
            if (p) {
              if (!p.storagePath) p.storagePath = resolvedPath;
              p.pendingStoragePath = undefined;
              p.uploading = false;
            }
          });
          photo = rec.photos.find((p) => p.localUri === localUri);
        } catch (uploadErr) {
          await merge((r) => {
            const p = r.photos.find((x) => x.localUri === localUri);
            if (p) p.uploading = false;
            // pendingStoragePath is intentionally left intact so the next
            // attempt takes the crash-recovery path and probes before retrying.
          });
          throw uploadErr;
        }
      }
      if (photo?.storagePath && photo.mediaRowId == null) {
        const media = await addInspectionMedia(serverId, {
          mediaType: "image",
          url: photo.storagePath,
          // Preserve the timestamp recorded when the photo was captured.
          // Never derive this from upload/registration time (retries may be delayed).
          capturedAt: photo.capturedAt,
          // Vision Platform provenance — where the evidence came from and how
          // the on-device quality gate scored it.
          captureSource: photo.captureSource,
          qualityScore: photo.qualityScore,
          captureMetadata: photo.captureMetadata,
          // Technician-authored note (set during or after capture). Stored as
          // caption on the server so AI analysis and reports can reference it.
          caption: photo.description ?? undefined,
          // Every photo inherits the inspection's active unit context so a
          // multi-family compliance export can trace evidence to an apartment.
          unitNumber: rec.unitNumber ?? null,
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
    const acknowledgedPaths = new Set(
      (rec.analyzedPhotoPaths ?? []).map(canonicalStoragePath),
    );
    if (
      rec.photos.some(
        (p) =>
          p.storagePath != null &&
          !acknowledgedPaths.has(canonicalStoragePath(p.storagePath)),
      )
    ) {
      const uploaded = rec.photos.filter((p) => p.storagePath);
      // Near-duplicate photos are still uploaded and kept as evidence, but
      // excluded from AI analysis to avoid redundant detections and cost.
      // They are acknowledged locally by exact path so the pending-work
      // invariant can settle without sending them to the provider.
      const toAnalyze = uploaded.filter(
        (p) =>
          !p.duplicateOf &&
          p.storagePath != null &&
          !acknowledgedPaths.has(canonicalStoragePath(p.storagePath)),
      );
      let analyzedPaths: string[] = [];
      if (toAnalyze.length > 0) {
        const result = await analyzeInspection({
          inspectionId: serverId,
          images: toAnalyze.map((p) => ({ imageUrl: p.storagePath as string })),
          draft: true,
        });
        analyzedPaths = result.analyzedImagePaths ?? [];
      }
      await merge((r) => {
        const currentPathsByCanonical = new Map(
          r.photos.flatMap((p) =>
            p.storagePath
              ? [[canonicalStoragePath(p.storagePath), p.storagePath] as const]
              : [],
          ),
        );
        const settledPaths = new Set(
          (r.analyzedPhotoPaths ?? []).flatMap((path) => {
            const currentPath = currentPathsByCanonical.get(
              canonicalStoragePath(path),
            );
            return currentPath ? [currentPath] : [];
          }),
        );
        for (const path of analyzedPaths) {
          const currentPath = currentPathsByCanonical.get(
            canonicalStoragePath(path),
          );
          if (currentPath) settledPaths.add(currentPath);
        }
        for (const photo of r.photos) {
          if (photo.duplicateOf && photo.storagePath) {
            settledPaths.add(photo.storagePath);
          }
        }
        // Failed and timed-out paths deliberately remain unsettled. The local
        // pending-work invariant will schedule another sync, while the server
        // reuses successful paths and only calls the provider for failures.
        r.analyzedPhotoPaths = [...settledPaths];
        r.analyzedCount = r.photos.filter(
          (p) => p.storagePath != null && settledPaths.has(p.storagePath),
        ).length;
      });
    }

    // 5. Field sync — notes / pest types may have changed after creation.
    const composedNotes = [
      rec.propertyType ? `Property type: ${rec.propertyType}` : "",
      rec.notes.trim(),
    ]
      .filter(Boolean)
      .join("\n\n");

    // Snapshot the signature revision BEFORE sending so we can detect whether
    // the user mutated signatures while the PATCH was in-flight.  If sigRev
    // changed by the time the round-trip completes we leave signaturesSynced=false
    // and let the next pass pick up the newer state — preventing a concurrent
    // "tap Re-sign" from being silently dropped.
    const sigRevAtSync = rec.sigRev ?? 0;
    // Snapshot unit number state before the PATCH for the same race-guard
    // reason as sigRevAtSync: if the user edits unitNumber mid-flight we
    // leave unitNumberSynced=false so the next pass picks up the newer value.
    const unitNumberAtSync = rec.unitNumber;

    // Build the signature slice of the PATCH body.
    //   • Non-null string  → include normally (new or updated value).
    //   • null + explicit-clear flag → include null so the server wipes its value.
    //     ownerSignature null also needs resignatureConsent: true to bypass the
    //     server's accidental-clear guard.
    //   • null without a clear flag → omit entirely (never captured; don't touch
    //     the server's value, which may have been set by another device).
    const sigPatch: {
      technicianSignature?: string | null;
      ownerSignature?: string | null;
      ownerNotAvailable?: boolean;
      signedAt?: string;
      resignatureConsent?: boolean;
    } = {
      ownerNotAvailable: rec.ownerNotAvailable,
      ...(rec.signedAt != null ? { signedAt: rec.signedAt } : {}),
    };

    if (typeof rec.technicianSignature === "string") {
      sigPatch.technicianSignature = rec.technicianSignature;
    } else if (rec.techSigClear && rec.technicianSignature === null) {
      // Explicit clear: send null so the server wipes its copy.
      sigPatch.technicianSignature = null;
    }

    if (typeof rec.ownerSignature === "string") {
      sigPatch.ownerSignature = rec.ownerSignature;
    } else if (rec.ownerSigConsent && rec.ownerSignature === null) {
      // Explicit clear (owner re-sign or "not available"): send null + consent.
      sigPatch.ownerSignature = null;
      sigPatch.resignatureConsent = true;
    }

    await updateInspection(serverId, {
      notes: composedNotes || undefined,
      pestTypes: rec.pestTypes.length ? rec.pestTypes : undefined,
      // Unit number: always send the current value so the server stays in sync.
      // Sending null explicitly clears any previously stored value.
      unitNumber: rec.unitNumber ?? null,
      ...sigPatch,
    });

    // Acknowledge only if the local state hasn't changed since we built the
    // payload. A changed sigRev means a concurrent mutation won the race;
    // keep signaturesSynced=false so the next pass sends the newer state.
    await merge((r) => {
      if ((r.sigRev ?? 0) === sigRevAtSync) {
        r.signaturesSynced = true;
        r.techSigClear = false;
        r.ownerSigConsent = false;
      }
      // unitNumberSynced: acknowledge if the value hasn't changed since we sent it.
      if (r.unitNumber === unitNumberAtSync) {
        r.unitNumberSynced = true;
      }
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

    // 5.6. #95 — Flush pending finding corrections queued while offline.
    // Each correction is applied one at a time and removed from the queue on
    // success. Errors are caught per-item so a single bad entry (e.g. a stale
    // analysisId) never blocks the rest of the sync pass.
    const corrections = [...(rec.pendingCorrections ?? [])];
    for (const correction of corrections) {
      try {
        await correctFinding(correction.analysisId, {
          findingId:         correction.findingId,
          action:            correction.action,
          technicianSpecies: correction.technicianSpecies,
        });
        await merge((r) => {
          r.pendingCorrections = (r.pendingCorrections ?? []).filter(
            (c) =>
              !(c.analysisId === correction.analysisId &&
                c.findingId  === correction.findingId),
          );
        });
      } catch {
        // Non-fatal: keep correction in queue; sync engine will retry with
        // exponential backoff on the next pass.
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

    // 7. Delivery retry — re-attempt any pending deliveries for channels that
    // support background auto-retry (server-push: SMS gateway, CRM webhook,
    // portal push, etc.). Interactive OS-sheet channels (email, share, print)
    // have supportsAutoRetry === false/undefined and are skipped here; they
    // remain in the queue as a visible indicator on the summary screen so the
    // technician can tap "Retry" when they are ready.
    const pendingDeliveries = rec.pendingDeliveries ?? [];
    if (pendingDeliveries.length > 0) {
      const stillPending: typeof pendingDeliveries = [];
      for (const entry of pendingDeliveries) {
        const method = getDeliveryMethod(entry.methodId);
        if (!method?.supportsAutoRetry) {
          // Interactive or unknown method — leave in queue for manual retry.
          stillPending.push(entry);
          continue;
        }
        try {
          // Server-push methods don't open OS UI and don't need a local PDF.
          await method.deliver({ pdfUri: "", ...entry.context });
          // On success the entry is dropped (not pushed to stillPending).
        } catch {
          // Non-fatal: keep in queue; next sync pass will retry.
          stillPending.push(entry);
        }
      }
      if (stillPending.length !== pendingDeliveries.length) {
        await merge((r) => {
          r.pendingDeliveries = stillPending;
          if (stillPending.length === 0) {
            r.lastDeliveredAt = new Date().toISOString();
          }
        });
      }
    }

    await merge((r) => {
      r.syncError = null;
      r.syncAttempts = 0;
      // Partial AI outcomes remain pending; don't immediately re-request the
      // same unresolved photo via the store subscription or foreground events.
      r.nextSyncAt = hasPendingWork(r)
        ? new Date(Date.now() + 30_000).toISOString()
        : null;
      r.lastSyncSuccess = new Date().toISOString();
    });
    state.onSynced?.(rec);
    return rec;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Sync failed";
    console.error("[Sync] syncOne failed for", record.localId, "—", msg, e);
    await merge((r) => {
      r.syncError = msg;
      r.syncAttempts += 1;
      r.nextSyncAt = new Date(Date.now() + retryDelayMs(e, r.syncAttempts)).toISOString();
    });
    throw e;
  } finally {
    state.syncingIds.delete(record.localId);
    notifyEngine();
  }
}

/**
 * One-shot sync for the OS background-fetch task.
 *
 * Unlike `configureSyncEngine`, this does NOT attach AppState / NetInfo
 * listeners — those make no sense in a background-task context. It simply
 * acquires the single-flight lock, runs a full sync pass with the supplied
 * token getter, and returns whether any work was done.
 *
 * Safe to call from `expo-background-fetch` TaskManager tasks where the JS
 * module state may be a fresh context (state.configured === false).
 */
export async function runBackgroundSync(
  getToken: () => Promise<string | null>,
): Promise<boolean> {
  if (state.running) return false;
  // Inject the token getter so syncOne can authenticate.
  const previousToken = state.getToken;
  state.getToken = getToken;
  state.running = true;
  let didWork = false;
  try {
    const records = (await listLocalInspections()).filter((r) => hasPendingWork(r) && isDue(r));
    if (records.length === 0) return false;
    records.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    for (const record of records) {
      await syncOne(record).catch(() => null);
    }
    didWork = true;
  } finally {
    state.running = false;
    state.getToken = previousToken;
    if (state.configured) await scheduleRetryIfNeeded();
  }
  return didWork;
}

function isDue(record: LocalInspection, now = Date.now()): boolean {
  return !record.nextSyncAt || new Date(record.nextSyncAt).getTime() <= now;
}

/** Exactly one timer for the earliest durable per-inspection deadline. */
async function scheduleRetryIfNeeded() {
  if (state.retryTimer) {
    clearTimeout(state.retryTimer);
    state.retryTimer = null;
  }
  const records = await listLocalInspections();
  const pending = records.filter(hasPendingWork);
  if (pending.length === 0) return;
  const delay = Math.max(0, Math.min(
    ...pending.map((r) => r.nextSyncAt
      ? (new Date(r.nextSyncAt).getTime() || 0) - Date.now()
      : 0),
  ));
  state.retryTimer = setTimeout(() => {
    state.retryTimer = null;
    void syncAll();
  }, delay);
}
