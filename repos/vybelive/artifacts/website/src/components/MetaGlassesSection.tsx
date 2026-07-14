import { motion } from "framer-motion";
import {
  Eye,
  Video,
  Camera,
  Sparkles,
  LayoutDashboard,
  CheckCircle2,
  ArrowRight,
} from "lucide-react";

const FEATURES = [
  {
    icon: Eye,
    title: "Hands-Free Streaming",
    desc: "Go live from your exact point of view — no phone in hand, no rig, just your perspective broadcast to the world.",
  },
  {
    icon: Video,
    title: "Live POV Video",
    desc: "Crystal-clear first-person video streamed directly from Meta AI Glasses over Bluetooth in real time.",
  },
  {
    icon: Camera,
    title: "Photo Capture",
    desc: "Snap high-quality moments straight from your glasses without breaking the stream or lifting a hand.",
  },
  {
    icon: Sparkles,
    title: "AI Clip Generation",
    desc: "Automatically transform your wearable footage into short-form clips ready for TikTok, Reels, and Shorts.",
  },
  {
    icon: LayoutDashboard,
    title: "Creator Dashboard Sync",
    desc: "Manage glasses streams, clips, and analytics from the same VYBE LIVE dashboard — one platform, every device.",
  },
];

function GlassesMockup() {
  return (
    <div className="relative w-full max-w-sm mx-auto select-none">
      {/* Outer glow */}
      <div className="absolute inset-0 rounded-[40px] bg-purple-600/20 blur-3xl scale-110 pointer-events-none" />

      <svg viewBox="0 0 320 130" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full relative">
        <defs>
          <linearGradient id="frame-grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#581c87" />
            <stop offset="50%" stopColor="#7e22ce" />
            <stop offset="100%" stopColor="#a21caf" />
          </linearGradient>
          <linearGradient id="lens-grad-l" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#1e0a3c" />
            <stop offset="100%" stopColor="#2d0a4e" />
          </linearGradient>
          <linearGradient id="lens-grad-r" x1="100%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#1e0a3c" />
            <stop offset="100%" stopColor="#2d0a4e" />
          </linearGradient>
          <filter id="glow-lens">
            <feGaussianBlur stdDeviation="2" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>

        {/* Left temple arm */}
        <rect x="0" y="48" width="30" height="8" rx="4" fill="url(#frame-grad)" />
        {/* Right temple arm */}
        <rect x="290" y="48" width="30" height="8" rx="4" fill="url(#frame-grad)" />

        {/* Left lens frame */}
        <rect x="28" y="22" width="118" height="80" rx="16" fill="url(#frame-grad)" />
        {/* Left lens inner */}
        <rect x="34" y="28" width="106" height="68" rx="12" fill="url(#lens-grad-l)" filter="url(#glow-lens)" />

        {/* Right lens frame */}
        <rect x="174" y="22" width="118" height="80" rx="16" fill="url(#frame-grad)" />
        {/* Right lens inner */}
        <rect x="180" y="28" width="106" height="68" rx="12" fill="url(#lens-grad-r)" filter="url(#glow-lens)" />

        {/* Bridge */}
        <rect x="146" y="48" width="28" height="8" rx="4" fill="url(#frame-grad)" />

        {/* Left lens HUD elements */}
        <motion.rect
          x="42" y="36" width="40" height="3" rx="1.5"
          fill="rgba(168,85,247,0.7)"
          animate={{ opacity: [0.4, 1, 0.4] }}
          transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.rect
          x="42" y="44" width="28" height="2" rx="1"
          fill="rgba(217,70,239,0.5)"
          animate={{ opacity: [0.3, 0.8, 0.3] }}
          transition={{ duration: 2, repeat: Infinity, delay: 0.4, ease: "easeInOut" }}
        />
        <motion.circle
          cx="120" cy="80" r={6}
          fill="none"
          stroke="rgba(168,85,247,0.8)"
          strokeWidth="1.5"
          animate={{ opacity: [0.5, 1, 0.5], scale: [0.85, 1.15, 0.85] }}
          transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
          style={{ originX: "120px", originY: "80px" }}
        />
        <motion.text
          x="42" y="92" fill="rgba(168,85,247,0.6)" fontSize="7" fontFamily="monospace"
          animate={{ opacity: [0.3, 0.9, 0.3] }}
          transition={{ duration: 3, repeat: Infinity, delay: 1 }}
        >
          ● LIVE
        </motion.text>

        {/* Right lens HUD elements */}
        <motion.rect
          x="190" y="36" width="35" height="3" rx="1.5"
          fill="rgba(217,70,239,0.6)"
          animate={{ opacity: [0.4, 1, 0.4] }}
          transition={{ duration: 2.2, repeat: Infinity, delay: 0.3, ease: "easeInOut" }}
        />
        <motion.rect
          x="190" y="44" width="22" height="2" rx="1"
          fill="rgba(168,85,247,0.4)"
          animate={{ opacity: [0.3, 0.7, 0.3] }}
          transition={{ duration: 1.8, repeat: Infinity, delay: 0.7, ease: "easeInOut" }}
        />
        <motion.text
          x="190" y="80" fill="rgba(217,70,239,0.5)" fontSize="6" fontFamily="monospace"
          animate={{ opacity: [0.2, 0.8, 0.2] }}
          transition={{ duration: 2.5, repeat: Infinity, delay: 0.5 }}
        >
          AI ✦ CLIP
        </motion.text>
      </svg>

      {/* Scanning line */}
      <motion.div
        className="absolute inset-x-[10%] h-px bg-gradient-to-r from-transparent via-purple-400/60 to-transparent pointer-events-none"
        animate={{ top: ["30%", "70%", "30%"] }}
        transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
      />
    </div>
  );
}

