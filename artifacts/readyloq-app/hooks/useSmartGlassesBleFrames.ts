/**
 * useSmartGlassesBleFrames — direct BLE → FAIE frame injection
 *
 * Subscribes to JPEG frames pushed from Ray-Ban Meta glasses over BLE and
 * delivers each frame URI to the consumer's `onFrame` callback.  The consumer
 * MUST await its durable-copy work (e.g. `ingestEvidence`) inside the callback;
 * the hook deletes the cache file only after the callback resolves, ensuring
 * the file is never removed while a durable copy is still in-progress.
 *
 * ── Storage model ────────────────────────────────────────────────────────────
 *
 * Each frame is written to a session-scoped subdirectory:
 *
 *   {cacheDirectory}/glasses_sessions/{sessionId}/frame_{ts}_{rand}.jpg
 *
 * `sessionId` encodes the mount timestamp in base-36 so startup cleanup can
 * compute each directory's age without any additional filesystem I/O.
 *
 * Lifecycle:
 *   1. Startup: delete glasses_sessions/* dirs that are (a) not the current
 *      session AND (b) older than MIN_ORPHAN_AGE_MS (5 min).  The age check
 *      protects overlapping mounts during fast navigation.
 *   2. Per-frame: write → await consumer callback (durable copy) → deleteAsync.
 *      The consumer MUST await persistPhoto / ingestEvidence inside onFrame.
 *   3. No unmount deletion: the per-frame delete handles the normal lifecycle;
 *      the startup scan handles crash-orphan cleanup on the next session.
 *
 * ── BLE vs cloud paths ───────────────────────────────────────────────────────
 *
 *   BLE connected  → frames arrive here (~50 ms latency)
 *   BLE not paired → frames arrive via webhook (cloud relay, ~1–2 s delay)
 *
 * Usage in new-inspection.tsx:
 *
 *   const bleFrames = useSmartGlassesBleFrames({
 *     active: !!wsInspectionId,
 *     onFrame: async (uri) => {
 *       // MUST be async — hook awaits this before deleting the cache file.
 *       await ingestEvidence([{
 *         id: `ble_${Date.now().toString(36)}`,
 *         uri,
 *         source: "smart_glasses",
 *         capturedAt: new Date().toISOString(),
 *       }]);
 *     },
 *   });
 */

import { useEffect, useRef, useState } from "react";
// expo-file-system v19 moved cacheDirectory/EncodingType/writeAsStringAsync to /legacy
import * as FileSystem from "expo-file-system/legacy";
import { smartGlassesBle } from "@/lib/ble";

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Minimum age (ms) before a glasses_sessions/* directory from a previous
 * session is considered an orphan and safe to delete on startup.
 *
 * 5 minutes is well beyond the longest plausible ingestEvidence call
 * (~2–3 s), so an overlapping mount during fast navigation will not
 * delete a directory that still has in-flight durable-copy work.
 */
const MIN_ORPHAN_AGE_MS = 5 * 60 * 1000;

// ─── Types ────────────────────────────────────────────────────────────────────

interface UseSmartGlassesBleFramesOptions {
  /**
   * Set to true when an inspection is open and frame capture should be active.
   * When false the BLE onFrame subscription is paused (saves battery).
   */
  active: boolean;
  /**
   * Called with the session-dir URI each time a JPEG frame is ready.
   *
   * **Must be async (return a Promise).** The hook awaits this callback before
   * deleting the cache file. Use it to call `ingestEvidence` so each frame
   * is durably copied to documentDirectory before the cache copy disappears.
   *
   *   onFrame: async (uri) => {
   *     await ingestEvidence([{ id: `ble_${Date.now()}`, uri,
   *                             source: 'smart_glasses',
   *                             capturedAt: new Date().toISOString() }]);
   *   }
   */
  onFrame: (uri: string) => Promise<void> | void;
}

interface SmartGlassesBleFramesState {
  /** True when glasses are BLE-connected AND active is true AND setup is done. */
  isActive: boolean;
  /** True when the BLE driver reports a connected device (regardless of active). */
  isBleConnected: boolean;
  /** Running total of JPEG frames successfully ingested this session. */
  frameCount: number;
  /**
   * Running total of frames lost this session:
   *   - BLE reassembly layer: disconnect mid-transfer or 5 s TTL timeout
   *   - Write layer: filesystem error after reassembly
   *   - Ingest layer: ingestEvidence threw or consumer callback failed
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

  // Unique session ID — embeds a base-36 creation timestamp so startup
  // cleanup can age-gate orphan deletion without extra filesystem I/O.
  const sessionIdRef = useRef(
    `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
  );

  /**
   * Whether the startup cleanup + session-dir creation has finished.
   * Gates frame subscription — no frame can be written until true.
   */
  const [setupComplete, setSetupComplete] = useState(false);

