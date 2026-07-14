import { useCallback, useEffect, useState } from "react";
import { useTitle } from "@/hooks/use-title";
import { motion, AnimatePresence } from "framer-motion";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { LaunchAnimation } from "@/components/LaunchAnimation";
// TODO(post-launch deploy): replace with the final App Store / Google Play link
const GET_APP_URL = "/download";

function openGetApp() {
  window.location.href = GET_APP_URL;
}

/* ── Particle Field ─────────────────────────────────────────── */
const PARTICLES = Array.from({ length: 48 }, (_, i) => ({
  id: i,
  x: ((i * 73 + 19) % 97) + 1,
  y: ((i * 41 + 7) % 95) + 2,
  size: 1 + (i % 3) * 0.7,
  delay: (i * 0.43) % 6,
  duration: 4 + (i % 5),
}));

function ParticleField() {
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden">
      {PARTICLES.map((p) => (
        <div
          key={p.id}
          className="absolute rounded-full bg-blue-400/30"
          style={{
            left: `${p.x}%`,
            top: `${p.y}%`,
            width: p.size,
            height: p.size,
            animation: `particle-drift ${p.duration}s ${p.delay}s ease-out infinite`,
          }}
        />
      ))}
    </div>
  );
}

/* ── The Massive V Headquarters SVG ─────────────────────────── */
function VHeadquartersSVG() {
  const LEFT = "M 90,48 L 350,666";
  const RIGHT = "M 610,48 L 350,666";
  const L_LEN = 672;

  const floors = [0.2, 0.38, 0.55, 0.72];

  return (
    <svg
      viewBox="0 0 700 720"
      className="w-full h-full"
      style={{ overflow: "visible" }}
    >
      <defs>
        <filter id="hq-glow-strong" x="-60%" y="-60%" width="220%" height="220%">
          <feGaussianBlur stdDeviation="12" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        <filter id="hq-glow-soft" x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="5" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        <filter id="hq-glow-apex" x="-100%" y="-100%" width="300%" height="300%">
          <feGaussianBlur stdDeviation="22" result="blur" />
          <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        <linearGradient id="arm-grad-l" x1="0.128" y1="0.067" x2="0.5" y2="0.925" gradientUnits="objectBoundingBox">
          <stop offset="0%" stopColor="#60a5fa" />
          <stop offset="100%" stopColor="#8b5cf6" />
        </linearGradient>
        <linearGradient id="arm-grad-r" x1="0.872" y1="0.067" x2="0.5" y2="0.925" gradientUnits="objectBoundingBox">
          <stop offset="0%" stopColor="#3b82f6" />
          <stop offset="100%" stopColor="#a855f7" />
        </linearGradient>
        <radialGradient id="apex-aura" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#a855f7" stopOpacity="0.9" />
          <stop offset="60%" stopColor="#7c3aed" stopOpacity="0.4" />
          <stop offset="100%" stopColor="#7c3aed" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Ambient apex aura */}
      <ellipse cx="350" cy="666" rx="160" ry="90" fill="url(#apex-aura)" className="animate-hq-breathe" />

      {/* Inner structure lines (depth effect) */}
      <motion.path d="M 134,48 L 358,666" stroke="rgba(96,165,250,0.12)" strokeWidth="1" fill="none"
        initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 2, delay: 1.2 }} />
      <motion.path d="M 566,48 L 342,666" stroke="rgba(168,85,247,0.12)" strokeWidth="1" fill="none"
        initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 2, delay: 1.2 }} />

      {/* Main V arms */}
      <motion.path d={LEFT} stroke="#60a5fa" strokeWidth="2.5" fill="none" filter="url(#hq-glow-soft)"
        initial={{ pathLength: 0, opacity: 0 }} animate={{ pathLength: 1, opacity: 1 }}
        transition={{ duration: 1.6, ease: "easeOut", delay: 0.4 }} />
      <motion.path d={RIGHT} stroke="#8b5cf6" strokeWidth="2.5" fill="none" filter="url(#hq-glow-soft)"
        initial={{ pathLength: 0, opacity: 0 }} animate={{ pathLength: 1, opacity: 1 }}
        transition={{ duration: 1.6, ease: "easeOut", delay: 0.6 }} />

      {/* Floor markers — left arm */}
      {floors.map((t, i) => {
        const x1 = 90 + t * (350 - 90);
        const y1 = 48 + t * (666 - 48);
        const x2 = 134 + t * (358 - 134);
        return (
          <motion.line key={`lf${i}`} x1={x1} y1={y1} x2={x2} y2={y1}
            stroke="rgba(96,165,250,0.4)" strokeWidth="0.9"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.8 + i * 0.1 }} />
        );
      })}

      {/* Floor markers — right arm */}
      {floors.map((t, i) => {
        const x1 = 610 + t * (350 - 610);
        const y1 = 48 + t * (666 - 48);
        const x2 = 566 + t * (342 - 566);
        return (
          <motion.line key={`rf${i}`} x1={x1} y1={y1} x2={x2} y2={y1}
            stroke="rgba(168,85,247,0.4)" strokeWidth="0.9"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.8 + i * 0.1 }} />
        );
      })}

      {/* Holographic display panels */}
      {[
        { x: 110, y: 175, w: 48, h: 28, c: "rgba(96,165,250,0.35)", d: 2.2 },
        { x: 542, y: 175, w: 48, h: 28, c: "rgba(168,85,247,0.35)", d: 2.4 },
        { x: 148, y: 358, w: 36, h: 22, c: "rgba(96,165,250,0.25)", d: 2.6 },
        { x: 516, y: 358, w: 36, h: 22, c: "rgba(168,85,247,0.25)", d: 2.7 },
        { x: 194, y: 500, w: 28, h: 16, c: "rgba(139,92,246,0.25)", d: 2.9 },
        { x: 478, y: 500, w: 28, h: 16, c: "rgba(139,92,246,0.25)", d: 3.0 },
      ].map((panel, i) => (
        <motion.rect key={i} x={panel.x} y={panel.y} width={panel.w} height={panel.h}
          fill="rgba(0,0,0,0.3)" stroke={panel.c} strokeWidth="0.8" rx="2"
          initial={{ opacity: 0 }} animate={{ opacity: [0, 1, 0.7, 1] }}
          transition={{ delay: panel.d, duration: 0.4, times: [0, 0.2, 0.6, 1] }} />
      ))}

      {/* Energy flows — animated sparks traveling along arms */}
      <motion.path d={LEFT} stroke="#60a5fa" strokeWidth="2" fill="none"
        strokeDasharray={`16 ${L_LEN - 16}`}
        animate={{ strokeDashoffset: [L_LEN, 0] }}
        transition={{ duration: 3, repeat: Infinity, ease: "linear", repeatDelay: 0.5 }}
        opacity={0.9} />
      <motion.path d={RIGHT} stroke="#a855f7" strokeWidth="2" fill="none"
        strokeDasharray={`16 ${L_LEN - 16}`}
        animate={{ strokeDashoffset: [0, L_LEN] }}
        transition={{ duration: 3.6, repeat: Infinity, ease: "linear", repeatDelay: 0.3 }}
        opacity={0.9} />

      {/* Apex core */}
      <motion.circle cx="350" cy="666" fill="#7c3aed" filter="url(#hq-glow-apex)"
        initial={{ r: 18 }}
        animate={{ r: [14, 22, 14], opacity: [1, 0.5, 1] }}
        transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut" }} />
      <circle cx="350" cy="666" r="5" fill="white" opacity="0.9" />

      {/* Top cap connectors */}
      <motion.line x1="90" y1="48" x2="134" y2="48" stroke="#60a5fa" strokeWidth="2" filter="url(#hq-glow-soft)"
        initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ delay: 2.0 }} />
      <motion.line x1="566" y1="48" x2="610" y2="48" stroke="#8b5cf6" strokeWidth="2" filter="url(#hq-glow-soft)"
        initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ delay: 2.0 }} />

      {/* Top endpoint nodes */}
      <motion.circle cx="90" cy="48" r="5" fill="#60a5fa" filter="url(#hq-glow-soft)"
        initial={{ opacity: 0 }} animate={{ opacity: [0, 1, 0.6, 1] }}
        transition={{ delay: 2.1, duration: 0.6 }} />
      <motion.circle cx="610" cy="48" r="5" fill="#8b5cf6" filter="url(#hq-glow-soft)"
        initial={{ opacity: 0 }} animate={{ opacity: [0, 1, 0.6, 1] }}
        transition={{ delay: 2.1, duration: 0.6 }} />
      <motion.circle cx="134" cy="48" r="3" fill="#60a5fa" opacity="0.5"
        initial={{ opacity: 0 }} animate={{ opacity: 0.5 }} transition={{ delay: 2.2 }} />
      <motion.circle cx="566" cy="48" r="3" fill="#8b5cf6" opacity="0.5"
        initial={{ opacity: 0 }} animate={{ opacity: 0.5 }} transition={{ delay: 2.2 }} />

      {/* Drone lights */}
      {[
        { bx: 168, by: 210, dx: 14, dy: 10, dur: 7, d: 3.0, c: "#60a5fa" },
        { bx: 532, by: 210, dx: 12, dy: 14, dur: 8, d: 3.3, c: "#a855f7" },
        { bx: 200, by: 390, dx: 16, dy: 8, dur: 6, d: 3.6, c: "#3b82f6" },
        { bx: 500, by: 390, dx: 10, dy: 16, dur: 9, d: 3.9, c: "#8b5cf6" },
        { bx: 240, by: 540, dx: 12, dy: 6, dur: 7.5, d: 4.2, c: "#60a5fa" },
        { bx: 460, by: 540, dx: 14, dy: 10, dur: 8.5, d: 4.5, c: "#a855f7" },
      ].map((drone, i) => (
        <motion.circle key={`dr${i}`} r="3" fill={drone.c} filter="url(#hq-glow-soft)"
          animate={{ cx: [drone.bx, drone.bx + drone.dx, drone.bx, drone.bx - drone.dx, drone.bx], cy: [drone.by, drone.by - drone.dy, drone.by + drone.dy, drone.by - drone.dy / 2, drone.by] }}
          initial={{ cx: drone.bx, cy: drone.by, opacity: 0 }}
          transition={{ cx: { duration: drone.dur, repeat: Infinity, ease: "easeInOut" }, cy: { duration: drone.dur * 0.7, repeat: Infinity, ease: "easeInOut" }, opacity: { delay: drone.d, duration: 0.5 } }}
        />
      ))}
    </svg>
  );
}

