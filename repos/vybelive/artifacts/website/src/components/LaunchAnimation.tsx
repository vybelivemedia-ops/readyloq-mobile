import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useId } from "react";

interface Props {
  onComplete: () => void;
}

export function LaunchAnimation({ onComplete }: Props) {
  const [phase, setPhase] = useState(0);
  const uid = useId().replace(/:/g, "");
  const gradId = `la-g-${uid}`;
  const glowId = `la-f-${uid}`;

  useEffect(() => {
    const timers = [
      setTimeout(() => setPhase(1), 250),
      setTimeout(() => setPhase(2), 550),
      setTimeout(() => setPhase(3), 1450),
      setTimeout(() => setPhase(4), 1850),
      setTimeout(() => setPhase(5), 2200),
      setTimeout(() => setPhase(6), 2750),
    ];
    const done = setTimeout(onComplete, 3350);
    return () => {
      timers.forEach(clearTimeout);
      clearTimeout(done);
    };
  }, [onComplete]);

  const V_PATH = "M 0,0 L 18,0 L 50,68 L 82,0 L 100,0 L 56,88 L 44,88 Z";

  return (
    <motion.div
      className="fixed inset-0 z-[9999] bg-black flex items-center justify-center overflow-hidden cursor-none"
      initial={{ opacity: 1 }}
      animate={phase >= 6 ? { opacity: 0 } : { opacity: 1 }}
      transition={{ duration: 0.6 }}
      style={{ pointerEvents: phase >= 6 ? "none" : "all" }}
    >
      {/* Scanline texture */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          backgroundImage:
            "repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(139,92,246,0.07) 3px, rgba(139,92,246,0.07) 4px)",
        }}
      />

      {/* Horizontal energy line */}
      <AnimatePresence>
        {phase === 1 && (
          <motion.div
            key="line"
            className="absolute left-0 right-0 pointer-events-none"
            style={{ top: "50%", height: "1px" }}
            initial={{ scaleX: 0, opacity: 1 }}
            animate={{ scaleX: 1, opacity: [1, 1, 0] }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.35, ease: "easeOut" }}
          >
            <div className="w-full h-full bg-gradient-to-r from-transparent via-purple-400 to-transparent" />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main content */}
      <div className="relative flex flex-col items-center gap-10">
        {/* Ambient glow */}
        {phase >= 3 && (
          <motion.div
            className="absolute pointer-events-none"
            style={{ inset: "-120px", zIndex: -1 }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.8 }}
          >
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-96 h-96 rounded-full bg-purple-700/30 blur-[100px]" />
            </div>
          </motion.div>
        )}

        {/* SVG V */}
        <motion.svg
          width="220"
          height="194"
          viewBox="0 0 100 88"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          animate={
            phase === 4 ? { scale: [1, 1.07, 0.98, 1] } : { scale: 1 }
          }
          transition={phase === 4 ? { duration: 0.35 } : {}}
        >
          <defs>
            <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#7c3aed" />
              <stop offset="35%" stopColor="#a855f7" />
              <stop offset="78%" stopColor="#d946ef" />
              <stop offset="100%" stopColor="#f0abfc" />
            </linearGradient>
            <filter id={glowId} x="-40%" y="-40%" width="180%" height="180%">
              <feGaussianBlur in="SourceGraphic" stdDeviation="6" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* Stroke-drawing phase */}
          {phase >= 2 && (
            <motion.path
              d={V_PATH}
              stroke={`url(#${gradId})`}
              strokeWidth="1.5"
              fill="none"
              strokeLinecap="square"
              initial={{ pathLength: 0, opacity: 1 }}
              animate={{ pathLength: 1, opacity: phase >= 3 ? 0 : 1 }}
              transition={{
                pathLength: { duration: 0.8, ease: [0.4, 0, 0.2, 1] },
                opacity: { duration: 0.3, delay: phase >= 3 ? 0 : 99 },
              }}
            />
          )}

          {/* Filled V with glow */}
          {phase >= 3 && (
            <motion.path
              d={V_PATH}
              fill={`url(#${gradId})`}
              filter={`url(#${glowId})`}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.5 }}
            />
          )}

          {/* Chrome flash */}
          {phase === 4 && (
            <motion.path
              d={V_PATH}
              fill="rgba(255,255,255,0.28)"
              initial={{ opacity: 0 }}
              animate={{ opacity: [0, 1, 0] }}
              transition={{ duration: 0.35 }}
            />
          )}
        </motion.svg>

        {/* VYBE LIVE text */}
        <AnimatePresence>
          {phase >= 5 && (
            <motion.p
              key="brand"
              initial={{ opacity: 0, y: 14, letterSpacing: "0.6em" }}
              animate={{ opacity: 1, y: 0, letterSpacing: "0.4em" }}
              transition={{ duration: 0.55, ease: "easeOut" }}
              className="font-display font-black text-3xl text-white tracking-[0.4em] uppercase select-none"
            >
              VYBE<span style={{ color: "#a855f7" }}>LIVE</span>
            </motion.p>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
