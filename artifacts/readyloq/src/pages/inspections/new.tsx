import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import { useUser } from "@clerk/react";
import { useCreateInspection, useAddInspectionMedia, useAnalyzeInspection } from "@workspace/api-client-react";
import { uploadInspectionEvidence } from "@/lib/inspection-upload";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ArrowLeft, Mic, Scan, CheckCircle2, Zap,
  Aperture, BrainCircuit,
  Camera, MapPin, ChevronDown, ChevronUp, X, Languages,
  Battery, BatteryCharging, BatteryLow, BatteryWarning, Gauge,
  AlertTriangle, Video, SwitchCamera, Trash2, Play,
} from "lucide-react";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  type SupportedLang, type TermMatch, type Category, LANG_CONFIG, CATEGORY_LABELS,
  matchTerminology, buildStructuredNote, type StructuredNote,
} from "@/lib/voice-intelligence";
import { useVoiceRecognition } from "@/hooks/use-voice-recognition";
import { useBatteryStatus, suggestModeFromBattery } from "@/hooks/use-battery-status";
import { PreInspectionIntel } from "@/components/property-intel";

// ─── Inspection Modes ─────────────────────────────────────────────────────────

export type InspectionMode = "low-power" | "standard" | "enhanced";

interface ModeConfig {
  label: string;
  short: string;
  description: string;
  badge: string;
  captureHeight: number;
  colorClass: string;
  borderClass: string;
}

const MODE_CONFIG: Record<InspectionMode, ModeConfig> = {
  "low-power": {
    label: "Battery Saver",
    short: "BATT SAVER",
    description: "720p photos · lowest battery use",
    badge: "text-emerald-400",
    captureHeight: 720,
    colorClass: "text-emerald-400",
    borderClass: "border-emerald-500/30 bg-emerald-500/10",
  },
  "standard": {
    label: "Standard",
    short: "STANDARD",
    description: "1080p photos · balanced battery use",
    badge: "text-primary",
    captureHeight: 1080,
    colorClass: "text-primary",
    borderClass: "border-primary/30 bg-primary/10",
  },
  "enhanced": {
    label: "High Quality",
    short: "HIGH-Q",
    description: "1440p photos · highest battery use",
    badge: "text-amber-400",
    captureHeight: 1440,
    colorClass: "text-amber-400",
    borderClass: "border-amber-500/30 bg-amber-500/10",
  },
};

// ─── Zone Data ────────────────────────────────────────────────────────────────

const INTERIOR_ZONES = [
  "Hallways", "Stairwells", "Laundry Rooms", "Trash Rooms", "Boiler Rooms",
  "Mechanical Rooms", "Utility Rooms", "Basements", "Storage Areas",
  "Elevator Areas", "Mail Rooms", "Lobbies", "Maintenance Rooms",
  "Vacant Units", "Occupied Units",
];

const EXTERIOR_ZONES = [
  "Front Perimeter", "Rear Perimeter", "Foundation", "Dumpster Area",
  "Landscaping", "Exterior Utility Penetrations", "Parking Areas", "Loading Areas",
];

const DEFAULT_INTERIOR = ["Hallways", "Laundry Rooms", "Trash Rooms", "Basements"];
const DEFAULT_EXTERIOR: string[] = [];

// ─── Constants ────────────────────────────────────────────────────────────────

const PROPERTY_TYPES = [
  "Multifamily", "Single Family", "Commercial", "Restaurant",
  "Warehouse", "School", "Healthcare", "Hospitality",
];

// Severity assigned to technician voice findings by pest/condition category.
const VOICE_SEVERITY: Record<Category, string> = {
  rodents: "high",
  cockroaches: "high",
  termites: "high",
  carpenter_ants: "high",
  exclusion: "medium",
  conducive: "medium",
};

/**
 * Upload a captured blob/data URL to permanent object storage and return its
 * canonical `/api/storage/...` path. Throws loudly on any failure — we never
 * silently substitute the ephemeral blob URL, which would let an inspection
 * "complete" with evidence that vanishes on reload and can't be AI-analyzed.
 * `fallbackContentType` is used only when the blob itself reports no MIME type
 * (e.g. "image/jpeg" for photos, "video/webm" for recorded clips).
 */
const VOICE_COMMANDS = [
  '"Fresh mouse droppings behind refrigerator"',
  '"Utility penetration under sink"',
  '"Heavy German roach activity"',
  '"Missing door sweep rear exit"',
  '"Save finding"',
  '"Add note"',
  '"End inspection"',
];

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// ─── Types ────────────────────────────────────────────────────────────────────

type Step = "setup" | "recording" | "review";
type FocusMode = "continuous" | "macro" | "auto";
type CameraPermission = "pending" | "granted" | "denied" | "unavailable";

interface CapturedItem {
  id: string; type: "photo" | "voice" | "video";
  label: string; url: string; ts: number;
  note?: StructuredNote;
  durationSec?: number;
  mimeType?: string;
}

interface CameraCapabilities {
  supportsZoom: boolean; minZoom: number; maxZoom: number;
  supportsFocusMode: boolean; availableFocusModes: string[];
  supportsTorch: boolean;
}

type FacingMode = "environment" | "user";

/**
 * Pick the best-supported MediaRecorder container/codec for video capture.
 * Chromium prefers WebM (VP9/VP8 + Opus); Safari only offers MP4. Returns
 * undefined to let the browser choose its own default when none match.
 */
function pickVideoMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined") return undefined;
  const candidates = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
    "video/mp4",
  ];
  return candidates.find(t => {
    try { return MediaRecorder.isTypeSupported(t); } catch { return false; }
  });
}

/** Map a recording MIME type to a sensible file extension for upload. */
function mimeToExt(mimeType?: string): string {
  return mimeType && mimeType.includes("mp4") ? "mp4" : "webm";
}

// ─── Camera hook ──────────────────────────────────────────────────────────────

