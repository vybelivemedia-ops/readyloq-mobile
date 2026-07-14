import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CheckCircle2, Lock, Zap, Users, ChevronRight, Calendar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTitle } from "@/hooks/use-title";

interface Milestone {
  id: string;
  phase: number;
  title: string;
  description: string;
  details: string[];
  status: "completed" | "active" | "upcoming";
  completedAt?: string;
  targetDate?: string;
}

interface RoadmapData {
  milestones: Milestone[];
  betaCount: number;
  currentStage: string;
  currentFocus: string[];
  nextMilestone: string;
  overallProgress: number;
  summary: string;
  lastUpdated: string;
}

// TODO(post-launch deploy): replace with the final App Store / Google Play link
const GET_APP_URL = "/download";

function openGetApp() {
  window.location.href = GET_APP_URL;
}

function formatTargetDate(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  const q = Math.ceil((d.getMonth() + 1) / 3);
  return `Q${q} ${d.getFullYear()}`;
}

/* ── Blueprint scan line ─────────────────────────────────────── */
function BlueprintScan() {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none rounded-2xl">
      <div
        className="absolute left-0 right-0 h-px animate-hologram-scan"
        style={{ background: "linear-gradient(90deg, transparent, rgba(59,130,246,0.4), transparent)" }}
      />
    </div>
  );
}

/* ── HQ Blueprint SVG (V shape floor plan) ───────────────────── */
function HQBlueprintSVG({ progress }: { progress: number }) {
  const completedWings = Math.round((progress / 100) * 10);

  const wings = [
    { id: "streaming", label: "Streaming Core", x: 55, y: 80, w: 70, h: 28, status: "completed" },
    { id: "ai-clips", label: "AI Clips", x: 55, y: 115, w: 70, h: 28, status: "completed" },
    { id: "hq", label: "AI HQ", x: 185, y: 170, w: 78, h: 32, status: "active" },
    { id: "brand", label: "Brand Relations", x: 325, y: 80, w: 90, h: 28, status: "locked" },
    { id: "collab", label: "Collab Center", x: 325, y: 115, w: 90, h: 28, status: "locked" },
    { id: "trend", label: "Trend Lab", x: 30, y: 170, w: 75, h: 28, status: "locked" },
    { id: "marketplace", label: "Marketplace", x: 345, y: 170, w: 80, h: 28, status: "locked" },
    { id: "talent", label: "AI Talent Agency", x: 30, y: 220, w: 120, h: 28, status: "locked" },
    { id: "economy", label: "Creator Economy", x: 300, y: 220, w: 120, h: 28, status: "locked" },
  ];

  const getColor = (status: string) => {
    if (status === "completed") return "#22c55e";
    if (status === "active") return "#60a5fa";
    return "#4b5563";
  };

  const getFill = (status: string) => {
    if (status === "completed") return "rgba(34,197,94,0.08)";
    if (status === "active") return "rgba(96,165,250,0.08)";
    return "rgba(0,0,0,0.3)";
  };

  void completedWings;

  return (
    <div className="relative w-full">
      <svg viewBox="0 0 450 270" className="w-full" style={{ filter: "drop-shadow(0 0 20px rgba(59,130,246,0.15))" }}>
        <defs>
          <filter id="bp-glow">
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <pattern id="bp-grid" width="10" height="10" patternUnits="userSpaceOnUse">
            <path d="M 10 0 L 0 0 0 10" fill="none" stroke="rgba(59,130,246,0.08)" strokeWidth="0.5" />
          </pattern>
        </defs>

        {/* Blueprint grid background */}
        <rect width="450" height="270" fill="url(#bp-grid)" />

        {/* V structure guide lines */}
        <motion.path d="M 90,60 L 225,220 L 360,60" fill="none" stroke="rgba(59,130,246,0.2)" strokeWidth="1" strokeDasharray="5 5"
          initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 2, ease: "easeOut" }} />

        {/* Wing boxes */}
        {wings.map((wing, i) => (
          <motion.g key={wing.id} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 + i * 0.1 }}>
            <rect x={wing.x} y={wing.y} width={wing.w} height={wing.h}
              fill={getFill(wing.status)} stroke={getColor(wing.status)} strokeWidth={wing.status === "active" ? 1.5 : 0.8}
              rx="2" strokeOpacity={wing.status === "locked" ? 0.3 : 0.7} />

            {wing.status === "active" && (
              <motion.rect x={wing.x} y={wing.y} width={wing.w} height={wing.h} fill="none"
                stroke="#60a5fa" strokeWidth="1.5" rx="2"
                animate={{ strokeOpacity: [0.3, 0.8, 0.3] }} transition={{ duration: 1.5, repeat: Infinity }} />
            )}

            <text x={wing.x + wing.w / 2} y={wing.y + wing.h / 2 - 2}
              textAnchor="middle" dominantBaseline="middle"
              fill={getColor(wing.status)} fontSize="5.5" fontFamily="monospace"
              opacity={wing.status === "locked" ? 0.5 : 1}>
              {wing.label}
            </text>

            {wing.status === "completed" && (
              <text x={wing.x + wing.w / 2} y={wing.y + wing.h / 2 + 7}
                textAnchor="middle" fill="#22c55e" fontSize="4.5" fontFamily="monospace" opacity="0.8">
                ✓ ACTIVE
              </text>
            )}
            {wing.status === "active" && (
              <text x={wing.x + wing.w / 2} y={wing.y + wing.h / 2 + 7}
                textAnchor="middle" fill="#60a5fa" fontSize="4.5" fontFamily="monospace" opacity="0.8">
                BUILDING...
              </text>
            )}
            {wing.status === "locked" && (
              <text x={wing.x + wing.w / 2} y={wing.y + wing.h / 2 + 7}
                textAnchor="middle" fill="#4b5563" fontSize="4.5" fontFamily="monospace" opacity="0.7">
                🔒 LOCKED
              </text>
            )}
          </motion.g>
        ))}

        {/* Central apex */}
        <motion.circle cx="225" cy="220" fill="rgba(139,92,246,0.3)" stroke="#8b5cf6" strokeWidth="1.5"
          initial={{ r: 8 }}
          animate={{ r: [7, 11, 7] }} transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut" }} />
        <text x="225" y="248" textAnchor="middle" fill="#a855f7" fontSize="5.5" fontFamily="monospace">AI CORE</text>

        {/* Construction beam effect */}
        <motion.rect x="0" y="0" width="30" height="270" fill="none"
          style={{ filter: "blur(8px)" }}
          animate={{ x: [-30, 480], opacity: [0, 0.3, 0.3, 0] }}
          transition={{ duration: 4, repeat: Infinity, repeatDelay: 8, ease: "easeInOut" }}
        />
      </svg>
    </div>
  );
}

