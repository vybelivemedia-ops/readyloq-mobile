/**
 * useSmartGlassesBleFrames — direct BLE → FAIE frame injection
 *
 * Subscribes to JPEG frames pushed from Ray-Ban Meta glasses over BLE and
 * delivers each frame as a local cache URI that the inspection screen can
 * route through the standard FAIE photo pipeline — exactly as if the
 * technician had captured the photo with the phone camera.
 *
 * This path is active when the glasses are BLE-connected (direct device
 * connection via react-native-ble-plx). It complements — but does not
 * replace — the Meta Live AI webhook path in useMetaGlassesSession, which
 * handles voice commands and cloud-relayed frames when BLE is not paired.
 *
 *   BLE connected  → frames arrive here (direct, low-latency)
 *   BLE not paired → frames arrive via webhook (cloud relay, ~1–2 s delay)
 *
 * Usage in new-inspection.tsx:
 *   const bleFrames = useSmartGlassesBleFrames({
 *     active: !!wsInspectionId,
 *     onFrame: (cacheUri) => {
 *       setPhotos((prev) => [...prev, { uri: cacheUri }]);
 *     },
 *   });
 *
 *   // Show BLE strip when connected
 *   bleFrames.isBleConnected → boolean
 *   bleFrames.frameCount     → number (total frames received this session)
 */

import { useEffect, useRef, useState } from "react";
// expo-file-system v19 moved cacheDirectory/EncodingType/writeAsStringAsync to /legacy
import * as FileSystem from "expo-file-system/legacy";
import { smartGlassesBle } from "@/lib/ble";

// ─── Types ────────────────────────────────────────────────────────────────────

interface UseSmartGlassesBleFramesOptions {
  /**
   * Set to true when an inspection is open and frame capture should be active.
   * When false the BLE onFrame subscription is paused (saves battery).
   */
  active: boolean;
  /**
   * Called with a `file://` cache URI each time a JPEG frame arrives from the
   * glasses. Wire this to `setPhotos((prev) => [...prev, { uri }])` in
   * new-inspection.tsx to route frames through the existing FAIE pipeline.
   */
  onFrame: (cacheUri: string) => void;
}

interface SmartGlassesBleFramesState {
  /** True when glasses are BLE-connected AND active is true. */
  isActive: boolean;
  /** True when the BLE driver reports a connected device (regardless of active). */
  isBleConnected: boolean;
  /** Running total of JPEG frames received this component lifetime. */
  frameCount: number;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useSmartGlassesBleFrames({
  active,
  onFrame,
}: UseSmartGlassesBleFramesOptions): SmartGlassesBleFramesState {
  const [isBleConnected, setIsBleConnected] = useState(
    () => smartGlassesBle.getState().connectionState === "connected",
  );
  const [frameCount, setFrameCount] = useState(0);

  // Stable ref so the frame callback always calls the latest onFrame prop
  const onFrameRef = useRef(onFrame);
  onFrameRef.current = onFrame;

  // ── Track BLE connection state ───────────────────────────────────────────
  useEffect(() => {
    // Sync initial state
    setIsBleConnected(
      smartGlassesBle.getState().connectionState === "connected",
    );
    // Subscribe to future state changes
    const unsub = smartGlassesBle.subscribe((state) => {
      setIsBleConnected(state.connectionState === "connected");
    });
    return unsub;
  }, []);

  // ── Subscribe to JPEG frames when active + BLE connected ─────────────────
  useEffect(() => {
    if (!active || !isBleConnected) return;

    const unsub = smartGlassesBle.onFrame((jpeg: Uint8Array) => {
      // Fire-and-forget — write JPEG to cache then notify the caller.
      void (async () => {
        try {
          const filename = `glasses_ble_${Date.now()}_${Math.random()
            .toString(36)
            .slice(2, 8)}.jpg`;
          // cacheDirectory can be null on some Android configurations; fall back
          // to documentDirectory (always non-null on Expo) so the URI is valid.
          const baseDir =
            FileSystem.cacheDirectory ?? FileSystem.documentDirectory ?? "";
          const cacheUri = `${baseDir}${filename}`;

          // Convert Uint8Array → base64 → write to FileSystem cache
          const base64 = uint8ArrayToBase64(jpeg);
          await FileSystem.writeAsStringAsync(cacheUri, base64, {
            encoding: FileSystem.EncodingType.Base64,
          });

          setFrameCount((prev) => prev + 1);
          onFrameRef.current(cacheUri);
        } catch {
          // Silent: BLE frame corruption or filesystem error in the field —
          // don't crash the inspection; just drop this frame.
        }
      })();
    });

    return unsub;
  }, [active, isBleConnected]);

  return {
    isActive: active && isBleConnected,
    isBleConnected,
    frameCount,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Encode a Uint8Array as a base64 string.
 *
 * Processes in 8 KB chunks to avoid call-stack overflow on large JPEG frames.
 */
function uint8ArrayToBase64(bytes: Uint8Array): string {
  const CHUNK = 8192;
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i += CHUNK) {
    binary += String.fromCharCode(
      ...bytes.subarray(i, Math.min(i + CHUNK, bytes.byteLength)),
    );
  }
  return btoa(binary);
}