function useCamera() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const captureRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const trackRef = useRef<MediaStreamTrack | null>(null);
  const imageCaptureRef = useRef<ImageCapture | null>(null);
  const animFrameRef = useRef<number>(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const videoTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const videoStartRef = useRef<number>(0);
  const facingModeRef = useRef<FacingMode>("environment");

  const [permission, setPermission] = useState<CameraPermission>("pending");
  const [capabilities, setCapabilities] = useState<CameraCapabilities>({
    supportsZoom: false, minZoom: 1, maxZoom: 5,
    supportsFocusMode: false, availableFocusModes: [],
    supportsTorch: false,
  });

  const [cssZoom, setCssZoom] = useState(1);
  const [currentZoom, setCurrentZoom] = useState(1);
  const [focusMode, setFocusMode] = useState<FocusMode>("continuous");
  const [lowLightActive, setLowLightActive] = useState(false);
  const [adjustmentPhase, setAdjustmentPhase] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<FacingMode>("environment");
  const [isRecordingVideo, setIsRecordingVideo] = useState(false);
  const [videoElapsed, setVideoElapsed] = useState(0);
  const [audioEnabled, setAudioEnabled] = useState(false);

  // Open a camera stream for the given facing direction. We request audio so
  // recorded video carries sound, but gracefully fall back to a silent
  // (video-only) stream on devices without a usable microphone so that photo
  // capture keeps working. Permission denial is re-thrown for startCamera to map.
  const openStream = useCallback(async (facing: FacingMode) => {
    let stream: MediaStream;
    let withAudio = true;
    const videoConstraints = { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1080 } };
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints, audio: true });
    } catch {
      // Audio+video failed (often a denied/absent microphone). Fall back to a
      // silent video-only stream so photo capture keeps working. Only if the
      // video-only request ALSO fails do we treat it as a true camera-permission
      // denial and let startCamera map it.
      withAudio = false;
      stream = await navigator.mediaDevices.getUserMedia({ video: videoConstraints, audio: false });
    }
    streamRef.current = stream;
    facingModeRef.current = facing;
    setFacingMode(facing);
    setAudioEnabled(withAudio);
    const track = stream.getVideoTracks()[0] as MediaStreamTrack;
    trackRef.current = track;
    if (videoRef.current) {
      videoRef.current.srcObject = stream;
      await videoRef.current.play().catch(() => {});
    }
    const caps = (track.getCapabilities?.() as any) ?? {};
    setCapabilities({
      supportsZoom: !!(caps.zoom),
      minZoom: caps.zoom?.min ?? 1,
      maxZoom: caps.zoom?.max ?? 5,
      supportsFocusMode: !!(caps.focusMode),
      availableFocusModes: (caps.focusMode as string[]) ?? [],
      supportsTorch: !!(caps.torch),
    });
    imageCaptureRef.current =
      typeof ImageCapture !== "undefined" ? new ImageCapture(track) : null;
  }, []);

  const startCamera = useCallback(async () => {
    try {
      await openStream(facingModeRef.current);
      setPermission("granted");
    } catch (err: any) {
      if (err.name === "NotAllowedError") setPermission("denied");
      else if (err.name === "NotFoundError") setPermission("unavailable");
      else setPermission("denied");
    }
  }, [openStream]);

  const stopCamera = useCallback(() => {
    cancelAnimationFrame(animFrameRef.current);
    if (videoTimerRef.current) { clearInterval(videoTimerRef.current); videoTimerRef.current = null; }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      try { mediaRecorderRef.current.stop(); } catch {}
    }
    mediaRecorderRef.current = null;
    recordedChunksRef.current = [];
    setIsRecordingVideo(false);
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null; trackRef.current = null; imageCaptureRef.current = null;
  }, []);

  // Flip between rear/front cameras by restarting the stream. Disabled while a
  // clip is recording (swapping the source track mid-recording is unreliable).
  const switchCamera = useCallback(async () => {
    if (isRecordingVideo) return;
    const prev = facingModeRef.current;
    const next: FacingMode = prev === "environment" ? "user" : "environment";
    cancelAnimationFrame(animFrameRef.current);
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null; trackRef.current = null; imageCaptureRef.current = null;
    try {
      await openStream(next);
      setCssZoom(1); setCurrentZoom(1);
    } catch {
      try { await openStream(prev); } catch {}
    }
  }, [isRecordingVideo, openStream]);

  // Begin recording the live stream to an in-memory video blob.
  const startVideo = useCallback((): boolean => {
    const stream = streamRef.current;
    if (!stream || isRecordingVideo || typeof MediaRecorder === "undefined") return false;
    const mimeType = pickVideoMimeType();
    let recorder: MediaRecorder;
    try {
      recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    } catch {
      try { recorder = new MediaRecorder(stream); } catch { return false; }
    }
    recordedChunksRef.current = [];
    recorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) recordedChunksRef.current.push(e.data); };
    recorder.start();
    mediaRecorderRef.current = recorder;
    videoStartRef.current = Date.now();
    setIsRecordingVideo(true);
    setVideoElapsed(0);
    videoTimerRef.current = setInterval(() => {
      setVideoElapsed(Math.floor((Date.now() - videoStartRef.current) / 1000));
    }, 250);
    return true;
  }, [isRecordingVideo]);

  // Stop recording and resolve the captured clip (blob URL + duration + MIME).
  // Resolves null if nothing usable was recorded.
  const stopVideo = useCallback((): Promise<{ url: string; durationSec: number; mimeType: string } | null> => {
    return new Promise((resolve) => {
      const recorder = mediaRecorderRef.current;
      if (!recorder || recorder.state === "inactive") { resolve(null); return; }
      if (videoTimerRef.current) { clearInterval(videoTimerRef.current); videoTimerRef.current = null; }
      const durationSec = Math.max(1, Math.round((Date.now() - videoStartRef.current) / 1000));
      recorder.onstop = () => {
        const type = recorder.mimeType || pickVideoMimeType() || "video/webm";
        const blob = new Blob(recordedChunksRef.current, { type });
        recordedChunksRef.current = [];
        mediaRecorderRef.current = null;
        setIsRecordingVideo(false);
        if (blob.size === 0) { resolve(null); return; }
        resolve({ url: URL.createObjectURL(blob), durationSec, mimeType: type });
      };
      try { recorder.stop(); } catch { setIsRecordingVideo(false); resolve(null); }
    });
  }, []);

  const applyZoom = useCallback(async (targetZoom: number) => {
    const z = Math.min(Math.max(targetZoom, 1), capabilities.maxZoom);
    setCurrentZoom(z); setCssZoom(z);
    if (capabilities.supportsZoom && trackRef.current) {
      try { await (trackRef.current as any).applyConstraints({ advanced: [{ zoom: z }] }); } catch {}
    }
  }, [capabilities]);

  const smoothZoom = useCallback(async (targetZoom: number) => {
    const start = currentZoom;
    const end = Math.min(Math.max(targetZoom, 1), 5);
    for (let i = 0; i <= 20; i++) {
      const z = start + (end - start) * (i / 20);
      setCssZoom(z); setCurrentZoom(z);
      if (capabilities.supportsZoom && trackRef.current) {
        try { await (trackRef.current as any).applyConstraints({ advanced: [{ zoom: z }] }); } catch {}
      }
      await sleep(25);
    }
  }, [currentZoom, capabilities]);

  const applyFocusMode = useCallback(async (mode: FocusMode) => {
    setFocusMode(mode);
    if (capabilities.supportsFocusMode && trackRef.current) {
      const mapped = mode === "macro" ? "manual" : "continuous";
      if (capabilities.availableFocusModes.includes(mapped)) {
        try {
          await (trackRef.current as any).applyConstraints({ advanced: [{ focusMode: mapped }] });
          if (mode === "macro" && imageCaptureRef.current) {
            await (imageCaptureRef.current as any).setFocusDistance?.(0.05);
          }
        } catch {}
      }
    }
  }, [capabilities]);

  const captureFrame = useCallback(async (imageHeight = 1080): Promise<string | null> => {
    if (imageCaptureRef.current) {
      try {
        const blob = await imageCaptureRef.current.takePhoto({
          fillLightMode: lowLightActive ? "flash" : "off",
          imageHeight,
        });
        return URL.createObjectURL(blob);
      } catch {}
    }
    const video = videoRef.current;
    if (video && video.readyState >= 2) {
      const canvas = captureRef.current ?? document.createElement("canvas");
      canvas.width = video.videoWidth || 1280;
      canvas.height = video.videoHeight || 720;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        if (lowLightActive) ctx.filter = "brightness(1.4) contrast(1.2)";
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        ctx.filter = "none";
        return canvas.toDataURL("image/jpeg", 0.92);
      }
    }
    return null;
  }, [lowLightActive]);

  return {
    videoRef, captureRef,
    permission, capabilities,
    cssZoom, currentZoom, focusMode, lowLightActive,
    adjustmentPhase,
    facingMode, isRecordingVideo, videoElapsed, audioEnabled,
    setLowLightActive, setAdjustmentPhase,
    startCamera, stopCamera, applyZoom, smoothZoom, applyFocusMode, captureFrame,
    switchCamera, startVideo, stopVideo,
  };
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function NewInspection() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { user } = useUser();
  const createInspection = useCreateInspection();
  const addMedia = useAddInspectionMedia();
  const analyzeInspection = useAnalyzeInspection();

  const [step, setStep] = useState<Step>("setup");
  const [propertyType, setPropertyType] = useState("Multifamily");
  const [selectedInterior, setSelectedInterior] = useState<string[]>(DEFAULT_INTERIOR);
  const [selectedExterior, setSelectedExterior] = useState<string[]>(DEFAULT_EXTERIOR);
  const [showAllInterior, setShowAllInterior] = useState(false);
  const [showExterior, setShowExterior] = useState(false);
  const [siteAddress, setSiteAddress] = useState("");
  const [technicianName, setTechnicianName] = useState("");
  const [completing, setCompleting] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  useEffect(() => {
    if (user?.fullName && !technicianName) {
      setTechnicianName(user.fullName);
    }
  }, [user?.fullName]);
  const [activeZone, setActiveZone] = useState<string | null>(null);

  const battery = useBatteryStatus();
  const [inspectionMode, setInspectionMode] = useState<InspectionMode>(() =>
    suggestModeFromBattery({ level: 1, charging: true, supported: false, isLow: false, isCritical: false, displayPct: 100 })
  );
  const inspectionModeRef = useRef<InspectionMode>("standard");

  const [inspectionLang, setInspectionLang] = useState<SupportedLang>("en");
  const [isRecording, setIsRecording] = useState(false);
  const [timer, setTimer] = useState(0);
  const [captured, setCaptured] = useState<CapturedItem[]>([]);
  const [createdId, setCreatedId] = useState<number | null>(null);
  const [voiceHint, setVoiceHint] = useState(0);
  const [voiceSuggestion, setVoiceSuggestion] = useState<TermMatch | null>(null);
  const [pendingTranscript, setPendingTranscript] = useState("");
  const [captureNotice, setCaptureNotice] = useState<CapturedItem | null>(null);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const adjustingRef = useRef(false);
  const captureNoticeRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Retry bookkeeping so a failed completion resumes incrementally instead of
  // re-uploading photos, duplicating media rows, or re-running AI analysis.
  const uploadedRef = useRef<Record<string, { path: string; uploadIntentId: number }>>({});
  const persistedRef = useRef<Set<string>>(new Set());
  const analyzedRef = useRef(false);

  const camera = useCamera();

  const voice = useVoiceRecognition({
    lang: LANG_CONFIG[inspectionLang].speechCode,
    onFinalResult: (text) => {
      setPendingTranscript(text);
      const match = matchTerminology(text);
      if (match) {
        setVoiceSuggestion(match);
      } else {
        confirmVoiceNote(text, null);
      }
    },
  });

  const allSelectedZones = [...selectedInterior, ...selectedExterior];
  const allAvailableInterior = INTERIOR_ZONES.filter(z => !selectedInterior.includes(z));
  const allAvailableExterior = EXTERIOR_ZONES.filter(z => !selectedExterior.includes(z));

  // Keep ref in sync with state (used inside async callbacks)
  useEffect(() => { inspectionModeRef.current = inspectionMode; }, [inspectionMode]);

  // Suggest mode from battery level on setup screen
  useEffect(() => {
    if (step !== "setup") return;
    const suggested = suggestModeFromBattery(battery);
    setInspectionMode(suggested);
  }, [battery.level, battery.charging, step]);

  // Auto-downgrade to Low Power when battery drops below 20% during recording
  useEffect(() => {
    if (!battery.supported || !isRecording) return;
    if (battery.isLow && inspectionModeRef.current !== "low-power") {
      setInspectionMode("low-power");
      toast({
        title: `Battery at ${battery.displayPct}%`,
        description: "Switched to Battery Saver. Voice and manual capture still active.",
      });
    }
  }, [battery.isLow, isRecording]);

  // Rotate voice hints
  useEffect(() => {
    const t = setInterval(() => setVoiceHint(h => (h + 1) % VOICE_COMMANDS.length), 4000);
    return () => clearInterval(t);
  }, []);

  // Rotate active zone during recording
  useEffect(() => {
    if (step !== "recording" || allSelectedZones.length === 0) return;
    let idx = 0;
    setActiveZone(allSelectedZones[0]);
    const t = setInterval(() => {
      idx = (idx + 1) % allSelectedZones.length;
      setActiveZone(allSelectedZones[idx]);
    }, 18000);
    return () => clearInterval(t);
  }, [step]);

  const formatTime = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

  const toggleZone = (zone: string, list: string[], setList: (v: string[]) => void) => {
    setList(list.includes(zone) ? list.filter(z => z !== zone) : [...list, zone]);
  };

  // ── Manual evidence capture ────────────────────────────────────────────────
  function showCaptureNotice(item: CapturedItem) {
    setCaptureNotice(item);
    if (captureNoticeRef.current) clearTimeout(captureNoticeRef.current);
    captureNoticeRef.current = setTimeout(() => setCaptureNotice(null), 3000);
  }

  const manualCapture = useCallback(async () => {
    if (adjustingRef.current) return;
    if (camera.permission !== "granted") {
      toast({ title: "Camera unavailable", description: "Grant camera access to capture photos.", variant: "destructive" });
      return;
    }
    adjustingRef.current = true;
    try {
      const url = await camera.captureFrame(MODE_CONFIG[inspectionModeRef.current].captureHeight);
      if (!url) {
        toast({ title: "Capture failed", description: "Could not capture a photo. Move closer to the subject and try again.", variant: "destructive" });
        return;
      }
      const item: CapturedItem = {
        id: `capture-${Date.now()}`, type: "photo",
        label: activeZone ? `Photo · ${activeZone}` : "Inspection photo",
        url, ts: Date.now(),
      };
      setCaptured(prev => [...prev, item]);
      camera.setAdjustmentPhase("Photo captured ✓");
      window.setTimeout(() => camera.setAdjustmentPhase(null), 1200);
      showCaptureNotice(item);
    } finally {
      adjustingRef.current = false;
    }
  }, [camera, activeZone, toast]);

  // ── Record / stop a video clip ───────────────────────────────────────────────
  // Video is captured as standalone evidence: it never blocks photo/voice and is
  // uploaded + attached on completion, but is NEVER turned into AI findings.
  async function toggleVideo() {
    if (camera.permission !== "granted") {
      toast({ title: "Camera unavailable", description: "Grant camera access to record video.", variant: "destructive" });
      return;
    }
    if (camera.isRecordingVideo) {
      const clip = await camera.stopVideo();
      if (!clip) {
        toast({ title: "Recording failed", description: "No video was captured. Please try again.", variant: "destructive" });
        return;
      }
      const item: CapturedItem = {
        id: `video-${Date.now()}`, type: "video",
        label: activeZone ? `Video · ${activeZone}` : "Inspection video",
        url: clip.url, ts: Date.now(),
        durationSec: clip.durationSec, mimeType: clip.mimeType,
      };
      setCaptured(prev => [...prev, item]);
      camera.setAdjustmentPhase("Video saved ✓");
      window.setTimeout(() => camera.setAdjustmentPhase(null), 1200);
      showCaptureNotice(item);
    } else {
      // Free the microphone first — speech recognition and the recorder contend
      // for the mic on many devices.
      if (voice.state === "listening") voice.stop();
      const ok = camera.startVideo();
      if (!ok) {
        toast({ title: "Can't record video", description: "Video recording isn't supported on this device or browser.", variant: "destructive" });
      }
    }
  }

  // Remove a captured item (review screen). Revokes the in-memory blob URL and
  // clears any staged upload/persist caches so a re-captured item is treated as
  // brand-new evidence.
  function removeCaptured(id: string) {
    setCaptured(prev => {
      const item = prev.find(i => i.id === id);
      if (item && (item.type === "photo" || item.type === "video") && item.url.startsWith("blob:")) {
        URL.revokeObjectURL(item.url);
      }
      return prev.filter(i => i.id !== id);
    });
    delete uploadedRef.current[id];
    persistedRef.current.delete(id);
  }

  // Return to the live camera to capture more evidence without resetting the
  // running inspection timer.
  async function resumeCapture() {
    setStep("recording");
    await camera.startCamera();
    if (!timerRef.current) {
      setIsRecording(true);
      timerRef.current = setInterval(() => setTimer(t => t + 1), 1000);
    }
  }

  // Recapture a clip: drop it and jump back to the camera to record again.
  async function recaptureVideo(id: string) {
    removeCaptured(id);
    await resumeCapture();
  }

  // ── Start Recording ────────────────────────────────────────────────────────
  function startRecording() {
    setIsRecording(true);
    setTimer(0);
    timerRef.current = setInterval(() => setTimer(t => t + 1), 1000);
  }

  function stopRecording() {
    setIsRecording(false);
    if (timerRef.current) clearInterval(timerRef.current);
    if (captureNoticeRef.current) clearTimeout(captureNoticeRef.current);
    setCaptureNotice(null);
    camera.stopCamera();
    setStep("review");
  }

  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (captureNoticeRef.current) clearTimeout(captureNoticeRef.current);
    camera.stopCamera();
  }, []);

  async function handleBeginInspection() {
    if (!siteAddress) {
      toast({ title: "Site address required", description: "Enter the property address to begin.", variant: "destructive" });
      return;
    }
    const techName = technicianName.trim() || "Technician";
    const zoneNote = allSelectedZones.length > 0
      ? `Zones: ${allSelectedZones.join(", ")}`
      : "";
    try {
      const result = await createInspection.mutateAsync({
        data: {
          siteAddress,
          technicianName: techName,
          pestTypes: [],
          notes: [`Property type: ${propertyType}`, zoneNote].filter(Boolean).join(" | "),
        },
      });
      setCreatedId(result.id);
      setStep("recording");
      await camera.startCamera();
      startRecording();
    } catch {
      toast({ title: "Error", description: "Failed to start inspection.", variant: "destructive" });
    }
  }

  function addVoiceNote() {
    if (voice.state === "listening") { voice.stop(); return; }
    // Regression guard: the Web Speech API is browser-provided (Chrome, Edge,
    // Safari). In browsers without it — notably Samsung Internet, the default
    // on Galaxy devices — start() used to no-op silently, making voice look
    // "removed". Tell the technician exactly what to do instead.
    if (!voice.isSupported) {
      toast({
        title: "Voice notes aren't supported in this browser",
        description:
          "This browser doesn't offer speech recognition. Open ReadyLoq in Chrome (or Edge/Safari) to use voice notes.",
        variant: "destructive",
      });
      return;
    }
    voice.start();
  }

  function confirmVoiceNote(transcript: string, match: TermMatch | null) {
    const label = match
      ? `${match.term.icon} ${match.term.professional}`
      : `🎤 ${transcript}`;
    const note: StructuredNote | undefined = match
      ? buildStructuredNote(transcript, match, inspectionLang)
      : undefined;
    setCaptured(prev => [...prev, {
      id: `voice-${Date.now()}`, type: "voice",
      label, url: "", ts: Date.now(), note,
    } as any]);
    setVoiceSuggestion(null);
    setPendingTranscript("");
    voice.reset();
    toast({
      title: match ? `${match.term.professional}` : "Voice note captured",
      description: match ? match.term.reportPhrase[inspectionLang] : "Added to inspection record.",
    });
  }

  function dismissVoiceSuggestion() {
    if (pendingTranscript) {
      confirmVoiceNote(pendingTranscript, null);
    } else {
      setVoiceSuggestion(null);
      voice.reset();
    }
  }

  async function handleComplete() {
    setCompleting(true);
    setUploadError(null);
    const photoItems = captured.filter(i => i.type === "photo");
    const videoItems = captured.filter(i => i.type === "video");

    try {
      // Step 1: Upload every captured photo AND video to permanent object
      // storage. Failures throw loudly (no silent blob fallback): we keep the
      // technician on this screen with a Retry button instead of saving broken
      // evidence. Already-uploaded items are cached so Retry only resumes what
      // failed.
      for (const item of photoItems) {
        const existing = uploadedRef.current[item.id];
        const refreshed = await uploadInspectionEvidence({
          url: item.url,
          filename: `inspection-${createdId}-${item.id}.jpg`,
          inspectionId: createdId!,
          mediaType: "photo",
          clientKey: `web-inspection-${createdId}-${item.id}`,
          uploadBlob: !existing,
        });
        if (existing && (existing.path !== refreshed.path || existing.uploadIntentId !== refreshed.uploadIntentId)) {
          throw new Error("The photo upload reservation changed during retry.");
        }
        uploadedRef.current[item.id] = refreshed;
      }
      for (const item of videoItems) {
        const existing = uploadedRef.current[item.id];
        const refreshed = await uploadInspectionEvidence({
          url: item.url,
          filename: `inspection-${createdId}-${item.id}.${mimeToExt(item.mimeType)}`,
          inspectionId: createdId!,
          mediaType: "video",
          clientKey: `web-inspection-${createdId}-${item.id}`,
          fallbackContentType: item.mimeType || "video/webm",
          uploadBlob: !existing,
        });
        if (existing && (existing.path !== refreshed.path || existing.uploadIntentId !== refreshed.uploadIntentId)) {
          throw new Error("The video upload reservation changed during retry.");
        }
        uploadedRef.current[item.id] = refreshed;
      }

      // Step 2: Persist all media records (incrementally) BEFORE analysis so the
      // server can verify each analyzed photo is a real media row for this
      // inspection. Failures here are also loud + retryable; the per-item guard
      // prevents duplicate rows on retry. Voice notes carry no uploaded blob;
      // photos and videos use their permanent storage path.
      if (createdId) {
        for (const item of captured) {
          // Voice findings are structured observations rather than uploaded
          // binary media; they are included with technician findings below.
          if (item.type === "voice" || persistedRef.current.has(item.id)) continue;
          // The current OpenAPI-generated MediaInput type has not yet been
          // regenerated for uploadIntentId; the API now requires this field.
          const mediaData = {
            mediaType: item.type,
            url: uploadedRef.current[item.id]!.path,
            uploadIntentId: uploadedRef.current[item.id]!.uploadIntentId,
            filename: item.label,
            caption: item.note ? `${item.note.professionalTerm} · ${item.note.reportPhrase}` : "",
            ...(item.type === "video" && item.durationSec ? { durationSec: item.durationSec } : {}),
          } as Parameters<typeof addMedia.mutateAsync>[0]["data"] & { uploadIntentId: number };
          await addMedia.mutateAsync({
            id: createdId,
            data: mediaData,
          });
          persistedRef.current.add(item.id);
        }
      }
    } catch (err) {
      // Evidence (upload/persist) is data-integrity critical — surface the
      // failure and let the technician retry rather than completing with
      // missing evidence.
      setUploadError(
        err instanceof Error
          ? err.message
          : "We couldn't save your evidence. Check your connection and try again.",
      );
      setCompleting(false);
      return;
    }

    // Step 3: Run REAL AI analysis on the persisted photos + merge with voice
    // findings. This is supplementary, so a failure here does NOT trap the
    // technician — the inspection + evidence are already saved. We surface any
    // photos the AI could not analyze instead of silently fabricating findings.
    if (createdId && !analyzedRef.current) {
      const technicianFindings = captured
        .filter(i => i.type === "voice" && i.note)
        .map((item, idx) => {
          const note = item.note!;
          return {
            id: idx + 1,
            category: CATEGORY_LABELS[note.category]?.en ?? "Observation",
            description: `${note.professionalTerm} — ${note.reportPhrase}`,
            confidence: 1,
            severity: VOICE_SEVERITY[note.category] ?? "medium",
            location: siteAddress || null,
            imageUrl: null,
            treatment: null,
            exclusionOpportunity: note.category === "exclusion",
            evidenceQuality: null,
          };
        });

      const images = photoItems
        .map(item => ({ imageUrl: uploadedRef.current[item.id]?.path ?? item.url, label: item.label }))
        .filter(img => img.imageUrl.startsWith("/api/storage"));

      // Video is recorded as evidence only — its metadata is sent to the
      // analyzer to attach to the report, but findings are NEVER generated from
      // video (that's a future video-frame analysis hook on the server). Keep
      // videos strictly OUT of `images`.
      const videos = videoItems
        .map(item => ({
          url: uploadedRef.current[item.id]?.path ?? item.url,
          filename: item.label,
          durationSec: item.durationSec,
          label: item.label,
        }))
        .filter(v => v.url.startsWith("/api/storage"));

      if (images.length > 0 || videos.length > 0 || technicianFindings.length > 0) {
        try {
          const result = await analyzeInspection.mutateAsync({
            data: { inspectionId: createdId, images, videos, technicianFindings },
          });
          analyzedRef.current = true;
          const failed = (result as { analysisErrors?: number | null })?.analysisErrors ?? 0;
          if (failed > 0) {
            toast({
              title: "Some photos couldn't be analyzed",
              description: `AI analysis failed for ${failed} photo${failed > 1 ? "s" : ""}. Your evidence is saved — you can re-run analysis from the inspection.`,
              variant: "destructive",
            });
          }
        } catch {
          toast({
            title: "AI analysis didn't run",
            description: "Your inspection and evidence were saved. You can re-run AI analysis from the inspection page.",
            variant: "destructive",
          });
        }
      }
    }

    setCompleting(false);
    navigate(createdId ? `/inspections/${createdId}` : "/inspections");
  }

  // ── STEP 1: SETUP ─────────────────────────────────────────────────────────────
  if (step === "setup") {
    const visibleInterior = showAllInterior ? INTERIOR_ZONES : INTERIOR_ZONES.slice(0, 8);
    return (
      <div className="max-w-lg mx-auto space-y-5 pt-2 pb-6">
        <div className="flex items-center gap-3">
          <Link href="/"><Button variant="ghost" size="icon" className="h-8 w-8"><ArrowLeft className="h-4 w-4" /></Button></Link>
          <div>
            <h1 className="text-xl font-bold">New Inspection</h1>
            <p className="text-muted-foreground text-xs mt-0.5">Select zones and begin</p>
          </div>
        </div>

        {/* Property Type */}
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Property Type</p>
          <div className="grid grid-cols-2 gap-2">
            {PROPERTY_TYPES.map(t => (
              <button key={t} onClick={() => setPropertyType(t)}
                className={cn("px-3 py-2.5 rounded-2xl border text-sm font-medium text-left transition-all",
                  propertyType === t
                    ? "border-primary bg-primary/15 text-primary"
                    : "border-border/60 bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground"
                )}>
                {t}
              </button>
            ))}
          </div>
        </div>

        {/* Interior Zones */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Interior Zones</p>
            <span className="text-[10px] text-primary font-semibold">{selectedInterior.length} selected</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {visibleInterior.map(zone => (
              <button key={zone} onClick={() => toggleZone(zone, selectedInterior, setSelectedInterior)}
                className={cn(
                  "px-3 py-1.5 rounded-full border text-[12px] font-medium transition-all",
                  selectedInterior.includes(zone)
                    ? "border-primary bg-primary/15 text-primary"
                    : "border-border/50 bg-card text-muted-foreground hover:border-primary/30 hover:text-foreground"
                )}>
                {zone}
              </button>
            ))}
          </div>
          <button onClick={() => setShowAllInterior(v => !v)}
            className="mt-2 flex items-center gap-1 text-[11px] text-primary/70 font-medium">
            {showAllInterior
              ? <><ChevronUp className="h-3 w-3" /> Show fewer</>
              : <><ChevronDown className="h-3 w-3" /> Show all {INTERIOR_ZONES.length} interior zones</>}
          </button>
        </div>

        {/* Exterior Zones */}
        <div>
          <button onClick={() => setShowExterior(v => !v)}
            className="flex items-center justify-between w-full mb-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Exterior Zones</p>
            <div className="flex items-center gap-2">
              {selectedExterior.length > 0 && (
                <span className="text-[10px] text-primary font-semibold">{selectedExterior.length} selected</span>
              )}
              {showExterior ? <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />}
            </div>
          </button>
          {showExterior && (
            <div className="flex flex-wrap gap-2">
              {EXTERIOR_ZONES.map(zone => (
                <button key={zone} onClick={() => toggleZone(zone, selectedExterior, setSelectedExterior)}
                  className={cn(
                    "px-3 py-1.5 rounded-full border text-[12px] font-medium transition-all",
                    selectedExterior.includes(zone)
                      ? "border-emerald-500/60 bg-emerald-500/10 text-emerald-400"
                      : "border-border/50 bg-card text-muted-foreground hover:border-emerald-500/30 hover:text-foreground"
                  )}>
                  {zone}
                </button>
              ))}
            </div>
          )}
          {!showExterior && (
            <p className="text-[11px] text-muted-foreground/60">Tap to add exterior zones to this inspection</p>
          )}
        </div>

        {/* Site address */}
        <div className="space-y-3">
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Site Address</p>
            <div className="relative">
              <MapPin className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              <Input placeholder="123 Main St, City, State" value={siteAddress}
                onChange={e => setSiteAddress(e.target.value)}
                className="bg-card border-border/60 rounded-xl h-12 text-base pl-9" />
            </div>
          </div>
          <PreInspectionIntel siteAddress={siteAddress} />
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Technician <span className="text-muted-foreground/40 normal-case font-normal">(optional)</span></p>
            <Input placeholder="Your name" value={technicianName}
              onChange={e => setTechnicianName(e.target.value)}
              className="bg-card border-border/60 rounded-xl h-12 text-base" />
          </div>
        </div>

        {/* How capture works */}
        <div className="bg-primary/5 border border-primary/20 rounded-2xl p-4 space-y-3">
          <p className="text-xs font-semibold text-primary/80 uppercase tracking-wider flex items-center gap-1.5">
            <Aperture className="h-3.5 w-3.5" /> How Capture Works
          </p>
          <div className="space-y-2">
            {[
              { icon: Camera, label: "Tap the shutter to capture inspection photos" },
              { icon: Mic, label: "Dictate findings hands-free with voice notes" },
              { icon: BrainCircuit, label: "AI analyzes your photos when you finish" },
            ].map(f => (
              <div key={f.label} className="flex items-center gap-2">
                <f.icon className="h-3.5 w-3.5 text-primary/70 shrink-0" />
                <span className="text-[11px] text-muted-foreground">{f.label}</span>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-muted-foreground/60 pt-1 border-t border-border/40">
            Camera and microphone permission required.
          </p>
        </div>

        {/* Inspection Mode selector */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
              <Gauge className="h-3.5 w-3.5" /> Inspection Mode
            </p>
            {battery.supported && (
              <span className={cn("text-[10px] font-semibold flex items-center gap-1",
                battery.isLow ? "text-amber-400" : "text-muted-foreground/50"
              )}>
                {battery.charging
                  ? <BatteryCharging className="h-3 w-3" />
                  : battery.isLow
                    ? <BatteryWarning className="h-3 w-3" />
                    : <Battery className="h-3 w-3" />
                }
                {battery.displayPct}%
                {battery.isLow && " · Low battery"}
              </span>
            )}
          </div>
          <div className="grid grid-cols-3 gap-2">
            {(["low-power", "standard", "enhanced"] as InspectionMode[]).map(mode => {
              const cfg = MODE_CONFIG[mode];
              const isActive = inspectionMode === mode;
              return (
                <button key={mode} onClick={() => setInspectionMode(mode)}
                  className={cn(
                    "flex flex-col items-center gap-1.5 px-2 py-3 rounded-2xl border text-center transition-all",
                    isActive ? cfg.borderClass : "border-border/50 bg-card hover:border-primary/20"
                  )}>
                  <span className={cn("text-xs font-bold tracking-wide",
                    isActive ? cfg.colorClass : "text-muted-foreground")}>
                    {cfg.label}
                  </span>
                  <span className="text-[9px] text-muted-foreground leading-tight">
                    {mode === "low-power" ? "720p" : mode === "standard" ? "1080p" : "1440p"}
                  </span>
                </button>
              );
            })}
          </div>
          <p className="text-[10px] text-muted-foreground/50 mt-1.5">
            {MODE_CONFIG[inspectionMode].description}
            {battery.supported && battery.isLow && inspectionMode !== "low-power" && (
              <span className="text-amber-400/80"> · Battery Saver recommended at {battery.displayPct}%</span>
            )}
          </p>
        </div>

        {/* Language selector */}
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <Languages className="h-3.5 w-3.5" /> Voice Language
          </p>
          <div className="flex gap-2">
            {(["en", "es", "pt"] as SupportedLang[]).map(lang => {
              const cfg = LANG_CONFIG[lang];
              return (
                <button key={lang} onClick={() => setInspectionLang(lang)}
                  className={cn(
                    "flex items-center gap-2 px-4 py-2.5 rounded-2xl border text-sm font-semibold transition-all flex-1 justify-center",
                    inspectionLang === lang
                      ? "border-primary bg-primary/15 text-primary"
                      : "border-border/60 bg-card text-muted-foreground hover:border-primary/30"
                  )}>
                  <span>{cfg.flag}</span> {cfg.label}
                </button>
              );
            })}
          </div>
          <p className="text-[10px] text-muted-foreground/50 mt-1.5">
            Voice notes and commands will be recognized in this language. Mixed-language speech is supported.
          </p>
        </div>

        <Button className="w-full h-14 text-base font-bold rounded-2xl bg-primary hover:bg-primary/90 shadow-lg shadow-primary/20"
          disabled={createInspection.isPending} onClick={handleBeginInspection}>
          {createInspection.isPending
            ? <span className="animate-pulse">Starting…</span>
            : <><Scan className="mr-2 h-5 w-5" />Begin Inspection</>}
        </Button>
      </div>
    );
  }

  // ── STEP 2: RECORDING ──────────────────────────────────────────────────────────
  if (step === "recording") {
    return (
      <div className="fixed inset-0 bg-black flex flex-col z-50 overflow-hidden">
        {/* Camera video feed */}
        <div className="absolute inset-0 bg-black">
          {camera.permission === "granted" ? (
            <video
              ref={camera.videoRef}
              autoPlay playsInline muted
              className="w-full h-full object-cover transition-transform duration-700 ease-out"
              style={{ transform: `scale(${camera.cssZoom})`, transformOrigin: "center center" }}
            />
          ) : (
            <div className="w-full h-full bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
              <div className="absolute inset-0 opacity-10"
                style={{ backgroundImage: "repeating-linear-gradient(0deg, transparent, transparent 60px, rgba(255,255,255,0.3) 60px, rgba(255,255,255,0.3) 61px), repeating-linear-gradient(90deg, transparent, transparent 60px, rgba(255,255,255,0.3) 60px, rgba(255,255,255,0.3) 61px)" }} />
            </div>
          )}
          <canvas ref={camera.captureRef} className="hidden" />
          <div className="absolute inset-0 bg-gradient-to-b from-black/70 via-transparent to-black/70 pointer-events-none" />
          {camera.permission === "denied" && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/50">
              <div className="text-center p-6">
                <Camera className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
                <p className="text-white/70 text-sm">Camera access denied</p>
                <p className="text-white/40 text-xs mt-1">Grant camera access to capture photos</p>
              </div>
            </div>
          )}
        </div>

        {/* Top bar */}
        <div className="relative z-10 flex items-center justify-between px-5 pb-2"
          style={{ paddingTop: 'max(1rem, env(safe-area-inset-top, 0px))' }}>
          {camera.isRecordingVideo ? (
            <div className="flex items-center gap-2 bg-red-600/90 rounded-full px-3 py-1.5">
              <div className="w-2 h-2 rounded-full bg-white animate-pulse" />
              <span className="text-white font-mono text-sm font-bold tracking-wider">REC {formatTime(camera.videoElapsed)}</span>
            </div>
          ) : (
            <div className="flex items-center gap-2 bg-black/50 backdrop-blur-sm rounded-full px-3 py-1.5">
              <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              <span className="text-white font-mono text-sm font-semibold">{formatTime(timer)}</span>
            </div>
          )}

          <div className="flex items-center gap-1.5 bg-black/50 backdrop-blur-sm rounded-full px-3 py-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-primary" />
            <span className="text-[11px] font-semibold text-primary">
              {MODE_CONFIG[inspectionMode].short}
            </span>
          </div>

          <div className="flex items-center gap-1.5 bg-black/50 backdrop-blur-sm rounded-full px-3 py-1.5">
            {battery.supported ? (
              <>
                {battery.charging
                  ? <BatteryCharging className="h-3 w-3 text-emerald-400" />
                  : battery.isLow
                    ? <BatteryWarning className="h-3 w-3 text-amber-400 animate-pulse" />
                    : <Battery className="h-3 w-3 text-white/50" />
                }
                <span className={cn("text-xs font-mono font-semibold",
                  battery.isLow ? "text-amber-400" : "text-white/50")}>
                  {battery.displayPct}%
                </span>
              </>
            ) : (
              <span className="text-white/50 text-xs">{captured.filter(c => c.type === "photo").length} photos</span>
            )}
          </div>
        </div>

        {/* HUD strip — active zone */}
        {activeZone && (
          <div className="relative z-10 px-4 mt-1">
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-1 bg-primary/15 border border-primary/30 rounded-full px-2.5 py-1 text-[10px] font-semibold text-primary">
                <MapPin className="h-3 w-3" />{activeZone}
              </div>
            </div>
          </div>
        )}

        {/* Capture confirmation */}
        <div className="relative z-10 px-5 mt-3 h-12">
          {camera.adjustmentPhase && (
            <div className="animate-slide-up flex items-center gap-3 backdrop-blur-md border rounded-2xl px-4 py-2.5 bg-emerald-900/60 border-emerald-500/40">
              <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
              <span className="text-sm font-medium text-emerald-300">
                {camera.adjustmentPhase}
              </span>
            </div>
          )}
        </div>

        {/* Capture notice — running photo count */}
        {captureNotice && !camera.adjustmentPhase && (
          <div className="relative z-10 px-5 mt-2">
            <div className="animate-slide-up bg-black/70 backdrop-blur-md border border-white/10 rounded-2xl px-4 py-3 flex items-center gap-2">
              <Camera className="h-4 w-4 text-primary shrink-0" />
              <span className="text-sm text-white/80">
                {captured.filter(c => c.type === "photo").length} photo{captured.filter(c => c.type === "photo").length === 1 ? "" : "s"} captured
              </span>
            </div>
          </div>
        )}

        {/* Voice: Listening overlay */}
        {voice.state === "listening" && (
          <div className="absolute inset-0 z-30 flex items-end justify-center pb-48 bg-black/60 backdrop-blur-sm">
            <div className="flex flex-col items-center gap-4 px-6 w-full max-w-sm">
              <div className="w-16 h-16 rounded-full bg-primary/20 border-2 border-primary flex items-center justify-center animate-pulse">
                <Mic className="h-7 w-7 text-primary" />
              </div>
              <p className="text-white font-semibold text-sm">
                {LANG_CONFIG[inspectionLang].flag} Listening…
              </p>
              {voice.interim && (
                <div className="bg-black/60 border border-primary/30 rounded-2xl px-4 py-3 w-full text-center">
                  <p className="text-white/80 text-sm italic">"{voice.interim}"</p>
                </div>
              )}
              <div className="flex gap-1 items-end h-6">
                {[3, 5, 8, 4, 7, 3, 6, 5, 4].map((h, i) => (
                  <div key={i} className="w-1 bg-primary rounded-full animate-bounce"
                    style={{ height: `${h * 2.5}px`, animationDelay: `${i * 80}ms` }} />
                ))}
              </div>
              <button onClick={() => voice.stop()}
                className="text-white/40 text-xs underline">Cancel</button>
            </div>
          </div>
        )}

        {/* Voice: Terminology suggestion overlay */}
        {voiceSuggestion && voice.state !== "listening" && (
          <div className="absolute inset-0 z-30 flex items-end justify-center pb-36 bg-black/70 backdrop-blur-sm">
            <div className="w-full max-w-sm px-5 space-y-3">
              <div className="bg-card border border-border/60 rounded-2xl p-4 space-y-3">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">You said</p>
                <p className="text-white/70 text-sm italic">"{pendingTranscript}"</p>
                <div className="border-t border-border/40 pt-3">
                  <p className="text-[10px] text-primary/70 uppercase tracking-wider font-semibold mb-1.5">Professional Term</p>
                  <div className="flex items-center gap-2">
                    <span className="text-2xl">{voiceSuggestion.term.icon}</span>
                    <div>
                      <p className="text-white font-bold text-base">{voiceSuggestion.term.professional}</p>
                      <p className="text-[11px] text-muted-foreground">{voiceSuggestion.term.reportPhrase[inspectionLang]}</p>
                    </div>
                  </div>
                </div>
                {voiceSuggestion.detectedLang !== "en" && (
                  <p className="text-[10px] text-muted-foreground/60 italic">
                    {voiceSuggestion.detectedLang === "es" ? "🇪🇸" : "🇧🇷"} {voiceSuggestion.term.translations[voiceSuggestion.detectedLang as "es" | "pt"]}
                  </p>
                )}
              </div>
              <div className="flex gap-2">
                <button onClick={dismissVoiceSuggestion}
                  className="flex-1 h-12 rounded-2xl border border-border/50 bg-black/40 text-white/60 text-sm flex items-center justify-center gap-2">
                  <X className="h-4 w-4" /> Save as-is
                </button>
                <button onClick={() => confirmVoiceNote(pendingTranscript, voiceSuggestion)}
                  className="flex-1 h-12 rounded-2xl bg-primary text-primary-foreground text-sm font-bold flex items-center justify-center gap-2">
                  <CheckCircle2 className="h-4 w-4" /> Confirm
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Empty state */}
        {captured.length === 0 && !camera.adjustmentPhase && (
          <div className="absolute inset-0 z-0 flex items-center justify-center pointer-events-none">
            <div className="text-center opacity-30">
              <Camera className="h-14 w-14 text-primary/50 mx-auto mb-3" />
              <p className="text-white/40 text-sm">Tap the shutter to capture evidence</p>
            </div>
          </div>
        )}

        {/* Bottom controls */}
        <div className="relative z-10 mt-auto px-6 pt-4"
          style={{ paddingBottom: 'max(2rem, env(safe-area-inset-bottom, 0px))' }}>
          <div className="text-center mb-5">
            <p className="text-white/25 text-xs">Say {VOICE_COMMANDS[voiceHint]}</p>
          </div>
          {/* Secondary controls: video record/stop + front/rear camera switch */}
          <div className="flex items-center justify-center gap-3 mb-4">
            <button onClick={toggleVideo}
              disabled={camera.permission !== "granted"}
              className={cn(
                "flex items-center gap-2 rounded-full px-4 py-2 border text-sm font-semibold transition-all active:scale-95 disabled:opacity-40",
                camera.isRecordingVideo
                  ? "border-red-500 bg-red-500/25 text-red-100"
                  : "border-white/25 bg-black/40 text-white/80 hover:bg-white/10"
              )}>
              {camera.isRecordingVideo ? (
                <><span className="w-2.5 h-2.5 rounded-sm bg-red-400" /> Stop · {formatTime(camera.videoElapsed)}</>
              ) : (
                <><Video className="h-4 w-4" /> Record video</>
              )}
            </button>
            <button onClick={() => camera.switchCamera()}
              disabled={camera.isRecordingVideo || camera.permission !== "granted"}
              className="flex items-center gap-2 rounded-full px-4 py-2 border border-white/25 bg-black/40 text-white/80 text-sm font-semibold hover:bg-white/10 transition-all active:scale-95 disabled:opacity-40">
              <SwitchCamera className="h-4 w-4" /> {camera.facingMode === "environment" ? "Front" : "Rear"}
            </button>
          </div>

          <div className="flex items-center justify-between gap-4">
            <button onClick={stopRecording}
              disabled={camera.isRecordingVideo}
              className="w-14 h-14 rounded-full border-2 border-red-500/50 bg-red-500/20 flex items-center justify-center transition-all active:scale-95 disabled:opacity-30">
              <div className="w-5 h-5 rounded bg-red-500" />
            </button>

            <button onClick={manualCapture}
              disabled={camera.isRecordingVideo}
              className="w-20 h-20 rounded-full border-4 border-white/80 flex items-center justify-center bg-white/10 hover:bg-white/20 transition-all active:scale-95 disabled:opacity-40">
              <Camera className="h-8 w-8 text-white" />
            </button>

            <button onClick={addVoiceNote}
              disabled={voice.state === "processing" || !!voiceSuggestion || camera.isRecordingVideo}
              className={cn(
                "w-14 h-14 rounded-full border-2 flex items-center justify-center transition-all active:scale-95 disabled:opacity-40",
                voice.state === "listening"
                  ? "border-primary bg-primary/30 animate-pulse"
                  : "border-primary/50 bg-primary/10 hover:bg-primary/20"
              )}>
              <Mic className="h-6 w-6 text-primary" />
            </button>
          </div>
          <p className="text-center text-white/25 text-xs mt-4">
            {camera.isRecordingVideo ? "Recording video — tap Stop to save the clip" : "Tap stop when inspection is complete"}
          </p>
        </div>
      </div>
    );
  }

  // ── STEP 3: REVIEW ────────────────────────────────────────────────────────────
  const additionalInterior = INTERIOR_ZONES.filter(z => !selectedInterior.includes(z));
  const additionalExterior = EXTERIOR_ZONES.filter(z => !selectedExterior.includes(z));
  const hasAdditional = additionalInterior.length > 0 || additionalExterior.length > 0;

  return (
    <div className="max-w-lg mx-auto space-y-5 pt-2 pb-6">
      <div>
        <h1 className="text-xl font-bold flex items-center gap-2">
          <CheckCircle2 className="h-5 w-5 text-emerald-400" />
          Inspection Complete
        </h1>
        <p className="text-muted-foreground text-xs mt-0.5">Review findings and save your record</p>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 gap-2">
        <div className="bg-card border border-border/60 rounded-2xl p-3 text-center">
          <p className="text-xl font-bold text-primary">{captured.filter(c => c.type === "photo").length}</p>
          <p className="text-[10px] text-muted-foreground">Photos</p>
        </div>
        <div className="bg-card border border-border/60 rounded-2xl p-3 text-center">
          <p className="text-xl font-bold text-rose-400">{captured.filter(c => c.type === "video").length}</p>
          <p className="text-[10px] text-muted-foreground">Videos</p>
        </div>
        <div className="bg-card border border-border/60 rounded-2xl p-3 text-center">
          <p className="text-xl font-bold text-emerald-400">{captured.filter(c => c.type === "voice").length}</p>
          <p className="text-[10px] text-muted-foreground">Voice Notes</p>
        </div>
        <div className="bg-card border border-border/60 rounded-2xl p-3 text-center">
          <p className="text-xl font-bold text-foreground">{formatTime(timer)}</p>
          <p className="text-[10px] text-muted-foreground">Duration</p>
        </div>
      </div>

      {/* Zones Visited */}
      {allSelectedZones.length > 0 && (
        <div className="bg-card border border-border/60 rounded-2xl p-4 space-y-3">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
            <MapPin className="h-3.5 w-3.5 text-emerald-400" />
            Zones Visited
            <span className="text-emerald-400 font-bold ml-auto">{allSelectedZones.length}</span>
          </p>
          {selectedInterior.length > 0 && (
            <div>
              <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wider mb-1.5">Interior</p>
              <div className="flex flex-wrap gap-1.5">
                {selectedInterior.map(z => (
                  <span key={z} className="text-[11px] font-medium px-2.5 py-1 rounded-full bg-primary/10 text-primary border border-primary/20">
                    {z}
                  </span>
                ))}
              </div>
            </div>
          )}
          {selectedExterior.length > 0 && (
            <div>
              <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wider mb-1.5">Exterior</p>
              <div className="flex flex-wrap gap-1.5">
                {selectedExterior.map(z => (
                  <span key={z} className="text-[11px] font-medium px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                    {z}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Additional Zones Available */}
      {hasAdditional && (
        <div className="bg-card border border-border/50 rounded-2xl p-4 space-y-3">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
            Additional Zones Available
          </p>
          {additionalInterior.length > 0 && (
            <div>
              <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wider mb-1.5">Interior</p>
              <div className="flex flex-wrap gap-1.5">
                {additionalInterior.map(z => (
                  <span key={z} className="text-[11px] px-2.5 py-1 rounded-full bg-muted/30 text-muted-foreground border border-border/40">
                    {z}
                  </span>
                ))}
              </div>
            </div>
          )}
          {additionalExterior.length > 0 && (
            <div>
              <p className="text-[10px] text-muted-foreground/60 uppercase tracking-wider mb-1.5">Exterior</p>
              <div className="flex flex-wrap gap-1.5">
                {additionalExterior.map(z => (
                  <span key={z} className="text-[11px] px-2.5 py-1 rounded-full bg-muted/30 text-muted-foreground border border-border/40">
                    {z}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Evidence summary */}
      <div className="bg-primary/5 border border-primary/20 rounded-2xl p-4">
        <p className="text-xs font-semibold text-primary/80 uppercase tracking-wider mb-3 flex items-center gap-1.5">
          <Aperture className="h-3.5 w-3.5" /> Evidence Summary
        </p>
        <div className="grid grid-cols-2 gap-x-4 gap-y-2">
          {[
            { label: "Photos", value: captured.filter(c => c.type === "photo").length },
            { label: "Videos", value: captured.filter(c => c.type === "video").length },
            { label: "Voice notes", value: captured.filter(c => c.type === "voice").length },
            { label: "Zones visited", value: allSelectedZones.length },
            { label: "Duration", value: formatTime(timer) },
          ].map(s => (
            <div key={s.label} className="flex justify-between items-center">
              <span className="text-[11px] text-muted-foreground">{s.label}</span>
              <span className="text-xs font-semibold text-foreground">{s.value}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Captured evidence */}
      {captured.filter(c => c.type === "photo").length > 0 && (
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Captured Evidence</p>
          <div className="grid grid-cols-2 gap-2">
            {captured.filter(c => c.type === "photo").map(item => (
              <div key={item.id} className="bg-card border border-border/60 rounded-2xl overflow-hidden">
                {(item.url.startsWith("blob:") || item.url.startsWith("http") || item.url.startsWith("data:")) ? (
                  <img src={item.url} alt="" className="w-full h-28 object-cover" />
                ) : (
                  <div className="w-full h-28 bg-muted/30 flex items-center justify-center">
                    <Camera className="h-6 w-6 text-muted-foreground/30" />
                  </div>
                )}
                <div className="p-2">
                  <p className="text-[10px] text-muted-foreground leading-tight line-clamp-2">{item.label}</p>
                </div>
              </div>
            ))}
          </div>
          {captured.filter(c => c.type === "voice").length > 0 && (
            <div className="mt-2 flex items-center gap-2 bg-card border border-border/60 rounded-2xl px-4 py-3">
              <Mic className="h-4 w-4 text-emerald-400 shrink-0" />
              <span className="text-xs text-muted-foreground">
                {captured.filter(c => c.type === "voice").length} voice note{captured.filter(c => c.type === "voice").length > 1 ? "s" : ""} recorded
              </span>
            </div>
          )}
        </div>
      )}

      {/* Captured videos — playback, delete, recapture */}
      {captured.filter(c => c.type === "video").length > 0 && (
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <Video className="h-3.5 w-3.5 text-rose-400" /> Captured Videos
          </p>
          <div className="space-y-3">
            {captured.filter(c => c.type === "video").map(item => (
              <div key={item.id} className="bg-card border border-border/60 rounded-2xl overflow-hidden">
                <video
                  src={item.url}
                  controls
                  playsInline
                  preload="metadata"
                  className="w-full max-h-56 bg-black"
                />
                <div className="flex items-center gap-2 p-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-foreground truncate">{item.label}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {item.durationSec ? formatTime(item.durationSec) : "0:00"} · recorded {new Date(item.ts).toLocaleTimeString()}
                    </p>
                  </div>
                  <button onClick={() => recaptureVideo(item.id)}
                    className="flex items-center gap-1 text-[11px] font-semibold text-muted-foreground hover:text-foreground border border-border/60 rounded-full px-2.5 py-1.5 transition-colors">
                    <Video className="h-3.5 w-3.5" /> Recapture
                  </button>
                  <button onClick={() => removeCaptured(item.id)}
                    className="flex items-center gap-1 text-[11px] font-semibold text-rose-400 hover:text-rose-300 border border-rose-500/30 rounded-full px-2.5 py-1.5 transition-colors">
                    <Trash2 className="h-3.5 w-3.5" /> Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Voice findings list */}
      {captured.filter(c => c.type === "voice" && c.note).length > 0 && (
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Voice Findings</p>
          <div className="space-y-1.5">
            {captured.filter(c => c.type === "voice" && c.note).map(item => (
              <div key={item.id}
                className="flex items-start gap-3 bg-card border border-border/60 rounded-xl px-3 py-2.5">
                <Mic className="h-4 w-4 text-emerald-400 shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-foreground">{item.note!.professionalTerm}</p>
                  <p className="text-[10px] text-muted-foreground leading-tight">{item.note!.reportPhrase}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {captured.length === 0 && (
        <div className="bg-card border border-border/60 rounded-2xl p-8 text-center text-muted-foreground">
          <Scan className="h-10 w-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No evidence captured during this inspection.</p>
        </div>
      )}

      {uploadError && (
        <div className="bg-destructive/10 border border-destructive/30 rounded-2xl p-4 flex items-start gap-3">
          <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-destructive">Couldn't save evidence</p>
            <p className="text-xs text-muted-foreground mt-0.5">{uploadError} Your captures are still here — tap Retry.</p>
          </div>
        </div>
      )}

      <div className="flex gap-3 pt-2">
        <Button variant="outline" className="flex-1 rounded-xl h-12" onClick={() => navigate("/inspections")}>
          Save Only
        </Button>
        <Button className="flex-1 rounded-xl h-12 font-semibold shadow-lg shadow-primary/20" onClick={handleComplete} disabled={completing}>
          <Zap className="mr-2 h-4 w-4" />
          {completing ? "Saving evidence…" : uploadError ? "Retry upload" : "Save & Review"}
        </Button>
      </div>
    </div>
  );
}
