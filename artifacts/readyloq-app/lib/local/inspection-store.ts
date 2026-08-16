import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";
import * as FileSystem from "expo-file-system/legacy";

// Lazily resolved so the delivery registry module is not imported at module
// initialisation time (avoids issues with module load order in the RN bundler).
let _getDeliveryMethod: ((id: string) => { supportsAutoRetry?: boolean } | undefined) | null = null;
function getDeliveryMethodLazy(id: string): { supportsAutoRetry?: boolean } | undefined {
  if (!_getDeliveryMethod) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    _getDeliveryMethod = require("@/lib/delivery/registry").getDeliveryMethod as typeof _getDeliveryMethod;
  }
  return _getDeliveryMethod?.(id);
}

/**
 * Local-first inspection store — the single source of truth for in-progress
 * and pending-sync inspections on this device.
 *
 * Guarantees:
 *  - Every mutation is persisted immediately (AsyncStorage record + index),
 *    so process death, backgrounding, folding, or restart never lose work.
 *  - Photos are copied OUT of the camera cache into documentDirectory the
 *    moment they are captured — the OS may purge cache at any time.
 *  - `localId` doubles as the server idempotency `clientKey`, so sync retries
 *    can never create duplicate server inspections.
 */

/**
 * Bait station as stored locally — superset of the UI BaitStation type, adding
 * the server row id so the sync engine can PATCH instead of double-creating.
 */
export type LocalBaitStation = {
  /** Client-generated UUID — stable identifier for UI keying. */
  id: string;
  label: string;
  locationType?: string;
  status: "active" | "missing" | "damaged" | "removed";
  notes?: string;
  lastCheckedAt?: string;
  /** Server row id once synced via POST /inspections/:id/bait-stations. */
  serverId?: number;
};

export type LocalPhoto = {
  /** Durable file:// URI under documentDirectory — always renderable. */
  localUri: string;
  capturedAt: string;
  /** `/api/storage/...` path once uploaded (sync step 2). */
  storagePath?: string;
  /** Server media row id once registered (sync step 3). */
  mediaRowId?: number;
  /** Vision Platform provenance: which provider produced this evidence. */
  captureSource?: string;
  /** 0–100 score from the on-device quality gate (absent = ungated). */
  qualityScore?: number;
  /** 64-bit perceptual (dHash) hex — computed off the capture path. */
  perceptualHash?: string;
  /** localUri of an earlier near-identical photo when this is a likely dup. */
  duplicateOf?: string;
  /** Provider/EXIF context, passed through to the server verbatim. */
  captureMetadata?: Record<string, unknown>;
  /**
   * Technician-authored description for this photo — added manually when AI
   * has not yet run or when the tech wants to add specific context that the
   * model may not capture (room label, station number, customer concern, etc.).
   */
  description?: string;
  /**
   * True while the sync engine is actively uploading this photo to object
   * storage (between the network request start and the `storagePath` write).
   * Checked by `removePhoto` to prevent deleting a photo that is mid-flight,
   * which would orphan the uploaded file without a local or server record.
   */
  uploading?: boolean;
  /**
   * Durable pre-upload marker: the `/api/storage/...` path reserved via
   * `requestUploadUrl` BEFORE the PUT bytes are sent. Written to AsyncStorage
   * in the same merge step as setting `uploading: true`, so a crash between the
   * URL-reservation call and the actual PUT (or between the PUT and the
   * `storagePath` promotion) can be detected and handled on the next launch:
   *
   *   - pendingStoragePath set + storagePath null → upload was started; probe
   *     the object URL to decide whether to skip re-upload or upload to a new path.
   *   - Promoted to storagePath on success, then cleared.
   *
   * Never cleared on app restart (unlike `uploading`) — it is the crash-recovery
   * anchor that prevents double-uploading the same bytes.
   */
  pendingStoragePath?: string;
};

