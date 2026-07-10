import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Crypto from "expo-crypto";
import * as FileSystem from "expo-file-system/legacy";

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
  /** Provider/EXIF context, passed through to the server verbatim. */
  captureMetadata?: Record<string, unknown>;
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
    completed: false,
    completedAt: null,
    serverCompleted: false,
    analyzedCount: 0,
    reportId: null,
    syncError: null,
    syncAttempts: 0,
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
  if (record.completed && !record.serverCompleted) return true;
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

function parseRecord(raw: string): LocalInspection | null {
  try {
    const rec = JSON.parse(raw) as LocalInspection;
    if (rec?.schemaVersion !== 1 || typeof rec.localId !== "string") return null;
    return rec;
  } catch {
    return null;
  }
}