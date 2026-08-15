/**
 * useSmartGlassesBleFrames — direct BLE → FAIE frame injection
 *
 * Subscribes to JPEG frames pushed from Ray-Ban Meta glasses over BLE and
 * delivers each frame as a local file URI that the inspection screen routes
 * through the standard FAIE photo pipeline — exactly as if the technician had
 * captured the photo with the phone camera.
 *
 * ── Storage model ────────────────────────────────────────────────────────────
 *
 * Each frame is written to a **session-scoped subdirectory**:
 *
 *   {cacheDirectory}/glasses_sessions/{sessionId}/frame_{ts}_{rand}.jpg
 *
 * A unique `sessionId` is generated once per hook mount.  On startup, the hook
 * deletes all OTHER session directories (from previous inspections) before
 * subscribing to frames, so no new frame can be written to a directory being
 * deleted.  The current session's directory is never touched on unmount —
 * `persistPhoto` in `ingestEvidence` has already durably copied each frame to
 * `documentDirectory`; the cache copy is cleaned up by the NEXT session's
 * startup scan.
 *
 * This avoids two classes of bugs:
 *   (a) Unmount-cleanup racing an in-flight FAIE upload that reads the file
 *       asynchronously after navigation.
 *   (b) Startup orphan scan racing a frame being written to the cache root.
 *
 * ── BLE vs cloud paths ───────────────────────────────────────────────────────
 *
 *   BLE connected  → frames arrive here (direct, ~50 ms latency)
 *   BLE not paired → frames arrive via webhook (cloud relay, ~1–2 s delay)
 *
 * Usage in new-inspection.tsx:
 *   const bleFrames = useSmartGlassesBleFrames({
 *     active: !!wsInspectionId,
 *     onFrame: (uri) => {
 *       // Route through ingestEvidence just like a camera capture
 *       void ingestEvidence([{ uri, capturedAt: new Date().toISOString(), source: 'ble_glasses' }]);
 *     },
 *   });
 *
 *   bleFrames.isBleConnected → boolean
 *   bleFrames.frameCount     → number (total frames received this session)
 *   bleFrames.droppedFrameCount → number (total frames lost this session)
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
   * Called with a `file://` session-dir URI each time a JPEG frame is written.
   * Wire this to `ingestEvidence` (not bare `setPhotos`) in new-inspection.tsx
   * so each frame is durably copied to documentDirectory before the cache copy
   * is cleaned up by the next session's startup scan.
   */
  onFrame: (uri: string) => void;
}

interface SmartGlassesBleFramesState {
  /** True when glasses are BLE-connected AND active is true AND setup is done. */
  isActive: boolean;
  /** True when the BLE driver reports a connected device (regardless of active). */
  isBleConnected: boolean;
  /** Running total of JPEG frames successfully written and delivered this session. */
  frameCount: number;
  /**
   * Running total of frames lost this session:
   *   - BLE reassembly layer: disconnect mid-transfer or 5 s TTL timeout
   *   - Write layer: filesystem error after reassembly
   */
  droppedFrameCount: number;
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
  const [droppedFrameCount, setDroppedFrameCount] = useState(0);

  // Stable ref so the frame callback always uses the latest onFrame prop.
  const onFrameRef = useRef(onFrame);
  onFrameRef.current = onFrame;

