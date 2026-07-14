import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from "react";
import { AppState } from "react-native";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";

import type { Stream } from "@workspace/api-client-react";

// Unique tag so our wake lock is independent of any other keep-awake usage.
const KEEP_AWAKE_TAG = "vybe-live-stream";

// Lightweight diagnostic logging for stream-session and timer lifecycle.
// Tagged so it can be filtered in Metro / device logs ("[stream]").
function logStream(event: string, data?: Record<string, unknown>) {
  console.log(`[stream] ${event}`, data ? JSON.stringify(data) : "");
}

function toStartedAtMs(startedAt: Stream["startedAt"] | null | undefined): number | null {
  if (!startedAt) return null;
  const t = new Date(startedAt).getTime();
  return Number.isFinite(t) ? t : null;
}

export type DeviceType = "phone" | "gopro" | "meta_glasses" | "external_rtmp" | "usb_camera" | "webrtc";
export type StreamHealth = "excellent" | "good" | "poor" | "critical";

export interface ChatMessage {
  id: string;
  platform: string;
  username: string;
  message: string;
  timestamp: number;
  color?: string;
  isPinned?: boolean;
}

export interface ClipMarker {
  id: string;
  timestamp: number;
  streamSecond: number;
  isAI: boolean;
  score?: number;
  label?: string;
}

export interface AgoraCredentials {
  appId: string;
  token: string;
  channelName: string;
  uid: number;
  expiresAt: string;
}

interface StreamContextValue {
  activeStream: Stream | null;
  agoraCredentials: AgoraCredentials | null;
  isLive: boolean;
  isConnecting: boolean;
  isReconnecting: boolean;
  deviceType: DeviceType;
  selectedPlatforms: string[];
  streamTitle: string;
  streamTags: string[];
  viewerCount: number;
  peakViewers: number;
  streamDuration: number;
  health: StreamHealth;
  bitrate: number;
  droppedFrames: number;
  signalStrength: number;
  battery: number;
  isOverheating: boolean;
  platformHealth: Record<string, "live" | "reconnecting" | "failed">;
  chatMessages: ChatMessage[];
  pinnedMessage: ChatMessage | null;
  clipMarkers: ClipMarker[];
  aiHighlightsActive: boolean;
  pendingClipsCount: number;

  setActiveStream: (stream: Stream | null) => void;
  setAgoraCredentials: (creds: AgoraCredentials | null) => void;
  setIsLive: (live: boolean) => void;
  setIsConnecting: (connecting: boolean) => void;
  setIsReconnecting: (v: boolean) => void;
  setDeviceType: (type: DeviceType) => void;
  setSelectedPlatforms: (platforms: string[]) => void;
  setViewerCount: (count: number) => void;
  setStreamTitle: (title: string) => void;
  setStreamTags: (tags: string[]) => void;
  setBitrate: (kbps: number) => void;
  setDroppedFrames: (n: number) => void;
  setSignalStrength: (n: number) => void;
  setBattery: (n: number) => void;
  setIsOverheating: (v: boolean) => void;
  setPlatformHealth: (ph: Record<string, "live" | "reconnecting" | "failed">) => void;
  setAiHighlightsActive: (v: boolean) => void;
  addChatMessage: (msg: Omit<ChatMessage, "id" | "timestamp">) => void;
  pinMessage: (id: string) => void;
  unpinMessage: () => void;
  addClipMarker: (isAI: boolean, score?: number, label?: string) => void;
  incrementPendingClips: () => void;
  clearStream: () => void;
}

export function deriveHealth(bitrate: number, droppedFrames: number, signalStrength: number): StreamHealth {
  if (bitrate < 800 || droppedFrames > 50 || signalStrength <= 1) return "critical";
  if (bitrate < 2000 || droppedFrames > 20 || signalStrength <= 2) return "poor";
  if (bitrate < 3500 || droppedFrames > 5 || signalStrength <= 3) return "good";
  return "excellent";
}

const StreamContext = createContext<StreamContextValue>({} as StreamContextValue);

