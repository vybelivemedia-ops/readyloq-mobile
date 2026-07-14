import { useEffect, useState } from "react";
import { useHQUI } from "../lib/HQUIContext";

export function BootScreen() {
  const { finishBoot } = useHQUI();
  const [progress, setProgress] = useState(0);
  const [hide, setHide] = useState(false);

  useEffect(() => {
    const start = performance.now();
    const dur = 3400;
    let raf = 0;
    const tick = () => {
      const p = Math.min(1, (performance.now() - start) / dur);
      setProgress(p);
      if (p < 1) raf = requestAnimationFrame(tick);
      else {
        setHide(true);
        setTimeout(finishBoot, 700);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [finishBoot]);

  const skip = () => {
    setHide(true);
    setTimeout(finishBoot, 300);
  };

  const lines = [
    "INITIALIZING HEADQUARTERS",
    "SYNCING EXECUTIVE TELEMETRY",
    "CALIBRATING HOLOGRAPHIC GRID",
    "ENTERING COMMAND CENTER",
  ];
  const lineIdx = Math.min(lines.length - 1, Math.floor(progress * lines.length));

  return (
    <div
      className={`absolute inset-0 z-50 flex flex-col items-center justify-center bg-background transition-opacity duration-700 ${
        hide ? "opacity-0 pointer-events-none" : "opacity-100"
      }`}
    >
      <div className="text-center">
        <div className="text-6xl md:text-7xl font-bold tracking-tighter text-primary mb-2 drop-shadow-[0_0_25px_rgba(34,230,255,0.5)]">
          VYBE<span className="text-foreground">LIVE</span>
        </div>
        <div className="text-xs font-mono uppercase tracking-[0.4em] text-muted-foreground mb-10">
          Living AI Headquarters
        </div>
        <div className="w-64 h-px bg-border mx-auto mb-3 overflow-hidden">
          <div className="h-full bg-primary transition-[width] duration-100" style={{ width: `${progress * 100}%` }} />
        </div>
        <div className="text-[11px] font-mono uppercase tracking-widest text-primary/80 h-4">
          {lines[lineIdx]}
        </div>
      </div>
      <button
        onClick={skip}
        className="absolute bottom-8 text-[11px] font-mono uppercase tracking-widest text-muted-foreground hover:text-foreground transition-colors"
      >
        Skip intro →
      </button>
    </div>
  );
}