/* ── Scanning overlay ────────────────────────────────────────── */
function ScanLine({ color = "rgba(96,165,250,0.15)" }: { color?: string }) {
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      <div
        className="absolute left-0 right-0 h-px animate-hologram-scan"
        style={{ background: `linear-gradient(90deg, transparent, ${color}, transparent)` }}
      />
    </div>
  );
}

/* ── Department Visualizations ───────────────────────────────── */

function MissionControlViz() {
  const DOT_ACTIVE = [1, 5, 8, 11, 14, 18, 22, 25, 28, 33, 36, 38, 42];
  return (
    <div className="relative rounded-2xl overflow-hidden h-72 glass-panel-blue p-1">
      <ScanLine />
      <div className="absolute inset-0 pointer-events-none">
        <svg viewBox="0 0 320 200" className="w-full h-full opacity-20">
          {[50, 90, 130, 170].map(y => (
            <ellipse key={y} cx="160" cy={y} rx="145" ry="18" fill="none" stroke="#60a5fa" strokeWidth="0.5" />
          ))}
          {[40, 90, 130, 160, 200, 240, 280].map(x => (
            <line key={x} x1={x} y1="10" x2={x} y2="190" stroke="#60a5fa" strokeWidth="0.4" />
          ))}
        </svg>
      </div>
      <div className="relative z-10 grid grid-cols-9 gap-2 p-5 pt-8">
        {Array.from({ length: 45 }, (_, i) => {
          const isActive = DOT_ACTIVE.includes(i);
          return (
            <motion.div
              key={i}
              className={`w-2 h-2 rounded-full ${isActive ? "bg-blue-400" : "bg-blue-900/25"}`}
              animate={isActive ? { opacity: [1, 0.25, 1], scale: [1, 1.6, 1] } : undefined}
              transition={{ duration: 1.4 + (i % 3) * 0.4, repeat: Infinity, delay: (i * 0.2) % 2.5 }}
            />
          );
        })}
      </div>
      <div className="absolute top-3 left-4 right-4 flex items-center justify-between">
        <span className="text-xs text-blue-400 font-mono tracking-widest">GLOBAL ACTIVITY</span>
        <motion.span className="text-xs text-blue-300 font-mono" animate={{ opacity: [0.5, 1, 0.5] }} transition={{ duration: 1.2, repeat: Infinity }}>
          ● 12,847 LIVE
        </motion.span>
      </div>
      <div className="absolute bottom-3 left-4 right-4 flex gap-3">
        {["STREAMS", "VIEWERS", "REVENUE"].map((label, i) => (
          <div key={label} className="flex-1 bg-blue-900/30 rounded px-2 py-1.5 border border-blue-500/20">
            <div className="text-[9px] text-blue-500 font-mono mb-0.5">{label}</div>
            <div className="text-xs text-blue-300 font-mono font-bold">
              {["8.2K", "2.4M", "$94K"][i]}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function BrandRelationsViz() {
  const BRANDS = [
    { name: "Nike", angle: 0, color: "#f59e0b" },
    { name: "Adidas", angle: 60, color: "#fbbf24" },
    { name: "Red Bull", angle: 120, color: "#f97316" },
    { name: "Sony", angle: 180, color: "#f59e0b" },
    { name: "GoPro", angle: 240, color: "#fbbf24" },
    { name: "Beats", angle: 300, color: "#f97316" },
  ];
  const R = 90;
  const cx = 150;
  const cy = 110;

  return (
    <div className="relative rounded-2xl overflow-hidden h-72 border border-amber-500/20 p-1" style={{ background: "rgba(245,158,11,0.03)" }}>
      <ScanLine color="rgba(245,158,11,0.12)" />
      <div className="absolute top-3 left-4 right-4 flex items-center justify-between">
        <span className="text-xs text-amber-400 font-mono tracking-widest">BRAND SCOUT</span>
        <motion.span className="text-xs text-amber-300 font-mono bg-amber-900/30 px-2 py-0.5 rounded-full border border-amber-500/30"
          animate={{ opacity: [0.7, 1, 0.7] }} transition={{ duration: 1.5, repeat: Infinity }}>
          SEARCHING...
        </motion.span>
      </div>
      <svg viewBox="0 0 300 220" className="w-full h-full mt-4">
        {BRANDS.map((brand, i) => {
          const rad = (brand.angle * Math.PI) / 180;
          const bx = cx + R * Math.cos(rad);
          const by = cy + R * Math.sin(rad);
          return (
            <g key={brand.name}>
              <motion.line x1={cx} y1={cy} x2={bx} y2={by} stroke={brand.color} strokeWidth="0.8" strokeDasharray="4 4"
                strokeOpacity="0.5" animate={{ strokeDashoffset: [0, -16] }}
                transition={{ duration: 1.5 + i * 0.3, repeat: Infinity, ease: "linear" }} />
              <motion.circle cx={bx} cy={by} r="16" fill="rgba(0,0,0,0.6)" stroke={brand.color} strokeWidth="1"
                strokeOpacity="0.5" animate={{ scale: [1, 1.08, 1], opacity: [0.7, 1, 0.7] }}
                transition={{ duration: 2 + i * 0.25, repeat: Infinity, delay: i * 0.3 }} />
              <text x={bx} y={by} textAnchor="middle" dominantBaseline="middle" fill={brand.color} fontSize="6" fontFamily="monospace" opacity="0.9">
                {brand.name}
              </text>
            </g>
          );
        })}
        <circle cx={cx} cy={cy} r="22" fill="rgba(245,158,11,0.12)" stroke="#f59e0b" strokeWidth="1.5" />
        <text x={cx} y={cy - 5} textAnchor="middle" fill="#fbbf24" fontSize="7" fontFamily="monospace">YOU</text>
        <text x={cx} y={cy + 6} textAnchor="middle" fill="#fbbf24" fontSize="5" fontFamily="monospace">CREATOR</text>
        <motion.circle cx={cx} cy={cy} fill="none" stroke="#f59e0b" strokeWidth="0.5" strokeOpacity="0.4"
          initial={{ r: 28 }}
          animate={{ r: [28, 42, 28] }} transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut" }} />
      </svg>
    </div>
  );
}

function CreatorSuccessViz() {
  const bars = [
    { label: "Views", value: 87, color: "#22c55e" },
    { label: "Subs", value: 64, color: "#4ade80" },
    { label: "Revenue", value: 73, color: "#16a34a" },
    { label: "Watch Time", value: 91, color: "#22c55e" },
  ];
  return (
    <div className="relative rounded-2xl overflow-hidden h-72 border border-green-500/20 p-4" style={{ background: "rgba(34,197,94,0.03)" }}>
      <ScanLine color="rgba(34,197,94,0.12)" />
      <div className="flex items-center justify-between mb-4">
        <span className="text-xs text-green-400 font-mono tracking-widest">GROWTH COACH</span>
        <span className="text-xs text-green-300 font-mono">▲ 28% this month</span>
      </div>
      <div className="space-y-3">
        {bars.map((bar, i) => (
          <div key={bar.label}>
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-mono text-green-300/70">{bar.label}</span>
              <motion.span className="text-xs font-mono text-green-400 font-bold"
                initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }}>
                {bar.value}%
              </motion.span>
            </div>
            <div className="h-2 bg-green-900/30 rounded-full overflow-hidden">
              <motion.div
                className="h-full rounded-full"
                style={{ background: `linear-gradient(90deg, ${bar.color}, #4ade80)` }}
                initial={{ width: 0 }}
                whileInView={{ width: `${bar.value}%` }}
                viewport={{ once: true }}
                transition={{ duration: 1.2, delay: i * 0.15, ease: "easeOut" }}
              />
            </div>
          </div>
        ))}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2">
        {[{ label: "Audience Health", v: "A+" }, { label: "Engagement Rate", v: "8.4%" }].map(s => (
          <div key={s.label} className="bg-green-900/20 border border-green-500/20 rounded-lg p-2 text-center">
            <div className="text-[10px] text-green-600 font-mono mb-1">{s.label}</div>
            <div className="text-sm font-bold text-green-400 font-mono">{s.v}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function TrendLabViz() {
  const topics = [
    { label: "#POVLife", heat: 98 },
    { label: "#LiveStream", heat: 84 },
    { label: "#AICreator", heat: 91 },
    { label: "#Wearable", heat: 67 },
    { label: "#MetaGlass", heat: 79 },
    { label: "#GoLive", heat: 72 },
    { label: "#MultiStream", heat: 55 },
    { label: "#ClipAI", heat: 88 },
  ];
  return (
    <div className="relative rounded-2xl overflow-hidden h-72 border border-pink-500/20 p-4" style={{ background: "rgba(236,72,153,0.03)" }}>
      <ScanLine color="rgba(236,72,153,0.12)" />
      <div className="flex items-center justify-between mb-4">
        <span className="text-xs text-pink-400 font-mono tracking-widest">TREND HUNTER</span>
        <motion.span className="text-xs text-pink-300 font-mono" animate={{ opacity: [0.5, 1, 0.5] }} transition={{ duration: 0.8, repeat: Infinity }}>
          ● MONITORING
        </motion.span>
      </div>
      <div className="flex flex-wrap gap-2">
        {topics.map((t, i) => {
          const h = t.heat / 100;
          const r = Math.round(236 * h + 139 * (1 - h));
          const g = Math.round(72 * h);
          const b = Math.round(153 * h);
          return (
            <motion.div
              key={t.label}
              className="px-2.5 py-1.5 rounded-lg border text-xs font-mono font-semibold cursor-default"
              style={{
                borderColor: `rgba(${r},${g},${b},0.5)`,
                background: `rgba(${r},${g},${b},0.12)`,
                color: `rgb(${r},${g},${b})`,
              }}
              animate={{ opacity: [0.7, 1, 0.7], scale: [1, 1.03, 1] }}
              transition={{ duration: 1.5 + (i % 3) * 0.5, repeat: Infinity, delay: i * 0.2 }}
            >
              {t.label}
              <span className="ml-1.5 opacity-60">{t.heat}</span>
            </motion.div>
          );
        })}
      </div>
      <div className="absolute bottom-3 left-4 right-4">
        <div className="text-[10px] text-pink-500 font-mono mb-1">GLOBAL HEAT INDEX</div>
        <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "linear-gradient(90deg, rgba(139,92,246,0.3), rgba(236,72,153,0.6), rgba(239,68,68,0.9))" }}>
          <motion.div className="h-full w-2 bg-white/70 rounded-full"
            animate={{ x: [0, 280, 0] }} transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }} />
        </div>
      </div>
    </div>
  );
}

function ClipStudioViz() {
  return (
    <div className="relative rounded-2xl overflow-hidden h-72 border border-cyan-500/20 p-4" style={{ background: "rgba(6,182,212,0.03)" }}>
      <ScanLine color="rgba(6,182,212,0.12)" />
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-cyan-400 font-mono tracking-widest">CLIP STUDIO</span>
        <motion.span className="text-xs text-cyan-300 font-mono bg-cyan-900/30 px-2 py-0.5 rounded-full border border-cyan-500/30"
          animate={{ opacity: [0.6, 1, 0.6] }} transition={{ duration: 1.5, repeat: Infinity }}>
          RENDERING...
        </motion.span>
      </div>
      <div className="space-y-3">
        {["Stream Highlight #1", "Epic Moment Clip", "AI Best-Of Reel"].map((clip, i) => (
          <div key={clip} className="bg-cyan-900/15 border border-cyan-500/15 rounded-lg p-2.5">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-mono text-cyan-300">{clip}</span>
              <span className="text-[10px] font-mono text-cyan-500">
                {["✓ Done", "87%", "Queued"][i]}
              </span>
            </div>
            <div className="h-1.5 bg-cyan-900/40 rounded-full overflow-hidden">
              <motion.div
                className="h-full bg-gradient-to-r from-cyan-500 to-blue-400 rounded-full"
                initial={{ width: 0 }}
                animate={{ width: [100, 100, 87, 87, 0, 0][i] + "%" }}
                transition={{ duration: 2, delay: i * 0.8, ease: "easeOut" }}
              />
            </div>
          </div>
        ))}
      </div>
      <div className="mt-3 bg-cyan-900/10 border border-cyan-500/10 rounded-lg p-2.5">
        <div className="text-[10px] text-cyan-500 font-mono mb-1">AI CAPTION GENERATION</div>
        <motion.div className="text-xs text-cyan-300 font-mono overflow-hidden whitespace-nowrap"
          animate={{ width: ["0%", "100%"] }} transition={{ duration: 3, delay: 1, repeat: Infinity, repeatDelay: 2 }}>
          "The most insane POV stream of the year 🔥"
        </motion.div>
      </div>
    </div>
  );
}

function CollabCenterViz() {
  const creators = [
    { cx: 150, cy: 100, name: "YOU", main: true },
    { cx: 60, cy: 50, name: "@viper" },
    { cx: 240, cy: 50, name: "@nova" },
    { cx: 40, cy: 140, name: "@axel" },
    { cx: 260, cy: 140, name: "@luna" },
    { cx: 90, cy: 185, name: "@kaz" },
    { cx: 210, cy: 185, name: "@rex" },
  ];
  return (
    <div className="relative rounded-2xl overflow-hidden h-72 border border-purple-500/20 p-4" style={{ background: "rgba(139,92,246,0.03)" }}>
      <ScanLine color="rgba(139,92,246,0.12)" />
      <div className="absolute top-3 left-4 right-4 flex items-center justify-between">
        <span className="text-xs text-purple-400 font-mono tracking-widest">COLLAB CENTER</span>
        <span className="text-xs text-purple-300 font-mono">6 MATCHES FOUND</span>
      </div>
      <svg viewBox="0 0 300 230" className="w-full h-full mt-2">
        {creators.slice(1).map((c, i) => (
          <motion.line key={i} x1={creators[0].cx} y1={creators[0].cy} x2={c.cx} y2={c.cy}
            stroke="#8b5cf6" strokeWidth="0.8" strokeOpacity="0.4" strokeDasharray="4 4"
            animate={{ strokeDashoffset: [0, -20] }}
            transition={{ duration: 2 + i * 0.3, repeat: Infinity, ease: "linear" }} />
        ))}
        {creators.map((c, i) => (
          <g key={i}>
            <motion.circle cx={c.cx} cy={c.cy} r={c.main ? 18 : 13}
              fill={c.main ? "rgba(139,92,246,0.25)" : "rgba(139,92,246,0.1)"}
              stroke={c.main ? "#a855f7" : "#8b5cf6"}
              strokeWidth={c.main ? 1.5 : 0.8}
              animate={{ opacity: [0.6, 1, 0.6] }}
              transition={{ duration: 2.5, repeat: Infinity, delay: i * 0.3 }} />
            <text x={c.cx} y={c.cy} textAnchor="middle" dominantBaseline="middle"
              fill={c.main ? "#c084fc" : "#a78bfa"} fontSize={c.main ? 6 : 5} fontFamily="monospace">
              {c.name}
            </text>
          </g>
        ))}
        <motion.circle cx={creators[0].cx} cy={creators[0].cy} fill="none" stroke="#a855f7"
          strokeWidth="0.5" strokeOpacity="0.4"
          initial={{ r: 24 }}
          animate={{ r: [24, 36, 24] }} transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }} />
      </svg>
    </div>
  );
}

function AICoreViz() {
  return (
    <div className="flex items-center justify-center">
      <div className="relative flex items-center justify-center w-72 h-72">
        {/* Outer pulse rings */}
        {[0, 0.6, 1.2].map((delay, i) => (
          <div key={i} className="absolute rounded-full border border-purple-500/30 animate-core-pulse-ring"
            style={{ width: 80 + i * 30, height: 80 + i * 30, animationDelay: `${delay}s`, animationDuration: "3s" }} />
        ))}
        {/* Orbital rings */}
        <div className="absolute w-52 h-52 rounded-full border border-purple-400/20 animate-hq-rotate" />
        <div className="absolute w-40 h-40 rounded-full border border-blue-400/20 animate-hq-spin-reverse" />
        <div className="absolute w-64 h-64 rounded-full border border-violet-500/10 animate-hq-rotate" style={{ animationDuration: "30s" }} />
        {/* Orbital nodes */}
        {[0, 72, 144, 216, 288].map((angle, i) => {
          const rad = (angle * Math.PI) / 180;
          return (
            <motion.div key={i} className="absolute w-2 h-2 rounded-full bg-purple-400"
              style={{ top: "50%", left: "50%", transform: `translate(-50%, -50%) translate(${Math.cos(rad) * 96}px, ${Math.sin(rad) * 96}px)` }}
              animate={{ opacity: [0.4, 1, 0.4] }}
              transition={{ duration: 2, repeat: Infinity, delay: i * 0.4 }} />
          );
        })}
        {/* Core */}
        <div className="relative z-10 w-24 h-24 rounded-full flex items-center justify-center"
          style={{ background: "radial-gradient(circle, rgba(139,92,246,0.9) 0%, rgba(79,70,229,0.6) 50%, rgba(139,92,246,0.2) 100%)", boxShadow: "0 0 60px rgba(139,92,246,0.8), 0 0 120px rgba(139,92,246,0.4)" }}>
          <motion.div className="text-white font-hero text-3xl font-black"
            animate={{ opacity: [0.8, 1, 0.8], scale: [0.95, 1.05, 0.95] }}
            transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}>
            AI
          </motion.div>
        </div>
      </div>
    </div>
  );
}

/* ── AI Assistant hover panel ────────────────────────────────── */
interface AssistantProps {
  name: string;
  message: string;
  accentColor: string;
}

function AIAssistantPanel({ name, message, accentColor }: AssistantProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 8, scale: 0.96 }}
      transition={{ duration: 0.2 }}
      className="absolute bottom-full left-0 mb-3 z-30 min-w-[220px] max-w-xs"
    >
      <div className="rounded-xl border backdrop-blur-xl p-3"
        style={{ background: "rgba(3,4,8,0.92)", borderColor: `${accentColor}40` }}>
        <div className="flex items-center gap-2 mb-1.5">
          <motion.div className="w-1.5 h-1.5 rounded-full" style={{ background: accentColor }}
            animate={{ opacity: [0.4, 1, 0.4] }} transition={{ duration: 0.8, repeat: Infinity }} />
          <span className="text-[10px] font-mono font-bold uppercase tracking-widest" style={{ color: accentColor }}>
            {name}
          </span>
        </div>
        <p className="text-xs text-white/80 font-mono leading-relaxed">{message}</p>
      </div>
    </motion.div>
  );
}