export function StreamProvider({ children }: { children: React.ReactNode }) {
  const [activeStream, setActiveStreamState] = useState<Stream | null>(null);
  const [agoraCredentials, setAgoraCredentials] = useState<AgoraCredentials | null>(null);
  const [isLive, setIsLive] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isReconnecting, setIsReconnectingState] = useState(false);
  const [deviceType, setDeviceType] = useState<DeviceType>("phone");
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>([]);
  const [streamTitle, setStreamTitle] = useState("");
  const [streamTags, setStreamTags] = useState<string[]>([]);
  const [viewerCount, setViewerCountState] = useState(0);
  const [peakViewers, setPeakViewers] = useState(0);
  // `nowMs` is the only timer state — it is bumped once per second (and on
  // foreground) so the duration recomputes from the persisted startedAt.
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [bitrate, setBitrateState] = useState(4800);
  const [droppedFrames, setDroppedFramesState] = useState(0);
  const [signalStrength, setSignalStrengthState] = useState(4);
  const [battery, setBatteryState] = useState(100);
  const [isOverheating, setIsOverheatingState] = useState(false);
  const [platformHealth, setPlatformHealthState] = useState<Record<string, "live" | "reconnecting" | "failed">>({});
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [pinnedMessage, setPinnedMessage] = useState<ChatMessage | null>(null);
  const [clipMarkers, setClipMarkers] = useState<ClipMarker[]>([]);
  const [aiHighlightsActive, setAiHighlightsActive] = useState(true);
  const [pendingClipsCount, setPendingClipsCount] = useState(0);

  const health = deriveHealth(bitrate, droppedFrames, signalStrength);

  // ── Timer derived from the persisted backend startedAt ────────────────────
  // Source of truth is `activeStream.startedAt` (set server-side on /start),
  // NOT a locally accumulated counter. This makes the elapsed time survive
  // reconnects, app backgrounding, navigation changes, and component remounts:
  // it is always recomputed from an absolute timestamp.
  const startedAtMs = toStartedAtMs(activeStream?.startedAt);
  const streamDuration =
    startedAtMs != null ? Math.max(0, Math.floor((nowMs - startedAtMs) / 1000)) : 0;

  // Stable ref so the AppState listener (mounted once) can read current stream.
  const activeStreamRef = useRef<Stream | null>(null);
  activeStreamRef.current = activeStream;

  // Tick once per second while live so the derived duration updates. JS timers
  // are throttled/paused while backgrounded; the AppState handler recomputes on
  // foreground so no time is ever lost.
  useEffect(() => {
    if (!isLive || startedAtMs == null) return;
    setNowMs(Date.now());
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [isLive, startedAtMs]);

  // Hold a screen wake lock for the entire live session so the device never
  // dims or auto-locks mid-broadcast. Keyed on isLive (not the POV screen) so
  // it survives navigation away from the stream UI and reconnects (isLive stays
  // true), and releases the instant the stream ends/clears. Activating while
  // backgrounded is harmless; the OS only enforces it while the app is active.
  useEffect(() => {
    if (!isLive) return;
    void activateKeepAwakeAsync(KEEP_AWAKE_TAG);
    return () => {
      void deactivateKeepAwake(KEEP_AWAKE_TAG);
    };
  }, [isLive]);

  // App foreground/background transitions: log them and recompute immediately
  // on return to foreground so the timer self-corrects after backgrounding.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      const streamId = activeStreamRef.current?.id ?? null;
      const startedAt = activeStreamRef.current?.startedAt ?? null;
      if (next === "active") {
        logStream("app-foreground", { streamId, startedAt });
        setNowMs(Date.now());
      } else if (next === "background" || next === "inactive") {
        logStream("app-background", { streamId, state: next });
      }
    });
    return () => sub.remove();
  }, []);

  // Diagnostic guards: surface an unexpected timer reset (live but no usable
  // startedAt) and one-time clock skew, so a 00:00 while LIVE is never silent.
  const missingLoggedRef = useRef(false);
  const skewLoggedRef = useRef(false);
  useEffect(() => {
    if (!isLive) {
      missingLoggedRef.current = false;
      skewLoggedRef.current = false;
      return;
    }
    if (startedAtMs == null) {
      if (!missingLoggedRef.current) {
        missingLoggedRef.current = true;
        logStream("timer-source-missing", {
          streamId: activeStreamRef.current?.id ?? null,
          reason: "isLive but startedAt missing/invalid",
        });
      }
      return;
    }
    missingLoggedRef.current = false;
    if (startedAtMs > Date.now() && !skewLoggedRef.current) {
      skewLoggedRef.current = true;
      logStream("clock-skew", {
        streamId: activeStreamRef.current?.id ?? null,
        startedAt: activeStreamRef.current?.startedAt ?? null,
        skewMs: startedAtMs - Date.now(),
      });
    }
  }, [isLive, startedAtMs]);

  const setActiveStream = useCallback((stream: Stream | null) => {
    setActiveStreamState(stream);
    if (stream) {
      logStream("active-stream-set", {
        streamId: stream.id,
        startedAt: stream.startedAt ?? null,
        status: stream.status,
      });
    } else {
      logStream("active-stream-cleared", { streamId: activeStreamRef.current?.id ?? null });
    }
  }, []);

  const setIsReconnecting = useCallback((v: boolean) => {
    setIsReconnectingState(v);
    logStream(v ? "reconnect-start" : "reconnect-end", {
      streamId: activeStreamRef.current?.id ?? null,
      startedAt: activeStreamRef.current?.startedAt ?? null,
    });
  }, []);

  const setViewerCount = useCallback((count: number) => {
    setViewerCountState(count);
    setPeakViewers((prev) => Math.max(prev, count));
  }, []);

  const setBitrate = useCallback((kbps: number) => setBitrateState(kbps), []);
  const setDroppedFrames = useCallback((n: number) => setDroppedFramesState(n), []);
  const setSignalStrength = useCallback((n: number) => setSignalStrengthState(Math.max(0, Math.min(4, n))), []);
  const setBattery = useCallback((n: number) => setBatteryState(Math.max(0, Math.min(100, n))), []);
  const setIsOverheating = useCallback((v: boolean) => setIsOverheatingState(v), []);
  const setPlatformHealth = useCallback((ph: Record<string, "live" | "reconnecting" | "failed">) => setPlatformHealthState(ph), []);

  const addChatMessage = useCallback((msg: Omit<ChatMessage, "id" | "timestamp">) => {
    const newMsg: ChatMessage = {
      ...msg,
      id: Date.now().toString() + Math.random().toString(36).slice(2, 6),
      timestamp: Date.now(),
    };
    setChatMessages((prev) => [newMsg, ...prev].slice(0, 150));
  }, []);

  const pinMessage = useCallback((id: string) => {
    setChatMessages((prev) => {
      const found = prev.find((m) => m.id === id);
      if (found) setPinnedMessage({ ...found, isPinned: true });
      return prev;
    });
  }, []);

  const unpinMessage = useCallback(() => {
    setPinnedMessage(null);
  }, []);

  const addClipMarker = useCallback((isAI: boolean, score?: number, label?: string) => {
    setClipMarkers((prev) => [
      { id: Date.now().toString(), timestamp: Date.now(), streamSecond: 0, isAI, score, label },
      ...prev,
    ].slice(0, 20));
  }, []);

  const incrementPendingClips = useCallback(() => setPendingClipsCount((n) => n + 1), []);

  const clearStream = useCallback(() => {
    logStream("timer-reset", {
      streamId: activeStreamRef.current?.id ?? null,
      startedAt: activeStreamRef.current?.startedAt ?? null,
      reason: "clearStream",
    });
    setActiveStreamState(null);
    setAgoraCredentials(null);
    setIsLive(false);
    setIsConnecting(false);
    setIsReconnectingState(false);
    setViewerCountState(0);
    setPeakViewers(0);
    setBitrateState(4800);
    setDroppedFramesState(0);
    setSignalStrengthState(4);
    setPlatformHealthState({});
    setChatMessages([]);
    setPinnedMessage(null);
    setClipMarkers([]);
    setPendingClipsCount(0);
  }, []);

  return (
    <StreamContext.Provider
      value={{
        activeStream, agoraCredentials, isLive, isConnecting, isReconnecting,
        deviceType, selectedPlatforms, streamTitle, streamTags,
        viewerCount, peakViewers, streamDuration,
        health, bitrate, droppedFrames, signalStrength, battery, isOverheating,
        platformHealth, chatMessages, pinnedMessage,
        clipMarkers, aiHighlightsActive, pendingClipsCount,
        setActiveStream, setAgoraCredentials, setIsLive, setIsConnecting, setIsReconnecting,
        setDeviceType, setSelectedPlatforms, setViewerCount,
        setStreamTitle, setStreamTags,
        setBitrate, setDroppedFrames, setSignalStrength, setBattery,
        setIsOverheating, setPlatformHealth, setAiHighlightsActive,
        addChatMessage, pinMessage, unpinMessage,
        addClipMarker, incrementPendingClips,
        clearStream,
      }}
    >
      {children}
    </StreamContext.Provider>
  );
}

export function useStream() {
  return useContext(StreamContext);
}
