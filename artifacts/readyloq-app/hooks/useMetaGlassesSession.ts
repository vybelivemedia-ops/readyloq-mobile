/**
 * useMetaGlassesSession — Meta Ray-Ban Live AI integration hook
 *
 * Registers an active inspection session with the ReadyLoq API so that the
 * technician's Meta glasses can forward voice commands and camera frames to
 * the server for AI analysis. Polls for buffered events and delivers them
 * to the caller via the onFinding callback.
 *
 * Usage:
 *   const glasses = useMetaGlassesSession({
 *     inspectionId: wsInspectionId,
 *     active: isFaieListening || isInspecting,
 *     onFinding: (event) => { ... merge into inspection state ... },
 *   });
 *
 *   // Show to tech so they can configure their glasses:
 *   glasses.code   // e.g. "A3F9BC"
 *   glasses.status // e.g. "Glasses active · 3 events"
 */

import { useAuth } from "@clerk/expo";
import { useEffect, useRef, useState, useCallback } from "react";
import { API_BASE } from "@/lib/api";

export interface GlassesFinding {
  category: string;
  description: string;
  confidence: number;
  severity: "low" | "medium" | "high" | "critical";
  zone?: string;
  species?: string;
}

export interface GlassesEvent {
  id: string;
  type: "finding" | "status" | "transcription";
  timestamp: number;
  text: string;
  finding?: GlassesFinding;
  /** Object-storage path of the persisted glasses frame (set by server). */
  storagePath?: string;
  /** inspectionMediaTable row ID for the persisted frame (set by server). */
  mediaId?: number;
  /**
   * One-word subject label from the Gemini digital-zoom clarification pass,
   * e.g. "cockroach", "mousetrap", "crack". Present when the stored frame
   * was cropped to this subject before storage.
   */
  zoomSubject?: string;
}

interface UseMetaGlassesSessionOptions {
  /** Server-assigned inspection ID (null until the inspection is persisted). */
  inspectionId: number | null;
  /** Session is active (inspection is open). When false, polling pauses. */
  active: boolean;
  /** Called for each new event received from the server. */
  onFinding: (event: GlassesEvent) => void;
}

interface MetaGlassesSessionState {
  /** UUID of the active session — used internally for polling. */
  sessionId: string | null;
  /** 6-char human-readable code the tech enters in the Meta app. */
  code: string | null;
  /** Number of events received this session. */
  eventCount: number;
  /** Short status string for display in the FAIE banner. */
  status: string | null;
  /** True once the session is registered and polling. */
  isActive: boolean;
  /**
   * True when the session is active but no event has arrived in the last
   * 2 minutes — prompts the technician to check the glasses connection.
   */
  isInactive: boolean;
  /**
   * True for 8 s after the session reconnects and a new pairing code is
   * issued — lets the UI highlight the code so the tech notices it changed.
   */
  codeJustChanged: boolean;
  /**
   * Fire-and-forget POST of a BLE telemetry event to the active session.
   * Safe to call even when no session is registered — it silently no-ops.
   * On network failure the event is discarded (best-effort telemetry).
   *
   * Callers should not await this — it is intentionally non-blocking so
   * the frame-drop hot-path is never stalled by a network call.
   */
  postTelemetryEvent(payload: {
    type: string;
    deviceId?: string | null;
    reason?: string;
    count?: number;
  }): void;
  /**
   * Retry session registration immediately.  Call this after fixing whatever
   * caused a previous failure (e.g. Meta app was closed, network was down).
   * Safe to call at any time — no-ops when registration is already active.
   */
  retrySession(): void;
}

const POLL_INTERVAL_MS = 3_000;        // poll every 3 s
const INACTIVITY_MS   = 2 * 60 * 1_000; // warn after 2 min silence
const RECONNECT_INTERVAL_MS = 30_000;  // don't create sessions every poll on persistent 404s