/* ── Department Section ───────────────────────────────────────── */
interface DeptConfig {
  id: string;
  num: string;
  name: string;
  tag: string;
  headline: string;
  description: string;
  accentColor: string;
  assistantName: string;
  assistantMessage: string;
  viz: React.ReactNode;
  flip: boolean;
}

function DepartmentSection({ dept }: { dept: DeptConfig }) {
  const [hovered, setHovered] = useState(false);

  return (
    <motion.section
      id={dept.id}
      className="relative py-24 border-b overflow-hidden hq-section-bg"
      style={{ borderColor: `${dept.accentColor}12` }}
      initial={{ opacity: 0 }}
      whileInView={{ opacity: 1 }}
      viewport={{ once: true, margin: "-100px" }}
    >
      {/* Section grid */}
      <div className="absolute inset-0 pointer-events-none opacity-30"
        style={{
          backgroundImage: `
            repeating-linear-gradient(0deg, transparent, transparent 60px, ${dept.accentColor}05 60px, ${dept.accentColor}05 61px),
            repeating-linear-gradient(90deg, transparent, transparent 60px, ${dept.accentColor}05 60px, ${dept.accentColor}05 61px)
          `,
        }}
      />

      {/* Ambient glow */}
      <div className="absolute pointer-events-none rounded-full blur-[120px] opacity-20"
        style={{ width: 400, height: 400, background: dept.accentColor, top: "20%", [dept.flip ? "right" : "left"]: "-5%" }} />

      <div className="relative z-10 max-w-7xl mx-auto px-6">
        <div className={`grid grid-cols-1 lg:grid-cols-2 gap-12 items-center ${dept.flip ? "lg:grid-flow-col-dense" : ""}`}>

          {/* Text side */}
          <motion.div
            className={dept.flip ? "lg:col-start-2" : ""}
            initial={{ opacity: 0, x: dept.flip ? 40 : -40 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.7, ease: "easeOut" }}
          >
            <div className="flex items-center gap-3 mb-6">
              <span className="text-xs font-mono tracking-widest" style={{ color: dept.accentColor }}>
                DEPT {dept.num}
              </span>
              <div className="h-px flex-1 max-w-16" style={{ background: `${dept.accentColor}60` }} />
              <span className="text-xs font-mono tracking-widest opacity-50" style={{ color: dept.accentColor }}>
                {dept.tag}
              </span>
            </div>

            <h2 className="font-hero font-black uppercase text-white mb-4 leading-[0.92]"
              style={{ fontSize: "clamp(2.5rem, 5vw, 4rem)" }}>
              {dept.name}
            </h2>
            <p className="text-xl font-light mb-2" style={{ color: dept.accentColor }}>
              {dept.headline}
            </p>
            <p className="text-muted-foreground leading-relaxed max-w-lg">
              {dept.description}
            </p>

            <div className="mt-8 flex items-center gap-3">
              <motion.div className="w-1.5 h-1.5 rounded-full animate-status-blink" style={{ background: dept.accentColor }} />
              <span className="text-xs font-mono tracking-wider" style={{ color: dept.accentColor }}>
                DEPARTMENT ACTIVE
              </span>
            </div>
          </motion.div>

          {/* Viz side */}
          <motion.div
            className={`relative ${dept.flip ? "lg:col-start-1 lg:row-start-1" : ""}`}
            initial={{ opacity: 0, x: dept.flip ? -40 : 40 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.7, ease: "easeOut", delay: 0.1 }}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
          >
            {dept.viz}
            <AnimatePresence>
              {hovered && (
                <AIAssistantPanel
                  name={dept.assistantName}
                  message={dept.assistantMessage}
                  accentColor={dept.accentColor}
                />
              )}
            </AnimatePresence>
          </motion.div>
        </div>
      </div>
    </motion.section>
  );
}

