import { useAuth, useUser } from "@clerk/expo";
import { Ionicons } from "@expo/vector-icons";
import {
  deleteInspection,
  getListAnalysisResultsQueryOptions,
  useGenerateReport,
  useGenerateReportNarrative,
  type Report,
} from "@/lib/api-client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CameraView, useCameraPermissions } from "expo-camera";
import { type Href, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { Image } from "expo-image";
import * as Haptics from "expo-haptics";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  AppState,
  BackHandler,
  Modal,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";

import * as Speech from "expo-speech";
import { AiInsightsPanel } from "@/components/AiInsightsPanel";
import { CoPilotHUD } from "@/components/CoPilotHUD";
import { BaitStationPanel } from "@/components/BaitStationPanel";
import { VoiceMicButton } from "@/components/VoiceMicButton";
import { useVoiceField } from "@/hooks/useVoiceField";
import { type LocalBaitStation } from "@/lib/local/inspection-store";
import { AuthedImage } from "@/components/AuthedImage";
import { WifiCameraModal } from "@/components/WifiCameraModal";
import { TreatmentLogWizard } from "@/components/TreatmentLogWizard";
import { useDailyRoute } from "@/hooks/useDailyRoute";
import { verifyEquipmentUsage } from "@/lib/audio/intelligence/EquipmentVerifier";
import { DeviceHealthStrip } from "@/components/DeviceHealthStrip";
import { MeasurementDevicePanel } from "@/components/MeasurementDevicePanel";
import { NativeCameraHealthBadge } from "@/components/NativeCameraHealthBadge";
import { useSmartGuidance } from "@/hooks/useSmartGuidance";
import { useMetaGlassesSession, type GlassesEvent } from "@/hooks/useMetaGlassesSession";
import { Button } from "@/components/ui/Button";
import { Screen } from "@/components/ui/Screen";
import { TextField } from "@/components/ui/TextField";
import { useColors } from "@/hooks/useColors";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";
import { useWindowSizeClass } from "@/hooks/useWindowSizeClass";
import { PEST_TYPES, PROPERTY_TYPES } from "@/constants/inspection";
import {
  ApiError,
  fetchPlaybookCompliance,
  fetchPropertyMemory,
  type ComplianceViolation,
  type PropertyMemoryData,
} from "@/lib/api";
import { ingestAllUploadedPhotos } from "@/lib/faie-ingest";
import { consumeLastMeasurementReading } from "@/lib/measurement";
import {
  deleteLocalInspection,
  getLocalInspection,
  newLocalInspection,
  persistPhoto,
  saveLocalInspection,
  updateLocalInspection,
  type LocalInspection,
} from "@/lib/local/inspection-store";
import { requestSync, syncNow } from "@/lib/sync/engine";
import {
  assessEvidence,
  computeDHash,
  findNearDuplicate,
  getRequestProvider,
  loadGrayscaleImage,
  speechService,
  type EvidenceItem,
} from "@/lib/vision";
import {
  AudioSessionManager,
  FallbackSpeechProvider,
  ConfidenceAction,
  type StructuredInspectionEvent,
} from "@/lib/audio";

/** True when an error smells like a connectivity failure (not a server rejection). */
function isOfflineError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /network request failed|network error|failed to fetch|timeout|abort/i.test(msg);
}

const OFFLINE_NOTICE =
  "You're offline — everything is saved on this device and will sync automatically when you're back online.";

type Step = "setup" | "capture" | "review";
type Photo = { uri: string };

// Manual  — standard typed-form capture (no voice features)
// Voice   — offline Whisper dictation, no network required
// Copilot — live cloud VLM over 5G/Wi-Fi (not yet available)
type InspectionMode = "manual" | "voice" | "copilot";

const ZOOM_LEVELS = [
  { label: "1×", value: 0 },
  { label: "2×", value: 0.25 },
  { label: "4×", value: 0.5 },
] as const;

