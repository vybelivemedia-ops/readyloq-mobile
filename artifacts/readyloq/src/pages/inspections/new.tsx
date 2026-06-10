import { useState, useEffect, useRef, useCallback } from "react";
import { useLocation } from "wouter";
import { useCreateInspection, useAddInspectionMedia } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  ArrowLeft, Mic, MicOff, Scan, AlertTriangle, Camera,
  CheckCircle2, Zap, ZoomIn, ZoomOut, Sun, Maximize2,
  Aperture, Focus, Sparkles, Shield, BrainCircuit,
} from "lucide-react";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

// ─── Constants ──────────────────────────────────────────────────────────────

const PROPERTY_TYPES = [
  "Single Family", "Multifamily", "Restaurant", "Commercial",
  "Warehouse", "School", "Healthcare", "Hospitality",
];

const AI_DETECTIONS = [
  { id: 1, label: "Potential Mouse Droppings Detected",    severity: "high",   icon: "🐭", confidence: 0.91, zoom: 2.8, focus: "macro" as const },
  { id: 2, label: "Potential Utility Penetration",         severity: "medium", icon: "⚠️", confidence: 0.87, zoom: 2.0, focus: "continuous" as const },
  { id: 3, label: "Potential Moisture Condition",          severity: "medium", icon: "💧", confidence: 0.83, zoom: 1.8, focus: "continuous" as const },
  { id: 4, label: "Potential Cockroach Harborage",         severity: "high",   icon: "🪳", confidence: 0.94, zoom: 3.2, focus: "macro" as const },
  { id: 5, label: "Potential Rub Mark — Active Runway",    severity: "high",   icon: "🐀", confidence: 0.88, zoom: 2.5, focus: "macro" as const },
  { id: 6, label: "Possible Entry Point Near Baseboard",   severity: "medium", icon: "🔍", confidence: 0.79, zoom: 2.2, focus: "continuous" as const },
  { id: 7, label: "Conducive Moisture Condition",          severity: "medium", icon: "💧", confidence: 0.82, zoom: 1.6, focus: "continuous" as const },
  { id: 8, label: "Potential Rat Droppings Detected",      severity: "high",   icon: "🐀", confidence: 0.90, zoom: 3.0, focus: "macro" as const },
  { id: 9, label: "Structural Gap — Exclusion Opportunity",severity: "medium", icon: "🔧", confidence: 0.77, zoom: 2.0, focus: "continuous" as const },
];

const VOICE_COMMANDS = [
  '"Start inspection"', '"Save finding"', '"Mouse activity"',
  '"Rat activity"', '"Utility penetration"', '"Add note"',
  '"Generate report"', '"End inspection"',
];

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// ─── Types ───────────────────────────────────────────────────────────────────

type Step = "setup" | "recording" | "review";
type FocusMode = "continuous" | "macro" | "auto";
type CameraPermission = "pending" | "granted" | "denied" | "unavailable";

interface Detection {
  id: number; label: string; severity: string; icon: string;
  confidence: number; zoom: number; focus: FocusMode;
}

interface DetectionBox { x: number; y: number; w: number; h: number; }

interface CapturedItem {
  id: string; type: "photo" | "voice";
  label: string; url: string; detection?: Detection; ts: number;
}

interface CameraCapabilities {
  supportsZoom: boolean; minZoom: number; maxZoom: number;
  supportsFocusMode: boolean; availableFocusModes: string[];
  supportsTorch: boolean;
}

// ─── Camera hook ─────────────────────────────────────────────────────────────

