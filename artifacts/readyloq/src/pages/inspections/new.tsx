import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { useCreateInspection, useAddInspectionMedia } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowLeft, Mic, MicOff, Square, Scan, AlertTriangle, Camera, Video, ChevronRight, X, CheckCircle2, Zap } from "lucide-react";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const PEST_TYPES = ["Rodents", "Cockroaches", "Ants", "Termites", "Bed Bugs", "Flies", "Spiders", "Wildlife"];

const PROPERTY_TYPES = [
  "Single Family",
  "Multifamily",
  "Restaurant",
  "Commercial",
  "Warehouse",
  "School",
  "Healthcare",
  "Hospitality",
];

const AI_DETECTIONS = [
  { id: 1, label: "Potential Mouse Droppings Detected", severity: "high", icon: "🐭", confidence: 0.91 },
  { id: 2, label: "Potential Utility Penetration Detected", severity: "medium", icon: "⚠️", confidence: 0.87 },
  { id: 3, label: "Potential Moisture Condition Detected", severity: "medium", icon: "💧", confidence: 0.83 },
  { id: 4, label: "Potential Cockroach Harborage Detected", severity: "high", icon: "🪳", confidence: 0.94 },
  { id: 5, label: "Potential Rub Mark — Active Runway", severity: "high", icon: "🐀", confidence: 0.88 },
  { id: 6, label: "Possible Entry Point Near Baseboard", severity: "medium", icon: "🔍", confidence: 0.79 },
  { id: 7, label: "Conducive Moisture Condition Detected", severity: "medium", icon: "💧", confidence: 0.82 },
];

const VOICE_COMMANDS = [
  '"Start inspection"',
  '"Save finding"',
  '"Mouse activity"',
  '"Rat activity"',
  '"Utility penetration"',
  '"Add note"',
  '"Generate report"',
  '"End inspection"',
];

type Step = "setup" | "recording" | "review";

interface Detection {
  id: number;
  label: string;
  severity: string;
  icon: string;
  confidence: number;
  ts: number;
}

