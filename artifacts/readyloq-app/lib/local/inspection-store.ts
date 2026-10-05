import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";
import * as FileSystem from "expo-file-system/legacy";
import { createSanitizedPhotoCopy } from "@/lib/privacy/image-sanitizer";

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
  latitude?: string;
  longitude?: string;
  status: "active" | "missing" | "damaged" | "removed";
  notes?: string;
  lastCheckedAt?: string;
  /** Server row id once synced via POST /inspections/:id/bait-stations. */
  serverId?: number;
  /** Persisted client idempotency key for a crash-safe create retry. */
  clientKey?: string;
  /** Immutable first-POST body; retries replay it even after local edits. */
  createPayload?: LocalBaitStationCreatePayload;
  /** False until the latest local station state is acknowledged by the server. */
  synced?: boolean;
};

export type LocalBaitStationCreatePayload = {
  label: string;
  locationType?: string;
  latitude?: string;
  longitude?: string;
  status: LocalBaitStation["status"];
  notes?: string;
  lastCheckedAt?: string;
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
  /** Provider and non-location EXIF/calibration context. */
  captureMetadata?: Record<string, unknown>;
  /** True only after an orientation-preserving, metadata-free JPEG copy exists. */
  privacySanitized?: boolean;
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
  /** Stable key used to recover the server reservation after an ambiguous response. */
  uploadIntentKey?: string;
  /** Authenticated server reservation bound to this photo and inspection. */
  uploadIntentId?: number;
};

export type LocalSyncPhase =
  | "waiting" // has unsynced work, no connection / not yet attempted
  | "syncing" // engine is actively pushing this inspection
  | "synced" // everything acknowledged by the server
  | "failed"; // last attempt errored; will retry (manual or automatic)

