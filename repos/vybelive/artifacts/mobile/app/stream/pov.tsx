import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Alert,
  Animated,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ChatOverlay } from "@/components/stream/ChatOverlay";
import { HealthBar } from "@/components/stream/HealthBar";
import { LiveReactions } from "@/components/stream/LiveReactions";
import { VideoSourcePreview } from "@/components/stream/VideoSourcePreview";
import { MetaGlassesSource } from "@/sources/MetaGlassesSource";
import { useStream } from "@/contexts/StreamContext";
import { useMetaWearablesContext } from "@/contexts/MetaWearablesContext";
import { useColors } from "@/hooks/useColors";
import { useAgoraRTC, isExpoGo } from "@/hooks/useAgoraRTC";
import { useAuth } from "@/contexts/AuthContext";
import { useVideoSource } from "@/hooks/useVideoSource";
import { useVoiceRecognition } from "@/hooks/useVoiceRecognition";
import { useGestureRecognition } from "@/hooks/useGestureRecognition";
import {
  useEndStream,
  useCreateClip,
  useCreateStreamMarker,
  useGetRecognitionSettings,
  getListStreamsQueryKey,
  getGetActiveStreamQueryKey,
  getListStreamRecordingsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";

const GESTURE_LABELS: Record<string, string> = {
  thumbs_up: "Thumbs up",
  peace: "Peace sign",
  pointing: "Pointing",
  open_palm: "Open palm",
};

const API_BASE = process.env["EXPO_PUBLIC_DOMAIN"]
  ? `https://${process.env["EXPO_PUBLIC_DOMAIN"]}/api`
  : "https://getvybe.live/api";

const PLATFORM_COLORS: Record<string, string> = {
  youtube: "#FF0000", twitch: "#9146FF", kick: "#53FC18",
  facebook: "#1877F2", instagram: "#E1306C", tiktok: "#00F2EA", custom_rtmp: "#888",
};

const DEMO_CHAT = [
  { platform: "twitch",    username: "xVybeCreator",   message: "This POV is insane! 🔥",            color: "#A78BFA" },
  { platform: "youtube",   username: "StreamFan99",     message: "Love the perspective bro",           color: "#A78BFA" },
  { platform: "kick",      username: "KickLive42",      message: "Go off!! first time watching 💯",    color: "#A78BFA" },
  { platform: "tiktok",    username: "tiktok_dev",      message: "drop location pls",                  color: "#A78BFA" },
  { platform: "instagram", username: "insta.creator",   message: "reposting this to my story",         color: "#A78BFA" },
  { platform: "youtube",   username: "NightRider_",     message: "best POV stream I've seen today",    color: "#A78BFA" },
  { platform: "twitch",    username: "vybe_watcher",    message: "how many fps is this?",              color: "#A78BFA" },
  { platform: "facebook",  username: "James.M",         message: "sharing this right now",             color: "#A78BFA" },
];

const AI_HIGHLIGHT_LABELS = [
  "Peak viewer moment", "High reaction spike", "Fast motion detected",
  "Crowd energy detected", "Viral potential: high", "Top clip candidate",
];

function formatDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function formatViewers(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return n.toString();
}

export default function POVScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [facing, setFacing] = useState<"front" | "back">("back");
  const [showChat, setShowChat] = useState(true);
  const [isMuted, setIsMuted] = useState(false);
  const [isClipping, setIsClipping] = useState(false);
  const [clipSaved, setClipSaved] = useState(false);
  const [photoCapturing, setPhotoCapturing] = useState(false);
  const [photoCaptured, setPhotoCaptured] = useState(false);
  const [outdoorMode, setOutdoorMode] = useState(false);
  const flashAnim = useRef(new Animated.Value(0)).current;
  const healthRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const chatRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pushPollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Real viewer statistics accumulated from the live Agora RTC session. These
  // are persisted to the backend when the stream ends (no simulated values).
  const peakViewersRef = useRef(0);
  const viewerSumRef = useRef(0);
  const viewerSampleCountRef = useRef(0);
  // Tracks how many consecutive failed polls each platform has accumulated.
  // When a platform hits 2 consecutive failures, auto-reconnect is triggered.
  const failedPollCounts = useRef<Record<string, number>>({});

  const {
    activeStream, agoraCredentials, isLive, viewerCount, streamDuration, chatMessages,
    selectedPlatforms, streamTitle, health, bitrate, droppedFrames,
    signalStrength, battery, isOverheating, isReconnecting, platformHealth,
    pinnedMessage, aiHighlightsActive, pendingClipsCount, deviceType,
    addChatMessage, clearStream,
    setBitrate, setDroppedFrames, setSignalStrength, setBattery, setIsOverheating,
    setIsReconnecting, setPlatformHealth, pinMessage, unpinMessage, addClipMarker,
    incrementPendingClips,
  } = useStream();

  const { accessToken, getValidToken } = useAuth();

  // Active video source — handles permissions, pairing, and capability queries.
  const { source, sourceState, connect, connectError } = useVideoSource(deviceType);

  // Meta Glasses DAT session — manages the real SDK session lifecycle.
  // Works in all modes: real SDK (dev build + credentials) or simulation (Expo Go).
  const metaWearables = useMetaWearablesContext();

  // Gate the Agora join on the video source being connected. connect() requests
  // camera AND microphone permission; joining before it resolves would publish a
  // silent mic track (no RECORD_AUDIO grant yet) → video reaches YouTube with no
  // audio. Waiting for "connected"/"streaming" guarantees the mic prompt is
  // answered before joinChannel() publishes the microphone track.
  const sourceReady =
    sourceState.status === "connected" || sourceState.status === "streaming";

  const { isSupported: agoraSupported, isJoined: agoraJoined, engineRef: agoraEngine, leaveChannel: agoraLeave } =
    useAgoraRTC(activeStream?.id ?? null, agoraCredentials, isLive && sourceReady);

  const qc = useQueryClient();
  const endStream = useEndStream();
  const createClip = useCreateClip();
  const createMarker = useCreateStreamMarker();
  const { data: recognitionSettings } = useGetRecognitionSettings();

  // Hands-free recognition is opt-in per live session. The user enables it from
  // the HUD chip; it only actually runs when their saved settings also allow it.
  const [handsFreeOptIn, setHandsFreeOptIn] = useState(false);
  // Transient toast shown when a hands-free marker fires.
  const [markerToast, setMarkerToast] = useState<{ label: string; source: "voice" | "gesture" } | null>(null);
  const markerToastRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Snapshot of stream second at fire time without re-subscribing recognizers.
  const streamSecondRef = useRef(0);
  streamSecondRef.current = streamDuration;

  const dropMarker = useCallback(
    (source: "voice" | "gesture", triggerValue: string, label: string, score?: number) => {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      addClipMarker(true, score, label);
      incrementPendingClips();
      setMarkerToast({ label, source });
      if (markerToastRef.current) clearTimeout(markerToastRef.current);
      markerToastRef.current = setTimeout(() => setMarkerToast(null), 2600);
      if (activeStream) {
        createMarker.mutate({
          streamId: activeStream.id,
          data: {
            source,
            triggerValue,
            label,
            streamSecond: streamSecondRef.current,
            contextWindowSeconds: recognitionSettings?.contextWindowSeconds ?? 30,
            ...(score != null ? { score } : {}),
          },
        });
      }
    },
    [activeStream, recognitionSettings?.contextWindowSeconds, addClipMarker, incrementPendingClips, createMarker],
  );

  const voiceActive = handsFreeOptIn && isLive && !!recognitionSettings?.voiceEnabled;
  const gestureActive = handsFreeOptIn && isLive && !!recognitionSettings?.gestureEnabled;

  const voice = useVoiceRecognition({
    enabled: voiceActive,
    phrases: recognitionSettings?.triggerPhrases ?? [],
    sensitivity: recognitionSettings?.sensitivity ?? "medium",
    onTrigger: useCallback(
      (t: { phrase: string; confidence: number }) =>
        dropMarker("voice", t.phrase, `Voice: "${t.phrase}"`, t.confidence || undefined),
      [dropMarker],
    ),
  });

  const gesture = useGestureRecognition({
    enabled: gestureActive,
    gestures: recognitionSettings?.enabledGestures ?? [],
    sensitivity: recognitionSettings?.sensitivity ?? "medium",
    onTrigger: useCallback(
      (t: { gesture: string; confidence: number }) =>
        dropMarker(
          "gesture",
          t.gesture,
          GESTURE_LABELS[t.gesture] ?? t.gesture,
          t.confidence || undefined,
        ),
      [dropMarker],
    ),
  });

  useEffect(() => {
    return () => {
      if (markerToastRef.current) clearTimeout(markerToastRef.current);
    };
  }, []);

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  // ── Auto-connect video source when stream goes live ───────────────────────
  useEffect(() => {
    if (!isLive) return;
    // RTMP ingest sources need the stream credentials; camera sources just need connect().
    void connect(
      source.capabilities.mode === "rtmp_ingest" && activeStream
        ? {
            rtmpIngestUrl: activeStream.rtmpIngestUrl ?? undefined,
            streamKey: activeStream.streamKey ?? undefined,
          }
        : undefined
    ).catch(() => undefined); // errors surface via connectError, never silently swallowed
  }, [isLive]);

  // ── Meta Glasses DAT session lifecycle ────────────────────────────────────
  // Starts a real DAT session (createSession → startSession → addStreamToSession)
  // when the stream is live and Meta Glasses is the selected source.
  // Stops and cleans up the session when the stream ends or source changes.
  useEffect(() => {
    if (!isLive || deviceType !== "meta_glasses") return;
    void metaWearables.startGlassesStream().catch((err: unknown) => {
      // Surface DAT session failures so the preview shows an actionable error
      // instead of staying stuck on "starting".
      if (source instanceof MetaGlassesSource) {
        source.markStreamError(
          (err as Error)?.message ?? "Could not start the glasses stream.",
        );
      }
    });
    return () => {
      void metaWearables.stopGlassesStream().catch(() => undefined);
    };
  }, [isLive, deviceType]);

  // ── Duration timer ────────────────────────────────────────────────────────
  // The elapsed time is derived in StreamContext from the persisted
  // activeStream.startedAt, so it survives reconnects, backgrounding,
  // navigation, and remounts. No local counter is kept here.

  // ── Real push-status polling (only when Agora is live on device) ─────────
  useEffect(() => {
    if (!isLive || !activeStream || Platform.OS === "web" || !agoraSupported) return;

    const poll = async () => {
      if (!accessToken) return;
      try {
        const res = await fetch(`${API_BASE}/streams/${activeStream.id}/push/status`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (res.status === 401) {
          // Access token expired mid-stream — refresh silently.
          // accessToken is in the effect's dep array, so when getValidToken()
          // updates it in AuthContext the effect restarts with a fresh token.
          void getValidToken().catch(() => null);
          return;
        }
        if (!res.ok) return;
        const data = await res.json() as {
          destinations: Array<{ platform: string; status: string }>;
        };
        const ph: Record<string, "live" | "reconnecting" | "failed"> = {};
        data.destinations.forEach((d) => {
          const mapped =
            d.status === "live" ? "live"
            : d.status === "failed" ? "failed"
            : "reconnecting";
          ph[d.platform] = mapped;

          // Track consecutive failures for auto-reconnect
          if (d.status === "failed") {
            failedPollCounts.current[d.platform] =
              (failedPollCounts.current[d.platform] ?? 0) + 1;
          } else {
            failedPollCounts.current[d.platform] = 0;
          }
        });
        if (Object.keys(ph).length > 0) setPlatformHealth(ph);

        // Trigger reconnect for any platform that has failed 2+ consecutive polls
        const toReconnect = Object.entries(failedPollCounts.current)
          .filter(([, count]) => count >= 2)
          .map(([platform]) => platform);

        if (toReconnect.length > 0) {
          // Reset counts immediately to prevent rapid-fire reconnect calls
          toReconnect.forEach((p) => { failedPollCounts.current[p] = 0; });
          fetch(`${API_BASE}/streams/${activeStream.id}/push/reconnect`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ platforms: toReconnect }),
          }).catch(() => undefined);
        }
      } catch { /* silent — simulation covers when API unreachable */ }
    };

    // Delay the first poll by 5 s.  push/start is fire-and-forget in setup.tsx
    // and takes ~2 s to create the YouTube broadcast, bind it, and start the
    // Agora converter task.  Polling before that completes always returns an
    // empty destinations list and tells us nothing useful.
    const firstPollTimer = setTimeout(() => { void poll(); }, 5000);
    pushPollRef.current = setInterval(() => void poll(), 10_000);
    return () => {
      clearTimeout(firstPollTimer);
      if (pushPollRef.current) clearInterval(pushPollRef.current);
    };
  }, [isLive, activeStream?.id, agoraSupported, accessToken]);

  // ── Simulation engine (runs only when Agora is unavailable / web) ────────
  useEffect(() => {
    if (!isLive) return;
    if (Platform.OS !== "web" && agoraSupported) return;

    let baseBitrate = 4800;
    let simDropped = 0;
    let simSignal = 4;
    let simBattery = 85;
    let tick = 0;

    // Health / bitrate simulation (viewer count comes from the real Agora RTC
    // session via onRtcStats → setViewerCount; it is never simulated here).
    healthRef.current = setInterval(() => {
      tick++;

      // Bitrate fluctuation
      const bitrateNoise = (Math.random() - 0.5) * 400;
      let newBitrate = baseBitrate + bitrateNoise;

      // Occasional dip (network fluctuation)
      if (tick % 45 === 0) {
        newBitrate = baseBitrate * 0.3;
        simDropped += Math.floor(Math.random() * 15);
        setDroppedFrames(simDropped);
      } else if (tick % 60 === 0) {
        // Recovery
        newBitrate = baseBitrate;
        simDropped = Math.max(0, simDropped - 5);
        setDroppedFrames(simDropped);
      }
      setBitrate(Math.round(Math.max(200, newBitrate)));

      // Signal fluctuation
      if (tick % 30 === 0) {
        simSignal = Math.max(0, Math.min(4, simSignal + (Math.random() < 0.5 ? -1 : 1)));
        setSignalStrength(simSignal);
      }

      // Reconnect event (every ~2 min)
      if (tick % 120 === 0) {
        setIsReconnecting(true);
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
        setTimeout(() => setIsReconnecting(false), 8000);
      }

      // Overheating (after extended use)
      if (tick === 180) {
        setIsOverheating(true);
        setTimeout(() => setIsOverheating(false), 15000);
      }

      // Battery drain (1% per ~60 ticks / ~1 min)
      if (tick % 60 === 0 && simBattery > 0) {
        simBattery -= 1;
        setBattery(simBattery);
      }

      // Platform health events
      if (tick % 90 === 0 && selectedPlatforms.length > 0) {
        const randomPlatform = selectedPlatforms[Math.floor(Math.random() * selectedPlatforms.length)];
        const ph: Record<string, "live" | "reconnecting" | "failed"> = {};
        selectedPlatforms.forEach((p) => { ph[p] = "live"; });
        ph[randomPlatform] = "reconnecting";
        setPlatformHealth(ph);
        setTimeout(() => {
          const ph2: Record<string, "live" | "reconnecting" | "failed"> = {};
          selectedPlatforms.forEach((p) => { ph2[p] = "live"; });
          setPlatformHealth(ph2);
        }, 6000);
      }

      // AI highlight detection
      if (tick % 40 === 0 && aiHighlightsActive) {
        const label = AI_HIGHLIGHT_LABELS[Math.floor(Math.random() * AI_HIGHLIGHT_LABELS.length)];
        addClipMarker(true, Math.random() * 40 + 60, label);
        incrementPendingClips();
      }
    }, 2000);

    // Chat simulation
    chatRef.current = setInterval(() => {
      const msg = DEMO_CHAT[Math.floor(Math.random() * DEMO_CHAT.length)];
      addChatMessage({ ...msg });
    }, 2500);

    return () => {
      if (healthRef.current) clearInterval(healthRef.current);
      if (chatRef.current) clearInterval(chatRef.current);
    };
  }, [isLive, agoraSupported]);

  // ── Real viewer statistics ───────────────────────────────────────────────
  // Sample the live viewer count (sourced from the Agora RTC session) to derive
  // the peak and a running average. These are persisted when the stream ends.
  useEffect(() => {
    if (!isLive) {
      peakViewersRef.current = 0;
      viewerSumRef.current = 0;
      viewerSampleCountRef.current = 0;
      return;
    }
    peakViewersRef.current = Math.max(peakViewersRef.current, viewerCount);
    viewerSumRef.current += viewerCount;
    viewerSampleCountRef.current += 1;
  }, [isLive, viewerCount]);

  // ── Clip handling ────────────────────────────────────────────────────────
  const handleClip = useCallback(async () => {
    if (isClipping) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    setIsClipping(true);

    // White flash
    Animated.sequence([
      Animated.timing(flashAnim, { toValue: 1, duration: 60, useNativeDriver: true }),
      Animated.timing(flashAnim, { toValue: 0, duration: 300, useNativeDriver: true }),
    ]).start();

    addClipMarker(false);

    try {
      if (activeStream) {
        await createClip.mutateAsync({
          data: { title: `Clip · ${streamTitle}`, streamId: activeStream.id, aiGenerated: false, aspectRatio: "vertical" },
        });
      }
    } catch { /* ignore */ }

    setClipSaved(true);
    setTimeout(() => { setClipSaved(false); setIsClipping(false); }, 2000);
  }, [isClipping, activeStream, streamTitle, addClipMarker]);

  // ── Meta Glasses photo capture ────────────────────────────────────────────
  const handleCapturePhoto = useCallback(async () => {
    if (photoCapturing) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setPhotoCapturing(true);

    // White flash for shutter feedback
    Animated.sequence([
      Animated.timing(flashAnim, { toValue: 1, duration: 50, useNativeDriver: true }),
      Animated.timing(flashAnim, { toValue: 0, duration: 250, useNativeDriver: true }),
    ]).start();

    try {
      await metaWearables.captureGlassesPhoto();
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setPhotoCaptured(true);
    } catch {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    }

    setTimeout(() => { setPhotoCaptured(false); setPhotoCapturing(false); }, 1800);
  }, [photoCapturing, metaWearables, flashAnim]);

  // ── End stream ───────────────────────────────────────────────────────────
  const handleEnd = useCallback(() => {
    Alert.alert(
      "End stream?",
      "Your stream ends on all platforms. AI will generate clips from your best moments.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "End Stream",
          style: "destructive",
          onPress: async () => {
            Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            // End on the server FIRST. If this call fails the stream is still
            // live on the backend, so we must NOT tear down locally or navigate
            // away — that would strand a live stream with no way to stop it.
            // Surface the error and let the creator retry instead.
            if (activeStream) {
              const samples = viewerSampleCountRef.current;
              const peak = peakViewersRef.current;
              const avg = samples > 0 ? viewerSumRef.current / samples : 0;
              try {
                // Persist only the metrics genuinely derived from the live
                // session. totalViews (cumulative unique views) is not something
                // Agora RTC stats can give us, so we don't fabricate it here.
                await endStream.mutateAsync({
                  streamId: activeStream.id,
                  data: { peakViewers: peak, avgViewers: avg },
                });
              } catch {
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
                Alert.alert(
                  "Couldn't end stream",
                  "We couldn't reach the server, so your stream may still be live. Check your connection and try again.",
                  [{ text: "OK" }]
                );
                return;
              }
            }
            // Server confirmed the stream ended — now tear down local capture.
            if (healthRef.current) clearInterval(healthRef.current);
            if (chatRef.current) clearInterval(chatRef.current);
            if (pushPollRef.current) clearInterval(pushPollRef.current);
            try { agoraLeave(); } catch { /* ignore */ }
            if (deviceType === "meta_glasses") {
              try { await metaWearables.stopGlassesStream(); } catch { /* ignore */ }
            }
            // Invalidate so home/live lists, active-stream recovery, and the
            // recordings archive no longer show this stream as live.
            void qc.invalidateQueries({ queryKey: getListStreamsQueryKey() });
            void qc.invalidateQueries({ queryKey: getGetActiveStreamQueryKey() });
            void qc.invalidateQueries({ queryKey: getListStreamRecordingsQueryKey() });
            clearStream();
            router.replace("/(tabs)");
          },
        },
      ]
    );
  }, [activeStream, clearStream, endStream, agoraLeave, deviceType, metaWearables, qc]);

  // ── Camera / source permission error ─────────────────────────────────────
  if (connectError?.code === "PERMISSION_DENIED") {
    return (
      <View style={[styles.permWrap, { backgroundColor: colors.background }]}>
        <Feather name="camera-off" size={52} color={colors.mutedForeground} />
        <Text style={[styles.permTitle, { color: colors.foreground }]}>Camera Access Required</Text>
        <Text style={[styles.permSub, { color: colors.mutedForeground }]}>
          POV streaming needs camera permission
        </Text>
        <TouchableOpacity onPress={() => void connect()} style={[styles.permBtn, { backgroundColor: colors.primary }]}>
          <Text style={styles.permBtnText}>Grant Camera Access</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const healthColor = { excellent: "#39FF14", good: "#FFD700", poor: "#FF8C00", critical: "#FF3B6C" }[health];

  return (
    <View style={styles.root}>
      {/* ── Video source preview ── */}
      <VideoSourcePreview
        source={source}
        facing={facing}
        agoraJoined={agoraSupported && agoraJoined}
        agoraEngine={agoraEngine}
        agoraUid={agoraCredentials?.uid ?? 0}
        datSessionId={deviceType === "meta_glasses" ? metaWearables.sessionId : null}
        datStreamState={deviceType === "meta_glasses" ? metaWearables.streamState : undefined}
      />

      {/* Agora status banner — SDK capture sources that aren't Meta Glasses
           (Meta Glasses uses its own DAT pipeline instead of Agora video) */}
      {Platform.OS !== "web" && !agoraSupported && source.capabilities.mode === "sdk_capture" && deviceType !== "meta_glasses" && (
        <View style={styles.agoraBanner} pointerEvents="none">
          <Feather name="info" size={11} color="rgba(255,255,255,0.5)" />
          <Text style={styles.agoraBannerText}>
            {isExpoGo
              ? "Expo Go — camera preview only. Use a dev build for live streaming."
              : "Simulation mode — Agora streaming requires a development build."}
          </Text>
        </View>
      )}

      {/* Meta Glasses Device Access Toolkit badge */}
      {deviceType === "meta_glasses" && (
        <View style={styles.companionBadge} pointerEvents="none">
          <Feather name="eye" size={11} color="#A78BFA" />
          <Text style={styles.companionBadgeText}>
            {metaWearables.mockKitEnabled ? "Meta Glasses · Mock Kit" : "Meta Glasses · DAT"}
          </Text>
          <View style={styles.companionDot} />
        </View>
      )}

      {/* Scrim gradient — top and bottom */}
      <View style={[StyleSheet.absoluteFill, styles.topScrim]} pointerEvents="none" />
      <View style={[StyleSheet.absoluteFill, styles.bottomScrim]} pointerEvents="none" />

      {/* Clip flash */}
      <Animated.View
        style={[StyleSheet.absoluteFill, styles.clipFlash, { opacity: flashAnim }]}
        pointerEvents="none"
      />

      {/* ── TOP BAR ── */}
      <View style={[styles.topBar, { paddingTop: topPad + 6 }]}>
        {/* Left: LIVE + timer + viewers */}
        <View style={styles.topLeft}>
          <View style={styles.liveBadge}>
            <View style={styles.liveDot} />
            <Text style={styles.liveText}>LIVE</Text>
          </View>
          <View style={[styles.pill, { backgroundColor: "rgba(0,0,0,0.55)" }]}>
            <Feather name="clock" size={10} color="rgba(255,255,255,0.7)" />
            <Text style={styles.pillText}>{formatDuration(streamDuration)}</Text>
          </View>
          <View style={[styles.pill, { backgroundColor: "rgba(0,0,0,0.55)" }]}>
            <Feather name="users" size={10} color="#00D4FF" />
            <Text style={[styles.pillText, { color: "#00D4FF" }]}>{formatViewers(viewerCount)}</Text>
          </View>
        </View>

        {/* Right: battery + end */}
        <View style={styles.topRight}>
          <View style={[styles.batteryPill, { backgroundColor: "rgba(0,0,0,0.55)" }]}>
            <Feather
              name="battery"
              size={12}
              color={battery > 20 ? "#39FF14" : "#FF3B6C"}
            />
            <Text style={[styles.batteryText, { color: battery > 20 ? "rgba(255,255,255,0.8)" : "#FF3B6C" }]}>
              {battery}%
            </Text>
          </View>
          <TouchableOpacity onPress={handleEnd} style={styles.endBtn}>
            <Feather name="x" size={12} color="#FFF" />
            <Text style={styles.endBtnText}>END</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* ── HEALTH BAR ── */}
      <View style={[styles.healthBarRow, { top: topPad + 52 }]}>
        <HealthBar
          health={health}
          bitrate={bitrate}
          droppedFrames={droppedFrames}
          signalStrength={signalStrength}
          platforms={selectedPlatforms}
          platformHealth={platformHealth}
        />
      </View>

      {/* ── HANDS-FREE STATUS CHIPS ── */}
      <View style={[styles.handsFreeRow, { top: topPad + 86 }]}>
        <TouchableOpacity
          onPress={() => { Haptics.selectionAsync(); setHandsFreeOptIn((v) => !v); }}
          style={[
            styles.hfChip,
            { backgroundColor: handsFreeOptIn ? "rgba(123,97,255,0.85)" : "rgba(0,0,0,0.55)" },
          ]}
        >
          <Feather name="radio" size={11} color={handsFreeOptIn ? "#FFF" : "rgba(255,255,255,0.6)"} />
          <Text style={[styles.hfChipText, { color: handsFreeOptIn ? "#FFF" : "rgba(255,255,255,0.6)" }]}>
            Hands-free
          </Text>
        </TouchableOpacity>

        {voiceActive && (
          <View style={[styles.hfChip, { backgroundColor: "rgba(0,0,0,0.55)" }]}>
            <View style={[styles.hfDot, { backgroundColor: voice.isListening ? "#39FF14" : "#FFD700" }]} />
            <Feather name="mic" size={11} color="rgba(255,255,255,0.85)" />
            <Text style={styles.hfChipText}>
              {voice.isSupported ? (voice.isListening ? "Listening" : "Standby") : "Dev build"}
            </Text>
          </View>
        )}

        {gestureActive && (
          <View style={[styles.hfChip, { backgroundColor: "rgba(0,0,0,0.55)" }]}>
            <View style={[styles.hfDot, { backgroundColor: gesture.isWatching ? "#39FF14" : "#FFD700" }]} />
            <Feather name="zap" size={11} color="rgba(255,255,255,0.85)" />
            <Text style={styles.hfChipText}>
              {gesture.isSupported ? (gesture.isWatching ? "Watching" : "Standby") : "Soon"}
            </Text>
          </View>
        )}
      </View>

      {/* ── HANDS-FREE MARKER TOAST ── */}
      {markerToast && (
        <View style={[styles.markerToast, { top: topPad + 122 }]} pointerEvents="none">
          <Feather name={markerToast.source === "voice" ? "mic" : "zap"} size={13} color="#FFF" />
          <Text style={styles.markerToastText}>Moment marked · {markerToast.label}</Text>
        </View>
      )}

      {/* ── ALERT BANNERS ── */}
      {isReconnecting && (
        <View style={[styles.alertBanner, { top: topPad + 90, backgroundColor: "rgba(255,140,0,0.92)" }]}>
          <Feather name="wifi-off" size={13} color="#FFF" />
          <Text style={styles.alertBannerText}>Reconnecting to stream…</Text>
          <View style={styles.alertSpinner}>
            <Feather name="loader" size={12} color="#FFF" />
          </View>
        </View>
      )}
      {isOverheating && !isReconnecting && (
        <View style={[styles.alertBanner, { top: topPad + 90, backgroundColor: "rgba(255,59,108,0.92)" }]}>
          <Feather name="thermometer" size={13} color="#FFF" />
          <Text style={styles.alertBannerText}>Device getting warm — quality may reduce</Text>
        </View>
      )}
      {droppedFrames > 20 && !isReconnecting && !isOverheating && (
        <View style={[styles.alertBanner, { top: topPad + 90, backgroundColor: "rgba(255,140,0,0.85)" }]}>
          <Feather name="alert-triangle" size={13} color="#FFF" />
          <Text style={styles.alertBannerText}>{droppedFrames} dropped frames — check signal</Text>
        </View>
      )}

      {/* ── STREAM TITLE ── */}
      <View style={[styles.titleRow, { bottom: bottomPad + 148 }]}>
        <Text style={styles.titleText} numberOfLines={1}>{streamTitle || "POV Stream"}</Text>
        {pendingClipsCount > 0 && (
          <View style={styles.aiClipBadge}>
            <Feather name="zap" size={10} color="#7B61FF" />
            <Text style={styles.aiClipBadgeText}>{pendingClipsCount} AI clips ready</Text>
          </View>
        )}
      </View>

      {/* ── CHAT OVERLAY ── */}
      {showChat && (
        <View style={[styles.chatWrap, { bottom: bottomPad + 148 }]}>
          <ChatOverlay
            messages={chatMessages.slice(0, 6)}
            pinnedMessage={pinnedMessage}
            onPinMessage={pinMessage}
            onUnpin={unpinMessage}
            outdoorMode={outdoorMode}
          />
        </View>
      )}

      {/* ── RIGHT RAIL (reactions + outdoor toggle) ── */}
      <View style={[styles.rightRail, { top: topPad + 130, bottom: bottomPad + 120 }]}>
        <LiveReactions />
        <TouchableOpacity
          onPress={() => {
            Haptics.selectionAsync();
            setOutdoorMode((v) => !v);
          }}
          style={[styles.sideIconBtn, { backgroundColor: outdoorMode ? "rgba(255,215,0,0.3)" : "rgba(0,0,0,0.55)" }]}
        >
          <Feather name="sun" size={18} color={outdoorMode ? "#FFD700" : "rgba(255,255,255,0.6)"} />
        </TouchableOpacity>
      </View>

      {/* ── BOTTOM BAR ── */}
      <View style={[styles.bottomBar, { paddingBottom: bottomPad + 20 }]}>
        {/* Chat toggle */}
        <TouchableOpacity
          onPress={() => { Haptics.selectionAsync(); setShowChat((v) => !v); }}
          style={[styles.controlBtn, { backgroundColor: "rgba(0,0,0,0.6)" }]}
        >
          <Feather
            name="message-square"
            size={20}
            color={showChat ? "#00D4FF" : "rgba(255,255,255,0.4)"}
          />
          {showChat && chatMessages.length > 0 && (
            <View style={styles.chatBadge}>
              <Text style={styles.chatBadgeText}>{Math.min(chatMessages.length, 99)}</Text>
            </View>
          )}
        </TouchableOpacity>

        {/* CLIP button — center, prominent */}
        <View style={styles.clipWrap}>
          <Pressable
            onPress={handleClip}
            disabled={isClipping}
            style={({ pressed }) => [
              styles.clipBtn,
              {
                backgroundColor: isClipping ? "rgba(123,97,255,0.5)" : "#7B61FF",
                shadowColor: "#7B61FF",
                transform: [{ scale: pressed ? 0.94 : 1 }],
              },
            ]}
          >
            <Feather name="zap" size={30} color="#FFF" />
            <Text style={styles.clipBtnLabel}>
              {clipSaved ? "SAVED!" : isClipping ? "SAVING" : "CLIP"}
            </Text>
          </Pressable>
          {aiHighlightsActive && (
            <View style={styles.aiIndicator}>
              <View style={styles.aiDot} />
              <Text style={styles.aiIndicatorText}>AI</Text>
            </View>
          )}
        </View>

        {/* Mute + Flip */}
        <View style={styles.rightControls}>
          <TouchableOpacity
            onPress={() => { Haptics.selectionAsync(); setIsMuted((v) => !v); }}
            style={[styles.controlBtn, { backgroundColor: isMuted ? "rgba(255,59,108,0.3)" : "rgba(0,0,0,0.6)" }]}
          >
            <Feather name={isMuted ? "mic-off" : "mic"} size={20} color={isMuted ? "#FF3B6C" : "#FFF"} />
          </TouchableOpacity>
          {Platform.OS !== "web" && source.capabilities.supportsFlip && (
            <TouchableOpacity
              onPress={() => { Haptics.selectionAsync(); setFacing((f) => f === "back" ? "front" : "back"); }}
              style={[styles.controlBtn, { backgroundColor: "rgba(0,0,0,0.6)" }]}
            >
              <Feather name="refresh-cw" size={20} color="#FFF" />
            </TouchableOpacity>
          )}
          {deviceType === "meta_glasses" && (
            <TouchableOpacity
              onPress={handleCapturePhoto}
              disabled={photoCapturing}
              style={[
                styles.controlBtn,
                { backgroundColor: photoCaptured ? "rgba(57,255,20,0.3)" : "rgba(0,0,0,0.6)" },
              ]}
            >
              <Feather
                name={photoCaptured ? "check" : "camera"}
                size={20}
                color={photoCaptured ? "#39FF14" : "#FFF"}
              />
            </TouchableOpacity>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#000" },
  webCamera: {
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    backgroundColor: "#09090F",
  },
  webCameraText: { color: "rgba(255,255,255,0.15)", fontSize: 13, fontFamily: "Inter_400Regular" },
  topScrim: {
    height: 220,
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: "rgba(0,0,0,0.5)",
    opacity: 0.6,
  },
  bottomScrim: {
    height: 260,
    bottom: 0,
    left: 0,
    right: 0,
    top: undefined,
    backgroundColor: "rgba(0,0,0,0.45)",
    opacity: 0.7,
  },
  clipFlash: { backgroundColor: "#FFFFFF", zIndex: 100 },

  topBar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    zIndex: 20,
  },
  topLeft: { flexDirection: "row", alignItems: "center", gap: 7, flexWrap: "wrap" },
  topRight: { flexDirection: "row", alignItems: "center", gap: 7 },

  liveBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "#FF3B6C",
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
  },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: "#FFF" },
  liveText: { color: "#FFF", fontSize: 11, fontFamily: "Inter_700Bold", letterSpacing: 1 },

  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 9,
    paddingVertical: 5,
    borderRadius: 20,
  },
  pillText: { fontSize: 11, fontFamily: "Inter_600SemiBold", color: "rgba(255,255,255,0.85)" },

  batteryPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 20,
  },
  batteryText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },

  endBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(255,59,108,0.9)",
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
  },
  endBtnText: { color: "#FFF", fontSize: 11, fontFamily: "Inter_700Bold", letterSpacing: 0.8 },

  healthBarRow: {
    position: "absolute",
    left: 14,
    zIndex: 15,
  },

  alertBanner: {
    position: "absolute",
    left: 14,
    right: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
    zIndex: 18,
  },
  alertBannerText: {
    flex: 1,
    color: "#FFF",
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
  },
  alertSpinner: { flexShrink: 0 },

  handsFreeRow: {
    position: "absolute",
    left: 14,
    right: 14,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    zIndex: 16,
  },
  hfChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  hfChipText: {
    color: "rgba(255,255,255,0.85)",
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
  },
  hfDot: { width: 6, height: 6, borderRadius: 3 },
  markerToast: {
    position: "absolute",
    left: 14,
    right: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
    backgroundColor: "rgba(123,97,255,0.92)",
    zIndex: 19,
  },
  markerToastText: {
    flex: 1,
    color: "#FFF",
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
  },

  titleRow: {
    position: "absolute",
    left: 14,
    right: 80,
    zIndex: 10,
    gap: 5,
  },
  titleText: {
    color: "#FFF",
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
    textShadowColor: "rgba(0,0,0,0.9)",
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 5,
  },
  aiClipBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(123,97,255,0.3)",
    borderWidth: 1,
    borderColor: "rgba(123,97,255,0.5)",
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 8,
    alignSelf: "flex-start",
  },
  aiClipBadgeText: { color: "#A78BFA", fontSize: 10, fontFamily: "Inter_700Bold" },

  chatWrap: {
    position: "absolute",
    left: 14,
    right: 90,
    zIndex: 10,
  },

  rightRail: {
    position: "absolute",
    right: 12,
    zIndex: 15,
    justifyContent: "flex-end",
    alignItems: "center",
    gap: 10,
  },
  sideIconBtn: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: "center",
    justifyContent: "center",
  },

  bottomBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    zIndex: 20,
  },

  controlBtn: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  chatBadge: {
    position: "absolute",
    top: -2,
    right: -2,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: "#FF3B6C",
    alignItems: "center",
    justifyContent: "center",
  },
  chatBadgeText: { color: "#FFF", fontSize: 8, fontFamily: "Inter_700Bold" },

  clipWrap: { alignItems: "center", gap: 6 },
  clipBtn: {
    width: 84,
    height: 84,
    borderRadius: 42,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.75,
    shadowRadius: 20,
    elevation: 12,
  },
  clipBtnLabel: {
    color: "#FFF",
    fontSize: 9,
    fontFamily: "Inter_700Bold",
    letterSpacing: 1.5,
  },
  aiIndicator: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "rgba(123,97,255,0.25)",
    borderWidth: 1,
    borderColor: "rgba(123,97,255,0.5)",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  aiDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#7B61FF",
  },
  aiIndicatorText: {
    color: "#A78BFA",
    fontSize: 9,
    fontFamily: "Inter_700Bold",
    letterSpacing: 1,
  },

  rightControls: { gap: 8, alignItems: "center" },

  permWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 16,
    padding: 32,
  },
  permTitle: { fontSize: 20, fontFamily: "Inter_700Bold" },
  permSub: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 20 },
  permBtn: { borderRadius: 14, paddingHorizontal: 24, paddingVertical: 14, marginTop: 8 },
  permBtnText: { color: "#FFF", fontSize: 15, fontFamily: "Inter_600SemiBold" },
  agoraBanner: {
    position: "absolute",
    bottom: 90,
    left: 14,
    right: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(0,0,0,0.45)",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    zIndex: 5,
  },
  agoraBannerText: {
    flex: 1,
    color: "rgba(255,255,255,0.5)",
    fontSize: 10,
    fontFamily: "Inter_400Regular",
  },
  companionBadge: {
    position: "absolute",
    top: 110,
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "rgba(167,139,250,0.18)",
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderWidth: 1,
    borderColor: "rgba(167,139,250,0.35)",
    zIndex: 5,
  },
  companionBadgeText: {
    color: "#A78BFA",
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.3,
  },
  companionDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#39FF14",
  },
});
