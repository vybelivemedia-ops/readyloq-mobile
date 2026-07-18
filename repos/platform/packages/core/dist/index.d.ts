/**
 * @platform/core
 *
 * Universal programming-model primitives. The lowest node in the platform DAG.
 *
 * RULES (enforced by CI lint — see ADR-015):
 *   1. ZERO external dependencies — not even other @platform/* packages.
 *   2. NO domain types — no "inspection", "evidence", "stream", "pest",
 *      "clip", "creator", "property", "agora", or any product-specific string.
 *   3. PURELY structural — interface / type / branded primitive only.
 *      No class implementations. No runtime logic.
 *   4. STABLE API — adding exports is backward-compatible; removing is breaking.
 *
 * CONSUMING PATTERN:
 *   Every other @platform/* package imports from here.
 *   Applications import from domain packages — they should rarely import
 *   @platform/core directly.
 */
/**
 * A discriminated union representing either a successful value or a typed
 * error. Prefer this over thrown exceptions for expected failure paths.
 *
 * @example
 *   function parse(s: string): Result<number, ParseError> {
 *     const n = Number(s);
 *     if (isNaN(n)) return { ok: false, error: new ParseError(s) };
 *     return { ok: true, value: n };
 *   }
 */
export type Result<T, E = Error> = {
    readonly ok: true;
    readonly value: T;
} | {
    readonly ok: false;
    readonly error: E;
};
/**
 * A `Promise` that resolves to a `Result<T, E>`.
 * Async operations should return `AsyncResult` rather than throwing.
 */
export type AsyncResult<T, E = Error> = Promise<Result<T, E>>;
/**
 * Explicit presence/absence. Avoids the `null` / `undefined` dual-footgun
 * when both are valid absent values in the same context.
 *
 * @example
 *   function findById(id: string): Option<User> {
 *     const user = db.get(id);
 *     return user ? { some: true, value: user } : { some: false };
 *   }
 */
export type Option<T> = {
    readonly some: true;
    readonly value: T;
} | {
    readonly some: false;
};
/**
 * Any resource that can be synchronously released.
 * Prefer `AsyncDisposable` for resources with async shutdown paths.
 */
export interface Disposable {
    dispose(): void;
}
/**
 * Any resource that requires asynchronous cleanup (network connections,
 * file handles, ML model sessions, etc.).
 */
export interface AsyncDisposable {
    dispose(): Promise<void>;
}
/** State machine for any long-lived component. */
export type LifecycleState = "created" | "initializing" | "running" | "stopping" | "stopped" | "error";
/**
 * A component whose lifecycle state is observable.
 * Subscribers receive the new state whenever it transitions.
 */
export interface Lifecycle {
    readonly state: LifecycleState;
    /** Returns a `Disposable` that unsubscribes when disposed. */
    onStateChange(handler: (state: LifecycleState) => void): Disposable;
}
/**
 * A stateful, long-running component with explicit start/stop semantics.
 * Services should be idempotent: calling `start()` on a running service
 * is a no-op; calling `stop()` on a stopped service is a no-op.
 *
 * @example
 *   class SyncService implements Service { ... }
 */
export interface Service extends AsyncDisposable {
    readonly serviceId: string;
    readonly state: LifecycleState;
    start(): Promise<void>;
    stop(): Promise<void>;
}
/**
 * A lifecycle-aware extension point with typed configuration.
 *
 * Plugins are registered with a `Registry<Plugin>` and initialised by the
 * host (e.g. `PlatformOS`) after all services are running.
 *
 * @example
 *   class PestWorkflowPlugin implements Plugin<PestConfig> { ... }
 */
export interface Plugin<TConfig = unknown> extends AsyncDisposable {
    readonly pluginId: string;
    readonly version: string;
    readonly config: TConfig;
    init(): Promise<void>;
}
/**
 * A typed, keyed store for named components (providers, plugins, handlers…).
 * All platform package "registries" must implement this interface.
 *
 * @example
 *   const registry: Registry<CaptureProvider> = ...;
 *   registry.register("native-camera", nativeCameraProvider);
 */
export interface Registry<T> {
    register(id: string, item: T): void;
    unregister(id: string): void;
    get(id: string): T | undefined;
    getAll(): ReadonlyMap<string, T>;
    has(id: string): boolean;
    clear(): void;
}
/**
 * Generic typed event. All domain-specific event shapes (e.g. `OSEvent` in
 * `@platform/shared-types`) are structural subtypes of this interface.
 *
 * Convention for `kind`:  "<domain>.<noun>.<verb>"
 *   e.g. "camera.evidence.captured", "ai.analysis.completed"
 */
export interface Event<TKind extends string = string, TPayload = unknown> {
    readonly kind: TKind;
    readonly payload: TPayload;
    readonly timestamp: number;
    readonly correlationId?: string;
    readonly sourceId?: string;
}
/** A function that handles a typed event, synchronously or asynchronously. */
export type EventHandler<TEvent extends Event = Event> = (event: TEvent) => void | Promise<void>;
/** A handle returned by `EventBus.subscribe()`. Dispose to unsubscribe. */
export interface EventSubscription extends Disposable {
    readonly subscriptionId: string;
}
/**
 * A write intent — something that mutates state.
 * Commands are dispatched, not returned. They do not carry a response value.
 *
 * @example
 *   type StartSyncCommand = Command<"sync.start", { entityId: string }>;
 */