export type LocalInspection = {
  schemaVersion: 1;
  /**
   * Clerk subject that owns this offline record. Missing/null values are legacy
   * records and are deliberately not claimed automatically by the next login.
   */
  ownerUserId: string | null;
  /**
   * Active tenant at capture time. Missing means a legacy company-unscoped
   * record; explicit null is a valid no-company scope (e.g. Super Admin).
   */
  companyId?: number | null;
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
  /** Number of current photos acknowledged for AI analysis (legacy UI field). */
  analyzedCount: number;
  /**
   * Exact uploaded storage paths acknowledged by AI analysis. This is the
   * durable sync cursor; unlike analyzedCount it remains correct when photos
   * are added, removed, or reordered between retries.
   */
  analyzedPhotoPaths: string[];
  /** Live report id, if one was built during capture. */
  reportId: number | null;

  syncError: string | null;
  syncAttempts: number;
  /** Durable earliest retry time, shared by foreground/background after restart. */
  nextSyncAt?: string | null;
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
   * Unit / apartment number for multi-family properties.
   * Set at booking time (from the portal) or by the technician in the
   * signature panel. Null for single-family or commercial properties.
   */
  unitNumber: string | null;
  /**
   * True once the current unitNumber has been PATCHed to the server.
   * Set false by InspectionSignaturePanel when the technician edits the unit
   * number so the sync engine re-queues the record even after serverCompleted.
   * Defaults to true via parseRecord so old records are not unnecessarily
   * re-synced.
   */
  unitNumberSynced: boolean;
  /**
   * Freeform reason for the visit (e.g. "Routine Inspection", "Callback"),
   * picked by the technician when booking. Sent once at creation time — like
   * notes/pestTypes/clientName, it has no separate "synced" flag. Null when
   * not set (older records, or the technician skipped the picker).
   */
  visitPurpose: string | null;

  /**
   * On-site signature data (SVG strings captured by InspectionSignaturePanel).
   * ownerNotAvailable is set when the owner/tenant was absent and the
   * technician signed on their behalf. signedAt records the first signature.
   */
  technicianSignature: string | null;
  ownerSignature: string | null;
  ownerNotAvailable: boolean;
  signedAt: string | null;
  /**
   * Monotonically incrementing counter bumped by InspectionSignaturePanel on
   * every local mutation.  The sync engine captures this value before sending
   * the PATCH; it only clears signaturesSynced when the counter still matches
   * after the round-trip, preventing a concurrent mutation from being silently
   * lost in a race between "PATCH in-flight" and "user taps Re-sign".
   */
  sigRev: number;
  /**
   * Set true when the technician explicitly clears their own signature so the
   * sync engine knows to send technicianSignature: null (rather than omitting
   * the field, which would leave the server's value untouched).
   */
  techSigClear: boolean;
  /**
   * Set true when the owner signature is intentionally nulled — either by
   * clearSignature("owner") or markOwnerNotAvailable — so the sync engine
   * sends ownerSignature: null + resignatureConsent: true.  Without this flag
   * the engine omits null fields to avoid accidentally wiping server data.
   */
  ownerSigConsent: boolean;
  /**
   * True once all current signature data has been PATCHed to the server.
   * Set false by InspectionSignaturePanel on every local mutation so the
   * sync engine re-queues the record even after serverCompleted = true.
   * Defaults to true via parseRecord so old records are not re-synced.
   */
  signaturesSynced: boolean;

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
let activeOwnerUserId: string | null = null;
let activeCompanyId: number | null = null;

/** Bind local reads/writes to the authenticated subject and active tenant. */
export function setLocalInspectionScope(
  userId: string | null,
  companyId: number | null,
): void {
  activeOwnerUserId = userId;
  activeCompanyId = companyId;
  notify();
}

/** Compatibility helper for unscoped unit fixtures; production uses tenant scope. */
export function setLocalInspectionOwner(userId: string | null): void {
  setLocalInspectionScope(userId, null);
}

export function getLocalInspectionOwner(): string | null {
  return activeOwnerUserId;
}

export function getLocalInspectionCompanyId(): number | null {
  return activeCompanyId;
}

const photosDir = (localId: string) =>
  `${FileSystem.documentDirectory}inspections/${localId}/photos/`;

/**
 * Canonical identity used only for comparing storage paths across API
 * boundaries. Mobile URLs include `/api/storage`; analysis responses omit it.
 */
export function canonicalStoragePath(path: string): string {
  return path.startsWith("/api/storage/")
    ? path.slice("/api/storage".length)
    : path;
}

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
  > &
    Partial<Pick<LocalInspection, "unitNumber" | "visitPurpose">>,
): LocalInspection {
  const now = new Date().toISOString();
  return {
    schemaVersion: 1,
    ownerUserId: activeOwnerUserId,
    ...(activeOwnerUserId ? { companyId: activeCompanyId } : {}),
    localId: Crypto.randomUUID(),
    serverId: null,
    createdAt: now,
    updatedAt: now,
    ...fields,
    visitPurpose: fields.visitPurpose ?? null,
    photos: [],
    baitStations: [],
    completed: false,
    completedAt: null,
    serverCompleted: false,
    analyzedCount: 0,
    analyzedPhotoPaths: [],
    reportId: null,
    syncError: null,
    syncAttempts: 0,
    nextSyncAt: null,
    lastSyncSuccess: null,
    allFindingsReviewed: false,
    pendingCorrections: [],
    lastDeliveredAt: null,
    pendingDeliveries: [],
    unitNumber: fields.unitNumber ?? null,
    // New record: nothing to sync yet.
    unitNumberSynced: true,
    technicianSignature: null,
    ownerSignature: null,
    ownerNotAvailable: false,
    signedAt: null,
    sigRev: 0,
    techSigClear: false,
    ownerSigConsent: false,
    // New record: no signatures yet, nothing to sync.
    signaturesSynced: true,
  };
}

