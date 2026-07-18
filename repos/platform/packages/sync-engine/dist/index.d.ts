/**
 * @platform/sync-engine
 *
 * Offline-first sync engine extracted from readyloq-mobile.
 *
 * CANONICAL SOURCE:
 *   repos/readyloq-mobile/artifacts/readyloq-app/lib/sync/engine.ts
 *     — SyncEngine: debounced flush, single-flight guard, exponential backoff
 *     — 6-step resumable pipeline: load → diff → upload → patch → reconcile → commit
 *   repos/readyloq-mobile/artifacts/readyloq-app/lib/local/inspection-store.ts
 *     — LocalStore: AsyncStorage + atomic RMW (read-modify-write) chain
 *
 * VYBE LIVE has no offline sync — it is a cloud-first streaming app that
 * requires network connectivity. This package is ReadyLoq-only for now.
 * VYBE could adopt it in future for e.g. draft-stream editing offline.
 *
 * GENERALISATION NEEDED (before extraction):
 *   1. Make the entity type generic (currently hardcoded to Inspection).
 *      Extract to SyncEngine<T extends SyncableEntity>.
 *   2. Decouple LocalStore from AsyncStorage — accept a KV adapter so web
 *      apps can use IndexedDB and server-side code can use Postgres.
 *   3. Make the 6-step pipeline configurable — some entities may not need
 *      the upload step (pure metadata sync).
 *   4. Replace the upload step's dependency on expo-file-system with an
 *      injected FileUploader interface (storage-core provides one).
 *
 * DEPENDENCY GRAPH:
 *   sync-engine → shared-types
 *   sync-engine does NOT depend on storage-core — the caller wires them
 *   together by passing a FileUploader to the engine constructor.
 */
import type { SyncRecord } from "@platform/shared-types";
/**
 * Any entity managed by the sync engine must implement this interface.
 * ReadyLoq's Inspection is the reference implementation.
 */
export interface SyncableEntity {
    id: string;
    updatedAt: string;
}
/**
 * Pluggable key-value store. Implementations:
 *   - AsyncStorage adapter (React Native / Expo — current ReadyLoq impl)
 *   - IndexedDB adapter  (web)
 *   - Postgres adapter   (server-side / tests)
 *   - MemoryAdapter      (unit tests — synchronous in-process)
 */
export interface KVAdapter {
    get<T>(key: string): Promise<T | null>;
    set<T>(key: string, value: T): Promise<void>;
    delete(key: string): Promise<void>;
    listKeys(prefix: string): Promise<string[]>;
}
/**
 * Injected into SyncEngine to handle binary evidence uploads.
 * storage-core's ObjectStorageService satisfies this interface.
 */
export interface FileUploader {
    upload(localUri: string, remotePath: string, mimeType: string): Promise<{
        url: string;
    }>;
}
/**
 * The 6-step resumable pipeline. Each step is idempotent — on retry the engine
 * skips steps whose checkpoint is already persisted in the local KV store.
 *
 *  load        — read the local entity and its pending diff from the KV store.
 *  diff        — compute what has changed since the last successful sync.
 *  upload      — push binary evidence files to object storage.
 *  patch       — PATCH the server with the entity delta.
 *  reconcile   — merge any server-side changes back into the local store.
 *  commit      — mark the sync record as complete, clear the pending diff.
 */
export type SyncPipelineStep = "load" | "diff" | "upload" | "patch" | "reconcile" | "commit";
export interface SyncCheckpoint {
    entityId: string;
    completedSteps: SyncPipelineStep[];
    partialUploadUrls?: Record<string, string>;
}
export interface RetryPolicy {
    /** Maximum attempts before the record is marked "error". */
    maxAttempts: number;
    /** Base delay in ms for exponential backoff. */
    baseDelayMs: number;
    /** Backoff multiplier (ReadyLoq uses 2×). */
    multiplier: number;
    /** Hard ceiling on backoff delay. */
    maxDelayMs: number;
}
/**
 * Default debounce window matching the canonical ReadyLoq implementation.
 * `requestSync()` coalesces rapid local mutations before starting a network pass.
 */
export declare const DEFAULT_DEBOUNCE_MS = 1200;
export declare const DEFAULT_RETRY_POLICY: RetryPolicy;
export interface SyncEngineOptions<T extends SyncableEntity> {
    kv: KVAdapter;
    uploader: FileUploader;
    retryPolicy?: RetryPolicy;
    /** Called with the entity delta to PATCH the server. */
    patchRemote: (entity: T) => Promise<T>;
    /** Called after reconcile to fetch the latest server state. */
    fetchRemote: (entityId: string) => Promise<T>;
    /** Debounce window — flush is deferred this many ms after the last change. */
    debounceMs?: number;
}
/**
 * The platform sync engine.
 *
 * Usage:
 *   const engine = new SyncEngine({
 *     kv:           new AsyncStorageAdapter(),
 *     uploader:     objectStorageService,
 *     patchRemote:  (inspection) => api.patch(inspection),
 *     fetchRemote:  (id) => api.get(id),
 *   });
 *   engine.enqueue(inspection);     // debounced — triggers flush after idle
 *   await engine.flushNow();        // force immediate sync (e.g. app-to-background)
 *   engine.destroy();               // cancel timers / in-flight requests
 */
export interface SyncEngine<T extends SyncableEntity> {
    /** Enqueue an entity for sync. Starts the debounce timer. */
    enqueue(entity: T): void;
    /** Bypass the debounce and sync all pending entities immediately. */
    flushNow(): Promise<void>;
    /** Get the current SyncRecord for an entity (for UI status display). */
    getRecord(entityId: string): SyncRecord | undefined;
    /** Subscribe to sync record updates. Returns unsubscribe function. */
    subscribe(listener: (record: SyncRecord) => void): () => void;
    /** Cancel all timers and abort in-flight requests. */
    destroy(): void;
}
//# sourceMappingURL=index.d.ts.map