export interface Command<TKind extends string = string, TPayload = unknown> {
    readonly kind: TKind;
    readonly payload: TPayload;
    readonly commandId: string;
    readonly issuedAt: number;
    readonly issuedBy?: string;
}
/**
 * A read intent — something that derives a value without mutating state.
 * Queries are resolved and return `AsyncResult<TResult>`.
 *
 * @example
 *   type GetSyncStatusQuery = Query<"sync.status", { entityId: string }, SyncStatus>;
 */
export interface Query<TKind extends string = string, TParams = unknown, TResult = unknown> {
    readonly kind: TKind;
    readonly params: TParams;
    readonly queryId: string;
    readonly issuedAt: number;
    execute(): AsyncResult<TResult>;
}
/**
 * A named platform capability with an availability flag. Capabilities are
 * declared by packages and queried by the host or consuming apps.
 *
 * @example
 *   const bluetoothCapability: Capability<"bluetooth"> = { ... };
 *   if (bluetoothCapability.isAvailable) { ... }
 */
export interface Capability<TName extends string = string> {
    readonly name: TName;
    readonly version: string;
    readonly isAvailable: boolean;
}
/**
 * A context-aware feature toggle.
 * `isEnabled()` without context checks the global default.
 * `isEnabled(context)` allows per-request or per-user evaluation.
 *
 * @example
 *   if (flags.isEnabled("new-sync-engine", { userId: user.id })) { ... }
 */
export interface FeatureFlag<TName extends string = string> {
    readonly name: TName;
    isEnabled(): boolean;
    isEnabled(context: Record<string, unknown>): boolean;
}
/** A `Registry<FeatureFlag>` with a convenient top-level `isEnabled()`. */
export interface FeatureFlagRegistry extends Registry<FeatureFlag> {
    isEnabled(flagName: string, context?: Record<string, unknown>): boolean;
}
/**
 * A configurable, disposable adapter for an external resource or service.
 * All platform package "provider" shapes must implement or extend this.
 *
 * @example
 *   class OpenAIProvider implements Provider<OpenAIConfig> { ... }
 */
export interface Provider<TConfig = unknown> extends AsyncDisposable {
    readonly providerId: string;
    readonly isAvailable: boolean;
    configure(config: TConfig): Promise<void>;
}
/**
 * Shared execution context threaded through every step in a `Pipeline` run.
 * Steps may read/write `metadata`; they check `isCancelled` before
 * continuing work.
 */
export interface PipelineContext {
    readonly runId: string;
    readonly startedAt: number;
    metadata: Record<string, unknown>;
    cancel(): void;
    readonly isCancelled: boolean;
}
/**
 * A single unit of work in a `Pipeline`.
 * A step receives the output of the previous step and returns a typed result.
 *
 * @example
 *   class UploadStep implements PipelineStep<LocalFile, StoragePath> { ... }
 */
export interface PipelineStep<TInput = unknown, TOutput = unknown> {
    readonly stepId: string;
    execute(input: TInput, context: PipelineContext): AsyncResult<TOutput>;
}
/**
 * An ordered sequence of `PipelineStep` instances. The output of each step
 * is passed as input to the next.
 *
 * This is the abstraction that `@platform/sync-engine`'s `SyncEngine<T>`
 * builds on — the app injects its own `SyncStep[]` at construction time.
 */
export interface Pipeline<TInput = unknown, TOutput = unknown> {
    readonly pipelineId: string;
    readonly steps: ReadonlyArray<PipelineStep>;
    execute(input: TInput): AsyncResult<TOutput>;
}
/**
 * A push-based data source. All platform streaming abstractions
 * (camera frames, sync progress, session state) implement this.
 */
export interface Observable<T> {
    subscribe(observer: Observer<T>): Disposable;
}
/** The consumer side of an `Observable<T>` subscription. */
export interface Observer<T> {
    next(value: T): void;
    error?(err: unknown): void;
    complete?(): void;
}
/**
 * Applies a nominal brand to a structural type `T`.
 * Use to create distinct primitive types that are structurally identical
 * but type-incompatible.
 *
 * @example
 *   type UserId   = Brand<string, "UserId">;
 *   type CompanyId = Brand<string, "CompanyId">;
 *   // UserId and CompanyId are not assignable to each other.
 */
declare const __brand: unique symbol;
export type Brand<T, B> = T & {
    readonly [__brand]: B;
};
/** A branded `string` identifier. Use to prevent ID mix-ups across entity types. */
export type ID<TEntity extends string = string> = Brand<string, TEntity>;
/** A branded `number` representing epoch milliseconds. */
export type Timestamp = Brand<number, "Timestamp">;
/** A branded `string` representing a semver version string. */
export type Version = Brand<string, "Version">;
export {};
//# sourceMappingURL=index.d.ts.map