/* ── Wing Card ───────────────────────────────────────────────── */
interface Wing {
  name: string;
  description: string;
  status: "completed" | "active" | "locked";
  icon: string;
  unlock?: string;
}

function WingCard({ wing, index }: { wing: Wing; index: number }) {
  const [hovered, setHovered] = useState(false);

  const colors = {
    completed: { border: "rgba(34,197,94,0.3)", bg: "rgba(34,197,94,0.04)", text: "#22c55e", badge: "rgba(34,197,94,0.1)" },
    active: { border: "rgba(96,165,250,0.4)", bg: "rgba(96,165,250,0.06)", text: "#60a5fa", badge: "rgba(96,165,250,0.15)" },
    locked: { border: "rgba(75,85,99,0.3)", bg: "rgba(0,0,0,0.2)", text: "#6b7280", badge: "rgba(75,85,99,0.1)" },
  };

  const c = colors[wing.status];

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ delay: index * 0.08 }}
      className="relative rounded-xl p-4 transition-all duration-300 cursor-default"
      style={{ border: `1px solid ${c.border}`, background: c.bg }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      {wing.status === "active" && <BlueprintScan />}

      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <span className="text-lg leading-none mt-0.5">{wing.icon}</span>
          <div>
            <h3 className="text-sm font-bold text-white mb-0.5">{wing.name}</h3>
            <p className="text-xs text-muted-foreground leading-relaxed">{wing.description}</p>
            {wing.status === "locked" && wing.unlock && (
              <p className="text-xs mt-1.5 font-mono" style={{ color: c.text }}>
                Unlocks: {wing.unlock}
              </p>
            )}
          </div>
        </div>
        <div className="flex-shrink-0">
          {wing.status === "completed" && (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-bold" style={{ background: c.badge, color: c.text }}>
              ✓ ACTIVE
            </span>
          )}
          {wing.status === "active" && (
            <motion.span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-bold" style={{ background: c.badge, color: c.text }}
              animate={{ opacity: [0.7, 1, 0.7] }} transition={{ duration: 1, repeat: Infinity }}>
              ⚡ BUILDING
            </motion.span>
          )}
          {wing.status === "locked" && (
            <Lock size={12} className="text-gray-600 mt-0.5" />
          )}
        </div>
      </div>

      <AnimatePresence>
        {hovered && wing.status === "locked" && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            className="absolute left-0 bottom-full mb-2 z-20 rounded-lg p-3 text-xs font-mono border border-gray-700 backdrop-blur-xl min-w-[200px]"
            style={{ background: "rgba(3,4,8,0.95)" }}
          >
            <p className="text-gray-400">Coming Soon</p>
            <p className="text-gray-500 mt-1 text-[10px] leading-relaxed">This department unlocks as the VYBE ecosystem grows.</p>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

/* ── Milestone card ──────────────────────────────────────────── */
function MilestoneCard({ milestone, index, isLast }: { milestone: Milestone; index: number; isLast: boolean }) {
  const colors = {
    completed: { line: "bg-green-800/40", dot: "bg-green-400", border: "border-green-900/30", text: "text-green-400" },
    active: { line: "bg-blue-500/30", dot: "bg-blue-400 animate-pulse", border: "border-blue-500/30", text: "text-blue-400" },
    upcoming: { line: "bg-gray-800/60", dot: "bg-gray-700", border: "border-border", text: "text-gray-500" },
  };
  const c = colors[milestone.status];

  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      whileInView={{ opacity: 1, x: 0 }}
      viewport={{ once: true }}
      transition={{ delay: index * 0.06 }}
      className="flex gap-5"
    >
      {/* Timeline indicator */}
      <div className="flex flex-col items-center flex-shrink-0">
        {milestone.status === "completed" ? (
          <CheckCircle2 size={20} className="text-green-400 flex-shrink-0" />
        ) : milestone.status === "active" ? (
          <span className="relative w-5 h-5 flex items-center justify-center">
            <span className="animate-ping absolute w-full h-full rounded-full bg-blue-500/30" />
            <Zap size={16} className="relative text-blue-400" />
          </span>
        ) : (
          <div className="w-4 h-4 rounded-full border border-gray-700 bg-gray-900" />
        )}
        {!isLast && <div className={`w-px flex-1 mt-2 min-h-[40px] ${c.line}`} />}
      </div>

      {/* Content */}
      <div className={`flex-1 ${isLast ? "pb-0" : "pb-10"}`}>
        <div className={`rounded-2xl border p-5 ${c.border}`}
          style={{ background: milestone.status === "active" ? "rgba(59,130,246,0.04)" : "rgba(255,255,255,0.015)" }}>
          <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
            <div>
              <span className="text-[10px] font-mono text-muted-foreground/60 mb-1 block">PHASE {milestone.phase}</span>
              <h3 className="text-lg font-display font-bold text-white">{milestone.title}</h3>
            </div>
            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-mono font-bold ${c.text}`}
              style={{ background: milestone.status === "completed" ? "rgba(34,197,94,0.08)" : milestone.status === "active" ? "rgba(59,130,246,0.1)" : "rgba(75,85,99,0.1)" }}>
              <span className={`w-1.5 h-1.5 rounded-full ${c.dot.replace(" animate-pulse", "")}`} />
              {milestone.status === "completed" ? "Shipped" : milestone.status === "active" ? "In Progress" : "Upcoming"}
            </span>
          </div>
          <p className="text-sm text-muted-foreground mb-4 leading-relaxed">{milestone.description}</p>
          <ul className="space-y-1.5">
            {milestone.details.map((d, j) => (
              <li key={j} className="flex items-start gap-2 text-xs text-muted-foreground">
                <span className={`mt-1.5 w-1 h-1 rounded-full flex-shrink-0 ${milestone.status === "completed" ? "bg-green-400" : milestone.status === "active" ? "bg-blue-400" : "bg-gray-600"}`} />
                {d}
              </li>
            ))}
          </ul>
          {(milestone.completedAt || milestone.targetDate) && (
            <div className="mt-4 pt-3 border-t border-border/30 flex items-center gap-2 text-[11px] text-muted-foreground font-mono">
              <Calendar size={11} />
              {milestone.completedAt ? `Shipped ${milestone.completedAt}` : `Target: ${formatTargetDate(milestone.targetDate!)}`}
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}

/* ── Wings config ────────────────────────────────────────────── */
const HQ_WINGS: Wing[] = [
  { name: "Streaming Core", description: "Live broadcasting from phone, GoPro, Meta Glasses, and RTMP sources.", status: "completed", icon: "✅" },
  { name: "AI Clips", description: "Auto-generate highlight clips from every stream with AI-powered editing.", status: "completed", icon: "✅" },
  { name: "Creator Profiles & Discovery", description: "Public profiles, follower system, and creator community network.", status: "completed", icon: "✅" },
  { name: "Live Stream Recording & Archive", description: "Cloud recording, archive, and hands-free voice moment-marking.", status: "completed", icon: "✅" },
  { name: "AI Headquarters", description: "The full command center — all 7 AI departments activating.", status: "active", icon: "🚧" },
  { name: "Brand Relations Wing", description: "AI-powered sponsor matching, outreach automation, and deal tracking.", status: "locked", icon: "🔒", unlock: "Creator milestone" },
  { name: "Collaboration Center", description: "Creator network mapping, match suggestions, and co-streaming tools.", status: "locked", icon: "🔒", unlock: "Future expansion" },
  { name: "Trend Intelligence Lab", description: "Real-time global trend monitoring, content predictions, and heat maps.", status: "locked", icon: "🔒", unlock: "Future expansion" },
  { name: "Creator Marketplace", description: "Monetize your audience with digital products and services.", status: "locked", icon: "🔒", unlock: "Future expansion" },
  { name: "AI Talent Agency", description: "Full-service AI representation for high-growth creators.", status: "locked", icon: "🔒", unlock: "Future expansion" },
  { name: "Creator Economy Network", description: "Cross-creator revenue sharing, brand pools, and collective deals.", status: "locked", icon: "🔒", unlock: "Future expansion" },
];

/* ── Main Roadmap Component ──────────────────────────────────── */
export default function Roadmap() {
  useTitle("VYBE Headquarters — Building the Future");

  const [data, setData] = useState<RoadmapData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const base = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";
    fetch(`${base}/api/roadmap`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  const milestones = data?.milestones ?? [];
  const betaCount = data?.betaCount ?? 0;
  const progress = data?.overallProgress ?? 55;
  const FOUNDING_TARGET = 10000;
  const foundingProgress = Math.min((betaCount / FOUNDING_TARGET) * 100, 100);

  return (
    <div className="flex flex-col min-h-screen pt-20">

      {/* ── HERO ─────────────────────────────────────────────────── */}
      <section className="relative py-24 border-b overflow-hidden"
        style={{ background: "radial-gradient(ellipse 70% 50% at 50% 0%, rgba(59,130,246,0.07) 0%, transparent 60%), hsl(270 20% 3%)" }}>

        <div className="absolute inset-0 pointer-events-none" style={{
          backgroundImage: `
            repeating-linear-gradient(0deg, transparent, transparent 60px, rgba(59,130,246,0.03) 60px, rgba(59,130,246,0.03) 61px),
            repeating-linear-gradient(90deg, transparent, transparent 60px, rgba(59,130,246,0.03) 60px, rgba(59,130,246,0.03) 61px)
          `,
        }} />

        <div className="relative z-10 max-w-5xl mx-auto px-6">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}
            className="text-center mb-14">

            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-blue-400/25 text-blue-300 text-xs font-mono uppercase tracking-widest mb-8"
              style={{ background: "rgba(59,130,246,0.08)" }}>
              <motion.span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-status-blink" />
              Headquarters Construction — June 2026
            </div>

            <h1 className="font-hero font-black uppercase text-white leading-[0.88] tracking-tight mb-6"
              style={{ fontSize: "clamp(3rem, 8vw, 7rem)" }}>
              Building the Future
              <br /><span className="text-gradient-blue">of Creator AI</span>
            </h1>

            <p className="text-xl text-muted-foreground max-w-2xl mx-auto leading-relaxed">
              Every milestone unlocks a new department inside VYBE Headquarters.
              Founding creators help build the world's first AI-powered creator operating system.
            </p>

            <div className="flex flex-wrap items-center justify-center gap-3 mt-8">
              {["Google Play Verified", "Live in Production", "YouTube Live Tested"].map(badge => (
                <span key={badge} className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-green-950/40 border border-green-700/30 text-green-300 text-sm font-mono">
                  <CheckCircle2 size={13} className="text-green-400" />
                  {badge}
                </span>
              ))}
            </div>
          </motion.div>

          {/* HQ Blueprint */}
          <motion.div className="relative rounded-2xl overflow-hidden border border-blue-500/15 p-6"
            style={{ background: "rgba(59,130,246,0.03)" }}
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
            <BlueprintScan />
            <div className="flex items-center justify-between mb-4">
              <span className="text-xs font-mono text-blue-400 tracking-widest">HEADQUARTERS BLUEPRINT</span>
              <span className="text-xs font-mono text-blue-300/50">CONSTRUCTION IN PROGRESS</span>
            </div>
            <HQBlueprintSVG progress={progress} />
          </motion.div>
        </div>
      </section>

      {/* ── FOUNDING CREATOR COUNTER ─────────────────────────────── */}
      <section className="py-16 border-b border-blue-500/10"
        style={{ background: "radial-gradient(ellipse 60% 80% at 50% 50%, rgba(139,92,246,0.06) 0%, transparent 70%), hsl(270 20% 3%)" }}>
        <div className="max-w-3xl mx-auto px-6 text-center">
          <motion.div initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}>
            <p className="text-xs font-mono text-purple-400 uppercase tracking-widest mb-3">FOUNDING CREATORS</p>
            <div className="text-5xl md:text-7xl font-hero font-black text-white mb-2">
              {loading ? (
                <span className="text-muted-foreground">—</span>
              ) : (
                <motion.span initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                  {betaCount.toLocaleString()}
                </motion.span>
              )}
              <span className="text-3xl text-muted-foreground font-sans font-normal"> / {FOUNDING_TARGET.toLocaleString()}</span>
            </div>

            <div className="relative h-4 bg-gray-900 rounded-full overflow-hidden border border-purple-500/15 my-6 max-w-xl mx-auto">
              <motion.div
                className="h-full rounded-full"
                style={{ background: "linear-gradient(90deg, #3b82f6, #7c3aed, #a855f7)" }}
                initial={{ width: 0 }}
                animate={{ width: `${foundingProgress}%` }}
                transition={{ duration: 1.4, ease: "easeOut", delay: 0.4 }}
              />
              {/* Shimmer */}
              <div className="absolute inset-0 overflow-hidden rounded-full">
                <motion.div
                  className="absolute top-0 bottom-0 w-16 bg-white/20 blur-sm skew-x-12"
                  animate={{ x: ["-100%", "800%"] }}
                  transition={{ duration: 2, repeat: Infinity, repeatDelay: 3, ease: "linear" }}
                />
              </div>
            </div>

            <p className="text-muted-foreground max-w-lg mx-auto mb-8">
              Every new creator helps expand Headquarters. Founding creators get lifetime priority access and help shape the platform.
            </p>

            <Button size="lg" onClick={openGetApp}
              className="h-14 px-10 rounded-full text-white font-bold text-lg"
              style={{ background: "linear-gradient(135deg, #3b82f6, #7c3aed)", boxShadow: "0 0 40px rgba(99,102,241,0.4)" }}>
              Download VYBE Live
            </Button>
          </motion.div>
        </div>
      </section>

      {/* ── PROGRESS STATS ───────────────────────────────────────── */}
      <section className="py-10 border-b border-border/30">
        <div className="max-w-4xl mx-auto px-6">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            {[
              { icon: CheckCircle2, label: "Phases Complete", value: loading ? "—" : `${milestones.filter(m => m.status === "completed").length} of ${milestones.length || 7}`, color: "text-green-400", bg: "rgba(34,197,94,0.08)", border: "rgba(34,197,94,0.2)" },
              { icon: Zap, label: "Overall Progress", value: `${progress}%`, color: "text-blue-400", bg: "rgba(59,130,246,0.08)", border: "rgba(59,130,246,0.2)" },
              { icon: Users, label: "Creators Joined", value: loading ? "—" : betaCount.toLocaleString(), color: "text-purple-400", bg: "rgba(139,92,246,0.08)", border: "rgba(139,92,246,0.2)" },
            ].map((stat, i) => (
              <motion.div key={i} initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }} transition={{ delay: i * 0.1 }}
                className="rounded-xl p-5 border flex items-center gap-4"
                style={{ background: stat.bg, borderColor: stat.border }}>
                <div className="w-12 h-12 rounded-full border flex items-center justify-center flex-shrink-0"
                  style={{ borderColor: stat.border, background: stat.bg }}>
                  <stat.icon className={stat.color} size={20} />
                </div>
                <div>
                  <p className="text-xs font-mono text-muted-foreground mb-0.5">{stat.label}</p>
                  <p className={`text-2xl font-display font-black ${stat.color}`}>{stat.value}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── HQ WINGS / DEPARTMENTS ───────────────────────────────── */}
      <section className="py-16 border-b border-border/30"
        style={{ background: "radial-gradient(ellipse 80% 40% at 50% 0%, rgba(59,130,246,0.04) 0%, transparent 60%), hsl(270 20% 3%)" }}>
        <div className="max-w-4xl mx-auto px-6">
          <motion.div initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="mb-10">
            <p className="text-xs font-mono text-blue-400 uppercase tracking-widest mb-3">HEADQUARTERS EXPANSION</p>
            <h2 className="font-hero text-3xl md:text-5xl font-black uppercase text-white leading-[0.92]">
              Department <span className="text-gradient-blue">Activation Status</span>
            </h2>
            <p className="text-muted-foreground mt-3 max-w-2xl">
              Each wing lights up as milestones are reached. Future departments remain under construction until the ecosystem grows to unlock them.
            </p>
          </motion.div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {HQ_WINGS.map((wing, i) => (
              <WingCard key={wing.name} wing={wing} index={i} />
            ))}
          </div>
        </div>
      </section>

      {/* ── MILESTONE DASHBOARD ──────────────────────────────────── */}
      <section className="py-10 border-b border-border/30">
        <div className="max-w-4xl mx-auto px-6">
          <p className="text-xs font-mono text-muted-foreground uppercase tracking-widest mb-6">COMPANY MILESTONES DASHBOARD</p>
          <div className="space-y-3">
            {[
              { label: "Business Foundation", pct: 100 },
              { label: "Mobile App & AI Clips", pct: 100 },
              { label: "Developer Verification & Distribution", pct: 100 },
              { label: "Live Streaming Engine", pct: 100 },
              { label: "Creator Social & Community", pct: 100 },
              { label: "Recording & Hands-Free Capture", pct: 100 },
              { label: "Public Launch", pct: 100 },
            ].map(({ label, pct }) => (
              <div key={label}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm text-white font-medium">{label}</span>
                  <span className={`text-sm font-bold font-mono ${pct === 100 ? "text-green-400" : "text-blue-400"}`}>{pct}%</span>
                </div>
                <div className="h-1.5 bg-gray-900 rounded-full overflow-hidden border border-gray-800">
                  <motion.div
                    className={`h-full rounded-full ${pct === 100 ? "bg-green-500" : "bg-gradient-to-r from-blue-500 to-purple-500"}`}
                    initial={{ width: 0 }}
                    whileInView={{ width: `${pct}%` }}
                    viewport={{ once: true }}
                    transition={{ duration: 1.2, ease: "easeOut" }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CURRENT STATUS ───────────────────────────────────────── */}
      {!loading && data && (
        <section className="py-10 border-b border-border/30">
          <div className="max-w-4xl mx-auto px-6">
            <div className="rounded-2xl border border-blue-500/20 overflow-hidden" style={{ background: "rgba(59,130,246,0.03)" }}>
              <div className="px-6 py-4 border-b border-border/30 flex items-center gap-3">
                <motion.span className="w-2 h-2 rounded-full bg-blue-400 animate-status-blink" />
                <span className="text-xs font-mono text-blue-400 uppercase tracking-widest">Current Status — June 2026</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-border/30">
                <div className="p-6">
                  <p className="text-[10px] font-mono text-muted-foreground mb-2 uppercase tracking-wide">Current Stage</p>
                  <p className="text-white font-display font-bold text-base leading-snug">{data.currentStage}</p>
                </div>
                <div className="p-6 md:col-span-2">
                  <p className="text-[10px] font-mono text-muted-foreground mb-3 uppercase tracking-wide">Current Focus</p>
                  <ul className="space-y-1.5">
                    {data.currentFocus.map((item, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-muted-foreground">
                        <ChevronRight size={13} className="text-blue-400 mt-0.5 flex-shrink-0" />
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* ── MILESTONE TIMELINE ───────────────────────────────────── */}
      <section className="py-16 flex-1"
        style={{ background: "hsl(270 20% 3%)" }}>
        <div className="max-w-4xl mx-auto px-6">
          <motion.div initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} className="mb-10">
            <p className="text-xs font-mono text-muted-foreground uppercase tracking-widest mb-3">CONSTRUCTION TIMELINE</p>
            <h2 className="font-hero text-3xl md:text-4xl font-black uppercase text-white leading-[0.92]">
              Every Phase <span className="text-gradient-brand">Opens a Door</span>
            </h2>
          </motion.div>

          <div className="space-y-0">
            {(loading ? Array(7).fill(null) : milestones).map((milestone: Milestone | null, i: number) => {
              if (!milestone) {
                return (
                  <div key={i} className="flex gap-5 pb-10">
                    <div className="flex flex-col items-center">
                      <div className="w-5 h-5 rounded-full bg-gray-800 animate-pulse" />
                      {i < 6 && <div className="w-px flex-1 bg-gray-800 mt-2" />}
                    </div>
                    <div className="flex-1">
                      <div className="rounded-2xl border border-gray-800 p-5 space-y-2">
                        <div className="h-4 w-48 bg-gray-800 rounded animate-pulse" />
                        <div className="h-3 w-full bg-gray-900 rounded animate-pulse" />
                        <div className="h-3 w-3/4 bg-gray-900 rounded animate-pulse" />
                      </div>
                    </div>
                  </div>
                );
              }
              return (
                <MilestoneCard
                  key={milestone.id}
                  milestone={milestone}
                  index={i}
                  isLast={i === milestones.length - 1}
                />
              );
            })}
          </div>
        </div>
      </section>

      {/* ── MISSION STATEMENT ────────────────────────────────────── */}
      <section className="py-20 border-t border-border/30"
        style={{ background: "radial-gradient(ellipse 60% 60% at 50% 50%, rgba(139,92,246,0.06) 0%, transparent 70%), hsl(270 20% 3%)" }}>
        <div className="max-w-3xl mx-auto px-6 text-center">
          <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}>
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-full mb-8"
              style={{ background: "radial-gradient(circle, rgba(139,92,246,0.7), rgba(59,130,246,0.3))", boxShadow: "0 0 40px rgba(139,92,246,0.5)" }}>
              <span className="font-hero text-white font-black text-xl">V</span>
            </div>
            <blockquote className="text-2xl md:text-3xl text-white font-light leading-relaxed mb-6">
              "We're not building another livestream app.
              <br />
              <span className="text-gradient-brand font-bold">We're building the world's first AI Headquarters for creators.</span>"
            </blockquote>
            <p className="text-muted-foreground text-lg mb-10 max-w-2xl mx-auto leading-relaxed">
              VYBE LIVE MEDIA LLC — Registered U.S. Business. Google Play Verified. Building in public with our founding creator community.
            </p>
            <div className="flex flex-col sm:flex-row items-center gap-4 justify-center">
              <Button size="lg" onClick={openGetApp}
                className="h-14 px-10 rounded-full text-white font-bold text-lg"
                style={{ background: "linear-gradient(135deg, #3b82f6, #7c3aed)", boxShadow: "0 0 40px rgba(99,102,241,0.4)" }}>
                Enter the Future
              </Button>
              <Button size="lg" variant="outline" onClick={openGetApp}
                className="h-14 px-10 rounded-full font-bold text-lg border-purple-500/30 bg-purple-500/5 hover:bg-purple-500/10 text-white">
                Help Build Headquarters
              </Button>
            </div>
            <p className="text-xs text-muted-foreground mt-5 font-mono tracking-wider uppercase">
              Free to Download · Available Now
            </p>
          </motion.div>
        </div>
      </section>

    </div>
  );
}
