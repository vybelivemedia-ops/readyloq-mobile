/**
 * Concrete implementation of DeviceRegistry.
 *
 * Implements ManagedRegistry<DeviceProvider> with the device-specific query
 * methods from the DeviceRegistry interface (findByCategory, findByTransport,
 * findByToken, getPrimary).
 *
 * Health results are cached in-memory and emitted as registry events. Callers
 * that want up-to-date health should call `checkAllHealth()` periodically or
 * subscribe to "provider.health_changed" events.
 *
 * Usage:
 *   const registry = createDeviceRegistry();
 *   registry.register(myProvider);
 *   const cameras = registry.findByCategory("camera");
 *   const primary = registry.getPrimary("camera");
 */

import type {
  HealthCheckResult,
  RegistryEvent,
  RegistryEventListener,
} from "@platform/provider-registry";

import type {
  DeviceProvider,
  DeviceRegistry,
  DeviceCategory,
  DeviceTransport,
} from "./index";

export function createDeviceRegistry(): DeviceRegistry {
  const store = new Map<string, DeviceProvider>();
  const healthCache = new Map<string, HealthCheckResult>();
  const listeners = new Set<RegistryEventListener<DeviceProvider>>();

  function emit(event: RegistryEvent<DeviceProvider>): void {
    listeners.forEach((l) => l(event));
  }

  function now(): string {
    return new Date().toISOString();
  }

  const registry: DeviceRegistry = {
    // ── Registry ────────────────────────────────────────────────────────────

    register(provider: DeviceProvider): void {
      store.set(provider.id, provider);
      emit({
        kind: "provider.registered",
        providerId: provider.id,
        provider,
        timestamp: now(),
      });
    },

    unregister(id: string): void {
      const provider = store.get(id);
      store.delete(id);
      healthCache.delete(id);
      emit({
        kind: "provider.unregistered",
        providerId: id,
        provider,
        timestamp: now(),
      });
    },

    get(id: string): DeviceProvider | undefined {
      return store.get(id);
    },

    list(): DeviceProvider[] {
      return [...store.values()];
    },

    has(id: string): boolean {
      return store.has(id);
    },

    // ── QueryableRegistry ────────────────────────────────────────────────────

    findAll(predicate: (provider: DeviceProvider) => boolean): DeviceProvider[] {
      return [...store.values()].filter(predicate);
    },

    // ── ObservableRegistry ───────────────────────────────────────────────────

    subscribe(listener: RegistryEventListener<DeviceProvider>): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    // ── ManagedRegistry ──────────────────────────────────────────────────────

    async checkAllHealth(): Promise<Map<string, HealthCheckResult>> {
      const results = new Map<string, HealthCheckResult>();
      const checks = [...store.values()].map(async (provider) => {
        if (!provider.checkHealth) return;
        try {
          const result = await provider.checkHealth();
          healthCache.set(provider.id, result);
          results.set(provider.id, result);
          emit({
            kind: "provider.health_changed",
            providerId: provider.id,
            health: result,
            timestamp: now(),
          });
        } catch (err) {
          const failed: HealthCheckResult = {
            status: "unhealthy",
            message: err instanceof Error ? err.message : "Health check threw an error",
            checkedAt: now(),
          };
          healthCache.set(provider.id, failed);
          results.set(provider.id, failed);
          emit({
            kind: "provider.health_changed",
            providerId: provider.id,
            health: failed,
            timestamp: now(),
          });
        }
      });
      await Promise.all(checks);
      return results;
    },

    getHealth(id: string): HealthCheckResult | undefined {
      return healthCache.get(id);
    },

    // ── DeviceRegistry ───────────────────────────────────────────────────────

    findByCategory(category: DeviceCategory): DeviceProvider[] {
      return [...store.values()].filter((p) =>
        p.capabilities.categories.includes(category),
      );
    },

    findByTransport(transport: DeviceTransport): DeviceProvider[] {
      return [...store.values()].filter((p) =>
        p.capabilities.transports.includes(transport),
      );
    },

    findByToken(token: string): DeviceProvider[] {
      return [...store.values()].filter((p) =>
        p.capabilities.tokens.includes(token),
      );
    },

    getPrimary(category: DeviceCategory): DeviceProvider | undefined {
      const candidates = registry.findByCategory(category);
      if (candidates.length === 0) return undefined;

      const healthScore = (status: string): number =>
        ({ healthy: 3, degraded: 2, unhealthy: 1, unknown: 0 }[status] ?? 0);

      return [...candidates].sort((a, b) => {
        const aStatus = healthCache.get(a.id)?.status ?? "unknown";
        const bStatus = healthCache.get(b.id)?.status ?? "unknown";
        const byHealth = healthScore(bStatus) - healthScore(aStatus);
        if (byHealth !== 0) return byHealth;
        return (b.priority ?? 0) - (a.priority ?? 0);
      })[0];
    },
  };

  return registry;
}
