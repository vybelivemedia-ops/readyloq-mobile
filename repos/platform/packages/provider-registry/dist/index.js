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
export {};