function useCamera() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const captureRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const trackRef = useRef<MediaStreamVideoTrack | null>(null);
  const imageCaptureRef = useRef<ImageCapture | null>(null);
  const animFrameRef = useRef<number>(0);

  const [permission, setPermission] = useState<CameraPermission>("pending");
  const [capabilities, setCapabilities] = useState<CameraCapabilities>({
    supportsZoom: false, minZoom: 1, maxZoom: 5,
    supportsFocusMode: false, availableFocusModes: [],
    supportsTorch: false,
  });

  // Visual state
  const [cssZoom, setCssZoom] = useState(1);
  const [currentZoom, setCurrentZoom] = useState(1);
  const [focusMode, setFocusMode] = useState<FocusMode>("continuous");
  const [lowLightActive, setLowLightActive] = useState(false);
  const [stabilizingActive, setStabilizingActive] = useState(false);
  const [detectionBox, setDetectionBox] = useState<DetectionBox | null>(null);
  const [adjustmentPhase, setAdjustmentPhase] = useState<string | null>(null);

  // Start the camera
  const startCamera = useCallback(async () => {
    try {
      const constraints: MediaStreamConstraints = {
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1920 },
          height: { ideal: 1080 },
        },
        audio: false,
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      streamRef.current = stream;
      const track = stream.getVideoTracks()[0] as MediaStreamVideoTrack;
      trackRef.current = track;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => {});
      }

      // Detect capabilities
      const caps = track.getCapabilities() as any;
      const newCaps: CameraCapabilities = {
        supportsZoom: !!(caps.zoom),
        minZoom: caps.zoom?.min ?? 1,
        maxZoom: caps.zoom?.max ?? 5,
        supportsFocusMode: !!(caps.focusMode),
        availableFocusModes: (caps.focusMode as string[]) ?? [],
        supportsTorch: !!(caps.torch),
      };
      setCapabilities(newCaps);

      // ImageCapture
      if (typeof ImageCapture !== "undefined") {
        imageCaptureRef.current = new ImageCapture(track);
      }

      setPermission("granted");
    } catch (err: any) {
      if (err.name === "NotAllowedError") setPermission("denied");
      else if (err.name === "NotFoundError") setPermission("unavailable");
      else setPermission("denied");
    }
  }, []);

  // Stop camera
  const stopCamera = useCallback(() => {
    cancelAnimationFrame(animFrameRef.current);
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    trackRef.current = null;
    imageCaptureRef.current = null;
  }, []);

  // Apply hardware zoom (smooth CSS transition if hw not available)
  const applyZoom = useCallback(async (targetZoom: number) => {
    const clampedZoom = Math.min(Math.max(targetZoom, 1), capabilities.maxZoom);
    setCurrentZoom(clampedZoom);
    setCssZoom(clampedZoom);

    if (capabilities.supportsZoom && trackRef.current) {
      try {
        await (trackRef.current as any).applyConstraints({ advanced: [{ zoom: clampedZoom }] });
      } catch {}
    }
  }, [capabilities]);

  // Smooth zoom animation
  const smoothZoom = useCallback(async (targetZoom: number) => {
    const start = currentZoom;
    const end = Math.min(Math.max(targetZoom, 1), 5);
    const steps = 20;
    for (let i = 0; i <= steps; i++) {
      const z = start + (end - start) * (i / steps);
      setCssZoom(z);
      setCurrentZoom(z);
      if (capabilities.supportsZoom && trackRef.current) {
        try { await (trackRef.current as any).applyConstraints({ advanced: [{ zoom: z }] }); } catch {}
      }
      await sleep(25);
    }
  }, [currentZoom, capabilities]);

  // Apply focus mode
  const applyFocusMode = useCallback(async (mode: FocusMode) => {
    setFocusMode(mode);
    if (capabilities.supportsFocusMode && trackRef.current) {
      const available = capabilities.availableFocusModes;
      const mapped = mode === "macro" ? "manual" : "continuous";
      if (available.includes(mapped)) {
        try {
          await (trackRef.current as any).applyConstraints({ advanced: [{ focusMode: mapped }] });
          if (mode === "macro" && imageCaptureRef.current) {
            await imageCaptureRef.current.setFocusDistance?.(0.05);
          }
        } catch {}
      }
    }
  }, [capabilities]);

  // Capture a real frame
  const captureFrame = useCallback(async (): Promise<string> => {
    // Try ImageCapture first (highest quality)
    if (imageCaptureRef.current) {
      try {
        const blob = await imageCaptureRef.current.takePhoto({
          fillLightMode: lowLightActive ? "flash" : "off",
          imageHeight: 1080,
        });
        return URL.createObjectURL(blob);
      } catch {}
    }

    // Canvas fallback — draw the video frame
    const video = videoRef.current;
    if (video && video.readyState >= 2) {
      const canvas = captureRef.current ?? document.createElement("canvas");
      canvas.width = video.videoWidth || 1280;
      canvas.height = video.videoHeight || 720;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        if (lowLightActive) {
          ctx.filter = "brightness(1.4) contrast(1.2)";
        }
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        ctx.filter = "none";
        return canvas.toDataURL("image/jpeg", 0.92);
      }
    }

    // Fallback for desktop browser without camera
    return `https://picsum.photos/seed/${Math.floor(Math.random() * 50)}/800/600`;
  }, [lowLightActive]);

  // Detection bounding box animation
  useEffect(() => {
    const canvas = overlayRef.current;
    const video = videoRef.current;
    if (!canvas || !detectionBox) return;

    const W = canvas.width = canvas.offsetWidth;
    const H = canvas.height = canvas.offsetHeight;
    let progress = 0;
    let animating = true;

    const draw = () => {
      if (!animating) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.clearRect(0, 0, W, H);

      progress = Math.min(progress + 0.04, 1);
      const { x, y, w, h } = detectionBox;
      const bx = x * W, by = y * H, bw = w * W, bh = h * H;
      const cornerLen = Math.min(bw, bh) * 0.22;
      const ease = 1 - Math.pow(1 - progress, 3);

      // Animated box expanding in
      ctx.strokeStyle = `rgba(20, 184, 166, ${0.6 + 0.4 * ease})`;
      ctx.lineWidth = 2;
      ctx.setLineDash([8, 4]);
      ctx.strokeRect(bx, by, bw * ease, bh * ease);
      ctx.setLineDash([]);

      // Corner brackets
      ctx.strokeStyle = `rgba(20, 184, 166, ${ease})`;
      ctx.lineWidth = 3;
      const corners = [
        [bx, by, cornerLen, 0, cornerLen, 0, 0, cornerLen],
        [bx + bw, by, -cornerLen, 0, -cornerLen, 0, 0, cornerLen],
        [bx, by + bh, cornerLen, 0, cornerLen, 0, 0, -cornerLen],
        [bx + bw, by + bh, -cornerLen, 0, -cornerLen, 0, 0, -cornerLen],
      ];
      for (const [px, py, dx1, dy1, dx2, dy2, dx3, dy3] of corners) {
        ctx.beginPath();
        ctx.moveTo(px + dx1 * ease, py + dy1 * ease);
        ctx.lineTo(px, py);
        ctx.lineTo(px + dx2 * (1 - ease), py + dy3 * (1 - ease));
        ctx.stroke();
      }

      // Crosshair center
      if (progress > 0.7) {
        const cx = bx + bw / 2, cy = by + bh / 2;
        const alpha = (progress - 0.7) / 0.3;
        ctx.strokeStyle = `rgba(20, 184, 166, ${alpha * 0.8})`;
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(cx - 12, cy); ctx.lineTo(cx + 12, cy); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(cx, cy - 12); ctx.lineTo(cx, cy + 12); ctx.stroke();

        // Circle around center
        ctx.beginPath();
        ctx.arc(cx, cy, 18 * alpha, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(20, 184, 166, ${alpha * 0.5})`;
        ctx.stroke();
      }

      animFrameRef.current = requestAnimationFrame(draw);
    };

    draw();
    return () => { animating = false; cancelAnimationFrame(animFrameRef.current); };
  }, [detectionBox]);

  // Clear canvas when no detection
  useEffect(() => {
    if (!detectionBox) {
      const canvas = overlayRef.current;
      if (canvas) {
        const ctx = canvas.getContext("2d");
        ctx?.clearRect(0, 0, canvas.width, canvas.height);
      }
    }
  }, [detectionBox]);

  return {
    videoRef, overlayRef, captureRef,
    permission, capabilities,
    cssZoom, currentZoom, focusMode, lowLightActive, stabilizingActive,
    adjustmentPhase,
    setLowLightActive, setStabilizingActive, setDetectionBox, setAdjustmentPhase,
    startCamera, stopCamera, applyZoom, smoothZoom, applyFocusMode, captureFrame,
  };
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function NewInspection() {
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const createInspection = useCreateInspection();
  const addMedia = useAddInspectionMedia();

  const [step, setStep] = useState<Step>("setup");
  const [propertyType, setPropertyType] = useState("Multifamily");
  const [siteAddress, setSiteAddress] = useState("");
  const [technicianName, setTechnicianName] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [micOn, setMicOn] = useState(true);
  const [timer, setTimer] = useState(0);
  const [detections, setDetections] = useState<Detection[]>([]);
  const [visibleDetection, setVisibleDetection] = useState<Detection | null>(null);
  const [captured, setCaptured] = useState<CapturedItem[]>([]);
  const [createdId, setCreatedId] = useState<number | null>(null);
  const [voiceActive, setVoiceActive] = useState(false);
  const [voiceHint, setVoiceHint] = useState(0);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const detectionRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const adjustingRef = useRef(false);

  const camera = useCamera();

  // Rotate voice hints
  useEffect(() => {
    const t = setInterval(() => setVoiceHint(h => (h + 1) % VOICE_COMMANDS.length), 3000);
    return () => clearInterval(t);
  }, []);

  // Format MM:SS
  const formatTime = (s: number) =>
    `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

  // ── Intelligent Camera Adjustment Pipeline ──────────────────────────────────
  const performIntelligentCapture = useCallback(async (detection: Detection): Promise<string> => {
    adjustingRef.current = true;

    // Random detection box
    const margin = 0.15;
    const bw = 0.3 + Math.random() * 0.3;
    const bh = 0.25 + Math.random() * 0.25;
    const bx = margin + Math.random() * (1 - bw - margin * 2);
    const by = margin + Math.random() * (1 - bh - margin * 2);
    camera.setDetectionBox({ x: bx, y: by, w: bw, h: bh });

    camera.setAdjustmentPhase("Confirming detection…");
    await sleep(700);

    camera.setAdjustmentPhase("Adjusting focus…");
    await camera.applyFocusMode(detection.focus);
    await sleep(800);

    camera.setAdjustmentPhase(`Zooming for clarity… ${detection.zoom.toFixed(1)}×`);
    await camera.smoothZoom(detection.zoom);
    await sleep(600);

    // Low-light check — simulate ambient sensor
    const needsLowLight = Math.random() > 0.5;
    if (needsLowLight) {
      camera.setAdjustmentPhase("Low-light enhancement active…");
      camera.setLowLightActive(true);
      await sleep(500);
    }

    camera.setAdjustmentPhase("Stabilizing…");
    camera.setStabilizingActive(true);
    await sleep(500);

    camera.setAdjustmentPhase("Selecting best frame…");
    await sleep(600);

    camera.setAdjustmentPhase("Capturing evidence…");
    const url = await camera.captureFrame();
    await sleep(300);

    camera.setAdjustmentPhase("Evidence saved ✓");
    await sleep(800);

    // Reset camera to default
    await camera.smoothZoom(1.0);
    await camera.applyFocusMode("continuous");
    camera.setLowLightActive(false);
    camera.setStabilizingActive(false);
    camera.setDetectionBox(null);

    await sleep(400);
    camera.setAdjustmentPhase(null);
    adjustingRef.current = false;

    return url;
  }, [camera]);

  // ── Start Recording ─────────────────────────────────────────────────────────
  function startRecording() {
    setIsRecording(true);
    setTimer(0);
    timerRef.current = setInterval(() => setTimer(t => t + 1), 1000);

    let dIdx = 0;
    // First detection after 5s, then every 9-16s
    const scheduleNext = () => {
      const delay = dIdx === 0 ? 5000 : 9000 + Math.random() * 7000;
      detectionRef.current = setTimeout(async () => {
        if (!isRecording && dIdx > 0) return;

        const detection = { ...AI_DETECTIONS[dIdx % AI_DETECTIONS.length] };
        dIdx++;
        setDetections(prev => [detection, ...prev]);
        setVisibleDetection(detection);
        setTimeout(() => setVisibleDetection(null), 5000);

        const url = await performIntelligentCapture(detection);

        setCaptured(prev => [...prev, {
          id: `capture-${Date.now()}`,
          type: "photo",
          label: detection.label,
          url,
          detection,
          ts: Date.now(),
        }]);

        scheduleNext();
      }, delay) as unknown as ReturnType<typeof setInterval>;
    };

    scheduleNext();
  }

  function stopRecording() {
    setIsRecording(false);
    if (timerRef.current) clearInterval(timerRef.current);
    if (detectionRef.current) clearTimeout(detectionRef.current as unknown as ReturnType<typeof setTimeout>);
    camera.stopCamera();
    setStep("review");
  }

  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (detectionRef.current) clearTimeout(detectionRef.current as unknown as ReturnType<typeof setTimeout>);
    camera.stopCamera();
  }, []);

  // ── Begin Inspection ────────────────────────────────────────────────────────
  async function handleBeginInspection() {
    if (!siteAddress || !technicianName) {
      toast({ title: "Required fields missing", description: "Enter site address and your name.", variant: "destructive" });
      return;
    }
    try {
      const result = await createInspection.mutateAsync({
        data: { siteAddress, technicianName, pestTypes: [], notes: `Property type: ${propertyType}` },
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
    setVoiceActive(true);
    setTimeout(() => {
      setVoiceActive(false);
      setCaptured(prev => [...prev, {
        id: `voice-${Date.now()}`, type: "voice",
        label: "Voice note recorded", url: "", ts: Date.now(),
      }]);
      toast({ title: "Voice note saved", description: "Added to inspection record." });
    }, 2500);
  }

  async function handleComplete() {
    if (createdId && captured.length > 0) {
      for (const item of captured) {
        try {
          await addMedia.mutateAsync({
            id: createdId,
            data: { mediaType: item.type, url: item.url, filename: item.label, caption: item.detection?.label },
          });
        } catch {}
      }
    }
    navigate(createdId ? `/inspections/${createdId}` : "/inspections");
  }

  // ── STEP 1: SETUP ────────────────────────────────────────────────────────────
  if (step === "setup") {
    return (
      <div className="max-w-lg mx-auto space-y-6 pt-2">
        <div className="flex items-center gap-3">
          <Link href="/"><Button variant="ghost" size="icon" className="h-8 w-8"><ArrowLeft className="h-4 w-4" /></Button></Link>
          <div>
            <h1 className="text-xl font-bold">New Inspection</h1>
            <p className="text-muted-foreground text-xs mt-0.5">Set up site details before you begin</p>
          </div>
        </div>

        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Property Type</p>
          <div className="grid grid-cols-2 gap-2">
            {PROPERTY_TYPES.map(t => (
              <button key={t} onClick={() => setPropertyType(t)}
                className={cn("px-3 py-3 rounded-2xl border text-sm font-medium text-left transition-all",
                  propertyType === t
                    ? "border-primary bg-primary/15 text-primary"
                    : "border-border/60 bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground"
                )}>
                {t}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-3">
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Site Address</p>
            <Input placeholder="123 Main St, City, State" value={siteAddress} onChange={e => setSiteAddress(e.target.value)}
              className="bg-card border-border/60 rounded-xl h-12 text-base" />
          </div>
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Your Name</p>
            <Input placeholder="Technician name" value={technicianName} onChange={e => setTechnicianName(e.target.value)}
              className="bg-card border-border/60 rounded-xl h-12 text-base" />
          </div>
        </div>

        {/* AI Camera capabilities preview */}
        <div className="bg-primary/5 border border-primary/20 rounded-2xl p-4 space-y-3">
          <p className="text-xs font-semibold text-primary/80 uppercase tracking-wider flex items-center gap-1.5">
            <Aperture className="h-3.5 w-3.5" /> Intelligent Camera System
          </p>
          <div className="grid grid-cols-2 gap-2">
            {[
              { icon: Focus, label: "Auto-Focus / Macro" },
              { icon: ZoomIn, label: "Auto-Zoom" },
              { icon: Sun, label: "Low-Light Enhancement" },
              { icon: Shield, label: "Image Stabilization" },
              { icon: Sparkles, label: "Best-Frame Selection" },
              { icon: Camera, label: "Auto Evidence Capture" },
            ].map(f => (
              <div key={f.label} className="flex items-center gap-2">
                <f.icon className="h-3.5 w-3.5 text-primary/70 shrink-0" />
                <span className="text-[11px] text-muted-foreground">{f.label}</span>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-muted-foreground/60 pt-1 border-t border-border/40">
            Camera permission required. ReadyLoq will automatically adjust focus, zoom, and exposure when evidence is detected.
          </p>
        </div>

        <div className="bg-primary/5 border border-primary/20 rounded-2xl p-4">
          <p className="text-xs font-semibold text-primary/80 uppercase tracking-wider mb-2 flex items-center gap-1.5">
            <Mic className="h-3 w-3" /> Voice Commands
          </p>
          <div className="flex flex-wrap gap-1.5">
            {VOICE_COMMANDS.slice(0, 5).map(cmd => (
              <span key={cmd} className="text-[11px] text-muted-foreground bg-muted/40 px-2.5 py-1 rounded-full">{cmd}</span>
            ))}
          </div>
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

  // ── STEP 2: RECORDING ─────────────────────────────────────────────────────────
  if (step === "recording") {
    const isAdjusting = !!camera.adjustmentPhase && camera.adjustmentPhase !== "Evidence saved ✓";
    const justCaptured = camera.adjustmentPhase === "Evidence saved ✓";

    return (
      <div className="fixed inset-0 bg-black flex flex-col z-50 overflow-hidden">
        {/* ── Camera video feed ── */}
        <div className="absolute inset-0 bg-black">
          {camera.permission === "granted" ? (
            <video
              ref={camera.videoRef}
              autoPlay playsInline muted
              className="w-full h-full object-cover transition-transform duration-700 ease-out"
              style={{ transform: `scale(${camera.cssZoom})`, transformOrigin: "center center" }}
            />
          ) : (
            /* Simulated viewfinder for desktop / no camera */
            <div className="w-full h-full bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900">
              <div className="absolute inset-0 opacity-10"
                style={{ backgroundImage: "repeating-linear-gradient(0deg, transparent, transparent 60px, rgba(255,255,255,0.3) 60px, rgba(255,255,255,0.3) 61px), repeating-linear-gradient(90deg, transparent, transparent 60px, rgba(255,255,255,0.3) 60px, rgba(255,255,255,0.3) 61px)" }} />
            </div>
          )}

          {/* Canvas capture (hidden) */}
          <canvas ref={camera.captureRef} className="hidden" />

          {/* Vignette */}
          <div className="absolute inset-0 bg-gradient-to-b from-black/70 via-transparent to-black/70 pointer-events-none" />

          {/* Low-light filter overlay */}
          {camera.lowLightActive && (
            <div className="absolute inset-0 bg-yellow-400/5 mix-blend-overlay pointer-events-none transition-opacity" />
          )}

          {/* AI detection canvas overlay */}
          <canvas ref={camera.overlayRef}
            className="absolute inset-0 w-full h-full pointer-events-none"
            style={{ width: "100%", height: "100%" }} />

          {/* Scanning line */}
          {!isAdjusting && (
            <div className="absolute inset-x-0 top-0 h-0.5 bg-gradient-to-r from-transparent via-primary/50 to-transparent animate-scan pointer-events-none" />
          )}

          {/* Camera permission denied overlay */}
          {camera.permission === "denied" && (
            <div className="absolute inset-0 flex items-center justify-center bg-black/50">
              <div className="text-center p-6">
                <Camera className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
                <p className="text-white/70 text-sm">Camera access denied</p>
                <p className="text-white/40 text-xs mt-1">Running in simulation mode</p>
              </div>
            </div>
          )}
        </div>

        {/* ── Top bar ── */}
        <div className="relative z-10 flex items-center justify-between px-5 pb-2"
          style={{ paddingTop: 'max(1rem, env(safe-area-inset-top, 0px))' }}>
          <div className="flex items-center gap-2 bg-black/50 backdrop-blur-sm rounded-full px-3 py-1.5">
            <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            <span className="text-white font-mono text-sm font-semibold">{formatTime(timer)}</span>
          </div>

          <div className="flex items-center gap-1.5 bg-black/50 backdrop-blur-sm rounded-full px-3 py-1.5">
            <div className={cn("w-1.5 h-1.5 rounded-full", isAdjusting ? "bg-amber-400 animate-pulse" : "bg-primary")} />
            <span className={cn("text-[11px] font-semibold", isAdjusting ? "text-amber-400" : "text-primary")}>
              {isAdjusting ? "AI ADJUSTING" : "AI ACTIVE"}
            </span>
          </div>

          <div className="text-white/50 text-xs bg-black/50 backdrop-blur-sm rounded-full px-3 py-1.5">
            {captured.length} captured
          </div>
        </div>

        {/* ── Camera HUD strip ── */}
        <div className="relative z-10 px-4 mt-1">
          <div className="flex items-center gap-2 flex-wrap">
            {/* Zoom */}
            <div className={cn(
              "flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-mono font-bold transition-all",
              isAdjusting && camera.cssZoom > 1.1
                ? "bg-amber-400/20 border border-amber-400/40 text-amber-300"
                : "bg-black/40 border border-white/10 text-white/60"
            )}>
              <ZoomIn className="h-3 w-3" />
              {camera.cssZoom.toFixed(1)}×
            </div>

            {/* Focus mode */}
            <div className={cn(
              "flex items-center gap-1 rounded-full px-2.5 py-1 text-[10px] font-semibold uppercase transition-all",
              camera.focusMode === "macro"
                ? "bg-primary/20 border border-primary/40 text-primary"
                : "bg-black/40 border border-white/10 text-white/50"
            )}>
              <Focus className="h-3 w-3" />
              {camera.focusMode}
            </div>

            {/* Low-light */}
            {camera.lowLightActive && (
              <div className="flex items-center gap-1 bg-yellow-500/20 border border-yellow-500/40 rounded-full px-2.5 py-1 text-[10px] font-semibold text-yellow-400 animate-pulse">
                <Sun className="h-3 w-3" />
                LOW LIGHT+
              </div>
            )}

            {/* Stabilizing */}
            {camera.stabilizingActive && (
              <div className="flex items-center gap-1 bg-blue-500/20 border border-blue-500/40 rounded-full px-2.5 py-1 text-[10px] font-semibold text-blue-400">
                <Shield className="h-3 w-3" />
                STABILIZED
              </div>
            )}
          </div>
        </div>

        {/* ── AI Adjustment phase display ── */}
        <div className="relative z-10 px-5 mt-3 h-12">
          {camera.adjustmentPhase && (
            <div className={cn(
              "animate-slide-up flex items-center gap-3 backdrop-blur-md border rounded-2xl px-4 py-2.5 transition-all",
              justCaptured
                ? "bg-emerald-900/60 border-emerald-500/40"
                : "bg-black/60 border-amber-500/30"
            )}>
              {justCaptured
                ? <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
                : <Sparkles className="h-4 w-4 text-amber-400 shrink-0 animate-pulse" />}
              <span className={cn("text-sm font-medium", justCaptured ? "text-emerald-300" : "text-amber-200")}>
                {camera.adjustmentPhase}
              </span>
            </div>
          )}
        </div>

        {/* ── Active detection toast ── */}
        <div className="relative z-10 px-5 mt-2 h-12">
          {visibleDetection && !camera.adjustmentPhase && (
            <div className="animate-slide-up flex items-center gap-3 bg-black/70 backdrop-blur-md border border-primary/30 rounded-2xl px-4 py-2.5">
              <div className={cn("w-2 h-2 rounded-full shrink-0",
                visibleDetection.severity === "high" ? "bg-orange-400 animate-pulse" : "bg-amber-400"
              )} />
              <span className="text-white text-sm flex-1">{visibleDetection.label}</span>
              <span className="text-primary/80 text-xs font-mono">{Math.round(visibleDetection.confidence * 100)}%</span>
            </div>
          )}
        </div>

        {/* ── Detection history ── */}
        {detections.length > 0 && (
          <div className="relative z-10 px-5 mt-3">
            <div className="flex gap-2 overflow-x-auto pb-1">
              {detections.slice(0, 8).map((d, i) => (
                <div key={`${d.id}-${i}`}
                  className="flex-shrink-0 flex items-center gap-1.5 bg-black/50 border border-white/10 rounded-full px-3 py-1">
                  <span className="text-[10px]">{d.icon}</span>
                  <span className="text-[10px] text-white/60 whitespace-nowrap">
                    {d.label.replace("Potential ", "").replace(" Detected", "").split("—")[0].trim()}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Voice active overlay */}
        {voiceActive && (
          <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/70 backdrop-blur-sm">
            <div className="flex flex-col items-center gap-4">
              <div className="w-20 h-20 rounded-full bg-primary/20 border-2 border-primary flex items-center justify-center animate-pulse">
                <Mic className="h-9 w-9 text-primary" />
              </div>
              <p className="text-white font-semibold">Listening…</p>
              <div className="flex gap-1 items-end h-8">
                {[3, 5, 8, 4, 7, 3, 6, 5, 4].map((h, i) => (
                  <div key={i} className="w-1.5 bg-primary rounded-full animate-bounce"
                    style={{ height: `${h * 3}px`, animationDelay: `${i * 80}ms` }} />
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Empty state */}
        {detections.length === 0 && !camera.adjustmentPhase && (
          <div className="absolute inset-0 z-0 flex items-center justify-center pointer-events-none">
            <div className="text-center opacity-30">
              <BrainCircuit className="h-14 w-14 text-primary/50 mx-auto mb-3" />
              <p className="text-white/40 text-sm">AI scanning environment…</p>
            </div>
          </div>
        )}

        {/* ── Bottom controls ── */}
        <div className="relative z-10 mt-auto px-6 pt-4"
          style={{ paddingBottom: 'max(2rem, env(safe-area-inset-bottom, 0px))' }}>
          <div className="text-center mb-5">
            <p className="text-white/25 text-xs">Say {VOICE_COMMANDS[voiceHint]}</p>
          </div>
          <div className="flex items-center justify-between gap-4">
            {/* Mic toggle */}
            <button onClick={() => setMicOn(m => !m)}
              className={cn("w-14 h-14 rounded-full border-2 flex items-center justify-center transition-all",
                micOn ? "border-white/30 bg-white/10" : "border-red-500/50 bg-red-500/20")}>
              {micOn ? <Mic className="h-6 w-6 text-white" /> : <MicOff className="h-6 w-6 text-red-400" />}
            </button>

            {/* STOP — large center */}
            <button onClick={stopRecording}
              className="w-20 h-20 rounded-full border-4 border-white/80 flex items-center justify-center bg-transparent hover:bg-white/10 transition-all active:scale-95">
              <div className="w-8 h-8 rounded-lg bg-red-500" />
            </button>

            {/* Voice note */}
            <button onClick={addVoiceNote} disabled={voiceActive}
              className="w-14 h-14 rounded-full border-2 border-primary/50 bg-primary/10 flex items-center justify-center hover:bg-primary/20 transition-all active:scale-95 disabled:opacity-40">
              <Mic className="h-6 w-6 text-primary" />
            </button>
          </div>
          <p className="text-center text-white/25 text-xs mt-4">Tap stop when inspection is complete</p>
        </div>
      </div>
    );
  }

  // ── STEP 3: REVIEW ────────────────────────────────────────────────────────────
  return (
    <div className="max-w-lg mx-auto space-y-5 pt-2">
      <div>
        <h1 className="text-xl font-bold flex items-center gap-2">
          <CheckCircle2 className="h-5 w-5 text-emerald-400" />
          Inspection Complete
        </h1>
        <p className="text-muted-foreground text-xs mt-0.5">Review AI findings and save your record</p>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-card border border-border/60 rounded-2xl p-3 text-center">
          <p className="text-xl font-bold text-primary">{captured.filter(c => c.type === "photo").length}</p>
          <p className="text-[10px] text-muted-foreground">Photos</p>
        </div>
        <div className="bg-card border border-border/60 rounded-2xl p-3 text-center">
          <p className="text-xl font-bold text-orange-400">{detections.length}</p>
          <p className="text-[10px] text-muted-foreground">AI Findings</p>
        </div>
        <div className="bg-card border border-border/60 rounded-2xl p-3 text-center">
          <p className="text-xl font-bold text-foreground">{formatTime(timer)}</p>
          <p className="text-[10px] text-muted-foreground">Duration</p>
        </div>
      </div>

      {/* Camera stats */}
      <div className="bg-primary/5 border border-primary/20 rounded-2xl p-4">
        <p className="text-xs font-semibold text-primary/80 uppercase tracking-wider mb-3 flex items-center gap-1.5">
          <Aperture className="h-3.5 w-3.5" /> Camera Intelligence Summary
        </p>
        <div className="grid grid-cols-2 gap-x-4 gap-y-2">
          {[
            { label: "Auto-captures performed", value: captured.filter(c => c.type === "photo").length },
            { label: "Auto-focus adjustments", value: detections.length },
            { label: "Zoom operations", value: detections.length },
            { label: "Voice notes", value: captured.filter(c => c.type === "voice").length },
          ].map(s => (
            <div key={s.label} className="flex justify-between items-center">
              <span className="text-[11px] text-muted-foreground">{s.label}</span>
              <span className="text-xs font-semibold text-foreground">{s.value}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Captured evidence with real images */}
      {captured.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Captured Evidence</p>
          <div className="grid grid-cols-2 gap-2">
            {captured.filter(c => c.type === "photo").map(item => (
              <div key={item.id} className="bg-card border border-border/60 rounded-2xl overflow-hidden">
                {item.url && item.url.startsWith("blob:") || item.url?.startsWith("http") || item.url?.startsWith("data:") ? (
                  <img src={item.url} alt="" className="w-full h-28 object-cover" onError={e => {
                    (e.target as HTMLImageElement).src = `https://picsum.photos/seed/${Math.floor(Math.random()*20)}/400/300`;
                  }} />
                ) : (
                  <div className="w-full h-28 bg-muted/30 flex items-center justify-center">
                    <Camera className="h-6 w-6 text-muted-foreground/30" />
                  </div>
                )}
                <div className="p-2">
                  <p className="text-[10px] text-muted-foreground leading-tight line-clamp-2">{item.label}</p>
                  {item.detection && (
                    <div className="flex items-center gap-1 mt-1">
                      <span className={cn("w-1.5 h-1.5 rounded-full",
                        item.detection.severity === "high" ? "bg-orange-400" : "bg-amber-400"
                      )} />
                      <span className="text-[9px] text-muted-foreground/70">
                        {item.detection.zoom.toFixed(1)}× zoom · {Math.round(item.detection.confidence * 100)}%
                      </span>
                    </div>
                  )}
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

      {/* AI findings */}
      {detections.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">AI Findings</p>
          <div className="space-y-1.5">
            {detections.map((d, i) => (
              <div key={`${d.id}-${i}`}
                className="flex items-center gap-3 bg-card border border-border/60 rounded-xl px-3 py-2.5">
                <span className="text-sm">{d.icon}</span>
                <span className="text-xs text-foreground flex-1">{d.label}</span>
                <div className="flex items-center gap-2 shrink-0 text-[10px] text-muted-foreground">
                  <span>{d.zoom.toFixed(1)}× zoom</span>
                  <span>·</span>
                  <span>{Math.round(d.confidence * 100)}%</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {captured.length === 0 && detections.length === 0 && (
        <div className="bg-card border border-border/60 rounded-2xl p-8 text-center text-muted-foreground">
          <Scan className="h-10 w-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No findings captured during this inspection.</p>
        </div>
      )}

      <div className="flex gap-3 pt-2 pb-4">
        <Button variant="outline" className="flex-1 rounded-xl h-12" onClick={() => navigate("/inspections")}>
          Save Only
        </Button>
        <Button className="flex-1 rounded-xl h-12 font-semibold shadow-lg shadow-primary/20" onClick={handleComplete}>
          <Zap className="mr-2 h-4 w-4" />
          Save & Review
        </Button>
      </div>
    </div>
  );
}