interface CapturedItem {
  id: string;
  type: "photo" | "voice" | "video";
  label: string;
  url: string;
  detection?: Detection;
  ts: number;
}

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

  // Rotate voice hints
  useEffect(() => {
    const t = setInterval(() => setVoiceHint(h => (h + 1) % VOICE_COMMANDS.length), 3000);
    return () => clearInterval(t);
  }, []);

  function startRecording() {
    setIsRecording(true);
    setTimer(0);
    timerRef.current = setInterval(() => setTimer(t => t + 1), 1000);

    // Simulate AI detections every 8-14 seconds
    let dIdx = 0;
    detectionRef.current = setInterval(() => {
      const detection = { ...AI_DETECTIONS[dIdx % AI_DETECTIONS.length], ts: Date.now() };
      dIdx++;
      setDetections(prev => [detection, ...prev]);
      setVisibleDetection(detection);

      // Auto capture "photo"
      const seeds = ["pest1", "pest2", "pest3", "rat1", "bug1", "roach1", "entry1", "moisture1"];
      const seed = seeds[Math.floor(Math.random() * seeds.length)];
      setCaptured(prev => [...prev, {
        id: `auto-${Date.now()}`,
        type: "photo",
        label: `Auto-capture: ${detection.label}`,
        url: `https://picsum.photos/seed/${seed}/400/300`,
        detection,
        ts: Date.now(),
      }]);

      setTimeout(() => setVisibleDetection(null), 4500);
    }, Math.random() * 6000 + 8000);
  }

  function stopRecording() {
    setIsRecording(false);
    if (timerRef.current) clearInterval(timerRef.current);
    if (detectionRef.current) clearInterval(detectionRef.current);
    setStep("review");
  }

  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (detectionRef.current) clearInterval(detectionRef.current);
  }, []);

  const formatTime = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

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
      startRecording();
    } catch {
      toast({ title: "Error", description: "Failed to start inspection.", variant: "destructive" });
    }
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
    navigate(`/inspections/${createdId ?? ""}`);
  }

  function addVoiceNote() {
    setVoiceActive(true);
    setTimeout(() => {
      setVoiceActive(false);
      setCaptured(prev => [...prev, {
        id: `voice-${Date.now()}`,
        type: "voice",
        label: "Voice note recorded",
        url: "",
        ts: Date.now(),
      }]);
      toast({ title: "Voice note saved", description: "Added to inspection record." });
    }, 3000);
  }

  // ── STEP 1: SETUP ──────────────────────────────────────────────────────────
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

        {/* Property Type */}
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

        {/* Site Info */}
        <div className="space-y-3">
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Site Address</p>
            <Input
              placeholder="123 Main St, City, State"
              value={siteAddress}
              onChange={e => setSiteAddress(e.target.value)}
              className="bg-card border-border/60 rounded-xl h-12 text-base"
            />
          </div>
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">Your Name</p>
            <Input
              placeholder="Technician name"
              value={technicianName}
              onChange={e => setTechnicianName(e.target.value)}
              className="bg-card border-border/60 rounded-xl h-12 text-base"
            />
          </div>
        </div>

        {/* Voice hints */}
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

        {/* Begin */}
        <Button
          className="w-full h-14 text-base font-bold rounded-2xl bg-primary hover:bg-primary/90 shadow-lg shadow-primary/20"
          disabled={createInspection.isPending}
          onClick={handleBeginInspection}
        >
          {createInspection.isPending ? (
            <span className="animate-pulse">Starting…</span>
          ) : (
            <>
              <Scan className="mr-2 h-5 w-5" />
              Begin Inspection
            </>
          )}
        </Button>
      </div>
    );
  }

  // ── STEP 2: RECORDING ──────────────────────────────────────────────────────
  if (step === "recording") {
    return (
      <div className="fixed inset-0 bg-black flex flex-col z-50">
        {/* Camera viewfinder background */}
        <div className="absolute inset-0 bg-gradient-to-b from-black/80 via-black/20 to-black/80" />

        {/* Simulated camera feed */}
        <div className="absolute inset-0 overflow-hidden">
          <div className="w-full h-full bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 opacity-90" />
          {/* Scanning line */}
          <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/60 to-transparent animate-scan" />
          {/* Corner brackets */}
          {[["top-16 left-4", "border-t border-l"], ["top-16 right-4", "border-t border-r"], ["bottom-24 left-4", "border-b border-l"], ["bottom-24 right-4", "border-b border-r"]].map(([pos, cls]) => (
            <div key={pos} className={`absolute ${pos} w-8 h-8 ${cls} border-primary/60 opacity-70`} />
          ))}
          {/* Grid overlay */}
          <div className="absolute inset-0 opacity-5" style={{ backgroundImage: "repeating-linear-gradient(0deg, transparent, transparent 60px, rgba(255,255,255,0.3) 60px, rgba(255,255,255,0.3) 61px), repeating-linear-gradient(90deg, transparent, transparent 60px, rgba(255,255,255,0.3) 60px, rgba(255,255,255,0.3) 61px)" }} />
        </div>

        {/* Top bar */}
        <div className="relative z-10 flex items-center justify-between px-5 pt-safe pt-4 pb-3">
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse" />
            <span className="text-white font-mono text-sm font-semibold">{formatTime(timer)}</span>
          </div>
          <div className="flex items-center gap-1.5 bg-black/40 backdrop-blur-sm rounded-full px-3 py-1.5">
            <Scan className="h-3.5 w-3.5 text-primary" />
            <span className="text-[11px] text-primary font-semibold">AI ACTIVE</span>
          </div>
          <div className="text-white/60 text-xs">{captured.length} captured</div>
        </div>

        {/* AI Detection notification */}
        <div className="relative z-10 px-5 mt-2 h-14">
          {visibleDetection && (
            <div className="animate-slide-up flex items-center gap-3 bg-black/70 backdrop-blur-md border border-primary/30 rounded-2xl px-4 py-2.5">
              <div className={cn(
                "w-2 h-2 rounded-full shrink-0",
                visibleDetection.severity === "high" ? "bg-orange-400" : "bg-amber-400"
              )} />
              <span className="text-white text-sm flex-1">{visibleDetection.label}</span>
              <span className="text-primary/80 text-xs font-mono">{Math.round(visibleDetection.confidence * 100)}%</span>
            </div>
          )}
        </div>

        {/* Detection history pills */}
        {detections.length > 0 && (
          <div className="relative z-10 px-5 mt-3">
            <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
              {detections.slice(0, 6).map((d, i) => (
                <div key={`${d.id}-${d.ts}`} className="flex-shrink-0 flex items-center gap-1.5 bg-black/50 border border-white/10 rounded-full px-3 py-1">
                  <span className="text-[10px]">{d.icon}</span>
                  <span className="text-[10px] text-white/70 whitespace-nowrap">
                    {d.label.replace("Potential ", "").replace(" Detected", "")}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Voice active overlay */}
        {voiceActive && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/60 backdrop-blur-sm">
            <div className="flex flex-col items-center gap-4">
              <div className="w-20 h-20 rounded-full bg-primary/20 border-2 border-primary flex items-center justify-center animate-pulse">
                <Mic className="h-9 w-9 text-primary" />
              </div>
              <p className="text-white font-semibold">Listening…</p>
              <div className="flex gap-1">
                {[...Array(5)].map((_, i) => (
                  <div key={i} className="w-1 bg-primary rounded-full animate-bounce" style={{ height: `${12 + Math.random() * 20}px`, animationDelay: `${i * 100}ms` }} />
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Center area — camera fill indicator */}
        <div className="relative z-10 flex-1 flex items-center justify-center">
          {detections.length === 0 && (
            <div className="text-center opacity-50">
              <Scan className="h-12 w-12 text-primary/40 mx-auto mb-3" />
              <p className="text-white/40 text-sm">Scanning environment…</p>
            </div>
          )}
        </div>

        {/* Bottom controls */}
        <div className="relative z-10 px-6 pb-safe pb-8 pt-4">
          {/* Voice hint */}
          <div className="text-center mb-5">
            <p className="text-white/30 text-xs">Say {VOICE_COMMANDS[voiceHint]}</p>
          </div>

          <div className="flex items-center justify-between gap-4">
            {/* Mic toggle */}
            <button
              onClick={() => setMicOn(m => !m)}
              className={cn(
                "w-14 h-14 rounded-full border-2 flex items-center justify-center transition-all",
                micOn
                  ? "border-white/30 bg-white/10"
                  : "border-red-500/50 bg-red-500/20"
              )}
            >
              {micOn ? <Mic className="h-6 w-6 text-white" /> : <MicOff className="h-6 w-6 text-red-400" />}
            </button>

            {/* STOP button — center */}
            <button
              onClick={stopRecording}
              className="w-20 h-20 rounded-full border-4 border-white/80 flex items-center justify-center bg-transparent hover:bg-white/10 transition-all active:scale-95"
            >
              <div className="w-8 h-8 rounded-lg bg-red-500" />
            </button>

            {/* Voice note */}
            <button
              onClick={addVoiceNote}
              disabled={voiceActive}
              className="w-14 h-14 rounded-full border-2 border-primary/50 bg-primary/10 flex items-center justify-center hover:bg-primary/20 transition-all active:scale-95"
            >
              <Mic className="h-6 w-6 text-primary" />
            </button>
          </div>

          <p className="text-center text-white/30 text-xs mt-4">Tap stop when inspection is complete</p>
        </div>
      </div>
    );
  }

  // ── STEP 3: REVIEW ─────────────────────────────────────────────────────────
  return (
    <div className="max-w-lg mx-auto space-y-5 pt-2">
      <div className="flex items-center gap-3">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-emerald-400" />
            Inspection Complete
          </h1>
          <p className="text-muted-foreground text-xs mt-0.5">Review AI findings and save your record</p>
        </div>
      </div>

      {/* Summary strip */}
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-card border border-border/60 rounded-2xl p-3 text-center">
          <p className="text-xl font-bold text-primary">{captured.length}</p>
          <p className="text-[10px] text-muted-foreground">Captured</p>
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

      {/* Evidence review */}
      {captured.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Captured Evidence</p>
          <div className="space-y-2">
            {captured.map(item => (
              <div key={item.id} className="flex items-center gap-3 bg-card border border-border/60 rounded-2xl p-3">
                {item.type === "photo" && item.url ? (
                  <img src={item.url} alt="" className="w-12 h-12 rounded-xl object-cover shrink-0" />
                ) : (
                  <div className={cn("w-12 h-12 rounded-xl flex items-center justify-center shrink-0",
                    item.type === "voice" ? "bg-emerald-500/15" : "bg-primary/15"
                  )}>
                    {item.type === "voice" ? <Mic className="h-5 w-5 text-emerald-400" /> : <Camera className="h-5 w-5 text-primary" />}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-foreground leading-tight truncate">{item.label}</p>
                  {item.detection && (
                    <div className="flex items-center gap-1 mt-0.5">
                      <span className={cn("w-1.5 h-1.5 rounded-full",
                        item.detection.severity === "high" ? "bg-orange-400" : "bg-amber-400"
                      )} />
                      <span className="text-[10px] text-muted-foreground">
                        {Math.round(item.detection.confidence * 100)}% confidence
                      </span>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* AI Findings */}
      {detections.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">AI Findings</p>
          <div className="space-y-1.5">
            {detections.map((d, i) => (
              <div key={`${d.id}-${i}`} className="flex items-center gap-3 bg-card border border-border/60 rounded-xl px-3 py-2.5">
                <AlertTriangle className={cn("h-4 w-4 shrink-0",
                  d.severity === "high" ? "text-orange-400" : "text-amber-400"
                )} />
                <span className="text-xs text-foreground flex-1">{d.label}</span>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-[10px] text-muted-foreground">{Math.round(d.confidence * 100)}%</span>
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

      <div className="flex gap-3 pt-2">
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
