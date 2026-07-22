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
export function createDeviceRegistry() {
    const store = new Map();
    const healthCache = new Map();
    const listeners = new Set();
    function emit(event) {
        listeners.forEach((l) => l(event));
    }
    function now() {
        return new Date().toISOString();
    }
    const registry = {
        // ── Registry ────────────────────────────────────────────────────────────
        register(provider) {
            store.set(provider.id, provider);
            emit({
                kind: "provider.registered",
                providerId: provider.id,
                provider,
                timestamp: now(),
            });
        },
        unregister(id) {
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
        get(id) {
            return store.get(id);
        },
        list() {
            return [...store.values()];
        },
        has(id) {
            return store.has(id);
        },
        // ── QueryableRegistry ────────────────────────────────────────────────────
        findAll(predicate) {
            return [...store.values()].filter(predicate);
        },
        // ── ObservableRegistry ───────────────────────────────────────────────────
        subscribe(listener) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        // ── ManagedRegistry ──────────────────────────────────────────────────────
        async checkAllHealth() {
            const results = new Map();
            const checks = [...store.values()].map(async (provider) => {
                if (!provider.checkHealth)
                    return;
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
                }
                catch (err) {
                    const failed = {
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
        getHealth(id) {
            return healthCache.get(id);
        },
        // ── DeviceRegistry ───────────────────────────────────────────────────────
        findByCategory(category) {
            return [...store.values()].filter((p) => p.capabilities.categories.includes(category));
        },
        findByTransport(transport) {
            return [...store.values()].filter((p) => p.capabilities.transports.includes(transport));
        },
        findByToken(token) {
            return [...store.values()].filter((p) => p.capabilities.tokens.includes(token));
        },
        getPrimary(category) {
            const candidates = registry.findByCategory(category);
            if (candidates.length === 0)
                return undefined;
            const healthScore = (status) => ({ healthy: 3, degraded: 2, unhealthy: 1, unknown: 0 }[status] ?? 0);
            return [...candidates].sort((a, b) => {
                const aStatus = healthCache.get(a.id)?.status ?? "unknown";
                const bStatus = healthCache.get(b.id)?.status ?? "unknown";
                const byHealth = healthScore(bStatus) - healthScore(aStatus);
                if (byHealth !== 0)
                    return byHealth;
                return (b.priority ?? 0) - (a.priority ?? 0);
            })[0];
        },
    };
    return registry;
}