/** Classify only known cloud errors; never display arbitrary server HTML/data. */
async function cloudRelayFailure(response: Response): Promise<string> {
  let detail = "";
  if (response.status === 404) {
    let error: unknown;
    try {
      error = (await response.json())?.error;
    } catch {
      // A missing API route may return HTML rather than JSON.
    }
    detail = error === "Inspection not found"
      ? " This inspection was not found for your company on the configured server."
      : " Check the configured Cloud Relay API route and inspection ID.";
  }
  return `Cloud Relay unavailable (${response.status}).${detail} Phone camera remains active.`;
}

export function useMetaGlassesSession({
  inspectionId,
  active,
  onFinding,
}: UseMetaGlassesSessionOptions): MetaGlassesSessionState {
  const { getToken } = useAuth();
  const getTokenRef = useRef(getToken);
  getTokenRef.current = getToken;

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [code, setCode]           = useState<string | null>(null);
  const [eventCount, setEventCount] = useState(0);
  const [isActive, setIsActive]   = useState(false);
  const [isInactive, setIsInactive] = useState(false);
  const [status, setStatus]       = useState<string | null>(null);
  // #109 — true for 8 s after a reconnect issues a new pairing code.
  const [codeJustChanged, setCodeJustChanged] = useState(false);

  // Last-polled cursor — never triggers re-renders.
  const lastSeenRef      = useRef<number>(0);
  // Last time any event arrived — used for #106 inactivity detection.
  const lastEventTimeRef = useRef<number>(0);
  const lastReconnectAttemptRef = useRef<number>(-Infinity);
  // Stable ref so the polling closure always calls the latest onFinding.
  const onFindingRef     = useRef(onFinding);
  onFindingRef.current   = onFinding;
  // Set to inspectionId only after a successful registration.  Not set on
  // failure so the next render (or retrySession() call) can try again.
  const registeredForRef = useRef<number | null>(null);
  // True while an async registration POST is in-flight; prevents concurrent
  // duplicate requests without permanently blocking retries on failure.
  const registeringRef   = useRef(false);
  // Always-current copy of inspectionId for use inside async poll closure.
  const inspectionIdRef  = useRef(inspectionId);
  inspectionIdRef.current = inspectionId;
  const activeRef = useRef(active);
  activeRef.current = active;
  // #111 — set of delivered event IDs; prevents re-delivery if cursor races.
  const seenEventIdsRef  = useRef(new Set<string>());
  // Incrementing counter: bumping this forces the registration effect to
  // re-run even when active/inspectionId/getToken haven't changed (retry).
  const [retryCount, setRetryCount] = useState(0);

  // Meta is an optional provider. Turning it off must immediately stop polling,
  // clear the inspection-scoped cloud session, and make telemetry a no-op.
  useEffect(() => {
    if (active && inspectionId) return;
    registeredForRef.current = null;
    setSessionId(null);
    setCode(null);
    setEventCount(0);
    setIsActive(false);
    setIsInactive(false);
    setStatus(null);
    setCodeJustChanged(false);
    lastSeenRef.current = 0;
    lastEventTimeRef.current = 0;
    lastReconnectAttemptRef.current = -Infinity;
    seenEventIdsRef.current.clear();
  }, [active, inspectionId]);

  // ── Session registration ───────────────────────────────────────────────────
  useEffect(() => {
    if (!active || !inspectionId) return;
    if (registeredForRef.current === inspectionId) return; // already succeeded
    if (registeringRef.current) return;                    // POST in-flight

    // An inspection change owns a new session. Never leave the previous
    // inspection's polling/session state active while registering the next one.
    if (
      registeredForRef.current !== null &&
      registeredForRef.current !== inspectionId
    ) {
      registeredForRef.current = null;
      setSessionId(null);
      setCode(null);
      setEventCount(0);
      setIsActive(false);
      setIsInactive(false);
      setStatus(null);
      lastSeenRef.current = 0;
      lastEventTimeRef.current = 0;
      lastReconnectAttemptRef.current = -Infinity;
      seenEventIdsRef.current.clear();
    }

    let cancelled = false;
    registeringRef.current = true;

    (async () => {
      try {
        const token = await getTokenRef.current();
        if (
          cancelled &&
          (!activeRef.current || inspectionIdRef.current !== inspectionId)
        ) return;
        const res = await fetch(`${API_BASE}/api/meta-glasses/session`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ inspectionId }),
        });
        if (!activeRef.current || inspectionIdRef.current !== inspectionId) return;
        if (!res.ok) {
          const failure = await cloudRelayFailure(res);
          if (!activeRef.current || inspectionIdRef.current !== inspectionId) return;
          setStatus(failure);
          return;
        }
        const data = (await res.json()) as { sessionId: string; code: string };
        // Only mark as registered after confirmed success so failures don't
        // permanently block retries (the original bug: ref was set up-front).
        registeredForRef.current = inspectionId;
        setSessionId(data.sessionId);
        setCode(data.code);
        setIsActive(true);
        setIsInactive(false);
        setStatus("Cloud Relay ready");
        lastSeenRef.current      = Date.now();
        lastEventTimeRef.current = Date.now();
      } catch {
        if (
          !cancelled &&
          activeRef.current &&
          inspectionIdRef.current === inspectionId
        ) {
          setStatus("Cloud Relay unavailable. Phone camera remains active.");
        }
        // registeredForRef NOT set; next retrySession() call retries.
      } finally {
        registeringRef.current = false;
        // If this effect was replaced while the same inspection is still opted
        // in, re-evaluate once after the in-flight request settles. This avoids
        // starting a duplicate request while preserving an explicit reconnect.
        if (
          cancelled &&
          activeRef.current &&
          inspectionIdRef.current !== null &&
          registeredForRef.current !== inspectionIdRef.current
        ) {
          setRetryCount((c) => c + 1);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  // retryCount is intentionally included: incrementing it forces an explicit
  // retry. getToken is read from a ref so auth-hook identity changes cannot
  // create duplicate Meta sessions during ordinary inspection re-renders.
  }, [active, inspectionId, retryCount]);

  // ── Polling ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!active || !sessionId) return;

    let timer: ReturnType<typeof setTimeout>;
    let cancelled = false;
    const scheduleNext = () => {
      if (!cancelled && activeRef.current) {
        timer = setTimeout(poll, POLL_INTERVAL_MS);
      }
    };

    const poll = async () => {
      try {
        const token = await getTokenRef.current();
        if (cancelled || !activeRef.current) return;
        const since = lastSeenRef.current;
        const res = await fetch(
          `${API_BASE}/api/meta-glasses/events/${sessionId}?since=${since}`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        if (cancelled || !activeRef.current) return;

        // ── #104 — Session lost (API restart): re-register inline ─────────
        if (res.status === 404) {
          setIsInactive(false);
          const iid = inspectionIdRef.current;
          if (iid && activeRef.current && Date.now() - lastReconnectAttemptRef.current >= RECONNECT_INTERVAL_MS) {
            setStatus("Reconnecting Cloud Relay…");
            lastReconnectAttemptRef.current = Date.now();
            try {
              const t2  = await getTokenRef.current();
              if (cancelled || !activeRef.current) return;
              const reg = await fetch(`${API_BASE}/api/meta-glasses/session`, {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${t2}` },
                body: JSON.stringify({ inspectionId: iid }),
              });
              if (cancelled || !activeRef.current) return;
              if (reg.ok) {
                const d = (await reg.json()) as { sessionId: string; code: string };
                if (cancelled || !activeRef.current) return;
                setCode(d.code);
                setCodeJustChanged(true);
                setTimeout(() => {
                  if (activeRef.current) setCodeJustChanged(false);
                }, 10_000);
                setStatus("Cloud Relay reconnected · update code");
                lastSeenRef.current      = Date.now();
                lastEventTimeRef.current = Date.now();
                registeredForRef.current = iid;
                // Updating sessionId triggers this effect to restart cleanly.
                setSessionId(d.sessionId);
                return; // current loop ends; new effect run takes over
              }
              const failure = await cloudRelayFailure(reg);
              if (cancelled || !activeRef.current || inspectionIdRef.current !== iid) return;
              setStatus(failure);
            } catch {
              if (cancelled || !activeRef.current || inspectionIdRef.current !== iid) return;
              setStatus("Cloud Relay unavailable. Phone camera remains active.");
            }
          }
          scheduleNext();
          return;
        }

        if (!res.ok) {
          scheduleNext();
          return;
        }

        const data = (await res.json()) as { events: GlassesEvent[]; serverTime: number };
        if (cancelled || !activeRef.current) return;

        if (data.events.length > 0) {
          // #111 — skip events already delivered (guards against poll-cursor race).
          const newEvents = data.events.filter((e) => {
            if (seenEventIdsRef.current.has(e.id)) return false;
            seenEventIdsRef.current.add(e.id);
            return true;
          });

          if (newEvents.length > 0) {
            const newest = Math.max(...newEvents.map((e) => e.timestamp));
            lastSeenRef.current      = newest;
            lastEventTimeRef.current = Date.now();

            setIsInactive(false);
            // #109 — first event after reconnect collapses the expanded code banner.
            setCodeJustChanged(false);
            setEventCount((prev) => prev + newEvents.length);
            setStatus(`Cloud Relay active · ${newEvents.length} new event${newEvents.length === 1 ? "" : "s"}`);

            for (const event of newEvents) {
              onFindingRef.current(event);
            }

            setTimeout(() => {
              if (activeRef.current) setStatus("Cloud Relay active");
            }, 4_000);
          }
        }

        // ── #106 — Inactivity check ───────────────────────────────────────
        const silentMs = Date.now() - lastEventTimeRef.current;
        if (lastEventTimeRef.current > 0 && silentMs > INACTIVITY_MS) {
          setIsInactive(true);
          setStatus("Cloud Relay inactive — check relay connection");
        } else {
          setIsInactive(false);
        }
      } catch {
        // Polling failures are silent — network may be flaky in the field.
      }

      scheduleNext();
    };

    timer = setTimeout(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [active, sessionId]);

  // ── Cleanup on inspection change ──────────────────────────────────────────
  useEffect(() => {
    if (!inspectionId) {
      setSessionId(null);
      setCode(null);
      setIsActive(false);
      setIsInactive(false);
      setStatus(null);
      setEventCount(0);
      lastSeenRef.current      = 0;
      lastEventTimeRef.current = 0;
      lastReconnectAttemptRef.current = -Infinity;
      registeredForRef.current = null;
      seenEventIdsRef.current.clear();
    }
  }, [inspectionId]);

  // ── postTelemetryEvent — fire-and-forget BLE telemetry POST ───────────────
  // Stable across renders (useCallback with stable deps) so callers can safely
  // list it in effect dependency arrays without triggering re-subscriptions.
  // Always-current session ID is read inside the async function via closure —
  // the callback captures the outer `sessionId` state, which is a React state
  // value. We use a ref so the latest session ID is always readable without
  // the function identity changing on every render.
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;

  const postTelemetryEvent = useCallback(
    (payload: { type: string; deviceId?: string | null; reason?: string; count?: number }) => {
      const sid = sessionIdRef.current;
      if (!sid || !activeRef.current) return; // no active session — silently discard

      // Fire-and-forget: network failures are acceptable for telemetry.
      void (async () => {
        try {
          const token = await getTokenRef.current();
          if (!activeRef.current || sessionIdRef.current !== sid) return;
          await fetch(`${API_BASE}/api/meta-glasses/events/${sid}`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(payload),
          });
        } catch {
          // Best-effort telemetry — silently discard network failures.
        }
      })();
    },
    [],
  );

  const retrySession = useCallback(() => {
    // Clear success flag so the registration effect re-runs on next render.
    registeredForRef.current = null;
    setStatus(null);
    setRetryCount((c) => c + 1);
  }, []);

  return { sessionId, code, eventCount, status, isActive, isInactive, codeJustChanged, postTelemetryEvent, retrySession };
}