  // Unique ID for this hook mount — scopes the session directory so startup
  // cleanup can target other-session dirs only, eliminating any write race.
  const sessionIdRef = useRef(
    `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
  );

  /**
   * Whether the startup cleanup + session-dir creation has finished.
   * The frame subscription effect will not subscribe until this is true,
   * ensuring cleanup is fully serialized before any new file can be written.
   */
  const [setupComplete, setSetupComplete] = useState(false);

  // ── Startup: clean up previous sessions, then create this session's dir ──
  //
  // Runs once on mount.  Delete ALL glasses_sessions/* dirs whose name does NOT
  // match the current sessionId.  Because the current session's dir doesn't
  // exist yet (we haven't started writing), there is no race between cleanup
  // and live frame writes.  Only after this resolves does setupComplete → true,
  // which gates the onFrame subscription.
  useEffect(() => {
    const baseDir =
      FileSystem.cacheDirectory ?? FileSystem.documentDirectory ?? "";

    if (!baseDir) {
      // No writable directory — skip storage; let setupComplete proceed so
      // dropped-frame tracking still works.
      setSetupComplete(true);
      return;
    }

    const sessionsBase = `${baseDir}glasses_sessions/`;
    const sessionDir = `${sessionsBase}${sessionIdRef.current}/`;

    void (async () => {
      try {
        // ── Step 1: delete previous-session directories ──────────────────────
        //
        // Only targets dirs whose name ≠ sessionId.current.  The current session
        // dir does not exist yet (we create it in step 2), so there is no risk
        // of deleting a dir that has live frames being written to it.
        const sessionsInfo = await FileSystem.getInfoAsync(sessionsBase);
        if (sessionsInfo.exists) {
          const entries = await FileSystem.readDirectoryAsync(sessionsBase);
          await Promise.all(
            entries
              .filter((e) => e !== sessionIdRef.current)
              .map((e) =>
                FileSystem.deleteAsync(`${sessionsBase}${e}`, {
                  idempotent: true,
                }).catch(() => {
                  /* non-fatal — old sessions may already be partially deleted */
                }),
              ),
          );
        }

        // ── Step 2: create this session's directory ──────────────────────────
        await FileSystem.makeDirectoryAsync(sessionDir, {
          intermediates: true,
        });
      } catch {
        // Non-fatal.  If dir creation fails, subsequent writes will fail and
        // be counted as dropped frames via the catch block in onFrame.
      } finally {
        setSetupComplete(true);
      }
    })();
    // sessionIdRef.current is stable for the lifetime of this mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Track BLE connection state ───────────────────────────────────────────
  useEffect(() => {
    setIsBleConnected(
      smartGlassesBle.getState().connectionState === "connected",
    );
    const unsub = smartGlassesBle.subscribe((state) => {
      setIsBleConnected(state.connectionState === "connected");
    });
    return unsub;
  }, []);

  // ── Track driver-level frame drops (disconnect + reassembly timeout) ──────
  //
  // These drops happen BEFORE the frame reaches the hook's onFrame callback,
  // so the write-layer catch block below cannot see them.  Subscribe directly
  // to the BLE driver so all drop sources flow into the same droppedFrameCount.
  useEffect(() => {
    const unsub = smartGlassesBle.onDroppedFrame((count) => {
      setDroppedFrameCount((prev) => prev + count);
    });
    return unsub;
  }, []);

  // ── Subscribe to JPEG frames when active + BLE connected + setup done ─────
  //
  // `setupComplete` is in the dependency array so this effect does not run
  // until after the startup cleanup and session-dir creation have resolved.
  // This serializes cleanup before any write can begin.
  useEffect(() => {
    if (!active || !isBleConnected || !setupComplete) return;

    const baseDir =
      FileSystem.cacheDirectory ?? FileSystem.documentDirectory ?? "";
    const sessionDir = `${baseDir}glasses_sessions/${sessionIdRef.current}/`;

    const unsub = smartGlassesBle.onFrame((jpeg: Uint8Array) => {
      void (async () => {
        try {
          const filename = `frame_${Date.now()}_${Math.random()
            .toString(36)
            .slice(2, 8)}.jpg`;
          const uri = `${sessionDir}${filename}`;

          // Convert Uint8Array → base64 → write to session directory.
          // The URI points to a stable location that survives unmount and draft
          // saves.  The NEXT session's startup scan cleans this dir up after
          // FAIE's persistPhoto has durably copied the file to documentDirectory.
          const base64 = uint8ArrayToBase64(jpeg);
          await FileSystem.writeAsStringAsync(uri, base64, {
            encoding: FileSystem.EncodingType.Base64,
          });

          setFrameCount((prev) => prev + 1);
          onFrameRef.current(uri);
        } catch {
          // Write-layer failure (disk full, dir not created, corrupt JPEG) —
          // don't crash the inspection; count for the UI warning.
          setDroppedFrameCount((prev) => prev + 1);
        }
      })();
    });

    return unsub;
  }, [active, isBleConnected, setupComplete]);

  return {
    isActive: active && isBleConnected && setupComplete,
    isBleConnected,
    frameCount,
    droppedFrameCount,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Encode a Uint8Array as a base64 string.
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
