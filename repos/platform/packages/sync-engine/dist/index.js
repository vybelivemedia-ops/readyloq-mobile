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
/**
 * Default debounce window matching the canonical ReadyLoq implementation.
 * `requestSync()` coalesces rapid local mutations before starting a network pass.
 */
export const DEFAULT_DEBOUNCE_MS = 1_200;
export const DEFAULT_RETRY_POLICY = {
    /**
     * 0 = no hard cap — the engine backs off indefinitely.
     * The canonical implementation does not enforce a maximum attempt count;
     * it retries until the entity syncs or is explicitly cancelled.
     * Set a positive value to cap retries in environments where stale records
     * should eventually be abandoned (e.g. a background job with a TTL).
     */
    maxAttempts: 0,
    /**
     * Canonical formula: Math.min(10_000 * 2^(max(attempts-1, 0)), 300_000)
     * First retry fires at ~10 s, doubling each time until the 5-minute ceiling.
     */
    baseDelayMs: 10_000,
    multiplier: 2,
    maxDelayMs: 300_000,
};