export function MetaGlassesSection() {
  return (
    <section
      id="meta-glasses"
      className="relative py-32 overflow-hidden border-y border-purple-500/15 bg-background"
    >
      {/* Ambient glow */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-60 left-1/2 -translate-x-1/2 w-[900px] h-[900px] rounded-full bg-purple-700/10 blur-[160px]" />
        <div className="absolute bottom-0 right-1/4 w-[500px] h-[500px] rounded-full bg-fuchsia-600/8 blur-[140px]" />
      </div>

      <div className="relative z-10 max-w-6xl mx-auto px-6">
        {/* Coming Soon badge */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="flex justify-center mb-8"
        >
          <span className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-purple-500/10 border border-purple-400/35 text-purple-300 text-xs font-bold uppercase tracking-widest backdrop-blur-sm">
            <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse" />
            Coming Soon to Beta
          </span>
        </motion.div>

        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.05 }}
          className="text-center max-w-3xl mx-auto mb-16"
        >
          <p className="text-purple-400 font-semibold tracking-widest uppercase text-xs mb-4">
            Meta AI Glasses
          </p>
          <h2 className="font-hero text-5xl md:text-7xl font-black text-white tracking-tight leading-[0.95] mb-6 uppercase">
            Stream Life
            <br />
            <span className="text-gradient-brand">From Your Eyes</span>
          </h2>
          <p className="text-lg md:text-xl text-muted-foreground leading-relaxed">
            Turn your point of view into livestreams, clips, and content.
          </p>
        </motion.div>

        {/* Glasses mockup */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.1 }}
          className="mb-20"
        >
          <GlassesMockup />
        </motion.div>

        {/* Feature grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5 mb-16">
          {FEATURES.map((feature, i) => (
            <motion.div
              key={feature.title}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.08 }}
              className="animated-border-card group relative rounded-2xl border border-purple-500/12 bg-card/40 backdrop-blur-sm p-6 hover:border-purple-400/35 transition-colors overflow-hidden"
            >
              <div className="absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none bg-gradient-to-b from-purple-500/[0.06] to-transparent" />
              <div className="relative">
                <div className="w-12 h-12 rounded-xl bg-purple-500/10 border border-purple-400/20 flex items-center justify-center text-purple-300 mb-4 group-hover:border-purple-400/40 transition-colors">
                  <feature.icon size={22} />
                </div>
                <h3 className="text-lg font-bold text-white mb-1.5">{feature.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{feature.desc}</p>
              </div>
            </motion.div>
          ))}
        </div>

        {/* Roadmap badge */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="max-w-2xl mx-auto"
        >
          <div className="relative rounded-2xl border border-purple-500/20 bg-card/50 backdrop-blur-md p-6 md:p-8 overflow-hidden">
            <div className="pointer-events-none absolute -right-16 -top-16 w-48 h-48 rounded-full bg-purple-600/15 blur-3xl" />
            <p className="relative text-xs font-semibold text-purple-300 uppercase tracking-widest mb-5">
              Integration Roadmap
            </p>
            <div className="relative flex flex-col sm:flex-row items-stretch gap-4">
              <div className="flex-1 flex items-center gap-3 rounded-xl border border-green-500/25 bg-green-950/25 px-4 py-3.5">
                <CheckCircle2 className="text-green-400 flex-shrink-0" size={22} />
                <div>
                  <p className="text-sm font-bold text-white leading-tight">Developer Integration</p>
                  <p className="text-xs text-green-400 font-semibold">Complete</p>
                </div>
              </div>

              <div className="hidden sm:flex items-center text-purple-400/50">
                <ArrowRight size={20} />
              </div>

              <div className="flex-1 flex items-center gap-3 rounded-xl border border-purple-400/25 bg-purple-950/20 px-4 py-3.5">
                <span className="relative flex-shrink-0 w-[22px] h-[22px] flex items-center justify-center">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-purple-400 opacity-35" />
                  <span className="relative w-2.5 h-2.5 rounded-full bg-purple-400" />
                </span>
                <div>
                  <p className="text-sm font-bold text-white leading-tight">Testing Phase</p>
                  <p className="text-xs text-purple-300 font-semibold">Next</p>
                </div>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
