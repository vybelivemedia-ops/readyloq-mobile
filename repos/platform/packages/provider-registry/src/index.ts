/**
 * @platform/provider-registry
 *
 * Generic provider registration, discovery, health checks, capability
 * matching, and lifecycle management.
 *
 * Every provider-based package in the platform builds on these contracts
 * instead of inventing its own registry pattern. Current adopters:
 *   @platform/device-core   — DeviceRegistry extends ManagedRegistry<DeviceProvider>
 *
 * Future refactor targets (adopt provider-registry as foundation):
 *   @platform/camera-core       — ProviderRegistry
 *   @platform/voice-intelligence — VoiceProvider registration
 *   @platform/ai-core           — AIProviderFactory
 *   @platform/storage-core      — StorageAdapter registration
 *   @platform/measurement-core  — MeasurementProvider registration
 *
 * DEPENDENCY GRAPH:
 *   provider-registry → core
 *   provider-registry → shared-types
 *
 * All hardware packages depend on provider-registry (via device-core).
 * platform-intelligence sits above all of them.
 *
 * DESIGN PRINCIPLES:
 *   - Generic over TProvider so each package defines its own provider shape.
 *   - No domain logic — only registration, discovery, health, and lifecycle.
 *   - All interfaces are structural (no abstract classes) so implementors can
 *     extend their own base types without inheritance conflicts.
 */

// ─────────────────────────────────────────────────────────────────────────────
// PROVIDER — base identity contract
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The minimum identity contract every provider must satisfy.
 *
 * id   — stable, unique within the registry (e.g. "meta-ray-ban-glasses-01")
 * name — human-readable display name
 */
export interface Provider {
  readonly id: string;
  readonly name: string;
}

/**
 * A provider that exposes typed capabilities.
 * Hardware providers extend this with DeviceCapabilities.
 * AI providers extend this with model/latency/cost capabilities.
 */
export interface CapabilityProvider<TCapabilities> extends Provider {
  readonly capabilities: TCapabilities;
}

/**
 * A provider with an explicit priority ranking.
 * Registries use this to implement getPrimary() / select() behaviour.
 * Higher number = higher priority. Default when not specified: 0.
 */
export interface PrioritizedProvider extends Provider {
  readonly priority: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// LIFECYCLE — initialize and teardown
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Standard lifecycle contract for providers that need setup and cleanup.
 * initialize() is called once when the provider is first registered.
 * teardown() is called when the provider is unregistered or the app shuts down.
 */
export interface Lifecycle {
  initialize(): Promise<void>;
  teardown(): Promise<void>;
}

// ─────────────────────────────────────────────────────────────────────────────
// HEALTH — health check contract
// ─────────────────────────────────────────────────────────────────────────────

export type HealthStatus = "healthy" | "degraded" | "unhealthy" | "unknown";

export interface HealthCheckResult {
  status: HealthStatus;
  /** Human-readable description of the health state. */
  message?: string;
  checkedAt: string; // ISO-8601
  /** Round-trip latency of the health probe in milliseconds. */
  latencyMs?: number;
  /** Structured detail for specific subsystem checks. */
  detail?: Record<string, unknown>;
}

/**
 * A provider that can report its own health.
 * ManagedRegistry calls this during checkAllHealth().
 */
export interface HealthCheckable {
  checkHealth(): Promise<HealthCheckResult>;
}

// ─────────────────────────────────────────────────────────────────────────────
// REGISTRY — core registration and retrieval
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The base registry — register, unregister, get, list.
 * All more capable registries extend this.
 */
export interface Registry<TProvider extends Provider> {
  register(provider: TProvider): void;
  unregister(id: string): void;
  get(id: string): TProvider | undefined;
  list(): TProvider[];
  has(id: string): boolean;
}

/**
 * Registry extended with predicate-based discovery.
 * findAll() is the foundation for all domain-specific query methods
 * (e.g. findByCategory, findByCapabilityToken).
 */
export interface QueryableRegistry<TProvider extends Provider>
  extends Registry<TProvider> {
  /** Find all providers matching an arbitrary predicate. */
  findAll(predicate: (provider: TProvider) => boolean): TProvider[];
}

// ─────────────────────────────────────────────────────────────────────────────
// REGISTRY EVENTS — observable registry
// ─────────────────────────────────────────────────────────────────────────────

export type RegistryEventKind =
  | "provider.registered"
  | "provider.unregistered"
  | "provider.health_changed"
  | "provider.error";

export interface RegistryEvent<TProvider extends Provider> {
  kind: RegistryEventKind;
  providerId: string;
  /** Present for registered/unregistered events. */
  provider?: TProvider;
  /** Present for health_changed events. */
  health?: HealthCheckResult;
  timestamp: string; // ISO-8601
}

export type RegistryEventListener<TProvider extends Provider> = (
  event: RegistryEvent<TProvider>
) => void;

/**
 * A registry that emits events when providers are registered, unregistered,
 * or change health status.
 * subscribe() returns an unsubscribe function (call to stop listening).
 */
export interface ObservableRegistry<TProvider extends Provider>
  extends QueryableRegistry<TProvider> {
  subscribe(listener: RegistryEventListener<TProvider>): () => void;
}

// ─────────────────────────────────────────────────────────────────────────────
// MANAGED REGISTRY — full-featured: observable + health management
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The full-featured registry. Combines registration, queryability,
 * observability, and health management in one interface.
 *
 * Concrete domain registries (DeviceRegistry, etc.) extend this with
 * domain-specific query methods (findByCategory, findByToken, etc.).
 *
 * checkAllHealth() runs health checks on every registered provider that
 * implements HealthCheckable. Results are cached and emitted as
 * provider.health_changed events.
 */
export interface ManagedRegistry<TProvider extends Provider>
  extends ObservableRegistry<TProvider> {
  /** Run health checks on all registered providers that implement HealthCheckable. */
  checkAllHealth(): Promise<Map<string, HealthCheckResult>>;
  /** Return the last cached health result for a provider (undefined if never checked). */
  getHealth(id: string): HealthCheckResult | undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// DISCOVERY — finding providers at runtime
// ─────────────────────────────────────────────────────────────────────────────

export interface DiscoveryResult<TProvider> {
  providers: TProvider[];
  discoveredAt: string; // ISO-8601
}

/**
 * A discovery mechanism that can enumerate available providers without
 * requiring them to be pre-registered.
 *
 * discover() performs a full scan and returns whatever was found.
 * Implementations typically also call registry.register() for each
 * found provider as a side effect.
 */
export interface Discovery<TProvider> {
  discover(): Promise<DiscoveryResult<TProvider>>;
  readonly isDiscovering: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// PROVIDER SELECTOR — pick the best from a set of candidates
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Selects the single best provider from a candidate list.
 *
 * Default implementations can sort by PrioritizedProvider.priority,
 * HealthCheckResult.status, or custom scoring functions.
 * The application layer can supply custom selectors for domain-specific
 * preference (e.g. prefer BLE over USB for wearables).
 */
export interface ProviderSelector<TProvider extends Provider> {
  select(candidates: TProvider[]): TProvider | undefined;
}

/**
 * A selector implementation that picks the highest-priority healthy provider.
 * Uses PrioritizedProvider.priority (higher wins) and prefers healthy over
 * degraded over unhealthy. Falls back to registration order when tied.
 */
export type PriorityHealthSelector<TProvider extends PrioritizedProvider> =
  ProviderSelector<TProvider>;