export async function saveLocalInspection(record: LocalInspection): Promise<void> {
  const ownerUserId = activeOwnerUserId;
  if (!ownerUserId) {
    throw new Error("Cannot save an offline inspection without an authenticated owner");
  }
  const key = recordKey(record.localId);
  const existingRaw = await AsyncStorage.getItem(key);
  if (existingRaw) {
    const existing = parseRecord(existingRaw);
    if (
      !existing ||
      existing.ownerUserId !== ownerUserId ||
      existing.companyId === undefined ||
      existing.companyId !== activeCompanyId
    ) {
      throw new Error("Cannot modify an offline inspection owned by another or unknown account/company");
    }
  } else {
    // Only a genuinely new record may acquire an owner. Never adopt a record
    // found through a stale object after its stored copy was removed.
    record.ownerUserId = ownerUserId;
    record.companyId = activeCompanyId;
  }
  if (
    record.ownerUserId !== ownerUserId ||
    record.companyId === undefined ||
    record.companyId !== activeCompanyId ||
    activeOwnerUserId !== ownerUserId
  ) {
    throw new Error("Offline inspection owner/company changed before save");
  }
  record.updatedAt = new Date().toISOString();
  await AsyncStorage.setItem(key, JSON.stringify(record));
  const index = await readIndex();
  if (!index.includes(record.localId)) {
    index.push(record.localId);
    await AsyncStorage.setItem(INDEX_KEY, JSON.stringify(index));
  }
  notify();
}

export async function getLocalInspection(localId: string): Promise<LocalInspection | null> {
  const ownerUserId = activeOwnerUserId;
  const companyId = activeCompanyId;
  if (!ownerUserId) return null;
  const raw = await AsyncStorage.getItem(recordKey(localId));
  if (activeOwnerUserId !== ownerUserId || activeCompanyId !== companyId) return null;
  if (!raw) return null;
  const record = parseRecord(raw);
  return record?.ownerUserId === ownerUserId &&
    record.companyId !== undefined &&
    record.companyId === companyId
    ? record
    : null;
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
    const previousStations = new Map(
      (record.baitStations ?? []).map((station) => [
        station.id,
        JSON.stringify([
          station.label,
          station.locationType,
          station.latitude,
          station.longitude,
          station.status,
          station.notes,
          station.lastCheckedAt,
        ]),
      ]),
    );
    mutate(record);
    for (const station of record.baitStations ?? []) {
      const previousState = previousStations.get(station.id);
      const currentState = JSON.stringify([
        station.label,
        station.locationType,
        station.latitude,
        station.longitude,
        station.status,
        station.notes,
        station.lastCheckedAt,
      ]);
      if (previousState !== currentState) station.synced = false;
    }
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
  const ownerUserId = activeOwnerUserId;
  const companyId = activeCompanyId;
  if (!ownerUserId) return [];
  const index = await readIndex();
  if (index.length === 0) return [];
  const pairs = await AsyncStorage.multiGet(index.map(recordKey));
  if (activeOwnerUserId !== ownerUserId || activeCompanyId !== companyId) return [];
  const records: LocalInspection[] = [];
  for (const [, raw] of pairs) {
    if (!raw) continue;
    const rec = parseRecord(raw);
    if (
      rec?.ownerUserId === ownerUserId &&
      rec.companyId !== undefined &&
      rec.companyId === companyId
    ) records.push(rec);
  }
  records.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return records;
}

/** Delete the record, its index entry, and every photo file. */
export async function deleteLocalInspection(localId: string): Promise<void> {
  const ownerUserId = activeOwnerUserId;
  const companyId = activeCompanyId;
  if (!ownerUserId || !(await getLocalInspection(localId))) return;
  if (activeOwnerUserId !== ownerUserId || activeCompanyId !== companyId) return;
  try {
    await FileSystem.deleteAsync(`${FileSystem.documentDirectory}inspections/${localId}`, {
      idempotent: true,
    });
  } catch {
    // File cleanup is best-effort; the record removal below is what matters.
  }
  if (activeOwnerUserId !== ownerUserId || activeCompanyId !== companyId) return;
  await AsyncStorage.removeItem(recordKey(localId));
  const index = await readIndex();
  const next = index.filter((id) => id !== localId);
  if (next.length !== index.length) {
    await AsyncStorage.setItem(INDEX_KEY, JSON.stringify(next));
  }
  notify();
}