/* ── Pricing Section ──────────────────────────────────────────── */
function PricingSection() {
  return (
    <section className="py-32 bg-background border-y border-purple-500/10 relative overflow-hidden">
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-px bg-gradient-to-r from-transparent via-purple-500/30 to-transparent" />
        <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[800px] h-px bg-gradient-to-r from-transparent via-blue-500/20 to-transparent" />
      </div>
      <div className="relative z-10 max-w-7xl mx-auto px-6">
        <motion.div className="text-center mb-16" initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}>
          <p className="text-xs font-mono text-blue-400 uppercase tracking-widest mb-4">HQ ACCESS CLEARANCE</p>
          <h2 className="font-hero text-5xl md:text-6xl font-black uppercase text-white leading-[0.92]">
            Choose Your <span className="text-gradient-brand">Clearance Level</span>
          </h2>
          <p className="text-muted-foreground mt-4 max-w-xl mx-auto">
            Every plan grants access to headquarters. Upgrade to unlock more AI departments.
          </p>
        </motion.div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {[
            {
              level: "ALPHA", name: "Free", price: "$0", tag: "Ground Floor Access",
              color: "#60a5fa", features: ["1 Platform Output", "Standard Quality", "VYBE Watermark", "Basic Dashboard"],
              cta: "Enter HQ",
            },
            {
              level: "DELTA", name: "Pro", price: "$29", tag: "Full Command Access",
              color: "#a855f7", features: ["3 Platform Outputs", "1080p Quality", "No Watermark", "AI Clip Generation", "All Analytics", "Priority Support"],
              cta: "Activate Your AI Team", featured: true,
            },
            {
              level: "OMEGA", name: "Enterprise", price: "$99", tag: "Elite Clearance",
              color: "#c084fc", features: ["Unlimited Platforms", "4K Quality", "Advanced Analytics", "Wearable Device Support", "Dedicated AI Agent", "SLA Guarantee"],
              cta: "Contact Command",
            },
          ].map((plan, i) => (
            <motion.div
              key={plan.name}
              initial={{ opacity: 0, y: 24 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.1 }}
              className={`relative rounded-2xl p-8 flex flex-col ${plan.featured ? "md:-translate-y-4" : ""}`}
              style={{
                background: plan.featured ? "rgba(88,28,135,0.12)" : "rgba(255,255,255,0.02)",
                border: `1px solid ${plan.color}30`,
                boxShadow: plan.featured ? `0 0 60px -20px ${plan.color}50` : "none",
              }}
            >
              {plan.featured && (
                <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-gradient-to-r from-purple-600 to-fuchsia-600 text-white px-5 py-1 rounded-full text-xs font-black uppercase tracking-wider">
                  Most Popular
                </div>
              )}
              <div className="mb-6">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border text-xs font-mono mb-4"
                  style={{ borderColor: `${plan.color}40`, color: plan.color, background: `${plan.color}10` }}>
                  <span className="w-1 h-1 rounded-full animate-status-blink" style={{ background: plan.color }} />
                  CLEARANCE {plan.level}
                </div>
                <h3 className="text-2xl font-bold mb-1" style={{ color: plan.color }}>{plan.name}</h3>
                <p className="text-xs text-muted-foreground font-mono mb-4">{plan.tag}</p>
                <div className="text-4xl font-display font-black text-white">
                  {plan.price}<span className="text-lg text-muted-foreground font-sans font-normal">/mo</span>
                </div>
              </div>
              <ul className="space-y-3 mb-8 flex-1">
                {plan.features.map(f => (
                  <li key={f} className="flex items-center gap-2.5 text-sm text-muted-foreground">
                    <div className="w-1 h-1 rounded-full flex-shrink-0" style={{ background: plan.color }} />
                    {f}
                  </li>
                ))}
              </ul>
              <Button
                onClick={plan.name === "Enterprise" ? undefined : openGetApp}
                asChild={plan.name === "Enterprise" ? true : undefined}
                className="w-full rounded-full h-12 font-bold transition-all"
                style={plan.featured
                  ? { background: `linear-gradient(135deg, #7c3aed, #a855f7)`, color: "white", boxShadow: `0 0 24px ${plan.color}40` }
                  : { background: `${plan.color}15`, borderColor: `${plan.color}40`, color: plan.color }}
                variant={plan.featured ? "default" : "outline"}
              >
                {plan.name === "Enterprise" ? <Link href="/contact">{plan.cta}</Link> : plan.cta}
              </Button>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ── Main Home Component ──────────────────────────────────────── */
const DEPARTMENTS: DeptConfig[] = [
  {
    id: "mission-control", num: "01", name: "Mission Control", tag: "INTELLIGENCE",
    headline: "Global Creator Activity at a Glance",
    description: "Track every creator, every stream, every live moment happening across the VYBE network in real time. Your AI continuously monitors global activity, surfaces opportunities, and delivers mission-critical intelligence to your command center.",
    accentColor: "#60a5fa", assistantName: "Mission AI",
    assistantMessage: "Monitoring 12,847 active streams across 94 countries. Identifying high-opportunity windows for your content schedule...",
    viz: <MissionControlViz />, flip: false,
  },
  {
    id: "brand-relations", num: "02", name: "Brand Relations", tag: "SPONSORSHIPS",
    headline: "Your Personal Brand Scout, Never Sleeps",
    description: "Brand Scout continuously scans the creator economy for sponsorship opportunities that match your niche, audience, and engagement profile. Automated outreach, relationship tracking, and deal management — all handled by your AI.",
    accentColor: "#f59e0b", assistantName: "Brand Scout",
    assistantMessage: "Searching for sponsorship opportunities... Found 3 matching brands in your niche. Initiating outreach sequence...",
    viz: <BrandRelationsViz />, flip: true,
  },
  {
    id: "creator-success", num: "03", name: "Creator Success", tag: "GROWTH",
    headline: "Your Growth Coach Runs the Numbers",
    description: "AI-powered performance analysis gives you a personalized creator roadmap. Audience insights, content strategy recommendations, and growth projections — updated after every stream so you always know your next move.",
    accentColor: "#22c55e", assistantName: "Growth Coach",
    assistantMessage: "Preparing recommendations... Your watch time is up 28% this week. Optimizing your next content window for maximum reach.",
    viz: <CreatorSuccessViz />, flip: false,
  },
  {
    id: "trend-lab", num: "04", name: "Trend Lab", tag: "INTELLIGENCE",
    headline: "AI Eyes on Every Conversation",
    description: "Trend Hunter monitors global conversations, viral content patterns, and emerging niches in real time. Stay ahead of the curve with content predictions, trending topics, and heat maps showing what your audience wants before they even know it.",
    accentColor: "#ec4899", assistantName: "Trend Hunter",
    assistantMessage: "Monitoring creator trends... #POVLife spiking 340% this week. Recommending content window in next 4 hours.",
    viz: <TrendLabViz />, flip: true,
  },
  {
    id: "clip-studio", num: "05", name: "Clip Studio", tag: "PRODUCTION",
    headline: "AI Renders Your Best Moments",
    description: "Every stream is automatically analyzed, clipped, captioned, and optimized for each platform. Clip Studio renders your highlights while you focus on creating — delivering short-form content ready to publish to YouTube, TikTok, Instagram, and more.",
    accentColor: "#06b6d4", assistantName: "Clip Studio AI",
    assistantMessage: "Rendering highlight clips... Identified 7 peak moments from last stream. Generating captions in 3 languages.",
    viz: <ClipStudioViz />, flip: false,
  },
  {
    id: "collab-center", num: "06", name: "Collaboration Center", tag: "COMMUNITY",
    headline: "Find Your Perfect Creator Match",
    description: "Collaboration Center maps the creator network and surfaces the highest-impact collaboration opportunities for your channel. AI analyzes audience overlap, content compatibility, and growth potential to recommend creators worth connecting with.",
    accentColor: "#a855f7", assistantName: "Collab AI",
    assistantMessage: "Scanning creator network... Found 6 high-compatibility matches in your niche. Preparing introduction sequence...",
    viz: <CollabCenterViz />, flip: true,
  },
];

export default function Home() {
  useTitle("VYBE AI Headquarters — The Creator Platform");

  const [animDone, setAnimDone] = useState(() => {
    try { return sessionStorage.getItem("vybe-intro-done") === "1"; } catch { return false; }
  });

  const handleAnimDone = useCallback(() => {
    try { sessionStorage.setItem("vybe-intro-done", "1"); } catch {}
    setAnimDone(true);
  }, []);

  useEffect(() => {
    document.body.style.overflow = animDone ? "" : "hidden";
    return () => { document.body.style.overflow = ""; };
  }, [animDone]);

  return (
    <>
      {!animDone && <LaunchAnimation onComplete={handleAnimDone} />}

      <div className="flex flex-col min-h-screen">

        {/* ── HERO ─────────────────────────────────────────────────────── */}
        <section className="relative min-h-screen flex flex-col items-center justify-center overflow-hidden pt-20"
          style={{ background: "radial-gradient(ellipse 80% 60% at 50% 40%, rgba(59,130,246,0.06) 0%, rgba(139,92,246,0.04) 40%, transparent 70%), hsl(270 20% 3%)" }}>

          <ParticleField />

          {/* Grid overlay */}
          <div className="absolute inset-0 pointer-events-none" style={{
            backgroundImage: `
              repeating-linear-gradient(0deg, transparent, transparent 70px, rgba(59,130,246,0.04) 70px, rgba(59,130,246,0.04) 71px),
              repeating-linear-gradient(90deg, transparent, transparent 70px, rgba(59,130,246,0.04) 70px, rgba(59,130,246,0.04) 71px)
            `,
          }} />

          {/* Light streaks */}
          <div className="absolute inset-0 pointer-events-none overflow-hidden">
            {[
              { top: "20%", width: "40%", delay: 0, dur: 5 },
              { top: "55%", width: "60%", delay: 2.5, dur: 4.2 },
              { top: "78%", width: "35%", delay: 1.2, dur: 5.8 },
            ].map((s, i) => (
              <motion.div key={i} className="absolute h-px pointer-events-none"
                style={{ top: s.top, left: 0, width: s.width, background: "linear-gradient(90deg, transparent, rgba(96,165,250,0.4), rgba(168,85,247,0.3), transparent)" }}
                animate={{ x: ["-100%", "600%"] }}
                transition={{ duration: s.dur, delay: s.delay, repeat: Infinity, repeatDelay: 6, ease: "linear" }} />
            ))}
          </div>

          {/* Massive V Headquarters */}
          <div className="relative z-10 w-full max-w-2xl mx-auto px-6 animate-hq-float" style={{ height: "min(55vh, 480px)" }}>
            <VHeadquartersSVG />
          </div>

          {/* Hero text */}
          <div className="relative z-10 text-center px-6 max-w-5xl mx-auto mt-4">
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 2.8 }}
              className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full border border-blue-400/25 text-blue-300 text-xs font-mono uppercase tracking-widest mb-6"
              style={{ background: "rgba(59,130,246,0.08)" }}>
              <motion.span className="w-1.5 h-1.5 rounded-full bg-blue-400" animate={{ opacity: [0.4, 1, 0.4] }} transition={{ duration: 1, repeat: Infinity }} />
              AI Headquarters — Now Activating
            </motion.div>

            <motion.h1 initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, delay: 3.0 }}
              className="font-hero font-black uppercase text-white leading-[0.88] tracking-tight"
              style={{ fontSize: "clamp(3rem, 9vw, 7.5rem)" }}>
              Meet Your{" "}
              <span className="text-gradient-brand">AI Creator</span>
              <br />Headquarters
            </motion.h1>

            <motion.p initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 3.2 }}
              className="mt-6 text-lg md:text-xl text-muted-foreground max-w-2xl mx-auto leading-relaxed">
              Not another streaming platform.{" "}
              <span className="text-white/80">An AI company working for you 24/7.</span>
            </motion.p>

            <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 3.4 }}
              className="mt-10 flex flex-col sm:flex-row items-center gap-4 justify-center">
              <Button size="lg" onClick={openGetApp}
                className="h-14 px-10 rounded-full text-white font-bold text-lg w-full sm:w-auto transition-all"
                style={{ background: "linear-gradient(135deg, #3b82f6, #7c3aed, #a855f7)", boxShadow: "0 0 50px rgba(99,102,241,0.5)" }}>
                Enter Headquarters
              </Button>
              <Button size="lg" variant="outline" onClick={openGetApp}
                className="h-14 px-10 rounded-full font-bold text-lg w-full sm:w-auto border-purple-500/30 bg-purple-500/5 hover:bg-purple-500/10 text-white backdrop-blur-sm">
                Download VYBE Live
              </Button>
            </motion.div>

            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 3.7 }}
              className="mt-10 flex flex-wrap items-center justify-center gap-3">
              {["Mission Control", "Brand Relations", "Clip Studio", "Trend Lab", "AI Core"].map(d => (
                <span key={d} className="px-3 py-1.5 rounded-full text-xs font-mono border"
                  style={{ borderColor: "rgba(96,165,250,0.2)", background: "rgba(96,165,250,0.05)", color: "rgba(96,165,250,0.7)" }}>
                  {d}
                </span>
              ))}
            </motion.div>
          </div>

          {/* Scroll indicator */}
          <motion.div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2 text-xs font-mono text-blue-400/50"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 4 }}>
            <motion.div className="w-px h-8 bg-gradient-to-b from-blue-400/50 to-transparent"
              animate={{ scaleY: [0, 1, 0] }} transition={{ duration: 1.5, repeat: Infinity }} />
            ENTER
          </motion.div>
        </section>

        {/* ── POSITIONING ─────────────────────────────────────────────── */}
        <section className="py-20 border-b border-blue-500/8 relative overflow-hidden"
          style={{ background: "linear-gradient(180deg, hsl(270 20% 3%), hsl(230 40% 4%))" }}>
          <div className="max-w-4xl mx-auto px-6 text-center">
            <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}>
              <p className="text-xs font-mono text-blue-400 uppercase tracking-widest mb-6">WHAT IS VYBE LIVE</p>
              <h2 className="font-hero text-4xl md:text-6xl font-black uppercase text-white leading-[0.92] mb-8">
                The World's First{" "}
                <span className="text-gradient-blue">AI-Powered</span>
                <br />Creator Operating System
              </h2>
              <p className="text-xl md:text-2xl text-muted-foreground leading-relaxed font-light max-w-3xl mx-auto">
                VYBE isn't a dashboard. It's a full headquarters staffed by AI agents — Brand Scout, Trend Hunter, Growth Coach, Clip Studio, and more — all working around the clock to grow your creator career.
              </p>
            </motion.div>
          </div>
        </section>

        {/* ── 7 DEPARTMENTS ───────────────────────────────────────────── */}
        {DEPARTMENTS.map(dept => (
          <DepartmentSection key={dept.id} dept={dept} />
        ))}

        {/* ── AI CORE (centerpiece) ────────────────────────────────────── */}
        <section id="ai-core" className="relative py-32 border-b border-purple-500/15 overflow-hidden"
          style={{ background: "radial-gradient(ellipse 70% 50% at 50% 50%, rgba(88,28,135,0.15) 0%, rgba(59,7,100,0.08) 50%, transparent 70%), hsl(270 20% 3%)" }}>

          {/* Grid */}
          <div className="absolute inset-0 pointer-events-none" style={{
            backgroundImage: `
              repeating-linear-gradient(0deg, transparent, transparent 60px, rgba(139,92,246,0.03) 60px, rgba(139,92,246,0.03) 61px),
              repeating-linear-gradient(90deg, transparent, transparent 60px, rgba(139,92,246,0.03) 60px, rgba(139,92,246,0.03) 61px)
            `,
          }} />

          <div className="relative z-10 max-w-7xl mx-auto px-6">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
              <motion.div initial={{ opacity: 0, x: -40 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ duration: 0.7 }}>
                <div className="flex items-center gap-3 mb-6">
                  <span className="text-xs font-mono tracking-widest text-purple-400">DEPT 07</span>
                  <div className="h-px flex-1 max-w-16 bg-purple-500/40" />
                  <span className="text-xs font-mono tracking-widest text-purple-400/50">NEURAL CORE</span>
                </div>
                <h2 className="font-hero font-black uppercase text-white leading-[0.9] mb-6"
                  style={{ fontSize: "clamp(3rem, 6vw, 5rem)" }}>
                  The <span className="text-gradient-brand">AI Core</span>
                </h2>
                <p className="text-xl text-purple-300 font-light mb-4">The Heart of Headquarters</p>
                <p className="text-muted-foreground leading-relaxed max-w-lg text-lg">
                  Every department runs on the same neural core. It learns from your streams, your audience, your deals — building a model of you that gets smarter with every upload, every live, every moment.
                </p>
                <div className="mt-8 space-y-3">
                  {["Learns from every stream you run", "Syncs data across all 7 departments", "Builds your unique creator DNA", "Improves with every interaction"].map((item, i) => (
                    <motion.div key={item} className="flex items-center gap-3"
                      initial={{ opacity: 0, x: -20 }} whileInView={{ opacity: 1, x: 0 }}
                      viewport={{ once: true }} transition={{ delay: i * 0.1 }}>
                      <div className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-status-blink" />
                      <span className="text-sm text-muted-foreground">{item}</span>
                    </motion.div>
                  ))}
                </div>
                <div className="mt-10">
                  <Button size="lg" onClick={openGetApp}
                    className="h-14 px-10 rounded-full text-white font-bold text-lg"
                    style={{ background: "linear-gradient(135deg, #7c3aed, #a855f7)", boxShadow: "0 0 50px rgba(139,92,246,0.5)" }}>
                    Activate Your AI Team
                  </Button>
                </div>
              </motion.div>

              <motion.div initial={{ opacity: 0, scale: 0.8 }} whileInView={{ opacity: 1, scale: 1 }} viewport={{ once: true }} transition={{ duration: 0.8 }}>
                <AICoreViz />
              </motion.div>
            </div>
          </div>
        </section>

        {/* ── PRICING ──────────────────────────────────────────────────── */}
        <PricingSection />

        {/* ── FINAL CTA ────────────────────────────────────────────────── */}
        <section className="py-36 relative overflow-hidden"
          style={{ background: "radial-gradient(ellipse 60% 50% at 50% 60%, rgba(59,130,246,0.08) 0%, rgba(139,92,246,0.06) 40%, transparent 70%), hsl(270 20% 3%)" }}>

          <div className="absolute inset-0 pointer-events-none overflow-hidden">
            {[
              { top: "25%", delay: 0, dur: 5.5 },
              { top: "60%", delay: 3, dur: 4.5 },
            ].map((s, i) => (
              <motion.div key={i} className="absolute h-px pointer-events-none"
                style={{ top: s.top, left: 0, width: "50%", background: "linear-gradient(90deg, transparent, rgba(96,165,250,0.3), transparent)" }}
                animate={{ x: ["-100%", "600%"] }}
                transition={{ duration: s.dur, delay: s.delay, repeat: Infinity, repeatDelay: 8, ease: "linear" }} />
            ))}
          </div>

          <div className="relative z-10 max-w-3xl mx-auto px-6 text-center">
            <motion.div initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }}>
              <div className="flex justify-center mb-8">
                <div className="w-20 h-20 rounded-full flex items-center justify-center"
                  style={{ background: "radial-gradient(circle, rgba(139,92,246,0.8), rgba(59,130,246,0.4))", boxShadow: "0 0 60px rgba(139,92,246,0.6)" }}>
                  <span className="font-hero text-white font-black text-3xl">V</span>
                </div>
              </div>
              <h2 className="font-hero text-5xl md:text-7xl font-black uppercase text-white leading-[0.88] mb-6">
                Headquarters{" "}
                <span className="text-gradient-brand">Awaits</span>
              </h2>
              <p className="text-xl text-muted-foreground mb-10 max-w-xl mx-auto leading-relaxed">
                Join thousands of creators who are building the future of streaming with an AI team that never clocks out.
              </p>
              <div className="flex flex-col sm:flex-row items-center gap-4 justify-center">
                <Button size="lg" onClick={openGetApp}
                  className="h-14 px-12 rounded-full text-white font-bold text-lg w-full sm:w-auto transition-all"
                  style={{ background: "linear-gradient(135deg, #3b82f6, #7c3aed, #a855f7)", boxShadow: "0 0 70px rgba(99,102,241,0.6)" }}>
                  Enter Headquarters
                </Button>
                <Button size="lg" variant="outline" onClick={openGetApp}
                  className="h-14 px-10 rounded-full font-bold text-lg w-full sm:w-auto border-purple-500/30 bg-purple-500/5 hover:bg-purple-500/10 text-white">
                  Download VYBE Live
                </Button>
              </div>
              <p className="text-xs text-muted-foreground mt-6 font-mono tracking-wider uppercase">
                Free to Download · Available on iOS &amp; Android
              </p>
            </motion.div>
          </div>
        </section>

      </div>
    </>
  );
}
