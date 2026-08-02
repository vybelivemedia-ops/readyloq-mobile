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
}

const POLL_INTERVAL_MS = 3_000;        // poll every 3 s
const INACTIVITY_MS   = 2 * 60 * 1_000; // warn after 2 min silence

export function useMetaGlassesSession({
  inspectionId,
  active,
  onFinding,
}: UseMetaGlassesSessionOptions): MetaGlassesSessionState {
  const { getToken } = useAuth();

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
  // Stable ref so the polling closure always calls the latest onFinding.
  const onFindingRef     = useRef(onFinding);
  onFindingRef.current   = onFinding;
  // Prevent duplicate registration for the same inspection.
  const registeredForRef = useRef<number | null>(null);
  // Always-current copy of inspectionId for use inside async poll closure.
  const inspectionIdRef  = useRef(inspectionId);
  inspectionIdRef.current = inspectionId;
  // #111 — set of delivered event IDs; prevents re-delivery if cursor races.
  const seenEventIdsRef  = useRef(new Set<string>());

  // ── Session registration ───────────────────────────────────────────────────
  useEffect(() => {
    if (!active || !inspectionId || registeredForRef.current === inspectionId) return;

    let cancelled = false;
    registeredForRef.current = inspectionId;

    (async () => {
      try {
        const token = await getToken();
        const res = await fetch(`${API_BASE}/api/meta-glasses/session`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
          body: JSON.stringify({ inspectionId }),
        });
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { sessionId: string; code: string };
        setSessionId(data.sessionId);
        setCode(data.code);
        setIsActive(true);
        setIsInactive(false);
        setStatus("Glasses ready");
        lastSeenRef.current      = Date.now();
        lastEventTimeRef.current = Date.now();
      } catch {
        if (!cancelled) setStatus(null);
      }
    })();

    return () => { cancelled = true; };
  }, [active, inspectionId, getToken]);

  // ── Polling ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!active || !sessionId) return;

    let timer: ReturnType<typeof setTimeout>;

    const poll = async () => {
      try {
        const token = await getToken();
        const since = lastSeenRef.current;
        const res = await fetch(
          `${API_BASE}/api/meta-glasses/events/${sessionId}?since=${since}`,
          { headers: { Authorization: `Bearer ${token}` } },
        );

        // ── #104 — Session lost (API restart): re-register inline ─────────
        if (res.status === 404) {
          setStatus("Reconnecting glasses…");
          setIsInactive(false);
          const iid = inspectionIdRef.current;
          if (iid) {
            try {
              const t2  = await getToken();
              const reg = await fetch(`${API_BASE}/api/meta-glasses/session`, {
                method: "POST",
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${t2}` },
                body: JSON.stringify({ inspectionId: iid }),
              });
              if (reg.ok) {
                const d = (await reg.json()) as { sessionId: string; code: string };
                setCode(d.code);
                setCodeJustChanged(true);
                setTimeout(() => setCodeJustChanged(false), 10_000);
                setStatus("Glasses reconnected · update code");
                lastSeenRef.current      = Date.now();
                lastEventTimeRef.current = Date.now();
                registeredForRef.current = iid;
                // Updating sessionId triggers this effect to restart cleanly.
                setSessionId(d.sessionId);
                return; // current loop ends; new effect run takes over
              }
            } catch { /* will retry on next tick */ }
          }
          timer = setTimeout(poll, POLL_INTERVAL_MS);
          return;
        }

        if (!res.ok) {
          timer = setTimeout(poll, POLL_INTERVAL_MS);
          return;
        }

        const data = (await res.json()) as { events: GlassesEvent[]; serverTime: number };

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
            setStatus(`Glasses active · ${newEvents.length} new event${newEvents.length === 1 ? "" : "s"}`);

            for (const event of newEvents) {
              onFindingRef.current(event);
            }

            setTimeout(() => setStatus("Glasses active"), 4_000);
          }
        }

        // ── #106 — Inactivity check ───────────────────────────────────────
        const silentMs = Date.now() - lastEventTimeRef.current;
        if (lastEventTimeRef.current > 0 && silentMs > INACTIVITY_MS) {
          setIsInactive(true);
          setStatus("Glasses may be inactive — check connection");
        } else {
          setIsInactive(false);
        }
      } catch {
        // Polling failures are silent — network may be flaky in the field.
      }

      timer = setTimeout(poll, POLL_INTERVAL_MS);
    };

    timer = setTimeout(poll, POLL_INTERVAL_MS);
    return () => clearTimeout(timer);
  }, [active, sessionId, getToken]);

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
      registeredForRef.current = null;
      seenEventIdsRef.current.clear();
    }
  }, [inspectionId]);

  return { sessionId, code, eventCount, status, isActive, isInactive, codeJustChanged };
}