export type LocalSyncPhase =
  | "waiting" // has unsynced work, no connection / not yet attempted
  | "syncing" // engine is actively pushing this inspection
  | "synced" // everything acknowledged by the server
  | "failed"; // last attempt errored; will retry (manual or automatic)

export type LocalInspection = {
  schemaVersion: 1;
  /** UUID — also sent as the server `clientKey` for idempotent creation. */
  localId: string;
  serverId: number | null;
  createdAt: string;
  updatedAt: string;

  siteAddress: string;
  clientName: string;
  technicianName: string;
  propertyType: string;
  pestTypes: string[];
  notes: string;
  photos: LocalPhoto[];
  /**
   * Bait stations logged during this inspection.
   * Persisted here so a crash or resume never loses station data.
   * `serverId` on each station tracks what has been synced to the server.
   */
  baitStations: LocalBaitStation[];

  /** Technician tapped "Complete Inspection" (possibly offline). */
  completed: boolean;
  completedAt: string | null;
  /** POST /inspections/:id/complete acknowledged by the server. */
  serverCompleted: boolean;
  /** Number of photos included in the last draft analysis run. */
  analyzedCount: number;
  /** Live report id, if one was built during capture. */
  reportId: number | null;

  syncError: string | null;
  syncAttempts: number;
  /** ISO timestamp of last successful server sync (any step). */
  lastSyncSuccess: string | null;
  /**
   * RLQ-008: true once the technician has reviewed (accepted/corrected/dismissed)
   * every AI finding from the latest draft analysis. Defaults to false.
   * Completion is gated on this being true, or there being no findings to review.
   */
  allFindingsReviewed: boolean;
  /**
   * RLQ-001: pending finding corrections to push to the server.
   * Each entry is applied via PATCH /api/analysis/:id/findings/correct and
   * removed from this queue once the server acknowledges it.
   */
  pendingCorrections: Array<{
    analysisId: number;
    findingId: number;
    action: "accept" | "correct" | "dismiss";
    technicianSpecies?: string;
  }>;
  /**
   * ISO timestamp of the last time this inspection's report was successfully
   * delivered via any channel (print, share, email). Null until first delivery.
   * Updated by the delivery section on every successful hand-off.
   */
  lastDeliveredAt: string | null;
  /**
   * Delivery attempts that failed (e.g. offline, weak signal, OS error) and
   * are waiting for the technician to retry or, for server-push channels, for
   * the sync engine to auto-retry on reconnection.
   *
   * Each entry records the delivery channel and enough context to rebuild the
   * delivery (subject, body, customerSummaryUrl) — the PDF is regenerated
   * fresh on retry since it is never persisted to disk.
   */
  pendingDeliveries: Array<{
    /** Delivery method id (matches DeliveryMethod.id in the registry). */
    methodId: string;
    /** Human-readable label for the UI indicator. */
    label: string;
    /** ISO timestamp when the failed attempt was queued. */
    queuedAt: string;
    /** Delivery context minus pdfUri (regenerated on retry). */
    context: {
      subject: string;
      body: string;
      customerSummaryUrl: string | null;
    };
  }>;
};

const INDEX_KEY = "readyloq.local-inspections.index.v1";
const RECORD_PREFIX = "readyloq.local-inspection.v1.";

const recordKey = (localId: string) => `${RECORD_PREFIX}${localId}`;

const photosDir = (localId: string) =>
  `${FileSystem.documentDirectory}inspections/${localId}/photos/`;

// ─── Change notifications (drives sync-status UI + engine wakeups) ──────────

type Listener = () => void;
const listeners = new Set<Listener>();

export function subscribeLocalInspections(cb: Listener): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

function notify() {
  for (const cb of listeners) {
    try {
      cb();
    } catch {
      // A broken listener must never block persistence.
    }
  }
}

// ─── CRUD ────────────────────────────────────────────────────────────────────

