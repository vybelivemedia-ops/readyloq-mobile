interface VFrameProps {
  activeObjectives?: number;
  className?: string;
}

export default function VFrame({ className = "" }: VFrameProps) {
  return (
    <svg
      viewBox="0 0 400 340"
      className={`pointer-events-none absolute inset-0 h-full w-full ${className}`}
      preserveAspectRatio="none"
      aria-hidden
    >
      <defs>
        <linearGradient id="vFrameLeft" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="rgba(160,100,255,0.5)" />
          <stop offset="100%" stopColor="rgba(160,100,255,0.15)" />
        </linearGradient>
        <linearGradient id="vFrameRight" x1="100%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="rgba(160,100,255,0.5)" />
          <stop offset="100%" stopColor="rgba(160,100,255,0.15)" />
        </linearGradient>
        <filter id="vGlow">
          <feGaussianBlur stdDeviation="3" result="blur" />
          <feComposite in="SourceGraphic" in2="blur" operator="over" />
        </filter>
      </defs>

      <path
        d="M 20,10 L 200,280 L 380,10"
        fill="none"
        stroke="url(#vFrameLeft)"
        strokeWidth="1.5"
        strokeLinecap="round"
        filter="url(#vGlow)"
        opacity="0.6"
      />

      <path
        d="M 20,10 L 200,280 L 380,10"
        fill="none"
        stroke="rgba(160,100,255,0.15)"
        strokeWidth="8"
        strokeLinecap="round"
      />

      <line x1="200" y1="280" x2="200" y2="340" stroke="rgba(0,255,255,0.3)" strokeWidth="1.5" strokeDasharray="4 3" />

      <circle cx="200" cy="280" r="4" fill="rgba(160,100,255,0.6)" className="animate-pulse" />
    </svg>
  );
}
