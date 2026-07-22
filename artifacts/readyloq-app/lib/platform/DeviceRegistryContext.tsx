/**
 * DeviceRegistryContext — React context that initializes the DevicePlugin
 * on app startup and makes the DeviceRegistry available throughout the tree.
 *
 * The DevicePlugin registers NativeCameraProvider and MediaImportProvider on
 * mount so that device health, status, and event streaming are available from
 * the moment the app starts.
 *
 * The shared nativeCameraRef starts as null and is filled in when a CameraView
 * component mounts. The DevicePlugin's registered NativeCameraProvider uses
 * this ref for health checks (camera permission API — no ref needed) and can
 * optionally use it for direct capture. Actual capture in the inspection screen
 * continues to go through provider-registry.ts with its own local cameraRef.
 *
 * Usage:
 *   // In a screen:
 *   const { registry, nativeCameraRef } = useDeviceRegistry();
 *   const primary = registry.getPrimary("camera");
 */

import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import type { CameraView } from "expo-camera";

import type { DeviceRegistry } from "@platform/device-core";
import { DevicePlugin } from "./device-plugin";

// ─── Context shape ────────────────────────────────────────────────────────────

interface DeviceRegistryContextValue {
  plugin: DevicePlugin;
  registry: DeviceRegistry;
  /**
   * Shared camera ref. Pass this to a <CameraView ref={nativeCameraRef} …/>
   * on any screen that needs the DevicePlugin's native camera provider to have
   * live capture capability. The ref starts null and is filled on CameraView mount.
   */
  nativeCameraRef: React.RefObject<CameraView | null>;
}

const DeviceRegistryContext = createContext<DeviceRegistryContextValue | null>(null);

// ─── Provider ─────────────────────────────────────────────────────────────────

export function DeviceRegistryProvider({ children }: { children: ReactNode }) {
  const nativeCameraRef = useRef<CameraView | null>(null);

  const plugin = useMemo(
    () => new DevicePlugin(nativeCameraRef),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  useEffect(() => {
    let active = true;

    plugin.initialize().then(() => {
      if (!active) return;
      console.log(
        "[DeviceRegistry] Initialized. Registered cameras:",
        plugin.registry.findByCategory("camera").map((p) => p.id),
      );
    }).catch((err) => {
      console.error("[DeviceRegistry] Initialize error:", err);
    });

    return () => {
      active = false;
      plugin.teardown().catch((err) => {
        console.error("[DeviceRegistry] Teardown error:", err);
      });
    };
  }, [plugin]);

  const value = useMemo<DeviceRegistryContextValue>(
    () => ({ plugin, registry: plugin.registry, nativeCameraRef }),
    [plugin],
  );

  return (
    <DeviceRegistryContext.Provider value={value}>
      {children}
    </DeviceRegistryContext.Provider>
  );
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * Access the DevicePlugin and DeviceRegistry from any component.
 * Must be rendered inside <DeviceRegistryProvider>.
 */
export function useDeviceRegistry(): DeviceRegistryContextValue {
  const ctx = useContext(DeviceRegistryContext);
  if (!ctx) {
    throw new Error("useDeviceRegistry must be used inside <DeviceRegistryProvider>");
  }
  return ctx;
}
