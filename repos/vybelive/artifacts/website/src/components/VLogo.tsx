import { useId } from "react";
import { motion } from "framer-motion";

interface VLogoProps {
  size?: number;
  glow?: boolean;
  pulse?: boolean;
  className?: string;
  variant?: "color" | "mono" | "white";
}

export function VLogo({
  size = 40,
  glow = false,
  pulse = false,
  className = "",
  variant = "color",
}: VLogoProps) {
  const uid = useId().replace(/:/g, "");
  const gradId = `vg-${uid}`;
  const glowId = `vf-${uid}`;
  const height = Math.round((size * 88) / 100);

  const fill =
    variant === "white"
      ? "#ffffff"
      : variant === "mono"
        ? "rgba(255,255,255,0.85)"
        : `url(#${gradId})`;

  return (
    <svg
      width={size}
      height={height}
      viewBox="0 0 100 88"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="VYBE LIVE V logo"
    >
      <defs>
        {variant === "color" && (
          <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#7c3aed" />
            <stop offset="35%" stopColor="#a855f7" />
            <stop offset="75%" stopColor="#d946ef" />
            <stop offset="100%" stopColor="#f0abfc" />
          </linearGradient>
        )}
        {glow && (
          <filter id={glowId} x="-40%" y="-40%" width="180%" height="180%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        )}
      </defs>
      <motion.path
        d="M 0,0 L 18,0 L 50,68 L 82,0 L 100,0 L 56,88 L 44,88 Z"
        fill={fill}
        filter={glow ? `url(#${glowId})` : undefined}
        animate={pulse ? { opacity: [1, 0.72, 1] } : undefined}
        transition={
          pulse
            ? { duration: 2.5, repeat: Infinity, ease: "easeInOut" }
            : undefined
        }
      />
    </svg>
  );
}