export default function NewInspectionScreen() {
  const colors = useColors();
  const { isLandscape, isExpanded, width } = useWindowSizeClass();
  // Co-Pilot split-screen kicks in at 600 px — covers portrait tablets and
  // medium windows in addition to fully unfolded foldables.
  const isWideScreen = width >= 600;
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user: clerkUser } = useUser();
  const { getToken } = useAuth();
  const params = useLocalSearchParams<{ resume?: string }>();

  const generateReport = useGenerateReport();
  const generateNarrative = useGenerateReportNarrative();

  const [step, setStep] = useState<Step>("setup");
  const [mode, setMode] = useState<InspectionMode>("voice");
  const [siteAddress, setSiteAddress] = useState("");
  const [clientName, setClientName] = useState("");
  const [technicianName, setTechnicianName] = useState(clerkUser?.fullName ?? "");
  const [propertyType, setPropertyType] = useState<string>(PROPERTY_TYPES[0]);
  const [pestTypes, setPestTypes] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  const [photos, setPhotos] = useState<Photo[]>([]);
  /** True when resuming a previously completed inspection — edits are locked. */
  const [isCompleted, setIsCompleted] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Active sensor count — drives split-screen flex weights.
  // When sensors are connected the panel gets equal space with the camera;
  // when none are docked the camera expands to fill more of the screen.
  const [activeSensorCount, setActiveSensorCount] = useState(0);

  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);

  const guidance = useSmartGuidance({
    propertyType,
    photoCount: photos.length,
    sessionActive: step === "capture",
  });
  const [capturing, setCapturing] = useState(false);
  // Synchronous ref-based lock — prevents burst captures when the shutter is
  // tapped rapidly during a lag spike (React state updates are async, so the
  // `capturing` state guard alone can be passed multiple times before it lands).
  const captureLockedRef = useRef(false);
  const [importing, setImporting] = useState(false);
  // Advisory warning from the on-device quality gate — auto-clears; never
  // blocks capture (poor evidence of a real problem beats no evidence).
  const [qualityNotice, setQualityNotice] = useState<string | null>(null);
  // Vision Platform providers: every evidence source (live camera, imported
  // GoPro/glasses footage, future streams) funnels through the same
  // EvidenceItem contract into the same persist → sync → analyze pipeline.
  // Sourced from the capture-provider registry (lib/vision/provider-registry):
  // adding a new usable source registers there, not here.
  const cameraProvider = useMemo(() => getRequestProvider("native-camera", { cameraRef }), []);
  const importProvider = useMemo(() => getRequestProvider("media-import", {}), []);
  const [zoom, setZoom] = useState(0);
  const zoomRef = useRef(0);
  // true while Co-Pilot is controlling the zoom level (cleared on manual tap)
  const [autoZoom, setAutoZoom] = useState(false);
  const zoomAnimRef = useRef<ReturnType<typeof requestAnimationFrame> | null>(null);
  const handleCopilotZoom = useCallback(
    (targetZoom: number) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      setAutoZoom(true);
      if (zoomAnimRef.current != null) cancelAnimationFrame(zoomAnimRef.current);
      const startZoom = zoomRef.current;
      const duration = 450;
      const startTime = performance.now();
      const animate = (now: number) => {
        const elapsed = now - startTime;
        const t = Math.min(elapsed / duration, 1);
        const eased = 1 - Math.pow(1 - t, 3);
        const current = startZoom + (targetZoom - startZoom) * eased;
        zoomRef.current = current;
        setZoom(current);
        if (t < 1) {
          zoomAnimRef.current = requestAnimationFrame(animate);
        } else {
          zoomAnimRef.current = null;
        }
      };
      zoomAnimRef.current = requestAnimationFrame(animate);
    },
    [],
  );
  const [flash, setFlash] = useState<"off" | "on" | "auto">("off");

  // ── Dictation state ────────────────────────────────────────────────────────
  // SpeechService is a singleton outside React, so recording survives foldable
  // screen-resize events that would otherwise unmount and remount this component.
  const [isDictating, setIsDictating] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const stopDictationRef = useRef<(() => void) | null>(null);

  // ── FAIE (Field Audio Intelligence Engine) state ──────────────────────────
  const [isFaieListening, setIsFaieListening] = useState(false);
  const [faieStatus, setFaieStatus] = useState<string | null>(null);
  const [faiePendingConfirm, setFaiePendingConfirm] = useState<StructuredInspectionEvent | null>(null);
  const sessionManagerRef = useRef<AudioSessionManager | null>(null);

  // ── FAIE frame-buffer state ────────────────────────────────────────────────
  // A rolling background snapshot captured every 1 500 ms while the FAIE
  // session is live.  getFrameWithBuffer() uses it as a guaranteed fallback when
  // the on-demand takePictureAsync() is busy or fails (e.g. Android pipeline
  // contention, cameraRef not yet ready).
  const lastFrameUriRef = useRef<string | null>(null);
  const frameBufferIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Controls the co-pilot always-on voice watchdog loop.
  // Set to true when FAIE starts in copilot mode; cleared when the user stops.
  const faieAutoRestartRef = useRef(false);
  // Animated value for the frame-capture flash overlay (0 = transparent, 1 = white).
  const frameCaptureAnim = useRef(new Animated.Value(0)).current;
  // True when the most-recently dispatched voice event carried an imageUri.
  const [lastEventHadFrame, setLastEventHadFrame] = useState(false);

  // ── Per-field voice dictation (setup form) ─────────────────────────────────
  const voiceSiteAddress = useVoiceField({
    onTranscript: (text) => setSiteAddress((prev) => (prev.trim() ? `${prev.trim()} ${text}` : text)),
  });
  const voiceClientName = useVoiceField({
    onTranscript: (text) => setClientName((prev) => (prev.trim() ? `${prev.trim()} ${text}` : text)),
  });

  // ── Bait station tracking (T002) ──────────────────────────────────────────
  const [baitStations, setBaitStations] = useState<LocalBaitStation[]>([]);
  const [showBaitPanel, setShowBaitPanel] = useState(false);

  function addBaitStation(station: Omit<LocalBaitStation, "id">) {
    const next: LocalBaitStation = { ...station, id: Math.random().toString(36).slice(2) };
    setBaitStations((prev) => {
      const updated = [...prev, next];
      void updateLocalInspection(recordRef.current?.localId ?? "", (r) => {
        r.baitStations = updated;
      });
      return updated;
    });
  }
  function updateBaitStation(id: string, update: Partial<LocalBaitStation>) {
    setBaitStations((prev) => {
      const updated = prev.map((s) => (s.id === id ? { ...s, ...update } : s));
      void updateLocalInspection(recordRef.current?.localId ?? "", (r) => {
        r.baitStations = updated;
      });
      return updated;
    });
  }
  function removeBaitStation(id: string) {
    setBaitStations((prev) => {
      const updated = prev.filter((s) => s.id !== id);
      void updateLocalInspection(recordRef.current?.localId ?? "", (r) => {
        r.baitStations = updated;
      });
      return updated;
    });
  }

  // ── Wi-Fi camera (T004) ───────────────────────────────────────────────────
  const [showWifiCamera, setShowWifiCamera] = useState(false);
  const [wifiCameraConnected, setWifiCameraConnected] = useState(false);

  // ── Chemical treatment log wizard ─────────────────────────────────────────
  const [showTreatmentWizard, setShowTreatmentWizard] = useState(false);
  const { assignmentsWithProducts } = useDailyRoute();

  // ── Offline status (T003) ─────────────────────────────────────────────────
  const { isConnected } = useNetworkStatus();

  // ── Property memory — prior-visit context banner ──────────────────────────
  const [propertyMemory, setPropertyMemory] = useState<PropertyMemoryData | null>(null);

  useEffect(() => {
    if (siteAddress.trim().length < 6) {
      setPropertyMemory(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      getToken()
        .then((token) => fetchPropertyMemory(token, siteAddress))
        .then((res) => {
          if (!cancelled) setPropertyMemory(res.found ? res.data : null);
        })
        .catch(() => {
          // Non-blocking — failure just means no banner is shown.
        });
    }, 600);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [siteAddress, getToken]);

  // Clean up any live recording if the screen is dismissed mid-dictation.
  useEffect(() => {
    return () => {
      // Stop the rolling frame buffer first so no further snapshots fire.
      if (frameBufferIntervalRef.current != null) {
        clearInterval(frameBufferIntervalRef.current);
        frameBufferIntervalRef.current = null;
      }
      stopDictationRef.current?.();
      stopDictationRef.current = null;
      void sessionManagerRef.current?.cancelSession();
      sessionManagerRef.current = null;
    };
  }, []);

  const handleDictationPress = async () => {
    if (isDictating) {
      stopDictationRef.current?.();
      stopDictationRef.current = null;
      setIsDictating(false);
      // isTranscribing becomes true when onProgress('…') fires
      return;
    }
    try {
      const stop = await speechService.startDictation((transcript) => {
        if (transcript === "…") {
          setIsTranscribing(true);
          return;
        }
        setIsTranscribing(false);
        setNotes((prev) => {
          const trimmed = prev.trim();
          return trimmed.length > 0 ? `${trimmed} ${transcript}` : transcript;
        });
      });
      stopDictationRef.current = stop;
      setIsDictating(true);
    } catch (e) {
      Alert.alert(
        "Dictation unavailable",
        e instanceof Error ? e.message : "Could not start dictation.",
      );
    }
  };

  // ── FAIE frame-buffer helpers ──────────────────────────────────────────────

  /**
   * Starts a rolling 1 500 ms background snapshot loop that silently stores the
   * latest low-quality camera frame while the FAIE session is active.
   * Idempotent — a second call while the interval is already running is a no-op.
   */
  const startFrameBuffer = () => {
    if (frameBufferIntervalRef.current != null) return;
    frameBufferIntervalRef.current = setInterval(() => {
      void (async () => {
        try {
          const pic = await cameraRef.current?.takePictureAsync({
            quality: 0.1,
            skipProcessing: true,
          });
          if (pic?.uri) lastFrameUriRef.current = pic.uri;
        } catch {
          // Silently skip — keep the last successful frame URI in the buffer.
        }
      })();
    }, 1_500);
  };

  /** Stops the rolling frame-buffer interval and releases buffered frame memory. */
  const stopFrameBuffer = () => {
    if (frameBufferIntervalRef.current != null) {
      clearInterval(frameBufferIntervalRef.current);
      frameBufferIntervalRef.current = null;
    }
    // Discard the stored frame URI so the JPEG is eligible for GC immediately.
    lastFrameUriRef.current = null;
  };

  /**
   * Best-effort frame capture for getFrame injection into AudioSessionManager.
   *
   * Strategy:
   * 1. Try a fresh on-demand takePictureAsync() — most current view of the room.
   *    Race it against a 500 ms deadline so a stalled camera never delays dispatch.
   * 2. If the fresh capture fails, times out, or returns null — fall back to the
   *    last rolling-buffer frame (up to ~1.5 s old but still useful for spatial context).
   * 3. If the buffer is empty (session just started) return null; the event is
   *    dispatched without an imageUri and the banner shows no camera icon.
   */
  const getFrameWithBuffer = async (): Promise<string | null> => {
    try {
      const deadline = new Promise<null>((resolve) => setTimeout(() => resolve(null), 500));
      const capture = (async () => {
        const pic = await cameraRef.current?.takePictureAsync({
          quality: 0.1,
          skipProcessing: true,
        });
        return pic?.uri ?? null;
      })();
      const fresh = await Promise.race([capture, deadline]);
      if (fresh) {
        lastFrameUriRef.current = fresh;
        return fresh;
      }
    } catch {
      // fall through to buffer
    }
    return lastFrameUriRef.current ?? null;
  };

  // ── FAIE handlers ──────────────────────────────────────────────────────────
  const handleFaiePress = async () => {
    if (isFaieListening) {
      // Clear the watchdog flag first so the loop exits after stopSession resolves.
      faieAutoRestartRef.current = false;
      setIsFaieListening(false);
      setFaieStatus(null);
      setFaiePendingConfirm(null);
      stopFrameBuffer();
      await sessionManagerRef.current?.stopSession();
      return;
    }
    if (!sessionManagerRef.current) {
      sessionManagerRef.current = new AudioSessionManager(new FallbackSpeechProvider());
    }
    const formatEvent = (ev: StructuredInspectionEvent): string => {
      const parts: string[] = [ev.action];
      if (ev.product) parts.push(ev.product);
      if (ev.room) parts.push(`in ${ev.room}`);
      if (ev.visionTarget) parts.push(`@ ${ev.visionTarget}`);
      if (ev.pest && ev.evidence) parts.push(`(${ev.pest} — ${ev.evidence})`);
      else if (ev.pest) parts.push(`(${ev.pest})`);
      else if (ev.evidence) parts.push(`(${ev.evidence})`);
      return parts.join(" ").trim();
    };
    // Co-pilot mode: keep the mic alive between recognition cycles so the
    // technician never has to re-tap.  Other modes (manual / voice) are
    // unaffected — the loop exits immediately after one session ends.
    faieAutoRestartRef.current = mode === "copilot";
    try {
      setIsFaieListening(true);
      setFaieStatus("Listening for commands…");
      setFaiePendingConfirm(null);
      setLastEventHadFrame(false);
      // Start rolling background snapshots so getFrameWithBuffer always has a
      // recent frame ready even if the on-demand capture is slow or fails.
      startFrameBuffer();
      do {
      // Stamp the session start time so the session manager can timestamp events.
      sessionManagerRef.current.setVisionContext({ timestamp: Date.now() });
      await sessionManagerRef.current.startSession(({ event, action }) => {
        // Flash the camera overlay and update the banner icon whenever the
        // session manager successfully attached a room snapshot to this event.
        if (event.imageUri) {
          setLastEventHadFrame(true);
          frameCaptureAnim.setValue(0.5);
          Animated.timing(frameCaptureAnim, {
            toValue: 0,
            duration: 400,
            useNativeDriver: true,
          }).start();
        } else {
          setLastEventHadFrame(false);
        }
        switch (action) {
          case ConfidenceAction.AUTO_COMMIT: {
            // 1. Voice-triggered photo capture ("snap", "take a photo", "capture")
            if (event.capturePhoto) {
              void takePhoto();
              setFaieStatus("Capturing photo…");
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              setTimeout(() => setFaieStatus("Listening…"), 2500);
              break;
            }

            // 2. Explicit field routing via prefix ("client name is…", "site address is…")
            if (event.targetField === "clientName" && event.fieldValue) {
              setClientName(event.fieldValue);
              setFaieStatus(`Client: "${event.fieldValue}"`);
              Speech.speak("Client name set", { rate: 1.1 });
              setTimeout(() => setFaieStatus("Listening…"), 2500);
              break;
            }
            if (event.targetField === "siteAddress" && event.fieldValue) {
              setSiteAddress(event.fieldValue);
              setFaieStatus(`Site: "${event.fieldValue}"`);
              Speech.speak("Site address set", { rate: 1.1 });
              setTimeout(() => setFaieStatus("Listening…"), 2500);
              break;
            }

            // 3a. Equipment detection — cross-reference against daily route.
            if (event.equipment) {
              const activePest = pestTypes[pestTypes.length - 1] ?? null;
              const result = verifyEquipmentUsage(event.equipment, activePest, assignmentsWithProducts);
              setFaieStatus(result.message);
              if (result.needsAttention) {
                void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
              }
              Speech.speak(result.message, { rate: 1.05 });
              setTimeout(() => setFaieStatus("Listening…"), 4000);
              break;
            }

            // 3. Bait station auto-log: "placed Contrac Blox in kitchen" or any
            //    transcript matching a baitStationTrigger phrase.
            if (
              event.targetField === "baitStation" ||
              ((event.action === "placed" || event.action === "applied") && event.product)
            ) {
              const where = event.room ?? "Unknown location";
              addBaitStation({
                label: event.product ?? "Bait station",
                locationType: event.room,
                status: "active",
                notes: event.severity ? `Severity: ${event.severity}` : undefined,
              });
              const summary = `Bait: ${event.product ?? "station"} @ ${where}`;
              setFaieStatus(summary);
              void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              Speech.speak(`Logged ${event.product ?? "bait station"}`, { rate: 1.1 });
              setTimeout(() => setFaieStatus("Listening…"), 3000);
              break;
            }

            // 4. Auto-add detected pest to the Suspected Pests chip list.
            if (event.pest) {
              const pestLower = event.pest.toLowerCase();
              const match = PEST_TYPES.find(
                (p) => p.toLowerCase().includes(pestLower) || pestLower.includes(p.toLowerCase()),
              );
              if (match) {
                setPestTypes((prev) => (prev.includes(match) ? prev : [...prev, match]));
                void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              }
            }

            // 5. Default — format finding and append to inspection notes.
            {
              const severityTag = event.severity ? ` [${event.severity}]` : "";
              const line = `${formatEvent(event)}${severityTag}`;
              setNotes((prev) => (prev.trim() ? `${prev.trim()}\n${line}` : line));
              setFaieStatus(`Logged: ${line}`);
              setTimeout(() => setFaieStatus("Listening…"), 3000);
            }
            break;
          }
          case ConfidenceAction.CONFIRM: {
            // Auto-commit low-confidence events immediately — no tap required.
            // A "~" marker in the status line signals the uncertainty level
            // passively without blocking the technician's capture flow.
            if (event.equipment) {
              const activePest = pestTypes[pestTypes.length - 1] ?? null;
              const result = verifyEquipmentUsage(event.equipment, activePest, assignmentsWithProducts);
              setFaieStatus(`${result.message} ~`);
              if (result.needsAttention) {
                void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
              }
              Speech.speak(result.message, { rate: 1.05 });
              setTimeout(() => setFaieStatus("Listening…"), 4000);
              break;
            }
            if (event.capturePhoto) {
              void takePhoto();
              setFaieStatus("Capturing photo…");
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              setTimeout(() => setFaieStatus("Listening…"), 2500);
              break;
            }
            if (event.targetField === "clientName" && event.fieldValue) {
              setClientName(event.fieldValue);
              setFaieStatus(`Client: "${event.fieldValue}" ~`);
              Speech.speak("Client name set", { rate: 1.1 });
              setTimeout(() => setFaieStatus("Listening…"), 2500);
              break;
            }
            if (event.targetField === "siteAddress" && event.fieldValue) {
              setSiteAddress(event.fieldValue);
              setFaieStatus(`Site: "${event.fieldValue}" ~`);
              Speech.speak("Site address set", { rate: 1.1 });
              setTimeout(() => setFaieStatus("Listening…"), 2500);
              break;
            }
            if (
              event.targetField === "baitStation" ||
              ((event.action === "placed" || event.action === "applied") && event.product)
            ) {
              const where = event.room ?? "Unknown location";
              addBaitStation({
                label: event.product ?? "Bait station",
                locationType: event.room,
                status: "active",
                notes: event.severity ? `Severity: ${event.severity}` : undefined,
              });
              setFaieStatus(`Bait ~: ${event.product ?? "station"} @ ${where}`);
              void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              setTimeout(() => setFaieStatus("Listening…"), 3000);
              break;
            }
            {
              if (event.pest) {
                const pestLower = event.pest.toLowerCase();
                const match = PEST_TYPES.find(
                  (p) => p.toLowerCase().includes(pestLower) || pestLower.includes(p.toLowerCase()),
                );
                if (match) {
                  setPestTypes((prev) => (prev.includes(match) ? prev : [...prev, match]));
                  void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                }
              }
              const severityTag = event.severity ? ` [${event.severity}]` : "";
              const line = `${formatEvent(event)}${severityTag}`;
              setNotes((prev) => (prev.trim() ? `${prev.trim()}\n${line}` : line));
              setFaieStatus(`Auto-logged ~: ${line}`);
              setTimeout(() => setFaieStatus("Listening…"), 3000);
            }
            break;
          }
          case ConfidenceAction.ASK_AGAIN:
            setFaieStatus("Didn't catch that — please repeat.");
            setTimeout(() => setFaieStatus("Listening…"), 2500);
            break;
        }
      }, {
        // getFrameWithBuffer: tries a fresh on-demand capture (500 ms deadline),
        // falls back to the rolling 1.5 s background buffer so imageUri is
        // populated even when the camera pipeline is momentarily busy.
        getFrame: getFrameWithBuffer,
        // Token getter for cloud-backed providers (FallbackSpeechProvider routes
        // this to OpenAIWhisperProvider when the local model is unavailable).
        getToken: () => getToken(),
      });
      // Session ended naturally — in co-pilot mode pause briefly then loop back.
      if (faieAutoRestartRef.current) {
        setFaieStatus("Restarting…");
        await new Promise<void>((resolve) => setTimeout(resolve, 300));
        setFaieStatus("Listening for commands…");
      }
      } while (faieAutoRestartRef.current);
      // Watchdog loop exited (user stopped or non-copilot mode) — clean up.
      stopFrameBuffer();
      setIsFaieListening(false);
      setFaieStatus(null);
    } catch (e) {
      faieAutoRestartRef.current = false;
      stopFrameBuffer();
      setIsFaieListening(false);
      setFaieStatus(null);
      Alert.alert(
        "Voice unavailable",
        e instanceof Error ? e.message : "Could not start voice session.",
      );
    }
  };

  const confirmFaieEvent = () => {
    if (!faiePendingConfirm) return;
    const ev = faiePendingConfirm;

    // Mirror the AUTO_COMMIT routing so "Log it" on a pending event
    // follows the same field-dispatch logic as an auto-committed one.
    if (ev.targetField === "clientName" && ev.fieldValue) {
      setClientName(ev.fieldValue);
    } else if (ev.targetField === "siteAddress" && ev.fieldValue) {
      setSiteAddress(ev.fieldValue);
    } else if (
      ev.targetField === "baitStation" ||
      ((ev.action === "placed" || ev.action === "applied") && ev.product)
    ) {
      addBaitStation({
        label: ev.product ?? "Bait station",
        locationType: ev.room,
        status: "active",
        notes: ev.severity ? `Severity: ${ev.severity}` : undefined,
      });
    } else {
      const severityTag = ev.severity ? ` [${ev.severity}]` : "";
      const parts: string[] = [ev.action];
      if (ev.product) parts.push(ev.product);
      if (ev.room) parts.push(`in ${ev.room}`);
      if (ev.pest && ev.evidence) parts.push(`(${ev.pest} — ${ev.evidence})`);
      else if (ev.pest) parts.push(`(${ev.pest})`);
      else if (ev.evidence) parts.push(`(${ev.evidence})`);
      const line = `${parts.join(" ").trim()}${severityTag}`;
      setNotes((prev) => (prev.trim() ? `${prev.trim()}\n${line}` : line));
    }

    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setFaiePendingConfirm(null);
    setFaieStatus("Listening…");
  };

  // Phone-size AI Inspection entry point. On expanded windows (tablets,
  // unfolded foldables) the AI panel renders side-by-side with the camera;
  // on compact/medium windows it opens as a full-screen overlay instead —
  // without this, phones have no way to reach the AI Inspection workflow.
  const [showInsights, setShowInsights] = useState(false);

  // Expanded-workspace analysis state. Reuses the exact same APIs as submit —
  // photos are uploaded once and never re-uploaded or re-analyzed at submit.
  const [wsInspectionId, setWsInspectionId] = useState<number | null>(null);
  const [wsAnalyzing, setWsAnalyzing] = useState(false);

  // ── #74 — Glasses-capture findings buffer ──────────────────────────────────
  // Persisted across the full inspection session. Each entry is a GlassesEvent
  // with a server-persisted frame (mediaId set) and/or a structured AI finding.
  const [glassesFindings, setGlassesFindings] = useState<GlassesEvent[]>([]);
  // #110 — full-screen viewer for glasses-captured frames
  const [glassesViewerPath, setGlassesViewerPath] = useState<string | null>(null);

  // ── Meta glasses session (Ray-Ban Live AI hands-free integration) ──────────
  // Registers a session with the API when an inspection is persisted so the
  // tech's glasses can forward voice + camera events in real-time. The 6-char
  // code is shown in the glasses strip below so the tech can pair the glasses.
  const glassesSession = useMetaGlassesSession({
    inspectionId: wsInspectionId,
    active: wsInspectionId != null,
    onFinding: useCallback(
      (event: GlassesEvent) => {
        // Persist frame findings in state so the detections panel stays up.
        if (event.finding || event.mediaId) {
          // #111 — deduplicate by event ID (guards against poll-cursor race)
          setGlassesFindings((prev) =>
            prev.some((e) => e.id === event.id) ? prev : [...prev, event]
          );
        }
        // Brief FAIE toast for immediate haptic feedback.
        setFaieStatus(`🕶 ${event.text}`);
        setTimeout(() => setFaieStatus(null), 4_000);
      },
      // setFaieStatus and setGlassesFindings are stable React setState refs.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      [],
    ),
  });

  // #106 — Haptic alert the moment glasses first go silent (isInactive flips true).
  // The amber strip already changes colour; the vibration grabs attention without
  // requiring the technician to glance at the screen.
  useEffect(() => {
    if (glassesSession.isInactive) {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    }
  }, [glassesSession.isInactive]);
  const [wsError, setWsError] = useState<string | null>(null);
  const [uploadedCount, setUploadedCount] = useState(0);
  const analyzedCount = useRef(0);

  // RLQ-008: tick incremented by useFocusEffect to re-read allFindingsReviewed on resume.
  const [reviewTick, setReviewTick] = useState(0);
  // RLQ-008: analysis query for the pending-findings review gate in the review step.
  const reviewAnalysisQ = useQuery({
    ...getListAnalysisResultsQueryOptions({ inspectionId: wsInspectionId ?? 0 }),
    enabled: wsInspectionId != null,
    staleTime: 10_000,
    refetchInterval: false,
  });

  // Local-first record: the single durable source of truth for this
  // inspection. Every capture and field edit is persisted to device storage
  // immediately, so a crash, fold, or dead zone never loses work. The sync
  // engine pushes it to the server whenever connectivity allows.
  const recordRef = useRef<LocalInspection | null>(null);
  const [hydrated, setHydrated] = useState(params.resume == null);

  // Resuming a draft after an app restart: rebuild all screen state from the
  // persisted record, including photos (durable file:// URIs) and how far the
  // server sync already got.
  useEffect(() => {
    const resumeId = params.resume;
    if (!resumeId || recordRef.current) return;
    void (async () => {
      const rec = await getLocalInspection(resumeId);
      if (rec) {
        recordRef.current = rec;
        setSiteAddress(rec.siteAddress);
        setClientName(rec.clientName);
        setTechnicianName(rec.technicianName || (clerkUser?.fullName ?? ""));
        setPropertyType(rec.propertyType || PROPERTY_TYPES[0]);
        setPestTypes(rec.pestTypes);
        setNotes(rec.notes);
        setPhotos(rec.photos.map((p) => ({ uri: p.localUri })));
        setUploadedCount(rec.photos.filter((p) => p.storagePath).length);
        analyzedCount.current = rec.analyzedCount;
        if (rec.serverId != null) setWsInspectionId(rec.serverId);
        if (rec.baitStations?.length) setBaitStations(rec.baitStations);
        if (rec.completed) setIsCompleted(true);
        setStep(rec.photos.length > 0 ? "capture" : "setup");
      }
      setHydrated(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.resume]);

  // Write-through persistence for field edits (debounced). The record itself
  // is created when the technician continues to the camera.
  useEffect(() => {
    if (!recordRef.current) return;
    const t = setTimeout(() => void persistDraft(), 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteAddress, clientName, technicianName, propertyType, pestTypes, notes]);

  // RLQ-008: re-read allFindingsReviewed when the screen gains focus (e.g. after
  // returning from the findings-review screen).
  useFocusEffect(
    useCallback(() => {
      void (async () => {
        const rec = recordRef.current;
        if (!rec) return;
        const fresh = await getLocalInspection(rec.localId);
        if (fresh) recordRef.current = fresh;
        setReviewTick((t) => t + 1);
      })();
    }, []),
  );

  const persistDraft = async () => {
    const rec = recordRef.current;
    if (!rec) return;
    // Atomic merge — never clobbers fields the sync engine wrote mid-flight.
    const updated = await updateLocalInspection(rec.localId, (r) => {
      r.siteAddress = siteAddress;
      r.clientName = clientName;
      r.technicianName = technicianName;
      r.propertyType = propertyType;
      r.pestTypes = pestTypes;
      r.notes = notes;
    });
    if (updated) recordRef.current = updated;
  };

  const [pestTypeError, setPestTypeError] = useState(false);

  // Entering the camera creates the durable local record (idempotent).
  const goToCapture = async () => {
    if (pestTypes.length === 0) {
      setPestTypeError(true);
      return;
    }
    setPestTypeError(false);
    if (!recordRef.current) {
      recordRef.current = newLocalInspection({
        siteAddress,
        clientName,
        technicianName,
        propertyType,
        pestTypes,
        notes,
      });
      await saveLocalInspection(recordRef.current);
    }
    setStep("capture");
  };

  // Leaving mid-inspection: the draft is already persisted, so keeping it is
  // free — the resume prompt offers it again next time. Discarding removes
  // local files and best-effort deletes any partially synced server row.
  const confirmExit = () => {
    const rec = recordRef.current;
    if (!rec || (photos.length === 0 && rec.serverId == null)) {
      if (rec) void deleteLocalInspection(rec.localId);
      router.back();
      return;
    }
    Alert.alert(
      "Leave inspection?",
      "Your photos and details are saved on this device. You can resume this inspection later.",
      [
        { text: "Keep working", style: "cancel" },
        {
          text: "Discard",
          style: "destructive",
          onPress: () => {
            const serverId = rec.serverId;
            if (serverId != null) void deleteInspection(serverId).catch(() => {});
            void deleteLocalInspection(rec.localId);
            router.back();
          },
        },
        { text: "Save draft & exit", onPress: () => router.back() },
      ],
    );
  };

  // Android hardware back: never silently destroys an in-progress inspection.
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (step === "review") {
        setStep("capture");
        return true;
      }
      if (step === "capture") {
        if (photos.length > 0) {
          confirmExit();
        } else {
          setStep("setup");
        }
        return true;
      }
      if (recordRef.current) {
        confirmExit();
        return true;
      }
      return false;
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, photos.length]);

  // Task #36: Re-check camera permissions when the app returns to the foreground
  // during an active capture session. useCameraPermissions is reactive, but an
  // explicit AppState listener ensures the state is refreshed promptly so the
  // camera-not-granted screen renders before the CameraView has a chance to error.
  useEffect(() => {
    if (step !== "capture") return;
    const sub = AppState.addEventListener("change", (nextState) => {
      if (nextState === "active") {
        void requestPermission().catch(() => {
          // Silently ignored — if the OS blocks the call (denied/never-ask-again),
          // permission.granted will be false and the grant screen renders normally.
        });
      }
    });
    return () => sub.remove();
  }, [step, requestPermission]);

  // Notify smart guidance when a new photo is captured so it can track idle time.
  useEffect(() => {
    const latest = photos[photos.length - 1];
    if (latest) guidance.notifyCapture(latest.uri);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photos.length]);

  // Live report builder state. The report is created once per inspection and
  // its AI narrative regenerated (with a fresh findings snapshot) after every
  // analysis run, so the draft always reflects the latest real detections.
  const [wsReport, setWsReport] = useState<Report | null>(null);
  const [wsReportBuilding, setWsReportBuilding] = useState(false);
  const [wsReportError, setWsReportError] = useState<string | null>(null);
  const wsReportId = useRef<number | null>(null);
  const wsReportRunning = useRef(false);
  const wsReportStale = useRef(false);

  const wsAnalysisQ = useQuery({
    ...getListAnalysisResultsQueryOptions({ inspectionId: wsInspectionId ?? 0 }),
    enabled: wsInspectionId != null,
  });
  const wsAnalysis = wsInspectionId != null ? wsAnalysisQ.data?.[0] : undefined;

  // Task #251 — Live compliance check. Fetched when the technician enters the
  // review step so violations appear BEFORE the inspection is finalised.
  const [reviewViolations, setReviewViolations] = useState<ComplianceViolation[]>([]);
  const [reviewViolationsLoading, setReviewViolationsLoading] = useState(false);

  useEffect(() => {
    if (step !== "review" || wsInspectionId == null) return;
    let cancelled = false;
    setReviewViolationsLoading(true);
    getToken()
      .then((token) => fetchPlaybookCompliance(token, wsInspectionId))
      .then((r) => { if (!cancelled) setReviewViolations(r.violations); })
      .catch(() => { /* non-fatal — violations are advisory only */ })
      .finally(() => { if (!cancelled) setReviewViolationsLoading(false); });
    return () => { cancelled = true; };
  }, [step, wsInspectionId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep FAIE vision context current with the latest AI analysis detections.
  useEffect(() => {
    const manager = sessionManagerRef.current;
    if (!manager || !wsAnalysis) return;
    const findings = (wsAnalysis.findings ?? []) as Array<{ species?: string; zone?: string }>;
    if (findings.length === 0) return;
    const top = findings[0];
    manager.setVisionContext({
      detectedPest: top?.species ?? undefined,
      detectedRoom: top?.zone ?? undefined,
      timestamp: Date.now(),
    });
  }, [wsAnalysis]);

  const canContinueSetup = siteAddress.trim().length > 0 && technicianName.trim().length > 0;

  const togglePest = (p: string) => {
    if (isCompleted) return;
    setPestTypeError(false);
    setPestTypes((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));
  };

  // Shared ingest path for ALL vision providers.
  //
  // Performance contract:
  //   1. Optimistic thumbnail — the cache URI is appended to `photos` state
  //      immediately (before any I/O) so the user sees the shot at once.
  //   2. Durable copy — the file is copied out of the volatile camera cache
  //      into documentDirectory in the background; the optimistic entry is
  //      then swapped to the durable URI via a targeted functional update
  //      (never a full list rebuild, so concurrent captures are safe).
  //   3. Store write — `updateLocalInspection` serialises through the update
  //      chain and only tracks `recordRef`; it does NOT call `setPhotos` again
  //      so concurrent-capture optimistic entries are never clobbered.
  //   4. Pixel analysis — runs deferred, well off the capture path.
  const ingestEvidence = async (items: EvidenceItem[]) => {
    const rec = recordRef.current;
    if (!rec || items.length === 0) return;
    const warnings: string[] = [];
    const added: { localUri: string; item: EvidenceItem }[] = [];

    try {
      for (const item of items) {
        const cacheUri = item.uri;

        // ── Step 1: optimistic thumbnail (instant, no I/O) ──────────────────
        setPhotos((prev) => [...prev, { uri: cacheUri }]);

        // ── Step 2: copy out of cache → durable directory ───────────────────
        const durableUri = await persistPhoto(rec.localId, cacheUri);
        const quality = assessEvidence(item);
        if (!quality.acceptable && quality.reasons.length > 0) warnings.push(quality.reasons[0]);

        // Swap the optimistic cache URI for the durable one.  Functional updater
        // is safe even when another capture added its own cache entry in the gap.
        setPhotos((prev) =>
          prev.map((p) => (p.uri === cacheUri ? { uri: durableUri } : p)),
        );

        // ── Step 3: persist record to AsyncStorage ──────────────────────────
        const updated = await updateLocalInspection(rec.localId, (r) => {
          r.photos.push({
            localUri: durableUri,
            capturedAt: item.capturedAt,
            captureSource: item.source,
            qualityScore: quality.score,
            captureMetadata: (() => {
              // Consume any fresh laser reading stamped before this capture.
              // The reading is cleared from the bridge so it attaches to exactly
              // one photo rather than being reused for subsequent captures.
              const laser = consumeLastMeasurementReading();
              return {
                ...item.metadata,
                width: item.width,
                height: item.height,
                fileSize: item.fileSize,
                ...(laser ? {
                  laserMeasurement: {
                    kind: laser.kind,
                    value: laser.value,
                    unit: laser.unit,
                    capturedAt: laser.capturedAt,
                  },
                } : {}),
              };
            })(),
          });
        });
        // Keep recordRef in sync; do NOT call setPhotos here — the targeted swap
        // above already reflects the correct URI, and a full rebuild would drop
        // optimistic entries from concurrent captures still in-flight.
        if (updated) recordRef.current = updated;

        added.push({ localUri: durableUri, item });

        // Fire FAIE global training ingest in the background — non-blocking.
        void ingestAllUploadedPhotos({
          photoUri: durableUri,
          companyId: clerkUser?.id ?? "",
          technicianId: clerkUser?.id ?? "",
          source: "technician_field_upload",
        });
      }

      setQualityNotice(warnings.length > 0 ? warnings[0] : null);
      // A fresh capture re-arms auto-run analysis after a prior failure.
      setWsError(null);
      // Deferred pass: decode pixels OFF the capture path to compute a perceptual
      // hash (duplicate detection) and a Laplacian sharpness score.
      void analyzeEvidencePixels(rec.localId, added);
    } catch (err) {
      // Local storage failure (disk full, file-system error) — the photo could
      // not be durably saved.  Surface a clear message so the technician knows
      // to free space; never let this become a silent black screen.
      const msg =
        err instanceof Error && err.message
          ? err.message
          : "Couldn't save photo to device storage. Check available storage space and try again.";
      setError(msg);
      console.error("[ingestEvidence]", err);
      // Roll back any optimistic thumbnails whose durable copy failed.
      if (added.length < items.length) {
        const savedUris = new Set(added.map((a) => a.localUri));
        setPhotos((prev) => prev.filter((p) => savedUris.has(p.uri) || added.some((a) => a.localUri === p.uri)));
      }
    }
  };

  // Sequential (one decode at a time, to bound memory) background pixel pass:
  // perceptual-hash de-duplication + sharpness refinement. Runs after the
  // thumbnails are already on screen. Each result patches its photo in place;
  // a detected duplicate or blur surfaces a gentle, non-blocking notice.
  // Advisory only — a failed/undecodable frame simply keeps its metadata score.
  const analyzeEvidencePixels = async (
    localId: string,
    added: { localUri: string; item: EvidenceItem }[],
  ) => {
    for (const { localUri, item } of added) {
      const pixels = await loadGrayscaleImage(localUri);
      if (!pixels) continue;
      const hash = computeDHash(pixels);
      const refined = assessEvidence(item, pixels);
      let duplicateOf: string | null = null;
      const updated = await updateLocalInspection(localId, (r) => {
        const photo = r.photos.find((p) => p.localUri === localUri);
        if (!photo) return;
        duplicateOf = findNearDuplicate(
          hash,
          r.photos.filter((p) => p.localUri !== localUri),
        );
        photo.perceptualHash = hash;
        if (duplicateOf) photo.duplicateOf = duplicateOf;
        photo.qualityScore = refined.score;
      });
      if (updated) recordRef.current = updated;
      if (duplicateOf) {
        setQualityNotice("This looks like a duplicate of an earlier photo");
      } else if (!refined.acceptable && refined.reasons.length > 0) {
        setQualityNotice(refined.reasons[0]);
      }
    }
  };

  const takePhoto = async () => {
    const rec = recordRef.current;
    // captureLockedRef is a synchronous guard — checked and set before any
    // await so rapid taps during a lag spike cannot queue up multiple captures.
    if (!cameraRef.current || captureLockedRef.current || capturing || importing || !rec) return;
    captureLockedRef.current = true;
    // Fire haptic immediately on press (before the async pipeline starts) so
    // the technician feels confirmation the moment they tap, not seconds later.
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      setCapturing(true);
      const items = await cameraProvider.capture();
      // ── Release the camera lock as soon as we have the captured URIs. ──────
      // File copy and AsyncStorage write continue in the background so the
      // shutter is ready for the next shot in ~200 ms instead of ~8 s.
      setCapturing(false);
      void ingestEvidence(items);
    } catch {
      setCapturing(false);
      setError("Couldn't capture photo. Please try again.");
    } finally {
      // 600 ms cooldown — discards any queued taps that arrived during the
      // capture pipeline without blocking the next intentional tap longer than needed.
      setTimeout(() => { captureLockedRef.current = false; }, 600);
    }
  };

  // Import existing footage (GoPro / smart-glasses / drone shots synced to the
  // camera roll) into this inspection — same pipeline as live captures.
  const importPhotos = async () => {
    const rec = recordRef.current;
    if (importing || capturing || !rec) return;
    try {
      setImporting(true);
      await ingestEvidence(await importProvider.capture());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't import photos. Please try again.");
    } finally {
      setImporting(false);
    }
  };

  // Quality warnings are transient nudges, not persistent errors.
  useEffect(() => {
    if (!qualityNotice) return;
    const timer = setTimeout(() => setQualityNotice(null), 6000);
    return () => clearTimeout(timer);
  }, [qualityNotice]);

  // Remove a not-yet-uploaded photo from both screen state and the record.
  const removePhoto = async (index: number) => {
    const rec = recordRef.current;
    const target = rec?.photos[index];
    // Refuse to delete a photo that is uploaded OR actively mid-upload.
    // The `uploading` flag is set by the sync engine before the network
    // request and cleared once the storagePath is written, preventing a
    // race where the file lands on storage but the local record still shows
    // storagePath === undefined.
    if (!rec || !target || target.storagePath || target.uploading) return;
    const updated = await updateLocalInspection(rec.localId, (r) => {
      const i = r.photos.findIndex((p) => p.localUri === target.localUri);
      // Re-check in the atomic context — engine may have set uploading or
      // storagePath between the outer guard and this callback.
      if (i !== -1 && !r.photos[i].storagePath && !r.photos[i].uploading) r.photos.splice(i, 1);
    });
    if (updated) {
      recordRef.current = updated;
      setPhotos(updated.photos.map((p) => ({ uri: p.localUri })));
    }
  };

  // Runs the sync pipeline from the workspace while the camera stays live:
  // create (idempotent) → upload photos → draft AI analysis. All progress is
  // checkpointed on the local record, so a drop mid-run resumes exactly where
  // it left off. Offline, this is a no-op with a friendly notice — photos are
  // already safe on the device.
  const runWorkspaceAnalysis = async () => {
    const rec = recordRef.current;
    if (wsAnalyzing || !rec || rec.photos.length === 0) return;
    setWsError(null);
    setWsAnalyzing(true);
    try {
      await persistDraft();
      const updated = await syncNow(rec.localId);
      if (updated) {
        recordRef.current = updated;
        if (updated.serverId != null) setWsInspectionId(updated.serverId);
        setUploadedCount(updated.photos.filter((p) => p.storagePath).length);
        analyzedCount.current = updated.analyzedCount;
        await queryClient.invalidateQueries();
        // New verified detections exist — rebuild the live report in the
        // background while the technician keeps capturing.
        if (updated.serverId != null) void buildLiveReport(updated.serverId);
      }
    } catch (e) {
      setWsError(
        isOfflineError(e)
          ? OFFLINE_NOTICE
          : e instanceof ApiError
            ? e.message
            : (e as Error).message,
      );
    } finally {
      setWsAnalyzing(false);
    }
  };

  // Auto-run: while the camera is open, analysis kicks off shortly after each
  // new photo so the AI Inspection Panel updates live — no button press
  // needed. The short delay batches rapid captures into one run; when a run
  // finishes and more photos arrived meanwhile, this re-fires for the rest.
  // After a failure (wsError set) auto-run pauses — a new capture or the
  // manual "Run analysis" button clears the error and re-arms it, so a
  // persistent failure never becomes an infinite retry loop.
  useEffect(() => {
    if (step !== "capture" || submitting || wsAnalyzing || wsError) return;
    if (photos.length === 0 || photos.length <= analyzedCount.current) return;
    const timer = setTimeout(() => {
      void runWorkspaceAnalysis();
    }, 2500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, submitting, wsAnalyzing, wsError, photos.length]);

  // Builds (or rebuilds) the live service report from the latest verified
  // data. Creates the report once, then regenerates its AI narrative with a
  // refreshed findings snapshot. If an analysis finishes while a build is in
  // flight, the stale flag queues exactly one more rebuild so the draft never
  // lags behind the newest detections.
  const buildLiveReport = async (inspectionId: number) => {
    if (wsReportRunning.current) {
      wsReportStale.current = true;
      return;
    }
    wsReportRunning.current = true;
    setWsReportBuilding(true);
    setWsReportError(null);
    try {
      do {
        wsReportStale.current = false;
        let reportId = wsReportId.current;
        if (reportId == null) {
          const created = await generateReport.mutateAsync({
            data: {
              inspectionId,
              title: `Service report — ${siteAddress.trim()}`,
              includeAiFindings: true,
            },
          });
          reportId = created.id;
          wsReportId.current = reportId;
          setWsReport(created);
        }
        const updated = await generateNarrative.mutateAsync({
          id: reportId,
          data: { refreshFindings: true },
        });
        setWsReport(updated);
      } while (wsReportStale.current);
      await queryClient.invalidateQueries();
    } catch (e) {
      setWsReportError(
        isOfflineError(e)
          ? "You're offline — the draft is saved on this device and the report will finalize automatically when you're back online."
          : e instanceof ApiError
            ? e.message
            : (e as Error).message,
      );
    } finally {
      wsReportRunning.current = false;
      setWsReportBuilding(false);
    }
  };

  // Complete Inspection — the explicit end of the capture lifecycle.
  // Marks the local record complete (durable even if the app dies right
  // after), then attempts an immediate sync: create → upload photos → draft
  // analysis → server-side completion (report, narrative, summary,
  // opportunities, scorecard). Offline, completion still succeeds locally
  // and the engine finishes the push automatically when connectivity
  // returns — the summary screen shows live sync status either way.
  const completeNow = async () => {
    const rec = recordRef.current;
    if (!rec || submitting) return;
    setError(null);
    setSubmitting(true);
    setProgress("Saving inspection…");
    try {
      const updated = await updateLocalInspection(rec.localId, (r) => {
        r.siteAddress = siteAddress;
        r.clientName = clientName;
        r.technicianName = technicianName;
        r.propertyType = propertyType;
        r.pestTypes = pestTypes;
        r.notes = notes;
        r.completed = true;
        r.completedAt = new Date().toISOString();
      });
      if (updated) recordRef.current = updated;

      setProgress("Syncing evidence & running AI analysis…");
      try {
        await syncNow(rec.localId);
      } catch {
        // Offline or server hiccup — the record is safe on-device and the
        // sync engine retries automatically. Completion is NOT blocked.
        requestSync(0);
      }
      await queryClient.invalidateQueries();
      router.replace(`/inspection-summary/${rec.localId}` as Href);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message);
      setSubmitting(false);
    }
  };

  // Wait for draft hydration when resuming, so we never render (or create)
  // fresh state on top of a half-loaded record.
  if (!hydrated) {
    return <Screen edges={["top", "bottom"]} />;
  }

  // ─── Submitting overlay ─────────────────────────────────────────────────────
  if (submitting) {
    return (
      <Screen edges={["top", "bottom"]}>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 16, padding: 24 }}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold", fontSize: 17 }}>
            {progress || "Working…"}
          </Text>
          <Text
            style={{
              color: colors.mutedForeground,
              fontFamily: "Inter_400Regular",
              fontSize: 14,
              textAlign: "center",
            }}
          >
            Keep the app open while we upload evidence and run AI analysis.
          </Text>
        </View>
      </Screen>
    );
  }

  // ─── Capture step (full camera) ─────────────────────────────────────────────
  if (step === "capture") {
    if (!permission) {
      return <Screen edges={["top", "bottom"]} />;
    }
    if (!permission.granted) {
      return (
        <Screen edges={["top", "bottom"]} padded>
          <Header title="Camera access" onClose={() => setStep("setup")} colors={colors} />
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 16 }}>
            <Ionicons name="camera-outline" size={48} color={colors.mutedForeground} />
            <Text
              style={{
                color: colors.foreground,
                fontFamily: "Inter_600SemiBold",
                fontSize: 17,
                textAlign: "center",
              }}
            >
              Allow camera access
            </Text>
            <Text
              style={{
                color: colors.mutedForeground,
                fontFamily: "Inter_400Regular",
                textAlign: "center",
              }}
            >
              ReadyLoq needs your camera to capture inspection evidence for AI analysis.
            </Text>
            <Button title="Grant camera access" onPress={requestPermission} />
          </View>
        </Screen>
      );
    }

    const isPhoneLandscape = isLandscape && !isWideScreen;

    const thumbs =
      photos.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={isPhoneLandscape ? { position: "absolute", bottom: 16, left: 0, right: 116 } : undefined}
          contentContainerStyle={{ gap: 8, paddingHorizontal: 16 }}
        >
          {photos.map((p, i) => (
            <View key={`${p.uri}-${i}`}>
              <Image source={{ uri: p.uri }} style={{ width: 56, height: 56, borderRadius: 8 }} />
              {i >= uploadedCount ? (
                <Pressable
                  onPress={() => void removePhoto(i)}
                  style={{
                    position: "absolute",
                    top: -6,
                    right: -6,
                    backgroundColor: colors.destructive,
                    borderRadius: 10,
                    width: 20,
                    height: 20,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Ionicons name="close" size={13} color="#fff" />
                </Pressable>
              ) : null}
            </View>
          ))}
        </ScrollView>
      ) : null;

    const captureButton = (
      <Pressable
        onPress={takePhoto}
        disabled={capturing}
        style={{
          width: 76,
          height: 76,
          borderRadius: 38,
          backgroundColor: "rgba(255,255,255,0.25)",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <View style={{ width: 62, height: 62, borderRadius: 31, backgroundColor: "#fff" }} />
      </Pressable>
    );

    const doneButton = (
      <Pressable
        onPress={() => setStep("review")}
        disabled={photos.length === 0}
        style={{ width: 64, alignItems: "center", opacity: photos.length === 0 ? 0.4 : 1 }}
      >
        <Text style={{ color: colors.primary, fontFamily: "Inter_600SemiBold", fontSize: 16 }}>
          Done
        </Text>
      </Pressable>
    );

    const flashButton = (
      <Pressable
        onPress={() => setFlash((f) => (f === "off" ? "auto" : f === "auto" ? "on" : "off"))}
        style={{
          width: 44,
          height: 44,
          borderRadius: 22,
          backgroundColor: "rgba(0,0,0,0.5)",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Ionicons
          name={flash === "off" ? "flash-off" : flash === "auto" ? "flash-outline" : "flash"}
          size={20}
          color="#fff"
        />
      </Pressable>
    );

    // Vision Platform: pull GoPro / smart-glasses / drone footage off the
    // camera roll straight into this inspection.
    const importButton = (
      <Pressable
        onPress={() => void importPhotos()}
        disabled={importing || capturing}
        style={{
          width: 44,
          height: 44,
          borderRadius: 22,
          backgroundColor: "rgba(0,0,0,0.5)",
          alignItems: "center",
          justifyContent: "center",
          opacity: importing ? 0.5 : 1,
        }}
      >
        {importing ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : (
          <Ionicons name="images-outline" size={20} color="#fff" />
        )}
      </Pressable>
    );

    // FAIE: mic button — voice mode only, activates the audio intelligence session.
    const faieButton = mode === "voice" ? (
      <Pressable
        onPress={() => void handleFaiePress()}
        style={{
          width: 44,
          height: 44,
          borderRadius: 22,
          backgroundColor: isFaieListening ? "rgba(239,68,68,0.85)" : "rgba(0,0,0,0.5)",
          alignItems: "center",
          justifyContent: "center",
          borderWidth: isFaieListening ? 1.5 : 0,
          borderColor: isFaieListening ? "#ef4444" : "transparent",
        }}
      >
        <Ionicons
          name={isFaieListening ? "mic" : "mic-outline"}
          size={20}
          color="#fff"
        />
      </Pressable>
    ) : null;

    // FAIE: live status banner — purely informational, no action required.
    // Low-confidence events are auto-committed (marked with "~"); the banner
    // echoes what was logged and shows a camera icon when a room snapshot was
    // captured alongside the audio note.
    const faieBanner = isFaieListening ? (
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          backgroundColor: "rgba(0,0,0,0.72)",
          paddingHorizontal: 12,
          paddingVertical: 8,
          borderRadius: 10,
          maxWidth: 440,
          borderWidth: 1,
          borderColor: "rgba(255,255,255,0.15)",
        }}
      >
        <Ionicons name="mic" size={15} color="#fff" />
        <Text style={{ color: "#fff", fontFamily: "Inter_500Medium", fontSize: 12, flex: 1, flexShrink: 1 }}>
          {faieStatus}
        </Text>
        {lastEventHadFrame ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
            <Ionicons name="camera" size={12} color="rgba(255,255,255,0.6)" />
          </View>
        ) : null}
      </View>
    ) : null;

    // Meta glasses activity strip — shown when a Live AI session is active.
    const glassesCaptures = glassesFindings.filter((e) => e.finding || e.mediaId);
    // #106 — amber strip when glasses have gone silent for 2+ minutes
    const glassesStripBg = glassesSession.isInactive
      ? "rgba(202,138,4,0.92)"
      : "rgba(124,58,237,0.88)";
    const glassesStrip = glassesSession.isActive ? (
      <View
        style={{
          backgroundColor: glassesStripBg,
          paddingHorizontal: 12,
          paddingVertical: 7,
          borderRadius: 10,
          maxWidth: 440,
          borderWidth: 1,
          borderColor: "rgba(255,255,255,0.2)",
          gap: 6,
        }}
      >
        {/* Normal status row */}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Ionicons name="glasses-outline" size={15} color="#fff" />
          <Text style={{ color: "#fff", fontFamily: "Inter_500Medium", fontSize: 12, flex: 1, flexShrink: 1 }}>
            {glassesSession.status ?? "Glasses active"}
          </Text>
          {/* Compact code pill — always visible so tech can reference it */}
          {glassesSession.code && !glassesSession.codeJustChanged ? (
            <View
              style={{
                backgroundColor: "rgba(255,255,255,0.18)",
                borderRadius: 5,
                paddingHorizontal: 6,
                paddingVertical: 2,
              }}
            >
              <Text style={{ color: "#fff", fontFamily: "Inter_700Bold", fontSize: 11, letterSpacing: 0.8 }}>
                {glassesSession.code}
              </Text>
            </View>
          ) : null}
          {glassesCaptures.length > 0 && (
            <View style={{ backgroundColor: "rgba(255,255,255,0.25)", borderRadius: 999, paddingHorizontal: 7, paddingVertical: 2 }}>
              <Text style={{ color: "#fff", fontFamily: "Inter_700Bold", fontSize: 11 }}>
                {glassesCaptures.length} capture{glassesCaptures.length === 1 ? "" : "s"}
              </Text>
            </View>
          )}
        </View>
        {/* #109 — Expanded reconnect banner: visible for 10 s after a new code is issued */}
        {glassesSession.codeJustChanged && glassesSession.code ? (
          <View
            style={{
              backgroundColor: "rgba(0,0,0,0.25)",
              borderRadius: 7,
              paddingHorizontal: 10,
              paddingVertical: 8,
              alignItems: "center",
              gap: 4,
              borderWidth: 1,
              borderColor: "rgba(254,240,138,0.55)",
            }}
          >
            <Text style={{ color: "rgba(254,240,138,1)", fontFamily: "Inter_500Medium", fontSize: 10, textAlign: "center" }}>
              New code issued — update the Meta app
            </Text>
            <Text style={{ color: "#fff", fontFamily: "Inter_700Bold", fontSize: 22, letterSpacing: 4 }}>
              {glassesSession.code}
            </Text>
          </View>
        ) : null}
      </View>
    ) : null;

    // Compact list of the most recent glasses detections — shown below the strip.
    // #110 — entries with a stored frame are tappable to open full-screen.
    // #115 — entries show the zoomed subject label when available.
    const glassesFindingsPanel = glassesCaptures.length > 0 ? (
      <View style={{ gap: 5, maxWidth: 440, alignSelf: "stretch" }}>
        {glassesCaptures.slice(-3).map((ev) => {
          const sev = ev.finding?.severity ?? "low";
          const sevColor =
            sev === "critical" || sev === "high" ? "#ef4444"
            : sev === "medium" ? "#f59e0b"
            : "#22c55e";
          return (
            <Pressable
              key={ev.id}
              onPress={ev.storagePath ? () => setGlassesViewerPath(ev.storagePath!) : undefined}
              style={{
                flexDirection: "row", alignItems: "center", gap: 8,
                backgroundColor: "rgba(124,58,237,0.18)",
                borderRadius: 8, paddingHorizontal: 8, paddingVertical: 5,
                borderWidth: 1, borderColor: "rgba(124,58,237,0.35)",
              }}
            >
              {ev.storagePath ? (
                <AuthedImage
                  path={ev.storagePath}
                  style={{ width: 36, height: 36, borderRadius: 6 }}
                  contentFit="cover"
                />
              ) : (
                <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: sevColor }} />
              )}
              <View style={{ flex: 1, gap: 1 }}>
                <Text
                  style={{ color: "#e9d5ff", fontFamily: "Inter_500Medium", fontSize: 11 }}
                  numberOfLines={1}
                >
                  {ev.finding
                    ? `${ev.finding.category} · ${Math.round(ev.finding.confidence * 100)}%`
                    : ev.text}
                </Text>
                {ev.zoomSubject ? (
                  <Text
                    style={{ color: "rgba(196,181,253,0.65)", fontFamily: "Inter_400Regular", fontSize: 9 }}
                    numberOfLines={1}
                  >
                    zoomed: {ev.zoomSubject}
                  </Text>
                ) : null}
              </View>
              {ev.mediaId ? (
                <Ionicons name="cloud-done-outline" size={11} color="rgba(233,213,255,0.7)" />
              ) : null}
            </Pressable>
          );
        })}
      </View>
    ) : null;

    // #110 — Full-screen viewer for glasses-captured frames.
    const glassesViewerModal = (
      <Modal
        visible={glassesViewerPath != null}
        transparent
        animationType="fade"
        onRequestClose={() => setGlassesViewerPath(null)}
        statusBarTranslucent
      >
        <Pressable
          style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.95)" }}
          onPress={() => setGlassesViewerPath(null)}
        >
          {glassesViewerPath ? (
            <AuthedImage
              path={glassesViewerPath}
              style={{ flex: 1 }}
              contentFit="contain"
            />
          ) : null}
          <Text
            style={{ position: "absolute", bottom: 48, alignSelf: "center", color: "rgba(255,255,255,0.5)", fontSize: 12 }}
          >
            Tap anywhere to close
          </Text>
        </Pressable>
      </Modal>
    );

    const qualityBanner = qualityNotice ? (
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          backgroundColor: "rgba(202,138,4,0.92)",
          paddingHorizontal: 10,
          paddingVertical: 7,
          borderRadius: 10,
          maxWidth: 440,
        }}
      >
        <Ionicons name="warning-outline" size={16} color="#fff" />
        <Text
          style={{
            color: "#fff",
            fontFamily: "Inter_600SemiBold",
            fontSize: 12,
            flex: 1,
            flexShrink: 1,
          }}
        >
          {qualityNotice}
        </Text>
        {/* RLQ-007: Actionable retake button. Removes the just-captured photo so the
            technician can try a sharper or better-lit shot without accumulating poor evidence. */}
        {photos.length > 0 && (
          <Pressable
            onPress={() => {
              void removePhoto(photos.length - 1);
              setQualityNotice(null);
            }}
            style={{
              paddingHorizontal: 8,
              paddingVertical: 4,
              borderRadius: 6,
              backgroundColor: "rgba(255,255,255,0.28)",
            }}
          >
            <Text style={{ color: "#fff", fontFamily: "Inter_700Bold", fontSize: 11 }}>
              Retake
            </Text>
          </Pressable>
        )}
      </View>
    ) : null;

    const zoomChips = (
      <View style={{ flexDirection: "row", gap: 8, alignItems: "center" }}>
        {ZOOM_LEVELS.map((z) => {
          const active = zoom === z.value;
          const aiControlled = active && autoZoom && mode === "copilot";
          return (
            <Pressable
              key={z.label}
              onPress={() => {
                if (zoomAnimRef.current != null) cancelAnimationFrame(zoomAnimRef.current);
                zoomRef.current = z.value;
                setZoom(z.value);
                setAutoZoom(false);
              }}
              style={{
                paddingHorizontal: 12,
                paddingVertical: 6,
                borderRadius: 999,
                backgroundColor: active ? "rgba(255,255,255,0.9)" : "rgba(0,0,0,0.5)",
                borderWidth: aiControlled ? 1.5 : 0,
                borderColor: "#17c4d3",
              }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                <Text
                  style={{
                    color: active ? "#000" : "#fff",
                    fontFamily: "Inter_600SemiBold",
                    fontSize: 13,
                  }}
                >
                  {z.label}
                </Text>
                {aiControlled && (
                  <Text style={{ color: "#17c4d3", fontFamily: "Inter_700Bold", fontSize: 9 }}>
                    AUTO
                  </Text>
                )}
              </View>
            </Pressable>
          );
        })}
      </View>
    );

    // ─── Expanded: AI Inspection Workspace (camera + live insights) ──────────
    // Strict 50/50 split — camera fills its pane edge-to-edge (cover mode).

    if (isWideScreen) {
      return (
        <Screen edges={["top", "bottom"]}>
          <View style={{ flex: 1, flexDirection: "row", backgroundColor: "#0D1117" }}>
            {/* Left: camera pane — cover-fills the entire half, no letterboxing */}
            <View style={{ flex: 1, backgroundColor: "#000" }}>
              {/* CameraView fills the pane completely — acts as CSS object-fit:cover */}
              <CameraView
                ref={cameraRef}
                style={{ flex: 1, width: "100%" }}
                facing="back"
                zoom={zoom}
                flash={flash}
              />

              {/* Frame-capture flash overlay */}
              <Animated.View
                pointerEvents="none"
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  right: 0,
                  bottom: 0,
                  backgroundColor: "#fff",
                  opacity: frameCaptureAnim,
                }}
              />

              {/* Top overlay: back button + photo count */}
              <View
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  right: 0,
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: 16,
                }}
              >
                <Pressable
                  onPress={() => setStep("setup")}
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 20,
                    backgroundColor: "rgba(0,0,0,0.45)",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Ionicons name="chevron-back" size={24} color="#fff" />
                </Pressable>
                <View
                  style={{
                    backgroundColor: "rgba(0,0,0,0.45)",
                    paddingHorizontal: 12,
                    paddingVertical: 6,
                    borderRadius: 999,
                  }}
                >
                  <Text style={{ color: "#fff", fontFamily: "Inter_600SemiBold" }}>
                    {photos.length} captured
                  </Text>
                </View>
              </View>

              {/* Bottom overlay: controls float above the live camera feed */}
              <View style={{ position: "absolute", bottom: 0, left: 0, right: 0, padding: 16, gap: 14, alignItems: "center" }}>
                {!isConnected && (
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8, backgroundColor: "rgba(239,68,68,0.15)", borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, alignSelf: "stretch" }}>
                    <Ionicons name="cloud-offline" size={16} color="#ef4444" />
                    <Text style={{ color: "#ef4444", fontFamily: "Inter_400Regular", fontSize: 12, flex: 1 }}>
                      Offline — photos save locally and sync when connected
                    </Text>
                  </View>
                )}
                {qualityBanner}
                {faieBanner}
                {glassesViewerModal}
                {glassesStrip}
                {glassesFindingsPanel}
                {zoomChips}
                <NativeCameraHealthBadge />
                <DeviceHealthStrip />
                {guidance.text ? (
                  <View
                    style={{
                      alignSelf: "stretch",
                      backgroundColor: "rgba(23,196,211,0.08)",
                      borderRadius: 10,
                      paddingHorizontal: 12,
                      paddingVertical: 7,
                      borderWidth: 1,
                      borderColor: "rgba(23,196,211,0.2)",
                    }}
                  >
                    <Text
                      style={{
                        color: "#17c4d3",
                        fontFamily: "Inter_400Regular",
                        fontSize: 12,
                        textAlign: "center",
                      }}
                    >
                      {guidance.text}
                    </Text>
                  </View>
                ) : null}
                <View style={{ flexDirection: "row", alignItems: "center", gap: 28 }}>
                  {flashButton}
                  {importButton}
                  <Pressable onPress={() => setShowWifiCamera(true)} style={{ alignItems: "center", gap: 4 }}>
                    <View style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: wifiCameraConnected ? "rgba(23,196,211,0.2)" : "rgba(255,255,255,0.1)", alignItems: "center", justifyContent: "center", borderWidth: wifiCameraConnected ? 1 : 0, borderColor: "#17c4d3" }}>
                      <Ionicons name="wifi" size={20} color={wifiCameraConnected ? "#17c4d3" : "#fff"} />
                    </View>
                    <Text style={{ color: wifiCameraConnected ? "#17c4d3" : "#9ca3af", fontFamily: "Inter_400Regular", fontSize: 10 }}>Wi-Fi</Text>
                  </Pressable>
                  {faieButton}
                  {captureButton}
                  {doneButton}
                </View>
                {thumbs}
              </View>
              <WifiCameraModal
                visible={showWifiCamera}
                onClose={() => setShowWifiCamera(false)}
                onConnected={() => setWifiCameraConnected(true)}
              />
            </View>

            {/* Right: AI Insights / Co-Pilot pane — strict 50% of screen */}
            <View style={{ flex: 1, borderLeftWidth: 1, borderLeftColor: "#30363D", backgroundColor: "#161B22" }}>
              {mode === "copilot" ? (
                <View style={{ flex: 1, flexDirection: "column" }}>
                  <CoPilotHUD
                    propertyType={propertyType}
                    analysis={wsAnalysis}
                    analyzing={wsAnalyzing}
                    photosCount={photos.length}
                    onZoomSuggestion={handleCopilotZoom}
                  />
                  <View style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingVertical: 8 }}>
                    <Pressable
                      onPress={() => setShowBaitPanel((v) => !v)}
                      style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingVertical: 6 }}
                    >
                      <Ionicons name="location" size={14} color="#9ca3af" />
                      <Text style={{ color: "#9ca3af", fontFamily: "Inter_600SemiBold", fontSize: 12, flex: 1 }}>
                        Bait Stations {baitStations.length > 0 ? `(${baitStations.length})` : ""}
                      </Text>
                      <Ionicons name={showBaitPanel ? "chevron-down" : "chevron-up"} size={12} color="#6b7280" />
                    </Pressable>
                    {showBaitPanel && (
                      <BaitStationPanel
                        stations={baitStations}
                        onAdd={addBaitStation}
                        onUpdate={updateBaitStation}
                        onRemove={removeBaitStation}
                      />
                    )}
                  </View>
                  <View
                    style={{
                      borderTopWidth: 1,
                      borderTopColor: colors.border,
                      padding: 12,
                    }}
                  >
                    <MeasurementDevicePanel onActiveCountChange={setActiveSensorCount} />
                  </View>
                </View>
              ) : (
                <AiInsightsPanel
                  siteAddress={siteAddress}
                  propertyType={propertyType}
                  pestTypes={pestTypes}
                  photosCount={photos.length}
                  pendingCount={Math.max(0, photos.length - analyzedCount.current)}
                  analysis={wsAnalysis}
                  analyzing={wsAnalyzing}
                  error={wsError}
                  report={wsReport}
                  reportBuilding={wsReportBuilding}
                  reportError={wsReportError}
                  onRunAnalysis={runWorkspaceAnalysis}
                  onReview={() => setStep("review")}
                />
              )}
            </View>
          </View>
        </Screen>
      );
    }

    return (
      <View style={{ flex: 1, backgroundColor: "#000" }}>
        <CameraView ref={cameraRef} style={{ flex: 1 }} facing="back" zoom={zoom} flash={flash} />
        {/* Frame-capture flash: briefly pulses white when a voice note grabs a room snapshot */}
        <Animated.View
          pointerEvents="none"
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "#fff",
            opacity: frameCaptureAnim,
          }}
        />
        <View style={{ position: "absolute", top: 0, left: 0, right: isLandscape ? 116 : 0 }}>
          <Screen edges={["top"]} style={{ backgroundColor: "transparent" }}>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                padding: 16,
              }}
            >
              <Pressable
                onPress={() => setStep("setup")}
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 20,
                  backgroundColor: "rgba(0,0,0,0.5)",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Ionicons name="chevron-back" size={24} color="#fff" />
              </Pressable>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <View
                  style={{
                    backgroundColor: "rgba(0,0,0,0.5)",
                    paddingHorizontal: 12,
                    paddingVertical: 6,
                    borderRadius: 999,
                  }}
                >
                  <Text style={{ color: "#fff", fontFamily: "Inter_600SemiBold" }}>
                    {photos.length} captured
                  </Text>
                </View>
                <Pressable
                  onPress={() => setShowInsights(true)}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 6,
                    backgroundColor: "rgba(0,0,0,0.5)",
                    paddingHorizontal: 12,
                    paddingVertical: 8,
                    borderRadius: 999,
                    borderWidth: 1,
                    borderColor: mode === "copilot"
                      ? "rgba(23,196,211,0.6)"
                      : "rgba(255,255,255,0.35)",
                  }}
                >
                  {wsAnalyzing ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Ionicons
                      name={mode === "copilot" ? "navigate-circle-outline" : "sparkles"}
                      size={15}
                      color="#fff"
                    />
                  )}
                  <Text style={{ color: "#fff", fontFamily: "Inter_600SemiBold", fontSize: 13 }}>
                    {mode === "copilot"
                      ? "Co-Pilot"
                      : `AI Insights${(wsAnalysis?.findings?.length ?? 0) > 0 ? ` (${wsAnalysis?.findings?.length})` : ""}`}
                  </Text>
                </Pressable>
              </View>
            </View>
          </Screen>
        </View>

        {isLandscape ? (
          <>
            {/* Right-edge control rail: capture stays under the thumb in landscape */}
            <View
              style={{
                position: "absolute",
                right: 0,
                top: 0,
                bottom: 0,
                width: 116,
                backgroundColor: "rgba(0,0,0,0.4)",
                alignItems: "center",
                justifyContent: "center",
                gap: 28,
              }}
            >
              {flashButton}
              {importButton}
              {captureButton}
              {doneButton}
              {faieButton}
              <Pressable
                onPress={() => {
                  if (!wsInspectionId) {
                    Alert.alert("Not ready", "Inspection is still saving. Wait a moment.");
                    return;
                  }
                  setShowTreatmentWizard(true);
                }}
                style={{ alignItems: "center", gap: 3 }}
              >
                <Ionicons name="flask-outline" size={22} color="#fff" />
                <Text style={{ color: "#fff", fontFamily: "Inter_400Regular", fontSize: 9 }}>Log Chem</Text>
              </Pressable>
            </View>
            <View
              style={{
                position: "absolute",
                bottom: photos.length > 0 ? 88 : 24,
                left: 0,
                right: 132,
                alignItems: "center",
                gap: 10,
              }}
            >
              {qualityBanner}
              {faieBanner}
              {glassesStrip}
              {glassesFindingsPanel}
              {zoomChips}
            </View>
            {thumbs}
          </>
        ) : (
          <View
            style={{
              position: "absolute",
              bottom: 0,
              left: 0,
              right: 0,
              paddingBottom: 36,
              paddingTop: 16,
              backgroundColor: "rgba(0,0,0,0.4)",
              gap: 16,
            }}
          >
            {thumbs}
            {qualityBanner ? (
              <View style={{ alignItems: "center", paddingHorizontal: 16 }}>{qualityBanner}</View>
            ) : null}
            {faieBanner ? (
              <View style={{ alignItems: "center", paddingHorizontal: 16 }}>{faieBanner}</View>
            ) : null}
            {glassesStrip ? (
              <View style={{ alignItems: "center", paddingHorizontal: 16 }}>{glassesStrip}</View>
            ) : null}
            {glassesFindingsPanel ? (
              <View style={{ paddingHorizontal: 16 }}>{glassesFindingsPanel}</View>
            ) : null}
            {!isConnected && (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(239,68,68,0.15)", marginHorizontal: 16, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 }}>
                <Ionicons name="cloud-offline" size={13} color="#ef4444" />
                <Text style={{ color: "#ef4444", fontFamily: "Inter_400Regular", fontSize: 11, flex: 1 }}>
                  Offline — saving locally
                </Text>
              </View>
            )}
            <View style={{ alignItems: "center" }}>{zoomChips}</View>
            {guidance.text ? (
              <View
                style={{
                  marginHorizontal: 16,
                  backgroundColor: "rgba(23,196,211,0.08)",
                  borderRadius: 10,
                  paddingHorizontal: 12,
                  paddingVertical: 7,
                  borderWidth: 1,
                  borderColor: "rgba(23,196,211,0.2)",
                }}
              >
                <Text
                  style={{
                    color: "#17c4d3",
                    fontFamily: "Inter_400Regular",
                    fontSize: 12,
                    textAlign: "center",
                  }}
                >
                  {guidance.text}
                </Text>
              </View>
            ) : null}
            <View style={{ alignItems: "center", paddingHorizontal: 16 }}>
              <NativeCameraHealthBadge />
              <DeviceHealthStrip />
            </View>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                paddingHorizontal: 28,
              }}
            >
              <View style={{ width: 64, alignItems: "center", gap: 12 }}>
                {flashButton}
                {importButton}
                <Pressable onPress={() => setShowWifiCamera(true)} style={{ alignItems: "center" }}>
                  <Ionicons name="wifi" size={22} color={wifiCameraConnected ? "#17c4d3" : "#fff"} />
                </Pressable>
                <Pressable
                  onPress={() => {
                    if (!wsInspectionId) {
                      Alert.alert(
                        "Not ready",
                        "Inspection is still saving to the server. Wait a moment and try again.",
                      );
                      return;
                    }
                    setShowTreatmentWizard(true);
                  }}
                  style={{ alignItems: "center", gap: 3 }}
                >
                  <Ionicons name="flask-outline" size={22} color="#fff" />
                  <Text style={{ color: "#fff", fontFamily: "Inter_400Regular", fontSize: 9 }}>Log Chem</Text>
                </Pressable>
              </View>
              {captureButton}
              {doneButton}
            </View>
          </View>
        )}
        <WifiCameraModal
          visible={showWifiCamera}
          onClose={() => setShowWifiCamera(false)}
          onConnected={() => setWifiCameraConnected(true)}
        />
        {wsInspectionId != null && (
          <TreatmentLogWizard
            visible={showTreatmentWizard}
            onClose={() => setShowTreatmentWizard(false)}
            inspectionId={wsInspectionId}
            pestTypes={pestTypes}
            routeAssignments={assignmentsWithProducts}
            onLogged={() => {
              setShowTreatmentWizard(false);
            }}
          />
        )}

        {/* Compact/medium overlay — Co-Pilot mode shows as a bottom sheet that
            sits over the bottom 42% of the camera; AI Insights takes full screen.
            Camera stays mounted in both cases so the AI loop keeps running. */}
        {showInsights ? (
          mode === "copilot" ? (
            /* ── Co-Pilot bottom sheet ── */
            <View
              style={{
                position: "absolute",
                bottom: 0,
                left: 0,
                right: 0,
                height: "42%",
                borderTopWidth: 1,
                borderTopColor: colors.primary + "55",
                borderTopLeftRadius: 16,
                borderTopRightRadius: 16,
                overflow: "hidden",
              }}
            >
              {/* Drag handle + close */}
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  paddingHorizontal: 16,
                  paddingTop: 10,
                  paddingBottom: 4,
                  backgroundColor: colors.background,
                }}
              >
                <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}>
                  <Ionicons name="navigate-circle" size={16} color={colors.primary} />
                  <Text style={{ color: colors.primary, fontFamily: "Inter_600SemiBold", fontSize: 13 }}>
                    Co-Pilot
                  </Text>
                </View>
                <Pressable
                  onPress={() => setShowInsights(false)}
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 14,
                    backgroundColor: colors.card,
                    borderWidth: 1,
                    borderColor: colors.border,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Ionicons name="chevron-down" size={16} color={colors.mutedForeground} />
                </Pressable>
              </View>
              <CoPilotHUD
                propertyType={propertyType}
                analysis={wsAnalysis}
                analyzing={wsAnalyzing}
                photosCount={photos.length}
                onZoomSuggestion={handleCopilotZoom}
              />
              <View style={{ borderTopWidth: 1, borderTopColor: colors.border + "55", paddingVertical: 6 }}>
                <Pressable
                  onPress={() => setShowBaitPanel((v) => !v)}
                  style={{ flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 16, paddingVertical: 4 }}
                >
                  <Ionicons name="location" size={13} color="#9ca3af" />
                  <Text style={{ color: "#9ca3af", fontFamily: "Inter_600SemiBold", fontSize: 11, flex: 1 }}>
                    Bait Stations {baitStations.length > 0 ? `(${baitStations.length})` : ""}
                  </Text>
                  <Ionicons name={showBaitPanel ? "chevron-down" : "chevron-up"} size={11} color="#6b7280" />
                </Pressable>
                {showBaitPanel && (
                  <BaitStationPanel
                    stations={baitStations}
                    onAdd={addBaitStation}
                    onUpdate={updateBaitStation}
                    onRemove={removeBaitStation}
                  />
                )}
              </View>
              <View
                style={{
                  borderTopWidth: 1,
                  borderTopColor: colors.border + "55",
                  padding: 12,
                }}
              >
                <MeasurementDevicePanel onActiveCountChange={setActiveSensorCount} />
              </View>
            </View>
          ) : (
            /* ── Full-screen AI Insights ── */
            <View
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                backgroundColor: colors.background,
              }}
            >
              <Screen edges={["top", "bottom"]}>
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                    paddingHorizontal: 16,
                    paddingVertical: 12,
                    borderBottomWidth: 1,
                    borderBottomColor: colors.border,
                  }}
                >
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <Ionicons name="sparkles" size={18} color={colors.primary} />
                    <Text
                      style={{
                        color: colors.foreground,
                        fontFamily: "Inter_700Bold",
                        fontSize: 18,
                      }}
                    >
                      AI Inspection
                    </Text>
                  </View>
                  <Pressable
                    onPress={() => setShowInsights(false)}
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 6,
                      paddingHorizontal: 14,
                      paddingVertical: 8,
                      borderRadius: 999,
                      backgroundColor: colors.card,
                      borderWidth: 1,
                      borderColor: colors.border,
                    }}
                  >
                    <Ionicons name="camera-outline" size={16} color={colors.foreground} />
                    <Text
                      style={{
                        color: colors.foreground,
                        fontFamily: "Inter_600SemiBold",
                        fontSize: 13,
                      }}
                    >
                      Back to camera
                    </Text>
                  </Pressable>
                </View>
                <AiInsightsPanel
                  siteAddress={siteAddress}
                  propertyType={propertyType}
                  pestTypes={pestTypes}
                  photosCount={photos.length}
                  pendingCount={Math.max(0, photos.length - analyzedCount.current)}
                  analysis={wsAnalysis}
                  analyzing={wsAnalyzing}
                  error={wsError}
                  report={wsReport}
                  reportBuilding={wsReportBuilding}
                  reportError={wsReportError}
                  onRunAnalysis={runWorkspaceAnalysis}
                  onReview={() => {
                    setShowInsights(false);
                    setStep("review");
                  }}
                />
              </Screen>
            </View>
          )
        ) : null}
      </View>
    );
  }

  // ─── Review step ────────────────────────────────────────────────────────────
  if (step === "review") {
    // RLQ-008: derive findings review gate. reviewTick (from useFocusEffect) triggers
    // re-reads of recordRef so allFindingsReviewed is fresh after returning from review.
    void reviewTick;
    const allFindingsReviewed = recordRef.current?.allFindingsReviewed ?? false;
    const reviewFindings = (reviewAnalysisQ.data?.[0]?.findings ?? []) as Array<{
      reviewStatus?: string | null;
    }>;
    const unreviewedCount = reviewFindings.filter(
      (f) => !f.reviewStatus || f.reviewStatus === "pending",
    ).length;
    const hasReviewGate = wsInspectionId != null && !allFindingsReviewed && unreviewedCount > 0;
    const showReviewedBadge =
      wsInspectionId != null &&
      (allFindingsReviewed || unreviewedCount === 0) &&
      reviewFindings.length > 0;

    return (
      <Screen edges={["top", "bottom"]} padded>
        <Header title="Review & submit" onClose={() => setStep("capture")} colors={colors} />
        <ScrollView
          contentContainerStyle={{
            gap: 18,
            paddingVertical: 12,
            paddingBottom: 32,
            width: "100%",
            maxWidth: 640,
            alignSelf: "center",
          }}
        >
          <SummaryRow label="Site address" value={siteAddress} colors={colors} />
          {clientName ? <SummaryRow label="Client" value={clientName} colors={colors} /> : null}
          <SummaryRow label="Technician" value={technicianName} colors={colors} />
          <SummaryRow label="Property type" value={propertyType} colors={colors} />
          {pestTypes.length ? (
            <SummaryRow label="Pest types" value={pestTypes.join(", ")} colors={colors} />
          ) : null}
          {notes ? <SummaryRow label="Notes" value={notes} colors={colors} /> : null}

          <View style={{ gap: 8 }}>
            <Text style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold", fontSize: 15 }}>
              Evidence ({photos.length})
            </Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {photos.map((p, i) => (
                <Image
                  key={`${p.uri}-${i}`}
                  source={{ uri: p.uri }}
                  style={{ width: 88, height: 88, borderRadius: 10 }}
                />
              ))}
            </View>
          </View>

          {/* AI findings review — optional, never blocks completion */}
          {hasReviewGate ? (
            <View
              style={{
                gap: 10,
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: 10,
                padding: 14,
                backgroundColor: colors.card,
              }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <Ionicons name="sparkles" size={20} color={colors.primary} />
                <View style={{ flex: 1 }}>
                  <Text
                    style={{
                      color: colors.foreground,
                      fontFamily: "Inter_600SemiBold",
                      fontSize: 15,
                    }}
                  >
                    AI Findings Available
                  </Text>
                  <Text
                    style={{
                      color: colors.mutedForeground,
                      fontFamily: "Inter_400Regular",
                      fontSize: 13,
                    }}
                  >
                    {unreviewedCount} finding{unreviewedCount !== 1 ? "s" : ""} — review
                    is optional, you can complete now and correct later
                  </Text>
                </View>
              </View>
              <View style={{ flexDirection: "row", gap: 8 }}>
                <Button
                  title={`Review (${unreviewedCount})`}
                  variant="outline"
                  icon="sparkles"
                  style={{ flex: 1 }}
                  onPress={() => {
                    const rec = recordRef.current;
                    if (rec) router.push(`/findings-review/${rec.localId}` as Href);
                  }}
                />
                <Button
                  title="Skip"
                  variant="ghost"
                  style={{ flex: 1 }}
                  onPress={async () => {
                    const rec = recordRef.current;
                    if (rec) {
                      await updateLocalInspection(rec.localId, (r) => {
                        r.allFindingsReviewed = true;
                      });
                      setReviewTick((t) => t + 1);
                    }
                  }}
                />
              </View>
            </View>
          ) : showReviewedBadge ? (
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
                padding: 12,
                borderRadius: 10,
                backgroundColor: (colors.success ?? "#22c55e") + "22",
                borderWidth: 1,
                borderColor: (colors.success ?? "#22c55e") + "55",
              }}
            >
              <Ionicons name="checkmark-circle" size={20} color={colors.success ?? "#22c55e"} />
              <Text
                style={{
                  color: colors.success ?? "#22c55e",
                  fontFamily: "Inter_600SemiBold",
                  fontSize: 14,
                }}
              >
                AI findings reviewed
              </Text>
            </View>
          ) : null}

          {/* Task #251 — Compliance violations surfaced BEFORE the inspection is
              finalised so the technician can still correct them. Shown as soon
              as we have a server ID and playbook data comes back. */}
          {reviewViolationsLoading && wsInspectionId != null ? (
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
                padding: 12,
                borderRadius: 10,
                backgroundColor: colors.card,
                borderWidth: 1,
                borderColor: colors.border,
              }}
            >
              <ActivityIndicator size="small" color={colors.mutedForeground} />
              <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 13 }}>
                Checking playbook compliance…
              </Text>
            </View>
          ) : reviewViolations.length > 0 ? (
            <View
              style={{
                gap: 10,
                borderWidth: 1,
                borderColor: "rgba(234,179,8,0.5)",
                borderRadius: 10,
                padding: 14,
                backgroundColor: "rgba(234,179,8,0.08)",
              }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Ionicons name="warning-outline" size={20} color="#ca8a04" />
                <Text
                  style={{
                    color: "#ca8a04",
                    fontFamily: "Inter_700Bold",
                    fontSize: 14,
                    flex: 1,
                  }}
                >
                  Playbook {reviewViolations.length === 1 ? "Violation" : "Violations"} Detected
                </Text>
                <View
                  style={{
                    backgroundColor: "rgba(234,179,8,0.2)",
                    borderRadius: 999,
                    paddingHorizontal: 8,
                    paddingVertical: 2,
                  }}
                >
                  <Text style={{ color: "#ca8a04", fontFamily: "Inter_700Bold", fontSize: 12 }}>
                    {reviewViolations.length}
                  </Text>
                </View>
              </View>
              {reviewViolations.map((v, i) => (
                <View
                  key={i}
                  style={{
                    flexDirection: "row",
                    alignItems: "flex-start",
                    gap: 8,
                    paddingTop: i > 0 ? 8 : 0,
                    borderTopWidth: i > 0 ? 1 : 0,
                    borderTopColor: "rgba(234,179,8,0.2)",
                  }}
                >
                  <Ionicons
                    name={v.severity === "ERROR" ? "close-circle-outline" : "alert-circle-outline"}
                    size={16}
                    color={v.severity === "ERROR" ? "#ef4444" : "#ca8a04"}
                    style={{ marginTop: 1 }}
                  />
                  <Text
                    style={{
                      color: colors.foreground,
                      fontFamily: "Inter_400Regular",
                      fontSize: 13,
                      flex: 1,
                    }}
                  >
                    {v.message}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}

          {error ? (
            <Text style={{ color: colors.destructive, fontSize: 14, textAlign: "center" }}>
              {error}
            </Text>
          ) : null}
        </ScrollView>

        <View style={{ gap: 10, paddingBottom: 8, width: "100%", maxWidth: 640, alignSelf: "center" }}>
          <Text
            style={{
              color: colors.mutedForeground,
              fontFamily: "Inter_400Regular",
              fontSize: 12,
              textAlign: "center",
            }}
          >
            Evidence is saved on-device and syncs automatically. The report, summary, and insights generate in the background.
          </Text>
          <Button
            title="Quick Submit & Save"
            size="lg"
            icon="checkmark-circle"
            onPress={completeNow}
          />
          <Button title="← Back to camera" variant="ghost" onPress={() => setStep("capture")} />
        </View>
      </Screen>
    );
  }

  // ─── Setup step ─────────────────────────────────────────────────────────────
  return (
    <Screen edges={["top", "bottom"]} padded>
      <Header
        title="New inspection"
        onClose={() => (recordRef.current ? confirmExit() : router.back())}
        colors={colors}
      />

      {/* ── Mode selector ──────────────────────────────────────────────── */}
      <ModeSelector mode={mode} onSelect={setMode} colors={colors} />

      <ScrollView
        contentContainerStyle={{
          gap: 16,
          paddingVertical: 12,
          paddingBottom: 32,
          width: "100%",
          maxWidth: 640,
          alignSelf: "center",
        }}
        keyboardShouldPersistTaps="handled"
      >
        {wsInspectionId != null ? (
          <Text
            style={{
              color: colors.mutedForeground,
              fontFamily: "Inter_400Regular",
              fontSize: 13,
              lineHeight: 19,
            }}
          >
            AI analysis has started for this inspection, so site, client, and technician are
            locked. Notes and suspected pests can still be updated.
          </Text>
        ) : null}
        <View style={{ gap: 6 }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <Text style={{ color: colors.foreground, fontFamily: "Inter_500Medium", fontSize: 14 }}>
              Site address *
            </Text>
            {wsInspectionId == null && (
              <VoiceMicButton
                isDictating={voiceSiteAddress.isDictating}
                isTranscribing={voiceSiteAddress.isTranscribing}
                onPress={() => void voiceSiteAddress.toggle()}
                size={28}
                accessibilityLabel="Dictate site address"
              />
            )}
          </View>
          <TextField
            placeholder="123 Main St, Suite 200"
            value={siteAddress}
            onChangeText={setSiteAddress}
            editable={wsInspectionId == null}
            style={wsInspectionId != null ? { opacity: 0.5 } : undefined}
          />
        </View>

        {/* ── Prior Visit Memory Banner ───────────────────────────────────── */}
        {propertyMemory && (
          <View
            style={{
              backgroundColor: "#0D1117",
              borderWidth: 1,
              borderColor: "#1C2235",
              borderRadius: 10,
              padding: 12,
              flexDirection: "row",
              alignItems: "flex-start",
              gap: 10,
            }}
          >
            <Ionicons name="time-outline" size={18} color="#17c4d3" style={{ marginTop: 1 }} />
            <View style={{ flex: 1, gap: 3 }}>
              <Text style={{ color: "#17c4d3", fontFamily: "Inter_700Bold", fontSize: 12, letterSpacing: 0.4 }}>
                PRIOR VISIT DETECTED
              </Text>
              {propertyMemory.lastVisitedAt ? (
                <Text style={{ color: "rgba(255,255,255,0.55)", fontFamily: "Inter_400Regular", fontSize: 12 }}>
                  Last visit: {new Date(propertyMemory.lastVisitedAt).toLocaleDateString()}
                </Text>
              ) : null}
              {propertyMemory.historicalPests.length > 0 ? (
                <Text style={{ color: "rgba(255,255,255,0.75)", fontFamily: "Inter_400Regular", fontSize: 12, marginTop: 2 }}>
                  Known pests: {propertyMemory.historicalPests.join(", ")}
                </Text>
              ) : null}
              {propertyMemory.historicalFindings.length > 0 ? (
                <Text style={{ color: "rgba(255,255,255,0.55)", fontFamily: "Inter_400Regular", fontSize: 11, marginTop: 2 }}>
                  {propertyMemory.historicalFindings.slice(0, 2).map((f) => f.description).join(" · ")}
                  {propertyMemory.historicalFindings.length > 2
                    ? ` · +${propertyMemory.historicalFindings.length - 2} more`
                    : ""}
                </Text>
              ) : null}
            </View>
          </View>
        )}

        <View style={{ gap: 6 }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <Text style={{ color: colors.foreground, fontFamily: "Inter_500Medium", fontSize: 14 }}>
              Client name
            </Text>
            {wsInspectionId == null && (
              <VoiceMicButton
                isDictating={voiceClientName.isDictating}
                isTranscribing={voiceClientName.isTranscribing}
                onPress={() => void voiceClientName.toggle()}
                size={28}
                accessibilityLabel="Dictate client name"
              />
            )}
          </View>
          <TextField
            placeholder="Acme Restaurant Group"
            value={clientName}
            onChangeText={setClientName}
            editable={wsInspectionId == null}
            style={wsInspectionId != null ? { opacity: 0.5 } : undefined}
          />
        </View>
        <TextField
          label="Technician *"
          placeholder="Your name"
          value={technicianName}
          onChangeText={setTechnicianName}
          editable={wsInspectionId == null}
          style={wsInspectionId != null ? { opacity: 0.5 } : undefined}
        />

        <View style={{ gap: 8 }}>
          <Text style={{ color: colors.foreground, fontFamily: "Inter_500Medium", fontSize: 14 }}>
            Property type
          </Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {PROPERTY_TYPES.map((p) => (
              <Pill key={p} label={p} active={propertyType === p} onPress={() => setPropertyType(p)} colors={colors} />
            ))}
          </View>
        </View>

        <View style={{ gap: 8 }}>
          <Text style={{ color: colors.foreground, fontFamily: "Inter_500Medium", fontSize: 14 }}>
            Suspected pests
          </Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {PEST_TYPES.map((p) => (
              <Pill key={p} label={p} active={pestTypes.includes(p)} onPress={() => togglePest(p)} colors={colors} disabled={isCompleted} />
            ))}
          </View>
          {pestTypeError && (
            <Text style={{ color: "#ef4444", fontSize: 12, marginTop: 4 }}>
              Select at least one pest type before continuing.
            </Text>
          )}
        </View>

        <View style={{ gap: 6 }}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <Text
              style={{
                color: colors.foreground,
                fontFamily: "Inter_500Medium",
                fontSize: 14,
              }}
            >
              Notes
            </Text>
            {mode === "voice" ? (
            <Pressable
              onPress={() => void handleDictationPress()}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 5,
                paddingHorizontal: 10,
                paddingVertical: 5,
                borderRadius: 999,
                backgroundColor: isDictating
                  ? "#ef444418"
                  : colors.card,
                borderWidth: 1,
                borderColor: isDictating ? "#ef4444" : colors.border,
              }}
            >
              {isTranscribing ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <Ionicons
                  name={isDictating ? "mic" : "mic-outline"}
                  size={14}
                  color={isDictating ? "#ef4444" : colors.mutedForeground}
                />
              )}
              <Text
                style={{
                  color: isDictating
                    ? "#ef4444"
                    : isTranscribing
                      ? colors.primary
                      : colors.mutedForeground,
                  fontFamily: "Inter_500Medium",
                  fontSize: 12,
                }}
              >
                {isDictating
                  ? "Stop"
                  : isTranscribing
                    ? "Transcribing…"
                    : "Dictate"}
              </Text>
            </Pressable>
            ) : null}
          </View>
          <TextField
            placeholder="Conditions observed, access notes, etc."
            value={notes}
            onChangeText={isCompleted ? undefined : setNotes}
            multiline
            editable={!isCompleted}
          />
        </View>
      </ScrollView>

      <View style={{ gap: 8, paddingBottom: 8, width: "100%", maxWidth: 640, alignSelf: "center" }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 }}>
          <Ionicons name="sparkles" size={13} color={colors.primary} />
          <Text
            style={{
              color: colors.mutedForeground,
              fontFamily: "Inter_400Regular",
              fontSize: 12,
            }}
          >
            AI Inspection runs live as you capture — open AI Insights from the camera.
          </Text>
        </View>
        <Button
          title="Continue to camera"
          size="lg"
          icon="camera"
          disabled={!canContinueSetup}
          onPress={() => void goToCapture()}
        />
      </View>
    </Screen>
  );
}

