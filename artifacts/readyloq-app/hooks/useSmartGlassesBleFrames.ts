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
import { customFetch } from "@/lib/api-client/custom-fetch";

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

// ─── Module-level frame-count persistence ─────────────────────────────────────
//
// On Android, switching apps or receiving a phone call can unmount and remount
// the inspection screen, resetting all React state to zero.  Module-level
// variables survive this lifecycle: the JS bundle stays loaded across
// background/foreground transitions, so these counters accumulate correctly
// across the entire inspection session regardless of component remounts.
//
// They are reset to 0 only by an explicit reconnect recovery (which clears
// pre-disconnect drops) — never on component unmount.
let _persistedDroppedFrameCount = 0;
let _persistedFrameCount = 0;

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
  /**
   * Meta-glasses session ID returned by POST /api/meta-glasses/session.
   * When provided, each dropped frame fires a lightweight telemetry event to
   * POST /api/meta-glasses/events/:sessionId so the engineering team can track
   * which BLE devices produce frequent frame drops in the field.
   * Optional — no telemetry is sent when omitted or null.
   */
  sessionId?: string | null;
}

interface SmartGlassesBleFramesState {
  /** True when glasses are BLE-connected AND active is true AND setup is done. */
  isActive: boolean;
  /** True when the BLE driver reports a connected device (regardless of active). */
  isBleConnected: boolean;
  /** Running total of JPEG frames successfully ingested this session. */
  frameCount: number;
  /**
   * Running total of frames lost since the last reconnect (or since mount).
   *   - BLE reassembly layer: disconnect mid-transfer or 5 s TTL timeout
   *   - Write layer: filesystem error after reassembly
   *   - Ingest layer: ingestEvidence threw or consumer callback failed
   *
   * Resets to 0 when the glasses reconnect and the first frame is successfully
   * written — so the warning disappears automatically after a clean recovery.
   */
  droppedFrameCount: number;
  /**
   * Transient message shown for ~5 s after a successful reconnect.
   * Format: "Reconnected — N frame(s) lost last disconnect"
   * Null when there was no recent reconnect or no frames were lost.
   */
  reconnectNotice: string | null;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useSmartGlassesBleFrames({
  active,
  onFrame,
  sessionId,
}: UseSmartGlassesBleFramesOptions): SmartGlassesBleFramesState {
  const [isBleConnected, setIsBleConnected] = useState(
    () => smartGlassesBle.getState().connectionState === "connected",
  );
  // Initialise from module-level persisted values so counts survive the
  // Android background/foreground unmount+remount cycle.
  const [frameCount, setFrameCount] = useState(() => _persistedFrameCount);
  const [droppedFrameCount, setDroppedFrameCount] = useState(
    () => _persistedDroppedFrameCount,
  );
  const [reconnectNotice, setReconnectNotice] = useState<string | null>(null);

  // Stable ref so the frame callback always uses the latest onFrame prop.
  const onFrameRef = useRef(onFrame);
  onFrameRef.current = onFrame;

  // Stable ref so the async frame callback can always read the latest telemetry
  // sessionId without it appearing in the effect's dependency array.
  const telemetrySessionIdRef = useRef(sessionId);
  telemetrySessionIdRef.current = sessionId;

  /**
   * Set to true when BLE transitions disconnected → connected.
   * Cleared by the next successful frame write, which also resets
   * droppedFrameCount and sets the transient reconnect notice.
   */
  const pendingReconnectRef = useRef(false);
  /**
   * Monotonically-incrementing generation counter.  Bumped on every
   * disconnected → connected transition.  Each frame captures its generation
   * at launch time; the recovery block only fires when the frame's generation
   * matches the current one.  This prevents a slow-ingesting pre-reconnect
   * frame from falsely triggering the green "reconnected" notice.
   */
  const reconnectGenerationRef = useRef(0);
  /**
   * Holds the droppedFrameCount at the moment the reconnect was detected so
   * the frame callback can read it synchronously (avoids stale-closure issues).
   */
  const droppedAtReconnectRef = useRef(0);
  /**
   * Ref mirror of droppedFrameCount — readable inside callbacks without closures.
   * Initialised from the module-level persisted value so it is already at the
   * correct count when the component remounts after an Android background event.
   */
  const droppedFrameCountRef = useRef(_persistedDroppedFrameCount);
  /** Timer id for the auto-clear of reconnectNotice. */
  const reconnectNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  // ── Track BLE connection state + detect reconnect transitions ────────────
  useEffect(() => {
    let wasConnected =
      smartGlassesBle.getState().connectionState === "connected";
    setIsBleConnected(wasConnected);

    const unsub = smartGlassesBle.subscribe((state) => {
      const nowConnected = state.connectionState === "connected";
      if (!wasConnected && nowConnected) {
        // disconnected → connected transition: arm the pending-reconnect flag
        // and bump the generation so any still-in-flight pre-reconnect frames
        // cannot falsely trigger the recovery (they'll see a stale generation).
        droppedAtReconnectRef.current = droppedFrameCountRef.current;
        pendingReconnectRef.current = true;
        reconnectGenerationRef.current += 1;
      }
      wasConnected = nowConnected;
      setIsBleConnected(nowConnected);
    });
    return unsub;
  }, []);

  // ── Track driver-level frame drops (disconnect + reassembly timeout) ──────
  useEffect(() => {
    const unsub = smartGlassesBle.onDroppedFrame((count) => {
      // Update the ref synchronously so the reconnect-transition subscriber
      // (which may fire in the same call stack) always sees the current count.
      droppedFrameCountRef.current += count;
      // Mirror to the module-level persisted value so the count survives an
      // Android background/foreground unmount+remount cycle.
      _persistedDroppedFrameCount = droppedFrameCountRef.current;
      // Any new drop immediately cancels the reconnect notice so the red
      // warning becomes visible again — the recovery was not clean.
      if (reconnectNoticeTimerRef.current != null) {
        clearTimeout(reconnectNoticeTimerRef.current);
        reconnectNoticeTimerRef.current = null;
        setReconnectNotice(null);
      }
      setDroppedFrameCount(droppedFrameCountRef.current);
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
      // Capture the reconnect generation synchronously at launch time.
      // If a disconnect+reconnect occurs while this frame is being written or
      // ingested, reconnectGenerationRef will have been bumped, so the recovery
      // block below will see a mismatch and skip — preventing a slow
      // pre-reconnect frame from falsely clearing the warning.
      const frameGeneration = reconnectGenerationRef.current;

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

          // ── Reconnect recovery ─────────────────────────────────────────────
          // On the first successful frame after a disconnected → connected
          // transition, reset the dropped-frame counter and show a brief notice
          // so the technician knows the warning referred to the last disconnect
          // (not to an ongoing problem).
          //
          // The generation guard ensures only a frame that was *received after*
          // the reconnect can trigger recovery.  A slow-ingesting pre-reconnect
          // frame will see frameGeneration < reconnectGenerationRef.current and
          // skip this block entirely.
          if (pendingReconnectRef.current && frameGeneration === reconnectGenerationRef.current) {
            pendingReconnectRef.current = false;
            const lostCount = droppedAtReconnectRef.current;
            // Preserve any drops that occurred between the reconnect event
            // and this first successful frame — they belong to the new session.
            const postReconnectDrops =
              droppedFrameCountRef.current - droppedAtReconnectRef.current;
            droppedFrameCountRef.current = postReconnectDrops;
            // Sync the module-level counter — the reconnect recovery is the
            // only place that intentionally resets drops to a lower value.
            _persistedDroppedFrameCount = postReconnectDrops;
            setDroppedFrameCount(postReconnectDrops);
            if (lostCount > 0) {
              const msg = `Reconnected — ${lostCount} frame${lostCount === 1 ? "" : "s"} lost last disconnect`;
              setReconnectNotice(msg);
              if (reconnectNoticeTimerRef.current != null) {
                clearTimeout(reconnectNoticeTimerRef.current);
              }
              reconnectNoticeTimerRef.current = setTimeout(() => {
                setReconnectNotice(null);
                reconnectNoticeTimerRef.current = null;
              }, 5_000);
            }
          }

          setFrameCount((prev) => {
            _persistedFrameCount = prev + 1;
            return prev + 1;
          });
        } catch (err: unknown) {
          // Write failure, ingest failure, or consumer threw — count the drop.
          // Update ref synchronously, then cancel any active reconnect notice so
          // the red warning becomes visible immediately (recovery was not clean).
          droppedFrameCountRef.current += 1;
          _persistedDroppedFrameCount = droppedFrameCountRef.current;
          if (reconnectNoticeTimerRef.current != null) {
            clearTimeout(reconnectNoticeTimerRef.current);
            reconnectNoticeTimerRef.current = null;
            setReconnectNotice(null);
          }
          setDroppedFrameCount(droppedFrameCountRef.current);

          // ── Telemetry: report the drop to the server ────────────────────────
          // Classify the error so the engineering team can distinguish hardware-
          // level filesystem failures from ingest/consumer errors in the fleet.
          //   filesystem_error — ENOENT / EPERM / filesystem-level failure while
          //                      writing the JPEG to the session cache directory.
          //   unknown          — ingest callback threw, or the error was not a
          //                      filesystem error (covers corrupt frames, network
          //                      failures inside ingestEvidence, etc.).
          const sid = telemetrySessionIdRef.current;
          if (sid) {
            const errMsg =
              err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
            const reason: "filesystem_error" | "unknown" =
              errMsg.includes("enoent") ||
              errMsg.includes("no such file") ||
              errMsg.includes("eperm") ||
              errMsg.includes("permission denied") ||
              errMsg.includes("could not write")
                ? "filesystem_error"
                : "unknown";
            const deviceId =
              smartGlassesBle.getState().connectedDeviceId ?? "unknown";
            void customFetch(`/api/meta-glasses/events/${sid}`, {
              method: "POST",
              body: JSON.stringify({ type: "ble_frame_dropped", deviceId, reason }),
            }).catch(() => {
              // Best-effort telemetry — never let a reporting failure cascade
              // into additional UI noise for the technician.
            });
          }
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

  // ── Clean up the notice timer on unmount ─────────────────────────────────
  useEffect(() => {
    return () => {
      if (reconnectNoticeTimerRef.current != null) {
        clearTimeout(reconnectNoticeTimerRef.current);
        reconnectNoticeTimerRef.current = null;
      }
    };
  }, []);

  return {
    isActive: active && isBleConnected && setupComplete,
    isBleConnected,
    frameCount,
    droppedFrameCount,
    reconnectNotice,
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
