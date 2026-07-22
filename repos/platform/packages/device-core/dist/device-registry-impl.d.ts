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
import type { DeviceRegistry } from "./index";
export declare function createDeviceRegistry(): DeviceRegistry;
//# sourceMappingURL=device-registry-impl.d.ts.map