export function newLocalInspection(
  fields: Pick<
    LocalInspection,
    "siteAddress" | "clientName" | "technicianName" | "propertyType" | "pestTypes" | "notes"
  >,
): LocalInspection {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    localId: Crypto.randomUUID(),
    serverId: null,
    createdAt: now,
    updatedAt: now,
    ...fields,
    photos: [],
    baitStations: [],
    completed: false,
    completedAt: null,
    serverCompleted: false,
    analyzedCount: 0,
    reportId: null,
    syncError: null,
    syncAttempts: 0,
    lastSyncSuccess: null,
    allFindingsReviewed: false,
    pendingCorrections: [],
    lastDeliveredAt: null,
    pendingDeliveries: [],
  };
}

export async function saveLocalInspection(record: LocalInspection): Promise<void> {
  record.updatedAt = new Date().toISOString();
  await AsyncStorage.setItem(recordKey(record.localId), JSON.stringify(record));
  const index = await readIndex();
  if (!index.includes(record.localId)) {
    index.push(record.localId);
    await AsyncStorage.setItem(INDEX_KEY, JSON.stringify(index));
  }
  notify();
}

export async function getLocalInspection(localId: string): Promise<LocalInspection | null> {
  const raw = await AsyncStorage.getItem(recordKey(localId));
  if (!raw) return null;
  return parseRecord(raw);
}

// All read-modify-write cycles are serialized through this chain so
// concurrent writers (capture UI + sync engine) always mutate a fresh copy —
// a stale whole-record save can never clobber the other side's fields.
let updateChain: Promise<unknown> = Promise.resolve();

/**
 * Atomically update a record: reads the freshest copy, applies `mutate`,
 * saves. Returns the updated record, or null if it no longer exists.
 * This is the ONLY safe way to write once a record may have two writers.
 */
export function updateLocalInspection(
  localId: string,
  mutate: (record: LocalInspection) => void,
): Promise<LocalInspection | null> {
  const task = async (): Promise<LocalInspection | null> => {
    const record = await getLocalInspection(localId);
    if (!record) return null;
    mutate(record);
    await saveLocalInspection(record);
    return record;
  };
  const result = updateChain.then(task, task);
  updateChain = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

/**
 * Update the technician description for a single photo.
 * Uses the serialised update chain so it is safe to call concurrently with
 * other mutations (e.g. the sync engine writing `storagePath`).
 */
export function updatePhotoDescription(
  localId: string,
  photoLocalUri: string,
  description: string,
): Promise<LocalInspection | null> {
  return updateLocalInspection(localId, (r) => {
    const photo = r.photos.find((p) => p.localUri === photoLocalUri);
    if (photo) photo.description = description.trim() || undefined;
  });
}

export async function listLocalInspections(): Promise<LocalInspection[]> {
  const index = await readIndex();
  if (index.length === 0) return [];
  const pairs = await AsyncStorage.multiGet(index.map(recordKey));
  const records: LocalInspection[] = [];
  for (const [, raw] of pairs) {
    if (!raw) continue;
    const rec = parseRecord(raw);
    if (rec) records.push(rec);
  }
  records.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return records;
}

/** Delete the record, its index entry, and every photo file. */
export async function deleteLocalInspection(localId: string): Promise<void> {
  try {
    await FileSystem.deleteAsync(`${FileSystem.documentDirectory}inspections/${localId}`, {
      idempotent: true,
    });
  } catch {
    // File cleanup is best-effort; the record removal below is what matters.
  }
  await AsyncStorage.removeItem(recordKey(localId));
  const index = await readIndex();
  const next = index.filter((id) => id !== localId);
  if (next.length !== index.length) {
    await AsyncStorage.setItem(INDEX_KEY, JSON.stringify(next));
  }
  notify();
}

/**
 * Copy a freshly captured photo out of the camera cache into this
 * inspection's durable directory. Returns the durable file:// URI.
 * MUST be called at capture time — cache URIs do not survive restarts.
 */
export async function persistPhoto(localId: string, cacheUri: string): Promise<string> {
  const dir = photosDir(localId);
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});
  const ext = cacheUri.includes(".") ? cacheUri.slice(cacheUri.lastIndexOf(".")) : ".jpg";
  const dest = `${dir}${Date.now()}-${Crypto.randomUUID().slice(0, 8)}${ext}`;
  await FileSystem.copyAsync({ from: cacheUri, to: dest });
  return dest;
}

