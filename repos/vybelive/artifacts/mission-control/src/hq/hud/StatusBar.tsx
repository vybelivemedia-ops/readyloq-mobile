import { Link } from "wouter";
import { Volume2, VolumeX, LayoutDashboard } from "lucide-react";
import { useHQUI } from "../lib/HQUIContext";
import { startAmbient, stopAmbient } from "../lib/sound";
import type { HQState } from "../lib/hqTypes";

const TIME_LABEL: Record<string, string> = {
  morning: "MORNING",
  afternoon: "AFTERNOON",
  evening: "EVENING",
  night: "NIGHT",
};

function Chip({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded bg-card/70 border border-border/60 backdrop-blur-sm">
      <span className="text-base font-bold font-mono" style={{ color }}>
        {value}
      </span>
      <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">{label}</span>
    </div>
  );
}

export function StatusBar({ state }: { state: HQState }) {
  const { soundOn, setSound } = useHQUI();

  const toggleSound = () => {
    if (soundOn) {
      stopAmbient();
      setSound(false);
    } else {
      startAmbient();
      setSound(true);
    }
  };

  return (
    <div className="absolute top-0 left-0 right-0 z-30 flex items-center justify-between gap-4 p-4 pointer-events-none">
      <div className="flex items-center gap-3 pointer-events-auto">
        <div className="text-lg font-bold tracking-tight text-primary drop-shadow-[0_0_12px_rgba(34,230,255,0.4)]">
          VYBE<span className="text-foreground">LIVE</span>
          <span className="ml-2 text-[10px] font-mono uppercase tracking-widest text-muted-foreground">HQ</span>
        </div>
      </div>

      <div className="hidden md:flex items-center gap-2 pointer-events-auto">
        <Chip label="Active" value={state.stats.activeExecutives} color="#34d399" />
        <Chip label="Open" value={state.stats.openTasks} color="#22e6ff" />
        <Chip label="Blocked" value={state.stats.blockedTasks} color="#f59e0b" />
        <Chip label="Critical" value={state.stats.criticalTasks} color="#f87171" />
        <Chip label="Handoffs" value={state.stats.handoffsToday} color="#a855f7" />
      </div>

      <div className="flex items-center gap-2 pointer-events-auto">
        <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded bg-card/70 border border-border/60 backdrop-blur-sm">
          <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
          <span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">
            {TIME_LABEL[state.timeOfDay]}
          </span>
        </div>
        <button
          onClick={toggleSound}
          title={soundOn ? "Mute ambience" : "Enable ambience"}
          className="p-2 rounded bg-card/70 border border-border/60 backdrop-blur-sm text-muted-foreground hover:text-primary transition-colors"
        >
          {soundOn ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
        </button>
        <Link
          href="/classic"
          title="Classic dashboard"
          className="p-2 rounded bg-card/70 border border-border/60 backdrop-blur-sm text-muted-foreground hover:text-primary transition-colors"
        >
          <LayoutDashboard className="w-4 h-4" />
        </Link>
      </div>
    </div>
  );
}
