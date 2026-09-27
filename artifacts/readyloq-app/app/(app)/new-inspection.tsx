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
import * as FileSystem from "expo-file-system/legacy";
import { createFrameBuffer, type FrameBuffer } from "@/lib/voice-context/frame-buffer";
import * as Haptics from "expo-haptics";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  AppState,
  BackHandler,
  FlatList,
  InteractionManager,
  Modal,
  Pressable,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import Reanimated, { useSharedValue, useAnimatedStyle, withTiming } from "react-native-reanimated";
import { Gesture, GestureDetector } from "react-native-gesture-handler";

import * as Speech from "expo-speech";
import { AiInsightsPanel } from "@/components/AiInsightsPanel";
import { CoPilotHUD } from "@/components/CoPilotHUD";
import { BaitStationPanel } from "@/components/BaitStationPanel";
import { VoiceMicButton } from "@/components/VoiceMicButton";
import { useVoiceField } from "@/hooks/useVoiceField";
import { type LocalBaitStation } from "@/lib/local/inspection-store";
import { AuthedImage } from "@/components/AuthedImage";
import { PhotoLightbox } from "@/components/PhotoLightbox";
import { WifiCameraModal } from "@/components/WifiCameraModal";
import { TreatmentLogWizard } from "@/components/TreatmentLogWizard";
import { DailyRouteSetupModal } from "@/components/DailyRouteSetupModal";
import { useDailyRoute } from "@/hooks/useDailyRoute";
import { verifyEquipmentUsage } from "@/lib/audio/intelligence/EquipmentVerifier";
import { DeviceHealthStrip } from "@/components/DeviceHealthStrip";
import { MeasurementDevicePanel } from "@/components/MeasurementDevicePanel";
import { MeasureModeOverlay } from "@/components/MeasureModeOverlay";
import { useMeasurementScaling } from "@/hooks/useMeasurementScaling";
import { NativeCameraHealthBadge } from "@/components/NativeCameraHealthBadge";
import { useAllDevicesHealthCheck } from "@/hooks/useAllDevicesHealthCheck";
import { useSmartGuidance } from "@/hooks/useSmartGuidance";
import { useMetaGlassesSession, type GlassesEvent } from "@/hooks/useMetaGlassesSession";
import { useMetaWearablesSession } from "@/hooks/useMetaWearablesSession";
import { useSmartGlassesBleFrames } from "@/hooks/useSmartGlassesBleFrames";
import { getBleBadgeStyle, shouldShowBleBadge } from "@/lib/ble/badge-display";
import { smartGlassesBle } from "@/lib/ble";
import {
  loadCalibrationProfile,
  DEFAULT_FOCAL_LENGTH_PX,
} from "@/lib/meta-glasses/calibration";
import { Button } from "@/components/ui/Button";
import { Screen } from "@/components/ui/Screen";
import { TextField } from "@/components/ui/TextField";
import { useColors } from "@/hooks/useColors";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";
import { useWindowSizeClass } from "@/hooks/useWindowSizeClass";
import { PEST_TYPES, PROPERTY_TYPES, VISIT_PURPOSES } from "@/constants/inspection";
import {
  ApiError,
  fetchPlaybookCompliance,
  fetchPropertyMemory,
  type ComplianceViolation,
  type PropertyMemoryData,
} from "@/lib/api";
import { ingestAllUploadedPhotos } from "@/lib/faie-ingest";
import {
  burstMeasurementManager,
  consumeLastMeasurementReading,
  setLastMeasurementReading,
} from "@/lib/measurement";
import {
  assertFiniteDimensions,
  isStampableResult,
} from "@/lib/measurement/degenerate-guard";
import {
  BurstMeasurementPipeline,
  FallbackSfMProvider,
  ReferenceScaleAnchor,
  REFERENCE_OBJECTS,
  type BoundingRegion,
  type BurstFrame,
  type BurstMeasurementResult,
  type ReferenceObject,
  type SfMDepthMap,
} from "@platform/measurement-core";
import {
  deleteLocalInspection,
  getLocalInspection,
  newLocalInspection,
  persistPhoto,
  saveLocalInspection,
  updateLocalInspection,
  type LocalInspection,
} from "@/lib/local/inspection-store";
import { createInspectionIngestQueue } from "@/lib/local/inspection-ingest-queue";
import { completeTechnicianWorkflow } from "@/lib/inspection/technician-completion";
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
type Photo = {
  /** Stable across the cache-URI → durable-URI swap to avoid image remounts. */
  id: string;
  uri: string;
  capturedAt?: string;
};

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
  const params = useLocalSearchParams<{
    resume?: string;
    /** Pre-filled site address from the Schedule tab stop card. */
    address?: string;
    /** Pre-filled client name from the Schedule tab stop card. */
    client?: string;
    /** Pre-filled unit / apartment number from the Schedule tab stop card. */
    unit?: string;
  }>();

  const generateReport = useGenerateReport();
  const generateNarrative = useGenerateReportNarrative();

  const [step, setStep] = useState<Step>("setup");
  const [mode, setMode] = useState<InspectionMode>("voice");
  const [siteAddress, setSiteAddress] = useState(params.address ?? "");
  const [clientName, setClientName] = useState(params.client ?? "");
  const [technicianName, setTechnicianName] = useState(clerkUser?.fullName ?? "");
  const [propertyType, setPropertyType] = useState<string>(PROPERTY_TYPES[0]);
  const [visitPurpose, setVisitPurpose] = useState<string | null>(null);
  const [pestTypes, setPestTypes] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  /** Unit / apt # read from the local record — shown as a badge in the capture header. */
  const [displayUnitNumber, setDisplayUnitNumber] = useState<string | null>(
    params.unit?.trim() || null,
  );
  /** True when resuming a previously completed inspection — edits are locked. */
  const [isCompleted, setIsCompleted] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Active sensor count — drives split-screen flex weights.
  // When sensors are connected the panel gets equal space with the camera;
  // when none are docked the camera expands to fill more of the screen.
  const [activeSensorCount, setActiveSensorCount] = useState(0);

  // ── Reference-object measurement scaling (clipping detection) ──────────────
  // The technician taps two points on the camera view to mark the reference
  // object (e.g. a credit card).  Clipping is evaluated immediately when the
  // second tap lands — before any target selection — so the amber warning
  // banner appears as soon as the reference is confirmed clipped and blocks the
  // technician from proceeding with a drifted scale factor.
  //
  // Camera pane dimensions — tracked via onLayout so wide-screen mode (where
  // the camera is the left half) uses the actual half-screen width rather than
  // the full window width.  Portrait and landscape both fill the screen so the
  // initial window dimensions are correct there too.
  const { width: _winW, height: _winH } = useWindowDimensions();
  const [_cameraW, _setCameraW] = useState(_winW);
  const [_cameraH, _setCameraH] = useState(_winH);
  const _onCameraPaneLayout = useCallback(
    (e: import("react-native").LayoutChangeEvent) => {
      const { width, height } = e.nativeEvent.layout;
      if (width > 0 && height > 0) {
        _setCameraW(width);
        _setCameraH(height);
      }
    },
    [],
  );
  const {
    handleReferenceSelected: _handleRefSelected,
    refPoints: _refPoints,
    clearMeasurement: _clearRefMeasurement,
  } = useMeasurementScaling({
    imageDimensions: { w: _cameraW, h: _cameraH },
  });

  // Two-tap reference selection state machine: idle → p1 → p2 → idle
  const [_refSelectMode, _setRefSelectMode] = useState<"idle" | "p1" | "p2">("idle");
  const [_refP1, _setRefP1] = useState<{ x: number; y: number } | null>(null);

  // Clipping is computed immediately on P2 tap — NOT waiting for a target.
  // The same 2-px edge margin used by computeScaledDimensions applies here so
  // the warning and the confidence penalty always agree on the same boundary.
  const [_referenceClipped, _setReferenceClipped] = useState(false);
  const [_refWarnings, _setRefWarnings] = useState<string[]>([]);

  // ── Glasses calibration profile ────────────────────────────────────────────
  // Loaded reactively via a smartGlassesBle.subscribe() subscription so that a
  // device swap or reconnect immediately re-reads the correct stored profile.
  //
  // Race-guard: each async read captures the device ID it started for; the
  // state update is ignored when the device has already changed by the time
  // the read completes, preventing a stale read from overwriting the current
  // device's focal length.
  //
  // Current application: the focal length is NOT applied to any measurement
  // path that uses phone CameraView frames (BurstMeasurementPipeline,
  // SpatialMeasurementCard ROI overlay), because those paths capture from the
  // phone camera — mixing focal lengths from different cameras produces
  // incorrect dimensions.  The profile is persisted in SecureStore and made
  // available here for the future glasses-frame measurement pipeline (a
  // glasses-source ROI path will use glassesFocalLengthPx directly when it
  // exists; until then the stored value is the authoritative per-device record).
  const [glassesFocalLengthPx, setGlassesFocalLengthPx] = useState(DEFAULT_FOCAL_LENGTH_PX);
  useEffect(() => {
    // Holds the device ID of the most-recently-started load.
    // loadForDevice captures this at call time; the completion callback
    // only applies the result when capturedId still matches.
    let latestDeviceId: string | null = null;

    const loadForDevice = (deviceId: string | null) => {
      latestDeviceId = deviceId;
      if (!deviceId) {
        setGlassesFocalLengthPx(DEFAULT_FOCAL_LENGTH_PX);
        return;
      }
      const capturedId = deviceId;
      void loadCalibrationProfile(capturedId).then((profile) => {
        // Guard: only apply when this device is still the connected one
        if (latestDeviceId === capturedId) {
          setGlassesFocalLengthPx(profile?.focalLengthPx ?? DEFAULT_FOCAL_LENGTH_PX);
        }
      });
    };

    // Load immediately for whatever device is connected right now
    loadForDevice(smartGlassesBle.getState().connectedDeviceId);

    // Re-load whenever the connected device changes (reconnect, swap, forget)
    const unsub = smartGlassesBle.subscribe((state) => {
      loadForDevice(state.connectedDeviceId);
    });
    return unsub;
  }, []);

  // ── Measure mode — hardware-free burst measurement ─────────────────────────
  // A full-screen overlay lets the technician frame a subject with a draggable
  // quad (or two endpoints for a gap/crack), fit a reference-object box, then
  // trigger a 3–5 frame burst that runs BurstMeasurementPipeline on the JS
  // thread (FallbackSfMProvider + ReferenceScaleAnchor).  Results are stamped
  // through the same measurement bridge used by MeasurementDevicePanel.onStamp.
  const [measureMode, setMeasureMode] = useState(false);
  const [measuring, setMeasuring] = useState(false);
  const [measureResult, setMeasureResult] = useState<BurstMeasurementResult | null>(null);
  // Phone-camera pipeline: focal length is derived from EXIF on the very first
  // burst and cached for the session (see BurstMeasurementManager.captureBurst).
  // The pipeline ref is rebuilt only when the EXIF-derived focal length changes.
  // IMPORTANT: the glasses focal length must NOT be substituted here — these
  // bursts capture from cameraRef (expo-camera CameraView), not the glasses.
  const _burstFocalLengthRef = useRef<number>(DEFAULT_FOCAL_LENGTH_PX);
  const _burstPipelineRef = useRef<BurstMeasurementPipeline>(
    new BurstMeasurementPipeline(new FallbackSfMProvider(), DEFAULT_FOCAL_LENGTH_PX),
  );

  const handleRunBurstMeasure = useCallback(
    async (
      targetVertices: Array<{ x: number; y: number }>,
      reference: { box: BoundingRegion; object: ReferenceObject },
    ) => {
      const cam = cameraRef.current;
      if (!cam) {
        Alert.alert("Camera not ready", "Wait for the camera preview to start, then try again.");
        return;
      }
      setMeasuring(true);
      setMeasureResult(null);
      let frames: BurstFrame[] = [];
      try {
        // 3–5 frame burst (4 by default) via expo-camera takePictureAsync.
        // captureBurst captures EXIF on the first frame and returns the derived
        // focal length (or the 800 px fallback when EXIF is unavailable).
        const capture = await burstMeasurementManager.captureBurst(
          cam as unknown as {
            takePictureAsync: (opts: object) => Promise<{
              uri: string;
              exif?: Record<string, unknown>;
            }>;
          },
          4,
        );
        frames = capture.frames;

        // Rebuild the pipeline when the EXIF-derived focal length changes.
        // This typically happens once per session on the very first burst;
        // subsequent bursts reuse the cached pipeline.
        if (capture.focalLengthPx !== _burstFocalLengthRef.current) {
          _burstFocalLengthRef.current = capture.focalLengthPx;
          _burstPipelineRef.current = new BurstMeasurementPipeline(
            new FallbackSfMProvider(),
            capture.focalLengthPx,
          );
        }

        if (frames.length === 0) {
          throw new Error("Burst capture failed — no frames were captured");
        }
        const result = await _burstPipelineRef.current.measure(frames, targetVertices, {
          box: reference.box,
          object: reference.object,
          imageWidthPx: _cameraW,
          imageHeightPx: _cameraH,
        });

        // When EXIF was unavailable the pipeline used the 800 px default focal
        // length.  Surface a warning so the technician knows the depth correction
        // is an approximation and results may be less accurate.
        if (capture.focalLengthSource === "fallback") {
          result.warnings.push(
            "Focal length estimated from default (EXIF unavailable) — dimensions may be less accurate",
          );
        }

        // Final guard: degenerate reference geometry can drive the scale
        // anchor to divide by ~0 — never display or stamp Infinity/NaN.
        // assertFiniteDimensions() is the single source of truth for this check;
        // it throws DEGENERATE_GEOMETRY_ERROR when any dimension is non-finite.
        assertFiniteDimensions(result);
        setMeasureResult(result);
      } catch (e) {
        Alert.alert(
          "Measurement failed",
          e instanceof Error ? e.message : "Could not compute dimensions.",
        );
      } finally {
        // Burst frames are temp files — always delete them after the pipeline runs.
        await burstMeasurementManager.cleanupBurst(frames);
        setMeasuring(false);
      }
    },
    [_cameraW, _cameraH],
  );

  const handleStampMeasureResult = useCallback(() => {
    if (!isStampableResult(measureResult)) return;
    // Same stamp path as MeasurementDevicePanel.onStamp: the measurement bridge
    // caches the reading and consumeLastMeasurementReading() attaches it to the
    // next captured photo's finding record (captureMetadata).
    setLastMeasurementReading({
      deviceId: "burst-measure-pipeline",
      kind: "width",
      value: measureResult.widthInches,
      unit: "in",
      signalQuality: measureResult.confidence,
      capturedAt: measureResult.measuredAt,
      metadata: {
        method: "burst_reference",
        heightInches: measureResult.heightInches,
        areaSqInches: measureResult.areaSqInches,
        centroidDepthMeters: measureResult.centroidDepthMeters,
        confidence: measureResult.confidence,
        warnings: measureResult.warnings,
      },
    });
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setMeasureMode(false);
    setMeasureResult(null);
  }, [measureResult]);

  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);

  const guidance = useSmartGuidance({
    propertyType,
    photoCount: photos.length,
    sessionActive: step === "capture",
  });
  // Warm the DeviceRegistry health cache on mount and every 30 s so the
  // NativeCameraHealthBadge and DeviceHealthStrip reflect current state
  // without waiting for each chip to probe independently.
  useAllDevicesHealthCheck();
  const [capturing, setCapturing] = useState(false);
  // Synchronous ref-based lock — prevents burst captures when the shutter is
  // tapped rapidly during a lag spike (React state updates are async, so the
  // `capturing` state guard alone can be passed multiple times before it lands).
  const captureLockedRef = useRef(false);
  const [importing, setImporting] = useState(false);
  // Advisory warning from the on-device quality gate — auto-clears; never
  // blocks capture (poor evidence of a real problem beats no evidence).
  const [qualityNotice, setQualityNotice] = useState<string | null>(null);
  // Post-treatment truck-stock notice — set from TreatmentLogWizard's
  // onLogged callback whenever the server returned an updated on-hand
  // baseline for the just-applied product. Dismissible and auto-clears;
  // lets the technician decide on the spot whether they can treat the next
  // stop or need to resupply before continuing. `low` styles it as a
  // resupply warning instead of a plain confirmation.
  const [stockNotice, setStockNotice] = useState<{
    productName: string;
    quantityOnHand: number;
    unit: string;
    low: boolean;
  } | null>(null);
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
  const faieStatusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showFaieStatus = useCallback(
    (message: string | null, durationMs?: number, nextMessage: string | null = "Listening…") => {
      if (faieStatusTimerRef.current) {
        clearTimeout(faieStatusTimerRef.current);
        faieStatusTimerRef.current = null;
      }
      setFaieStatus(message);
      if (durationMs != null) {
        faieStatusTimerRef.current = setTimeout(() => {
          faieStatusTimerRef.current = null;
          setFaieStatus(nextMessage);
        }, durationMs);
      }
    },
    [],
  );

  // ── FAIE frame-buffer state ────────────────────────────────────────────────
  // A rolling background snapshot captured every 1 500 ms while the FAIE
  // session is live.  frameBuffer.getFrame() uses it as a guaranteed fallback
  // when the on-demand takePictureAsync() is busy or fails (e.g. Android
  // pipeline contention, cameraRef not yet ready).
  //
  // The FrameBuffer instance is created once on mount.  takePicture reads
  // cameraRef at call time so no stale-closure issues arise.
  const cameraCaptureQueueRef = useRef(createInspectionIngestQueue());
  const frameBufferRef = useRef<FrameBuffer>(
    createFrameBuffer({
      takePicture: async () => {
        // NOTE: cameraRef is populated by the CameraView component after mount.
        // Reading it inside this callback (not at createFrameBuffer time) avoids
        // a stale-closure problem.
        if (captureLockedRef.current) return null;
        return cameraCaptureQueueRef.current.enqueue(async () => {
          // Re-check after waiting: a technician shutter always gets priority
          // over a rolling context frame that has not started yet.
          if (captureLockedRef.current) return null;
          const pic = await (cameraRef as React.RefObject<CameraView | null>).current?.takePictureAsync({
            quality: 0.1,
            skipProcessing: true,
          });
          return pic?.uri ?? null;
        });
      },
      deleteFile: FileSystem.deleteAsync,
    }),
  );
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
  const {
    assignmentsWithProducts,
    isSetupToday,
    showSetupModal: showMorningKitModal,
    openSetupModal: openMorningKitModal,
    closeSetupModal: closeMorningKitModal,
    saveRoute: saveMorningKit,
  } = useDailyRoute();

  // ── Morning kit auto-prompt ───────────────────────────────────────────────
  // When the tech opens a new inspection and hasn't declared today's chemical
  // kit yet, automatically open the DailyRouteSetupModal after a short delay
  // (so the camera preview finishes loading first). A ref ensures we only
  // prompt once per screen mount, even if isSetupToday briefly flickers.
  const kitAutoPromptedRef = useRef(false);
  useEffect(() => {
    if (!isSetupToday && !kitAutoPromptedRef.current) {
      kitAutoPromptedRef.current = true;
      const timer = setTimeout(() => openMorningKitModal(), 600);
      return () => clearTimeout(timer);
    }
  }, [isSetupToday, openMorningKitModal]);

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
      // Stop the rolling frame-buffer: marks active=false so any in-flight
      // takePictureAsync calls self-delete their output, clears the interval,
      // and fires a best-effort delete of the last buffered frame.
      frameBufferRef.current.stop();
      if (faieStatusTimerRef.current) clearTimeout(faieStatusTimerRef.current);
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

  // Frame-buffer convenience aliases — delegate to the stable frameBufferRef
  // instance created at mount time.
  const startFrameBuffer = () => frameBufferRef.current.start();
  const stopFrameBuffer = () => frameBufferRef.current.stop();
  const getFrameWithBuffer = () => frameBufferRef.current.getFrame();

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
      await sessionManagerRef.current.startSession(({ event, action, contextOnly }) => {
        // Flash the camera overlay and update the banner icon whenever the
        // session manager successfully attached a room snapshot to this event.
        if (contextOnly) {
          setLastEventHadFrame(true);
          frameCaptureAnim.setValue(0.5);
          Animated.timing(frameCaptureAnim, {
            toValue: 0,
            duration: 400,
            useNativeDriver: true,
          }).start();
          return;
        }
        setLastEventHadFrame(false);
        switch (action) {
          case ConfidenceAction.AUTO_COMMIT: {
            // 1. Voice-triggered photo capture ("snap", "take a photo", "capture")
            if (event.capturePhoto) {
              void takePhoto();
              showFaieStatus("Capturing photo…", 2500);
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              break;
            }

            // 2. Explicit field routing via prefix ("client name is…", "site address is…")
            if (event.targetField === "clientName" && event.fieldValue) {
              setClientName(event.fieldValue);
              showFaieStatus(`Client: "${event.fieldValue}"`, 2500);
              Speech.speak("Client name set", { rate: 1.1 });
              break;
            }
            if (event.targetField === "siteAddress" && event.fieldValue) {
              setSiteAddress(event.fieldValue);
              showFaieStatus(`Site: "${event.fieldValue}"`, 2500);
              Speech.speak("Site address set", { rate: 1.1 });
              break;
            }

            // 3a. Equipment detection — cross-reference against daily route.
            if (event.equipment) {
              const activePest = pestTypes[pestTypes.length - 1] ?? null;
              const result = verifyEquipmentUsage(event.equipment, activePest, assignmentsWithProducts);
              showFaieStatus(result.message, 4000);
              if (result.needsAttention) {
                void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
              }
              Speech.speak(result.message, { rate: 1.05 });
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
              showFaieStatus(summary, 3000);
              void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              Speech.speak(`Logged ${event.product ?? "bait station"}`, { rate: 1.1 });
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
              showFaieStatus(`Logged: ${line}`, 3000);
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
              showFaieStatus(`${result.message} ~`, 4000);
              if (result.needsAttention) {
                void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
              }
              Speech.speak(result.message, { rate: 1.05 });
              break;
            }
            if (event.capturePhoto) {
              void takePhoto();
              showFaieStatus("Capturing photo…", 2500);
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
              break;
            }
            if (event.targetField === "clientName" && event.fieldValue) {
              setClientName(event.fieldValue);
              showFaieStatus(`Client: "${event.fieldValue}" ~`, 2500);
              Speech.speak("Client name set", { rate: 1.1 });
              break;
            }
            if (event.targetField === "siteAddress" && event.fieldValue) {
              setSiteAddress(event.fieldValue);
              showFaieStatus(`Site: "${event.fieldValue}" ~`, 2500);
              Speech.speak("Site address set", { rate: 1.1 });
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
              showFaieStatus(`Bait ~: ${event.product ?? "station"} @ ${where}`, 3000);
              void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
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
              showFaieStatus(`Auto-logged ~: ${line}`, 3000);
            }
            break;
          }
          case ConfidenceAction.ASK_AGAIN:
            showFaieStatus("Didn't catch that — please repeat.", 2500);
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
  // An unsuccessful photo remains retryable by sync, but must not trigger the
  // same live analysis batch every 2.5 seconds when no new evidence arrived.
  const lastWorkspaceAnalysisPhotoCount = useRef(0);

  // ── #74 — Glasses-capture findings buffer ──────────────────────────────────
  // Persisted across the full inspection session. Each entry is a GlassesEvent
  // with a server-persisted frame (mediaId set) and/or a structured AI finding.
  const [glassesFindings, setGlassesFindings] = useState<GlassesEvent[]>([]);
  // Meta cloud relay is opt-in per inspection. A persisted inspection ID alone
  // must never create a Meta session or start polling.
  const [metaCloudEnabled, setMetaCloudEnabled] = useState(false);
  // #110 — full-screen viewer for glasses-captured frames
  const [glassesViewerPath, setGlassesViewerPath] = useState<string | null>(null);

  // #117 — pinch-to-zoom + pan for the glasses viewer
  const { width: _glassesScreenW, height: _glassesScreenH } = useWindowDimensions();
  const glassesViewerScale      = useSharedValue(1);
  const glassesViewerBaseScale  = useSharedValue(1);
  const glassesViewerTranslateX = useSharedValue(0);
  const glassesViewerTranslateY = useSharedValue(0);
  const glassesViewerBaseTX     = useSharedValue(0);
  const glassesViewerBaseTY     = useSharedValue(0);

  useEffect(() => {
    if (glassesViewerPath === null) {
      glassesViewerScale.value      = 1;
      glassesViewerBaseScale.value  = 1;
      glassesViewerTranslateX.value = 0;
      glassesViewerTranslateY.value = 0;
      glassesViewerBaseTX.value     = 0;
      glassesViewerBaseTY.value     = 0;
    }
  }, [glassesViewerPath, glassesViewerScale, glassesViewerBaseScale, glassesViewerTranslateX, glassesViewerTranslateY, glassesViewerBaseTX, glassesViewerBaseTY]);

  const glassesViewerPinch = Gesture.Pinch()
    .onUpdate((e) => {
      glassesViewerScale.value = Math.max(1, Math.min(glassesViewerBaseScale.value * e.scale, 8));
    })
    .onEnd(() => {
      glassesViewerBaseScale.value = glassesViewerScale.value;
    });

  const glassesViewerPan = Gesture.Pan()
    .onUpdate((e) => {
      const maxX = (_glassesScreenW * (glassesViewerScale.value - 1)) / 2;
      const maxY = (_glassesScreenH * (glassesViewerScale.value - 1)) / 2;
      glassesViewerTranslateX.value = Math.max(-maxX, Math.min(glassesViewerBaseTX.value + e.translationX, maxX));
      glassesViewerTranslateY.value = Math.max(-maxY, Math.min(glassesViewerBaseTY.value + e.translationY, maxY));
    })
    .onEnd(() => {
      glassesViewerBaseTX.value = glassesViewerTranslateX.value;
      glassesViewerBaseTY.value = glassesViewerTranslateY.value;
    });

  const glassesViewerDoubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd(() => {
      glassesViewerScale.value      = withTiming(1, { duration: 250 });
      glassesViewerBaseScale.value  = 1;
      glassesViewerTranslateX.value = withTiming(0, { duration: 250 });
      glassesViewerTranslateY.value = withTiming(0, { duration: 250 });
      glassesViewerBaseTX.value     = 0;
      glassesViewerBaseTY.value     = 0;
    });

  const glassesViewerGesture   = Gesture.Simultaneous(glassesViewerPinch, glassesViewerPan, glassesViewerDoubleTap);
  const glassesViewerAnimStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: glassesViewerTranslateX.value },
      { translateY: glassesViewerTranslateY.value },
      { scale: glassesViewerScale.value },
    ],
  }));

  // ── Meta glasses session (Ray-Ban Live AI hands-free integration) ──────────
  // Registers only after the technician explicitly enables the optional Meta
  // cloud relay. Phone-camera inspections never create or poll a Meta session.
  const glassesSession = useMetaGlassesSession({
    inspectionId: wsInspectionId,
    active: wsInspectionId != null && metaCloudEnabled,
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
        showFaieStatus(`🕶 ${event.text}`, 4_000, null);
      },
      [showFaieStatus],
    ),
  });

  // ── BLE direct frame injection — bypasses the Meta cloud webhook ─────────────
  // When the glasses are paired via BLE, hardware-button frames arrive here
  // (~50 ms latency) and are routed straight into the FAIE photo pipeline,
  // exactly as if the technician had captured the photo with the phone camera.
  // The webhook path (useMetaGlassesSession above) continues to handle voice
  // commands and cloud-relayed events independently.
  const bleGlasses = useSmartGlassesBleFrames({
    active: wsInspectionId != null,
    // onFrame MUST be async — the hook awaits it before deleting the cache file.
    // Routing through ingestEvidence ensures persistPhoto durably copies the
    // frame to documentDirectory before the cache source is removed.
    onFrame: async (uri: string) => {
      const persisted = await ingestEvidence([{
        id: `ble_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
        uri,
        source: "smart_glasses" as const,
        capturedAt: new Date().toISOString(),
      }]);
      if (!persisted) {
        throw new Error("BLE glasses photo was not saved to this inspection.");
      }
      showFaieStatus("🕶 BLE frame captured", 3_000, null);
    },
    // Post BLE frame-drop telemetry to the active meta-glasses session so the
    // engineering team can identify faulty hardware in the portal BLE Health page.
    // This is fire-and-forget: postTelemetryEvent silently discards failures and
    // no-ops when no session is registered (e.g. before inspection is persisted).
    onDroppedFrame: (count, reason, deviceId) => {
      glassesSession.postTelemetryEvent({
        type: "ble_frame_dropped",
        deviceId: deviceId ?? undefined,
        reason,
        count,
      });
    },
  });

  // ── Official Android Meta glasses capture ─────────────────────────────────
  // DAT emits only a real, local image file after Meta AI approves the camera
  // permission and its stream completes a capture. It goes through the exact
  // same local-first evidence intake as phone, Wi-Fi, and custom BLE sources.
  const metaWearables = useMetaWearablesSession({
    onCapture: async (capture) => {
      const persisted = await ingestEvidence([{
        id: `meta_dat_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
        uri: capture.uri,
        source: "smart_glasses" as const,
        capturedAt: capture.capturedAt,
        metadata: {
          captureTransport: "meta_wearables_device_access_toolkit",
          nativeCaptureSource: capture.source,
          mimeType: capture.mimeType,
        },
      }]);
      if (!persisted) {
        throw new Error("Meta glasses photo was not saved to this inspection.");
      }
      showFaieStatus("Meta glasses photo added to inspection", 3_000, null);
    },
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
  const wsAnalysisRunningRef = useRef(false);
  const ingestQueueRef = useRef(createInspectionIngestQueue());
  const intakeClosedRef = useRef(false);
  const [pendingIngestCount, setPendingIngestCount] = useState(0);
  const deferredPixelItemsRef = useRef<Array<{ localUri: string; item: EvidenceItem }>>([]);
  const deferredPixelTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (deferredPixelTimerRef.current) clearTimeout(deferredPixelTimerRef.current);
    };
  }, []);

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
        setVisitPurpose(rec.visitPurpose ?? null);
        setPestTypes(rec.pestTypes);
        setNotes(rec.notes);
        setPhotos(rec.photos.map((p) => ({ id: p.localUri, uri: p.localUri, capturedAt: p.capturedAt })));
        setUploadedCount(rec.photos.filter((p) => p.storagePath).length);
        analyzedCount.current = rec.analyzedCount;
        if (rec.serverId != null) setWsInspectionId(rec.serverId);
        if (rec.baitStations?.length) setBaitStations(rec.baitStations);
        if (rec.completed) setIsCompleted(true);
        setDisplayUnitNumber(rec.unitNumber ?? null);
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
  }, [siteAddress, clientName, technicianName, propertyType, visitPurpose, pestTypes, notes]);

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
        setDisplayUnitNumber(fresh?.unitNumber ?? null);
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
      r.visitPurpose = visitPurpose;
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
        visitPurpose,
        pestTypes,
        notes,
        unitNumber: displayUnitNumber,
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
  const ingestEvidence = (items: EvidenceItem[]): Promise<boolean> => {
    const rec = recordRef.current;
    if (!rec || items.length === 0 || intakeClosedRef.current) return Promise.resolve(false);

    // Optimistic UI remains outside the persistence queue: every source appears
    // instantly even when an earlier photo is still copying to durable storage.
    const batchCacheUris = new Set(items.map((item) => item.uri));
    setPhotos((prev) => [
      ...prev,
      ...items.map((item) => ({ id: item.uri, uri: item.uri, capturedAt: item.capturedAt })),
    ]);
    setPendingIngestCount((count) => count + items.length);

    const persistBatch = async (): Promise<boolean> => {
      const warnings: string[] = [];
      const added: { localUri: string; item: EvidenceItem }[] = [];
      const uncommittedDurableUris = new Set<string>();
      try {
        for (const item of items) {
          const cacheUri = item.uri;
          const durableUri = await persistPhoto(rec.localId, cacheUri);
          uncommittedDurableUris.add(durableUri);
          const quality = assessEvidence(item);
          if (!quality.acceptable && quality.reasons.length > 0) warnings.push(quality.reasons[0]);

          const updated = await updateLocalInspection(rec.localId, (r) => {
            r.photos.push({
              localUri: durableUri,
              capturedAt: item.capturedAt,
              captureSource: item.source,
              qualityScore: quality.score,
              captureMetadata: (() => {
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
                      ...(laser.deviceId ? { deviceId: laser.deviceId } : {}),
                      ...(laser.signalQuality != null ? { signalQuality: laser.signalQuality } : {}),
                      ...(laser.metadata ? { metadata: laser.metadata } : {}),
                    },
                  } : {}),
                };
              })(),
            });
          });
          if (!updated) {
            throw new Error("This inspection is no longer available to save the photo.");
          }
          recordRef.current = updated;
          uncommittedDurableUris.delete(durableUri);
          setPhotos((prev) =>
            prev.map((p) => (p.uri === cacheUri ? { ...p, uri: durableUri } : p)),
          );
          added.push({ localUri: durableUri, item });

          void ingestAllUploadedPhotos({
            photoUri: durableUri,
            companyId: clerkUser?.id ?? "",
            technicianId: clerkUser?.id ?? "",
            source: "technician_field_upload",
          });
        }

        setQualityNotice(warnings[0] ?? null);
        setWsError(null);
        // Pixel decoding is advisory and CPU-heavy. Batch it until the camera
        // has been quiet for five seconds so rapid multi-shot capture never
        // competes with grayscale decoding, hashing, or another store write.
        deferredPixelItemsRef.current.push(...added);
        if (deferredPixelTimerRef.current) clearTimeout(deferredPixelTimerRef.current);
        deferredPixelTimerRef.current = setTimeout(() => {
          deferredPixelTimerRef.current = null;
          const deferred = deferredPixelItemsRef.current.splice(0);
          if (deferred.length === 0) return;
          InteractionManager.runAfterInteractions(() => {
            void analyzeEvidencePixels(rec.localId, deferred);
          });
        }, 5_000);
        return true;
      } catch (err) {
        const msg =
          err instanceof Error && err.message
            ? err.message
            : "Couldn't save photo to device storage. Check available storage space and try again.";
        setError(msg);
        console.error("[ingestEvidence]", err);
        for (const uri of uncommittedDurableUris) {
          void FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
        }
        // Remove only unresolved optimistic entries from this batch. Durable
        // photos and optimistic entries owned by other queued batches survive.
        setPhotos((prev) => prev.filter((p) => !batchCacheUris.has(p.uri)));
        return false;
      } finally {
        setPendingIngestCount((count) => Math.max(0, count - items.length));
      }
    };

    // One durable writer per inspection. This prevents rapid camera, BLE, DAT,
    // and import captures from contending on file and AsyncStorage queues.
    return ingestQueueRef.current.enqueue(persistBatch);
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
      const items = await cameraCaptureQueueRef.current.enqueue(() =>
        cameraProvider.capture(),
      );
      // ── Release the camera lock as soon as we have the captured URIs. ──────
      // File copy and AsyncStorage write continue in the background so the
      // shutter is ready for the next shot in ~200 ms instead of ~8 s.
      setCapturing(false);
      void ingestEvidence(items);
    } catch {
      setCapturing(false);
      setError("Couldn't capture photo. Please try again.");
    } finally {
      // A short debounce discards accidental double taps while allowing a
      // deliberate multi-shot sequence as soon as the native camera is ready.
      setTimeout(() => { captureLockedRef.current = false; }, 250);
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

  // Truck-stock notice auto-clears after 6s, same as other transient banners.
  useEffect(() => {
    if (!stockNotice) return;
    const timer = setTimeout(() => setStockNotice(null), 6000);
    return () => clearTimeout(timer);
  }, [stockNotice]);

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
      setPhotos(updated.photos.map((p) => ({ id: p.localUri, uri: p.localUri, capturedAt: p.capturedAt })));
    }
  };

  // Runs the sync pipeline from the workspace while the camera stays live:
  // create (idempotent) → upload photos → draft AI analysis. All progress is
  // checkpointed on the local record, so a drop mid-run resumes exactly where
  // it left off. Offline, this is a no-op with a friendly notice — photos are
  // already safe on the device.
  const runWorkspaceAnalysis = async () => {
    if (wsAnalysisRunningRef.current) return;
    wsAnalysisRunningRef.current = true;
    setWsError(null);
    setWsAnalyzing(true);
    try {
      // Never sync/analyze an optimistic URI that has not reached durable
      // storage and the local inspection record yet.
      await ingestQueueRef.current.drain();
      const rec = recordRef.current;
      if (!rec || rec.photos.length === 0) return;
      lastWorkspaceAnalysisPhotoCount.current = Math.max(
        lastWorkspaceAnalysisPhotoCount.current, rec.photos.length,
      );
      await persistDraft();
      const updated = await syncNow(rec.localId);
      if (updated) {
        recordRef.current = updated;
        if (updated.serverId != null) setWsInspectionId(updated.serverId);
        setUploadedCount(updated.photos.filter((p) => p.storagePath).length);
        analyzedCount.current = updated.analyzedCount;
        if (updated.serverId != null) {
          await queryClient.invalidateQueries({
            queryKey: getListAnalysisResultsQueryOptions({
              inspectionId: updated.serverId,
            }).queryKey,
          });
        }
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
      wsAnalysisRunningRef.current = false;
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
    if (
      step !== "capture" ||
      submitting ||
      wsAnalyzing ||
      wsError ||
      pendingIngestCount > 0
    ) return;
    if (
      photos.length === 0 ||
      photos.length <= analyzedCount.current ||
      photos.length <= lastWorkspaceAnalysisPhotoCount.current
    ) return;
    const timer = setTimeout(() => {
      void runWorkspaceAnalysis();
    }, 2500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, submitting, wsAnalyzing, wsError, photos.length, pendingIngestCount]);

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
  // Marks the local record complete (durable even if the app dies right after)
  // and navigates once that local write is safe. The existing sync engine then
  // continues upload, registration, AI, and finalization independently.
  const completeNow = async () => {
    const rec = recordRef.current;
    if (!rec || submitting) return;
    setError(null);
    setSubmitting(true);
    intakeClosedRef.current = true;
    setProgress("Saving inspection…");
    try {
      await completeTechnicianWorkflow({
        // A technician can tap Complete immediately after the shutter. Drain
        // the durable queue so the last optimistic photo cannot be omitted.
        drainPendingIngestion: () => ingestQueueRef.current.drain(),
        persistLocalCompletion: async () => {
          const current = recordRef.current ?? rec;
          const updated = await updateLocalInspection(current.localId, (r) => {
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
          return updated?.localId ?? current.localId;
        },
        navigateToSummary: (localId) => {
          router.replace(`/inspection-summary/${localId}` as Href);
        },
        continueSyncInBackground: (localId) => {
          // Keep the existing upload/registration/AI/finalization pipeline,
          // but do not include it in the technician's completion await chain.
          void syncNow(localId)
            .then(() => queryClient.invalidateQueries())
            .catch(() => requestSync(0));
        },
      });
    } catch (e) {
      intakeClosedRef.current = false;
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

  const capturePhotoMeta = photos.map((photo, index) => ({
    id: photo.id,
    url: photo.uri,
    classificationTag: "Unclassified",
    confidenceScore: null,
    technicianCorrectionLabel: null,
    structuredDescription: null,
    chemicalLogReference: null,
    unitNumber: displayUnitNumber,
    capturedAt: photo.capturedAt ?? null,
  }));

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
        <FlatList
          horizontal
          data={photos}
          keyExtractor={(photo) => photo.id}
          extraData={uploadedCount}
          initialNumToRender={7}
          maxToRenderPerBatch={5}
          windowSize={5}
          removeClippedSubviews
          showsHorizontalScrollIndicator={false}
          style={isPhoneLandscape ? { position: "absolute", bottom: 16, left: 0, right: 116 } : undefined}
          contentContainerStyle={{ gap: 8, paddingHorizontal: 16 }}
          renderItem={({ item: p, index: i }) => (
            <View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Open photo ${i + 1}`}
                onPress={() => setLightboxIndex(i)}
              >
                <Image source={{ uri: p.uri }} style={{ width: 56, height: 56, borderRadius: 8 }} />
                <View style={{ position: "absolute", top: 3, left: 3, backgroundColor: "rgba(0,0,0,0.65)", borderRadius: 999, paddingHorizontal: 4, paddingVertical: 1 }}>
                  <Text style={{ color: "#fff", fontSize: 7, fontFamily: "Inter_700Bold" }}>NEW</Text>
                </View>
                {p.capturedAt ? (
                  <View style={{ position: "absolute", bottom: 3, left: 3, backgroundColor: "rgba(0,0,0,0.65)", borderRadius: 999, paddingHorizontal: 4, paddingVertical: 1 }}>
                    <Text style={{ color: "#fff", fontSize: 7 }}>{new Date(p.capturedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</Text>
                  </View>
                ) : null}
              </Pressable>
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
          )}
        />
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

    // Reference-object clipping warning banner.
    // Shown when the technician has selected a reference object whose endpoints
    // extend to a frame edge, making the measured pixel span unreliable.  The
    // banner persists until the technician re-selects the reference in-frame.
    const refClipBanner = _referenceClipped ? (
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          backgroundColor: "rgba(217,119,6,0.92)",
          paddingHorizontal: 10,
          paddingVertical: 7,
          borderRadius: 10,
          maxWidth: 440,
          borderWidth: 1,
          borderColor: "rgba(255,255,255,0.25)",
        }}
      >
        <Ionicons name="warning" size={14} color="#fff" />
        <Text style={{ color: "#fff", fontFamily: "Inter_600SemiBold", fontSize: 12, flex: 1, flexShrink: 1 }}>
          {_refWarnings[0] ?? "Re-centre reference object"}
        </Text>
        <Pressable
          hitSlop={8}
          onPress={() => {
            _clearRefMeasurement();
            _setReferenceClipped(false);
            _setRefWarnings([]);
            _setRefSelectMode("idle");
            _setRefP1(null);
          }}
          style={{
            backgroundColor: "rgba(255,255,255,0.2)",
            paddingHorizontal: 8,
            paddingVertical: 4,
            borderRadius: 6,
          }}
        >
          <Text style={{ color: "#fff", fontFamily: "Inter_600SemiBold", fontSize: 11 }}>Re-select</Text>
        </Pressable>
      </View>
    ) : null;

    // Build a 4-corner ROI quad from the reference selection endpoints so
    // SpatialMeasurementCard can run the same clipping check against the same
    // region the technician marked.  When no reference has been selected yet
    // we pass undefined and the card defaults to its centred placeholder quad.
    const _roiVertices: Array<{ x: number; y: number }> | undefined =
      _refPoints.length === 2
        ? (() => {
            const [rp1, rp2] = _refPoints as [{ x: number; y: number }, { x: number; y: number }];
            const minX = Math.min(rp1.x, rp2.x);
            const maxX = Math.max(rp1.x, rp2.x);
            const minY = Math.min(rp1.y, rp2.y);
            const maxY = Math.max(rp1.y, rp2.y);
            return [
              { x: minX, y: minY },
              { x: maxX, y: minY },
              { x: maxX, y: maxY },
              { x: minX, y: maxY },
            ];
          })()
        : undefined;

    // Transparent Pressable overlay — active only during reference selection.
    // Intercepts the first two taps in sequence to set P1 then P2.
    const refSelectionOverlay =
      _refSelectMode !== "idle" ? (
        <Pressable
          style={{
            position: "absolute",
            top: 0, left: 0, right: 0, bottom: 0,
            zIndex: 50,
          }}
          onPress={(e) => {
            const { locationX: x, locationY: y } = e.nativeEvent;
            if (_refSelectMode === "p1") {
              _setRefP1({ x, y });
              _setRefSelectMode("p2");
            } else if (_refSelectMode === "p2" && _refP1) {
              const p2 = { x, y };
              // Convert the two tap endpoints to a normalised BoundingRegion so
              // ReferenceScaleAnchor.anchor() can apply the canonical clipping
              // detection (normalised coords outside [0,1]) instead of a local
              // pixel-edge heuristic.  We supply a 1×1 uniform depth map because
              // the clipped flag only inspects box coords — no depth needed here.
              const minX = Math.min(_refP1.x, p2.x);
              const maxX = Math.max(_refP1.x, p2.x);
              const minY = Math.min(_refP1.y, p2.y);
              const maxY = Math.max(_refP1.y, p2.y);
              const normBox: BoundingRegion = {
                x:      minX / _cameraW,
                y:      minY / _cameraH,
                width:  (maxX - minX) / _cameraW,
                height: (maxY - minY) / _cameraH,
              };
              const dummyDepthMap: SfMDepthMap = {
                width: 1,
                height: 1,
                relativeDepth: new Float32Array([0.5]),
                scaleVariance: 0,
                frameCount: 1,
              };
              const anchorResult = new ReferenceScaleAnchor(
                _burstFocalLengthRef.current,
              ).anchor(
                normBox,
                _cameraW,
                _cameraH,
                REFERENCE_OBJECTS.CREDIT_CARD,
                dummyDepthMap,
              );
              _setReferenceClipped(anchorResult.clipped);
              // When clipped the technician needs to re-frame the reference; when
              // not clipped surface any size/distance warnings from the anchor so
              // the technician knows to move closer before tapping Measure.
              _setRefWarnings(
                anchorResult.clipped
                  ? ["Re-centre reference object"]
                  : anchorResult.warnings,
              );
              _handleRefSelected(_refP1, p2);
              _setRefSelectMode("idle");
              _setRefP1(null);
            }
          }}
        >
          {/* Selection hint */}
          <View
            style={{
              position: "absolute",
              top: "50%",
              alignSelf: "center",
              backgroundColor: "rgba(0,0,0,0.65)",
              paddingHorizontal: 14,
              paddingVertical: 8,
              borderRadius: 8,
              borderWidth: 1,
              borderColor: "#17c4d3",
            }}
          >
            <Text style={{ color: "#17c4d3", fontFamily: "Inter_600SemiBold", fontSize: 13 }}>
              {_refSelectMode === "p1" ? "Tap near edge of reference object" : "Tap far edge of reference object"}
            </Text>
          </View>
        </Pressable>
      ) : null;

    // Inline chip to start reference selection (shown in the banner strip).
    const refSelectChip = (
      <Pressable
        hitSlop={8}
        onPress={() => {
          _clearRefMeasurement();
          _setReferenceClipped(false);
          _setRefWarnings([]);
          _setRefP1(null);
          _setRefSelectMode("p1");
        }}
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 5,
          backgroundColor: _referenceClipped
            ? "rgba(217,119,6,0.85)"
            : "rgba(0,0,0,0.55)",
          paddingHorizontal: 10,
          paddingVertical: 6,
          borderRadius: 999,
          borderWidth: 1,
          borderColor: _referenceClipped ? "#f59e0b" : "rgba(23,196,211,0.6)",
        }}
      >
        <Ionicons name="expand-outline" size={13} color={_referenceClipped ? "#f59e0b" : "#17c4d3"} />
        <Text style={{ color: "#fff", fontFamily: "Inter_600SemiBold", fontSize: 11 }}>
          {_refPoints.length === 2 ? (_referenceClipped ? "Re-select Ref" : "Ref ✓") : "Select Ref"}
        </Text>
      </Pressable>
    );

    // Inline chip to enter Measure mode (hardware-free burst measurement).
    const measureChip = (
      <Pressable
        hitSlop={8}
        onPress={() => {
          setMeasureResult(null);
          setMeasureMode(true);
        }}
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 5,
          backgroundColor: measureMode ? "rgba(23,196,211,0.25)" : "rgba(0,0,0,0.55)",
          paddingHorizontal: 10,
          paddingVertical: 6,
          borderRadius: 999,
          borderWidth: 1,
          borderColor: "rgba(23,196,211,0.6)",
        }}
      >
        <Ionicons name="resize-outline" size={13} color="#17c4d3" />
        <Text style={{ color: "#fff", fontFamily: "Inter_600SemiBold", fontSize: 11 }}>
          Measure
        </Text>
      </Pressable>
    );

    // Full-screen Measure-mode overlay — rendered inside the camera pane so all
    // gesture coordinates are relative to the actual preview dimensions.
    const measureOverlay = measureMode ? (
      <MeasureModeOverlay
        viewportWidth={_cameraW}
        viewportHeight={_cameraH}
        measuring={measuring}
        result={measureResult}
        onMeasure={(target, reference) => void handleRunBurstMeasure(target, reference)}
        onStamp={handleStampMeasureResult}
        onClearResult={() => setMeasureResult(null)}
        onClose={() => {
          setMeasureMode(false);
          setMeasureResult(null);
        }}
      />
    ) : null;

    // Meta glasses activity strip — shown when a Live AI session is active,
    // OR when registration failed (error strip with a visible retry button).
    const glassesCaptures = glassesFindings.filter((e) => e.finding || e.mediaId);
    // #106 — amber strip when glasses have gone silent for 2+ minutes
    const glassesStripBg = glassesSession.isInactive
      ? "rgba(202,138,4,0.92)"
      : "rgba(124,58,237,0.88)";

    // Optional-provider notice. A Meta failure never represents an inspection
    // failure because the phone camera remains the primary capture provider.
    const glassesErrorStrip =
      metaCloudEnabled &&
      !glassesSession.isActive &&
      wsInspectionId != null &&
      glassesSession.status !== null ? (
        <View
          style={{
            backgroundColor: "rgba(124,58,237,0.88)",
            paddingHorizontal: 12,
            paddingVertical: 8,
            borderRadius: 10,
            maxWidth: 440,
            borderWidth: 1,
            borderColor: "rgba(255,255,255,0.2)",
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
          }}
        >
          <Ionicons name="glasses-outline" size={15} color="#fff" />
          <Text
            style={{
              color: "#fff",
              fontFamily: "Inter_400Regular",
              fontSize: 12,
              flex: 1,
              flexShrink: 1,
            }}
          >
            {glassesSession.status}
          </Text>
          <Pressable
            onPress={glassesSession.retrySession}
            style={{
              backgroundColor: "rgba(255,255,255,0.20)",
              borderRadius: 6,
              paddingHorizontal: 10,
              paddingVertical: 4,
            }}
          >
            <Text style={{ color: "#fff", fontFamily: "Inter_600SemiBold", fontSize: 11 }}>
              Retry
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setMetaCloudEnabled(false)}
            style={{
              backgroundColor: "rgba(255,255,255,0.12)",
              borderRadius: 6,
              paddingHorizontal: 10,
              paddingVertical: 4,
            }}
          >
            <Text style={{ color: "#fff", fontFamily: "Inter_600SemiBold", fontSize: 11 }}>
              Use phone
            </Text>
          </Pressable>
        </View>
      ) : null;

    const metaCloudSetupStrip =
      wsInspectionId != null && !metaCloudEnabled ? (
        <View
          style={{
            backgroundColor: "rgba(15,23,42,0.78)",
            paddingHorizontal: 12,
            paddingVertical: 7,
            borderRadius: 10,
            maxWidth: 440,
            borderWidth: 1,
            borderColor: "rgba(255,255,255,0.12)",
            flexDirection: "row",
            alignItems: "center",
            gap: 8,
          }}
        >
          <Ionicons name="phone-portrait-outline" size={15} color="#fff" />
          <Text style={{ color: "#fff", fontFamily: "Inter_500Medium", fontSize: 12, flex: 1 }}>
            Phone camera active · Meta glasses optional
          </Text>
          <Pressable
            onPress={() => setMetaCloudEnabled(true)}
            style={{
              backgroundColor: "rgba(255,255,255,0.16)",
              borderRadius: 6,
              paddingHorizontal: 9,
              paddingVertical: 4,
            }}
          >
            <Text style={{ color: "#fff", fontFamily: "Inter_600SemiBold", fontSize: 11 }}>
              Use Meta
            </Text>
          </Pressable>
        </View>
      ) : null;

    const glassesStrip = glassesErrorStrip ?? (glassesSession.isActive ? (
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
          <Pressable
            onPress={() => setMetaCloudEnabled(false)}
            style={{
              backgroundColor: "rgba(255,255,255,0.16)",
              borderRadius: 6,
              paddingHorizontal: 7,
              paddingVertical: 2,
            }}
          >
            <Text style={{ color: "#fff", fontFamily: "Inter_600SemiBold", fontSize: 10 }}>
              Phone
            </Text>
          </Pressable>
        </View>
        {/* Connection-mode badge row — BLE direct vs cloud relay */}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          {/* BLE / Cloud badge */}
          {(() => {
            const badgeStyle = getBleBadgeStyle(bleGlasses.isBleConnected);
            return (
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 4,
                  backgroundColor: badgeStyle.bgColor,
                  borderRadius: 5,
                  paddingHorizontal: 7,
                  paddingVertical: 3,
                  borderWidth: 1,
                  borderColor: badgeStyle.borderColor,
                }}
              >
                <View
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: 3,
                    backgroundColor: badgeStyle.dotColor,
                  }}
                />
                <Text
                  style={{
                    color: badgeStyle.textColor,
                    fontFamily: "Inter_600SemiBold",
                    fontSize: 10,
                    letterSpacing: 0.3,
                  }}
                >
                  {badgeStyle.label}
                </Text>
              </View>
            );
          })()}
          {/* BLE frame count — shown only when BLE has received frames */}
          {bleGlasses.isBleConnected && bleGlasses.frameCount > 0 ? (
            <Text style={{ color: "rgba(255,255,255,0.65)", fontFamily: "Inter_400Regular", fontSize: 10 }}>
              {bleGlasses.frameCount} BLE frame{bleGlasses.frameCount === 1 ? "" : "s"}
            </Text>
          ) : null}
          {/* Dropped-frame warning — permanent while frames are being lost;
               replaced by a 5-second transient notice once the glasses reconnect
               and the first frame is successfully written. */}
          {bleGlasses.reconnectNotice ? (
            <Text style={{ color: "#86efac", fontFamily: "Inter_500Medium", fontSize: 10 }}>
              ✓ {bleGlasses.reconnectNotice}
            </Text>
          ) : bleGlasses.droppedFrameCount > 0 ? (
            <Text style={{ color: "#f87171", fontFamily: "Inter_500Medium", fontSize: 10 }}>
              ⚠ {bleGlasses.droppedFrameCount} frame{bleGlasses.droppedFrameCount === 1 ? "" : "s"} lost
            </Text>
          ) : null}
          {/* Cloud event count — shown alongside when BLE is also active */}
          {bleGlasses.isBleConnected && glassesSession.eventCount > 0 ? (
            <Text style={{ color: "rgba(255,255,255,0.65)", fontFamily: "Inter_400Regular", fontSize: 10 }}>
              · {glassesSession.eventCount} cloud event{glassesSession.eventCount === 1 ? "" : "s"}
            </Text>
          ) : null}
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
    ) : metaCloudSetupStrip);

    // Official native Meta path. This is intentionally separate from the
    // cloud/webhook strip and the ReadyLoq custom BLE badges above: consumer
    // Meta glasses use DAT and Meta AI approval, not GATT pairing.
    const nativeMetaGlassesStrip = metaWearables.nativeModulePresent ? (
      <View
        style={{
          backgroundColor: metaWearables.canCapture ? "rgba(22,163,74,0.90)" : "rgba(124,58,237,0.88)",
          paddingHorizontal: 12,
          paddingVertical: 8,
          borderRadius: 10,
          maxWidth: 440,
          borderWidth: 1,
          borderColor: "rgba(255,255,255,0.2)",
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
        }}
      >
        <Ionicons name="glasses-outline" size={15} color="#fff" />
        <View style={{ flex: 1, gap: 1 }}>
          <Text style={{ color: "#fff", fontFamily: "Inter_600SemiBold", fontSize: 12 }}>
            {metaWearables.title}
          </Text>
          <Text style={{ color: "rgba(255,255,255,0.82)", fontFamily: "Inter_400Regular", fontSize: 10 }}>
            {metaWearables.canCapture
              ? "Official Meta Android session · photo goes directly into this inspection"
              : metaWearables.guidance}
          </Text>
        </View>
        {metaWearables.canCapture ? (
          <Pressable
            onPress={() => void metaWearables.capturePhoto()}
            style={{ backgroundColor: "rgba(255,255,255,0.22)", borderRadius: 6, paddingHorizontal: 9, paddingVertical: 5 }}
          >
            <Text style={{ color: "#fff", fontFamily: "Inter_700Bold", fontSize: 11 }}>Capture</Text>
          </Pressable>
        ) : metaWearables.canStartSession ? (
          <Pressable
            onPress={() => void metaWearables.startSession()}
            style={{ backgroundColor: "rgba(255,255,255,0.22)", borderRadius: 6, paddingHorizontal: 9, paddingVertical: 5 }}
          >
            <Text style={{ color: "#fff", fontFamily: "Inter_700Bold", fontSize: 11 }}>Connect</Text>
          </Pressable>
        ) : (
          <Pressable
            onPress={() => router.push("/(app)/(tabs)/connections" as Href)}
            style={{ backgroundColor: "rgba(255,255,255,0.22)", borderRadius: 6, paddingHorizontal: 9, paddingVertical: 5 }}
          >
            <Text style={{ color: "#fff", fontFamily: "Inter_700Bold", fontSize: 11 }}>Set up</Text>
          </Pressable>
        )}
      </View>
    ) : null;

    // Compact BLE-only badge — shown when glasses are BLE-connected but no
    // cloud session is active yet.  Gives the technician confirmation that the
    // hardware link is working before they start the Meta Live AI session.
    const bleBadgeOnly = !glassesSession.isActive && bleGlasses.isBleConnected ? (
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
        {(() => {
          const badgeStyle = getBleBadgeStyle(true /* isBleConnected */);
          return (
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 4,
                backgroundColor: badgeStyle.bgColor,
                borderRadius: 5,
                paddingHorizontal: 7,
                paddingVertical: 3,
                borderWidth: 1,
                borderColor: badgeStyle.borderColor,
              }}
            >
              <View
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: 3,
                  backgroundColor: badgeStyle.dotColor,
                }}
              />
              <Text
                style={{
                  color: badgeStyle.textColor,
                  fontFamily: "Inter_600SemiBold",
                  fontSize: 10,
                  letterSpacing: 0.3,
                }}
              >
                {badgeStyle.label}
              </Text>
            </View>
          );
        })()}
        {bleGlasses.frameCount > 0 ? (
          <Text style={{ color: "rgba(255,255,255,0.65)", fontFamily: "Inter_400Regular", fontSize: 10 }}>
            {bleGlasses.frameCount} BLE frame{bleGlasses.frameCount === 1 ? "" : "s"}
          </Text>
        ) : null}
        {bleGlasses.droppedFrameCount > 0 ? (
          <Text style={{ color: "#f87171", fontFamily: "Inter_500Medium", fontSize: 10 }}>
            ⚠ {bleGlasses.droppedFrameCount} frame{bleGlasses.droppedFrameCount === 1 ? "" : "s"} lost
          </Text>
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
              onPress={ev.storagePath ? () => setGlassesViewerPath(ev.storagePath as string) : undefined}
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
        <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.95)" }}>
          {/* Close button */}
          <Pressable
            onPress={() => setGlassesViewerPath(null)}
            hitSlop={12}
            style={{
              position: "absolute", top: 52, right: 16, zIndex: 10,
              backgroundColor: "rgba(0,0,0,0.55)", borderRadius: 999,
              padding: 8,
            }}
          >
            <Ionicons name="close" size={22} color="#fff" />
          </Pressable>

          {/* Pinch-to-zoom + pan image (double-tap to reset) */}
          <GestureDetector gesture={glassesViewerGesture}>
            <Reanimated.View style={[{ flex: 1 }, glassesViewerAnimStyle]}>
              {glassesViewerPath ? (
                <AuthedImage
                  path={glassesViewerPath}
                  style={{ flex: 1 }}
                  contentFit="contain"
                />
              ) : null}
            </Reanimated.View>
          </GestureDetector>

          <Text
            style={{ position: "absolute", bottom: 48, alignSelf: "center", color: "rgba(255,255,255,0.5)", fontSize: 12 }}
          >
            Pinch to zoom · Drag to pan · Double-tap to reset
          </Text>
        </View>
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

    const stockBanner = stockNotice ? (
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          backgroundColor: stockNotice.low ? "rgba(202,138,4,0.92)" : "rgba(22,163,74,0.90)",
          paddingHorizontal: 10,
          paddingVertical: 7,
          borderRadius: 10,
          maxWidth: 440,
        }}
      >
        <Ionicons name={stockNotice.low ? "warning-outline" : "flask-outline"} size={16} color="#fff" />
        <Text
          style={{
            color: "#fff",
            fontFamily: "Inter_600SemiBold",
            fontSize: 12,
            flex: 1,
            flexShrink: 1,
          }}
        >
          {stockNotice.low
            ? `Low stock: ${stockNotice.quantityOnHand.toFixed(1)} ${stockNotice.unit} of ${stockNotice.productName} remaining on truck`
            : `${stockNotice.quantityOnHand.toFixed(1)} ${stockNotice.unit} of ${stockNotice.productName} remaining on truck`}
        </Text>
        <Pressable
          onPress={() => setStockNotice(null)}
          style={{
            paddingHorizontal: 8,
            paddingVertical: 4,
            borderRadius: 6,
            backgroundColor: "rgba(255,255,255,0.28)",
          }}
        >
          <Ionicons name="close" size={14} color="#fff" />
        </Pressable>
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
            <View style={{ flex: 1, backgroundColor: "#000" }} onLayout={_onCameraPaneLayout}>
              {/* CameraView fills the pane completely — acts as CSS object-fit:cover */}
              <CameraView
                ref={cameraRef}
                style={{ flex: 1, width: "100%" }}
                facing="back"
                zoom={zoom}
                flash={flash}
              />
              {/* Reference overlay inside the camera pane — touch coords relative
                   to this View (left half), so clipping checks the actual half-screen
                   camera width, not the full window width. */}
              {refSelectionOverlay}

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
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  {displayUnitNumber ? (
                    <View
                      style={{
                        backgroundColor: "rgba(20,184,166,0.75)",
                        paddingHorizontal: 10,
                        paddingVertical: 5,
                        borderRadius: 999,
                      }}
                    >
                      <Text style={{ color: "#fff", fontFamily: "Inter_600SemiBold", fontSize: 12 }}>
                        Unit {displayUnitNumber}
                      </Text>
                    </View>
                  ) : null}
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
                {refClipBanner}
                {qualityBanner}
                {stockBanner}
                {faieBanner}
                {glassesViewerModal}
                {glassesStrip}
                {nativeMetaGlassesStrip}
                {bleBadgeOnly}
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
                  {refSelectChip}
                  {measureChip}
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
              {/* Measure-mode overlay — must be the LAST camera-pane child so it
                  paints above (and captures touches before) the control bars. */}
              {measureOverlay}
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
                    isBleConnected={bleGlasses.isBleConnected}
                    bleFrameCount={bleGlasses.frameCount}
                    glassesSessionActive={shouldShowBleBadge(bleGlasses.isBleConnected, bleGlasses.frameCount) || glassesSession.isActive}
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
                    <MeasurementDevicePanel
                      onStamp={setLastMeasurementReading}
                      onActiveCountChange={setActiveSensorCount}
                      roiVertices={_roiVertices}
                      viewportWidth={_cameraW}
                      viewportHeight={_cameraH}
                      referenceClipped={_referenceClipped}
                    />
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
      <View style={{ flex: 1, backgroundColor: "#000" }} onLayout={_onCameraPaneLayout}>
        <CameraView ref={cameraRef} style={{ flex: 1 }} facing="back" zoom={zoom} flash={flash} />
        {/* Reference-object selection overlay — intercepts two taps to define the
            reference endpoint pair; touch coords are relative to this View so
            clipping evaluates against the full-screen camera in portrait/landscape. */}
        {refSelectionOverlay}
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
                {displayUnitNumber ? (
                  <View
                    style={{
                      backgroundColor: "rgba(20,184,166,0.75)",
                      paddingHorizontal: 10,
                      paddingVertical: 5,
                      borderRadius: 999,
                    }}
                  >
                    <Text style={{ color: "#fff", fontFamily: "Inter_600SemiBold", fontSize: 12 }}>
                      Unit {displayUnitNumber}
                    </Text>
                  </View>
                ) : null}
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
              {refSelectChip}
              {measureChip}
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
              {refClipBanner}
              {qualityBanner}
              {stockBanner}
              {faieBanner}
              {glassesStrip}
              {nativeMetaGlassesStrip}
              {bleBadgeOnly}
              {glassesFindingsPanel}
              {zoomChips}
            </View>
            {thumbs}
            {refSelectionOverlay}
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
            {refClipBanner ? (
              <View style={{ alignItems: "center", paddingHorizontal: 16 }}>{refClipBanner}</View>
            ) : null}
            {qualityBanner ? (
              <View style={{ alignItems: "center", paddingHorizontal: 16 }}>{qualityBanner}</View>
            ) : null}
            {stockBanner ? (
              <View style={{ alignItems: "center", paddingHorizontal: 16 }}>{stockBanner}</View>
            ) : null}
            {faieBanner ? (
              <View style={{ alignItems: "center", paddingHorizontal: 16 }}>{faieBanner}</View>
            ) : null}
            {glassesStrip ? (
              <View style={{ alignItems: "center", paddingHorizontal: 16 }}>{glassesStrip}</View>
            ) : null}
            {nativeMetaGlassesStrip ? (
              <View style={{ alignItems: "center", paddingHorizontal: 16 }}>{nativeMetaGlassesStrip}</View>
            ) : null}
            {bleBadgeOnly ? (
              <View style={{ alignItems: "center", paddingHorizontal: 16 }}>{bleBadgeOnly}</View>
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
                {refSelectChip}
                {measureChip}
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
            onLogged={(stock) => {
              setShowTreatmentWizard(false);
              if (stock) setStockNotice(stock);
            }}
          />
        )}

        {/* Morning kit declaration modal — opens automatically when the tech
            hasn't set their chemical assignments for the day, or manually via
            the treatment log wizard's "Today's Route" tab. */}
        <DailyRouteSetupModal
          visible={showMorningKitModal}
          initialAssignments={assignmentsWithProducts.map((a) => ({
            productId: a.productId,
            targetPest: a.targetPest,
            notes: a.notes,
          }))}
          onClose={closeMorningKitModal}
          onSave={(assignments) => {
            void saveMorningKit(assignments);
            closeMorningKitModal();
          }}
        />

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
                isBleConnected={bleGlasses.isBleConnected}
                bleFrameCount={bleGlasses.frameCount}
                glassesSessionActive={shouldShowBleBadge(bleGlasses.isBleConnected, bleGlasses.frameCount) || glassesSession.isActive}
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
                <MeasurementDevicePanel
                  onStamp={setLastMeasurementReading}
                  onActiveCountChange={setActiveSensorCount}
                  roiVertices={_roiVertices}
                  viewportWidth={_cameraW}
                  viewportHeight={_cameraH}
                  referenceClipped={_referenceClipped}
                />
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
        {/* Measure-mode overlay — must be the LAST child so it paints above
            (and captures touches before) the top bar, control bars, and rails
            in both portrait and landscape. */}
        {measureOverlay}
        <PhotoLightbox
          photos={capturePhotoMeta}
          initialIndex={lightboxIndex ?? 0}
          visible={lightboxIndex != null}
          onClose={() => setLightboxIndex(null)}
        />
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
                <Pressable key={p.id} onPress={() => setLightboxIndex(i)} style={{ width: 88, height: 88 }}>
                  <Image source={{ uri: p.uri }} style={{ width: 88, height: 88, borderRadius: 10 }} />
                  <View style={{ position: "absolute", top: 4, left: 4, backgroundColor: "rgba(0,0,0,0.68)", borderRadius: 999, paddingHorizontal: 5, paddingVertical: 2 }}>
                    <Text style={{ color: "#fff", fontSize: 8, fontFamily: "Inter_700Bold" }}>Unclassified</Text>
                  </View>
                  {p.capturedAt ? (
                    <View style={{ position: "absolute", bottom: 4, left: 4, backgroundColor: "rgba(0,0,0,0.68)", borderRadius: 999, paddingHorizontal: 5, paddingVertical: 2 }}>
                      <Text style={{ color: "#fff", fontSize: 8 }}>{new Date(p.capturedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</Text>
                    </View>
                  ) : null}
                </Pressable>
              ))}
            </View>
            <PhotoLightbox
              photos={capturePhotoMeta}
              initialIndex={lightboxIndex ?? 0}
              visible={lightboxIndex != null}
              onClose={() => setLightboxIndex(null)}
            />
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
            Purpose of visit
          </Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {VISIT_PURPOSES.map((p) => (
              <Pill key={p} label={p} active={visitPurpose === p} onPress={() => setVisitPurpose(visitPurpose === p ? null : p)} colors={colors} />
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