/**
 * Derive the user-facing sync phase for a record.
 * `syncingIds` comes from the sync engine (which inspections it is pushing now).
 */
export function syncPhase(record: LocalInspection, syncingIds: ReadonlySet<string>): LocalSyncPhase {
  if (syncingIds.has(record.localId)) return "syncing";
  if (!hasPendingWork(record)) return "synced";
  if (record.syncError) return "failed";
  return "waiting";
}

/** True when anything on this record still needs to reach the server. */
export function hasPendingWork(record: LocalInspection): boolean {
  if (record.serverId == null) return true;
  if (record.photos.some((p) => !p.storagePath || p.mediaRowId == null)) return true;
  if (record.photos.length > record.analyzedCount) return true;
  // #95 — pending finding corrections queued while offline
  if ((record.pendingCorrections ?? []).length > 0) return true;
  if (record.completed && !record.serverCompleted) return true;
  // Pending deliveries that support background auto-retry (server-push channels)
  // keep the record in the sync scheduler so reconnection triggers the retry.
  // Interactive-only channels (email, share, print) are NOT counted here —
  // they require the technician to tap Retry and must not prevent the inspection
  // from reaching "synced" status.
  if (
    (record.pendingDeliveries ?? []).some(
      (d) => getDeliveryMethodLazy(d.methodId)?.supportsAutoRetry === true,
    )
  ) {
    return true;
  }
  return false;
}

// ─── Internals ───────────────────────────────────────────────────────────────

async function readIndex(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(INDEX_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Append a delivery entry to the pending queue, deduplicating by `methodId`.
 * Pure function — the only place the queue is grown, so the no-duplicates
 * invariant is enforced in exactly one spot and is trivially unit-testable.
 */
export function enqueueDelivery(
  pending: LocalInspection["pendingDeliveries"],
  entry: LocalInspection["pendingDeliveries"][number],
): LocalInspection["pendingDeliveries"] {
  if (pending.some((d) => d.methodId === entry.methodId)) return pending;
  return [...pending, entry];
}

/**
 * Parse and migrate a raw JSON string from AsyncStorage into a LocalInspection.
 * Exported for unit testing the schema-migration defaults.
 * All new optional fields must be defaulted here so old records hydrate cleanly.
 */
export function parseRecord(raw: string): LocalInspection | null {
  try {
    const rec = JSON.parse(raw) as LocalInspection;
    if (rec?.schemaVersion !== 1 || typeof rec.localId !== "string") return null;
    rec.lastSyncSuccess ??= null;
    rec.allFindingsReviewed ??= false;
    rec.pendingCorrections ??= [];
    rec.baitStations ??= [];
    rec.lastDeliveredAt ??= null;
    rec.pendingDeliveries ??= [];
    // Reset any `uploading: true` flags that survived a crash.
    // The sync engine sets `uploading: true` + `pendingStoragePath` in the same
    // atomic merge BEFORE the PUT bytes are sent, then promotes `pendingStoragePath`
    // → `storagePath` after a successful upload.  If the process died while the
    // flag was set, the photo would be permanently stuck (never re-attempted because
    // the upload guard checks `!uploading`).  Clearing the flag on every hydration
    // lets the engine retry the photo; `pendingStoragePath` (intentionally NOT reset
    // here) tells the engine whether a storage path was already reserved so it can
    // probe for the object before deciding to re-upload or reuse.
    if (rec.photos) {
      for (const p of rec.photos) {
        if (p.uploading) p.uploading = false;
      }
    }
    return rec;
  } catch {
    return null;
  }
}