/**
 * Re-encode a freshly captured photo without image metadata directly into this
 * inspection's durable directory. Raw camera/import bytes are never persisted
 * as the retry source. MUST be called at capture time.
 */
export async function persistPhoto(localId: string, cacheUri: string): Promise<string> {
  const dir = photosDir(localId);
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});
  const dest = `${dir}${Date.now()}-${Crypto.randomUUID().slice(0, 8)}.jpg`;
  return createSanitizedPhotoCopy(cacheUri, dest);
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
  const acknowledgedPaths = new Set(
    (record.analyzedPhotoPaths ?? []).map(canonicalStoragePath),
  );
  if (
    record.photos.some(
      (p) =>
        p.storagePath != null &&
        !acknowledgedPaths.has(canonicalStoragePath(p.storagePath)),
    )
  ) {
    return true;
  }
  // #95 — pending finding corrections queued while offline
  if ((record.pendingCorrections ?? []).length > 0) return true;
  if ((record.baitStations ?? []).some((station) => station.synced === false)) return true;
  if (record.completed && !record.serverCompleted) return true;
  // Signatures captured after the initial sync (e.g. at the summary screen)
  // must be pushed even when serverCompleted is already true.
  if (record.signaturesSynced === false) return true;
  // Unit number edited in the signature panel after the initial sync.
  if (record.unitNumberSynced === false) return true;
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
    // Do not infer ownership from the currently signed-in account. This keeps
    // pre-ownership records inaccessible until an explicit recovery workflow exists.
    rec.ownerUserId = typeof rec.ownerUserId === "string" ? rec.ownerUserId : null;
    if (
      rec.companyId !== undefined &&
      rec.companyId !== null &&
      (typeof rec.companyId !== "number" || !Number.isFinite(rec.companyId))
    ) {
      rec.companyId = undefined;
    }
    rec.lastSyncSuccess ??= null;
    rec.nextSyncAt ??= null;
    rec.allFindingsReviewed ??= false;
    rec.pendingCorrections ??= [];
    rec.baitStations ??= [];
    for (const station of rec.baitStations) {
      // Legacy stations with a server row were already acknowledged; stations
      // without one remain pending so interrupted creates are retried.
      station.synced ??= station.serverId != null;
    }
    rec.lastDeliveredAt ??= null;
    rec.pendingDeliveries ??= [];
    rec.technicianSignature ??= null;
    rec.ownerSignature ??= null;
    rec.ownerNotAvailable ??= false;
    rec.signedAt ??= null;
    // sigRev: 0 on old records — any new mutation will bump it above 0.
    rec.sigRev ??= 0;
    // Default false: no explicit clear pending on old records.
    rec.techSigClear ??= false;
    rec.ownerSigConsent ??= false;
    // Default true so pre-existing completed records are not unnecessarily
    // re-synced. Only explicitly set to false by InspectionSignaturePanel.
    rec.signaturesSynced ??= true;
    // Unit number: default null and synced on old records.
    rec.unitNumber ??= null;
    rec.unitNumberSynced ??= true;
    // Counts cannot be mapped safely back to paths after a photo list was
    // edited or reordered. Legacy records therefore restart path
    // acknowledgement from an empty set. The server deduplicates already
    // successful analysis, making this conservative migration safe.
    if (!Array.isArray(rec.analyzedPhotoPaths)) {
      rec.analyzedPhotoPaths = [];
    } else {
      rec.analyzedPhotoPaths = rec.analyzedPhotoPaths.filter(
        (path): path is string => typeof path === "string",
      );
    }
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