  // ── Startup: clean up old orphan sessions, create this session's dir ──────
  //
  // Serialized before any frame subscription (setupComplete gates the effect
  // below).  Only deletes dirs that are:
  //   (a) not the current session (name ≠ sessionId)
  //   (b) older than MIN_ORPHAN_AGE_MS — protects overlapping mounts created
  //       during fast in-app navigation that may still have in-flight callbacks
  //
  // The current session dir does not exist yet, so there is zero race between
  // this cleanup and any write to the current session.
  useEffect(() => {
    const baseDir =
      FileSystem.cacheDirectory ?? FileSystem.documentDirectory ?? "";

    if (!baseDir) {
      setSetupComplete(true);
      return;
    }

    const sessionsBase = `${baseDir}glasses_sessions/`;
    const sessionDir = `${sessionsBase}${sessionIdRef.current}/`;
    const now = Date.now();

    void (async () => {
      try {
        const sessionsInfo = await FileSystem.getInfoAsync(sessionsBase);
        if (sessionsInfo.exists) {
          const entries = await FileSystem.readDirectoryAsync(sessionsBase);
          await Promise.all(
            entries
              .filter((e) => {
                if (e === sessionIdRef.current) return false; // never touch current session
                // Decode embedded creation timestamp from dir name (base-36 prefix).
                // Fall back to 0 (epoch) for any name that doesn't match our format —
                // that makes it infinitely old and eligible for immediate deletion.
                const tsBase36 = e.split("_")[0] ?? "0";
                const createdAt = parseInt(tsBase36, 36) || 0;
                return now - createdAt > MIN_ORPHAN_AGE_MS;
              })
              .map((e) =>
                FileSystem.deleteAsync(`${sessionsBase}${e}`, {
                  idempotent: true,
                }).catch(() => {}),
              ),
          );
        }

        await FileSystem.makeDirectoryAsync(sessionDir, {
          intermediates: true,
        });
      } catch {
        // Non-fatal — frame writes will fail and be counted as drops.
      } finally {
        setSetupComplete(true);
      }
    })();
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
  useEffect(() => {
    const unsub = smartGlassesBle.onDroppedFrame((count) => {
      setDroppedFrameCount((prev) => prev + count);
    });
    return unsub;
  }, []);

  // ── Subscribe to JPEG frames when active + BLE connected + setup done ─────
  //
  // `setupComplete` in deps ensures no frame can be written until the startup
  // cleanup and session-dir creation have fully resolved.
  useEffect(() => {
    if (!active || !isBleConnected || !setupComplete) return;

    const baseDir =
      FileSystem.cacheDirectory ?? FileSystem.documentDirectory ?? "";
    const sessionDir = `${baseDir}glasses_sessions/${sessionIdRef.current}/`;

    const unsub = smartGlassesBle.onFrame((jpeg: Uint8Array) => {
      void (async () => {
        let uri: string | null = null;
        try {
          const filename = `frame_${Date.now()}_${Math.random()
            .toString(36)
            .slice(2, 8)}.jpg`;
          uri = `${sessionDir}${filename}`;

          await FileSystem.writeAsStringAsync(uri, uint8ArrayToBase64(jpeg), {
            encoding: FileSystem.EncodingType.Base64,
          });

          // Await the consumer callback so the durable copy (ingestEvidence →
          // persistPhoto) completes before we delete the cache source file.
          await onFrameRef.current(uri);
          setFrameCount((prev) => prev + 1);
        } catch {
          // Write failure, ingest failure, or consumer threw — count the drop.
          setDroppedFrameCount((prev) => prev + 1);
        } finally {
          // Delete the cache file regardless of success or failure: on success
          // persistPhoto has already copied it to documentDirectory; on failure
          // it's useless.  idempotent: true silences "file not found" errors.
          if (uri) {
            void FileSystem.deleteAsync(uri, { idempotent: true }).catch(
              () => {},
            );
          }
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