function Header({
  title,
  onClose,
  colors,
}: {
  title: string;
  onClose: () => void;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingVertical: 12,
      }}
    >
      <Text style={{ color: colors.foreground, fontFamily: "Inter_700Bold", fontSize: 20 }}>{title}</Text>
      <Pressable
        onPress={onClose}
        style={{
          width: 38,
          height: 38,
          borderRadius: 19,
          backgroundColor: colors.card,
          borderWidth: 1,
          borderColor: colors.border,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Ionicons name="close" size={20} color={colors.mutedForeground} />
      </Pressable>
    </View>
  );
}

function Pill({
  label,
  active,
  onPress,
  colors,
  disabled = false,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  colors: ReturnType<typeof useColors>;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      style={{
        paddingHorizontal: 14,
        paddingVertical: 9,
        borderRadius: 999,
        backgroundColor: active ? colors.primary : colors.card,
        borderWidth: 1,
        borderColor: active ? colors.primary : colors.border,
        opacity: disabled ? 0.45 : 1,
      }}
    >
      <Text
        style={{
          color: active ? colors.primaryForeground : colors.mutedForeground,
          fontFamily: "Inter_500Medium",
          fontSize: 13,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function SummaryRow({
  label,
  value,
  colors,
}: {
  label: string;
  value: string;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={{ gap: 3 }}>
      <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_500Medium", fontSize: 13 }}>
        {label}
      </Text>
      <Text style={{ color: colors.foreground, fontFamily: "Inter_400Regular", fontSize: 15 }}>
        {value}
      </Text>
    </View>
  );
}

// ─── Mode selector ────────────────────────────────────────────────────────────

const MODE_CONFIG: {
  key: InspectionMode;
  label: string;
  sub: string;
  icon: React.ComponentProps<typeof Ionicons>["name"];
  available: boolean;
}[] = [
  {
    key: "manual",
    label: "Manual",
    sub: "Standard",
    icon: "pencil-outline",
    available: true,
  },
  {
    key: "voice",
    label: "Voice",
    sub: "Offline AI",
    icon: "mic-outline",
    available: true,
  },
  {
    key: "copilot",
    label: "Co-Pilot",
    sub: "Live · 5G",
    icon: "sparkles-outline",
    available: true,
  },
];

function ModeSelector({
  mode,
  onSelect,
  colors,
}: {
  mode: InspectionMode;
  onSelect: (m: InspectionMode) => void;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View
      style={{
        flexDirection: "row",
        gap: 8,
        paddingVertical: 10,
      }}
    >
      {MODE_CONFIG.map(({ key, label, sub, icon, available }) => {
        const active = mode === key;
        return (
          <Pressable
            key={key}
            onPress={() => available && onSelect(key)}
            style={{
              flex: 1,
              paddingVertical: 10,
              paddingHorizontal: 10,
              borderRadius: colors.radius,
              backgroundColor: active ? colors.accent : colors.card,
              borderWidth: 1,
              borderColor: active ? colors.primary : colors.border,
              alignItems: "center",
              gap: 4,
              opacity: available ? 1 : 0.38,
            }}
          >
            <Ionicons
              name={icon}
              size={18}
              color={active ? colors.primary : colors.mutedForeground}
            />
            <Text
              style={{
                color: active ? colors.primary : colors.foreground,
                fontFamily: "Inter_600SemiBold",
                fontSize: 13,
              }}
            >
              {label}
            </Text>
            <Text
              style={{
                color: colors.mutedForeground,
                fontFamily: "Inter_400Regular",
                fontSize: 10,
              }}
            >
              {available ? sub : "Coming soon"}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
