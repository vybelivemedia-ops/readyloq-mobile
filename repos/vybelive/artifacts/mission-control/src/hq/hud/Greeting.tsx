import { useEffect, useState } from "react";
import { X, ClipboardList } from "lucide-react";
import { greetingForTime } from "../lib/departments";
import type { HQState } from "../lib/hqTypes";

export function Greeting({ state }: { state: HQState }) {
  const [dismissed, setDismissed] = useState(false);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setShown(true), 400);
    return () => clearTimeout(t);
  }, []);

  if (dismissed) return null;

  const chief = state.executives.find((e) => e.role === "chief_of_staff");
  const hello = `${greetingForTime(state.timeOfDay)}, ${state.founderName}.`;
  const headline = state.briefing?.headline ?? "All systems nominal across the headquarters.";
  const { activeExecutives, openTasks, criticalTasks } = state.stats;
  const summary =
    criticalTasks > 0
      ? `${activeExecutives} executives are active. ${criticalTasks} critical item${criticalTasks > 1 ? "s" : ""} need your attention.`
      : `${activeExecutives} executives are active with ${openTasks} open task${openTasks === 1 ? "" : "s"} in flight.`;

  return (
    <div
      className={`absolute bottom-6 left-1/2 -translate-x-1/2 z-30 w-[min(640px,92vw)] transition-all duration-700 ${
        shown ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
      }`}
    >
      <div className="relative rounded-lg border border-primary/25 bg-card/85 backdrop-blur-md p-5 pr-10 overflow-hidden">
        <div className="absolute top-0 left-0 w-1 h-full bg-primary" />
        <button
          onClick={() => setDismissed(true)}
          className="absolute top-3 right-3 text-muted-foreground hover:text-foreground transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
        <div className="flex items-center gap-2 mb-2 text-[10px] font-mono uppercase tracking-wider text-primary/80">
          <ClipboardList className="w-3.5 h-3.5" />
          {chief ? `${chief.name} — Chief of Staff` : "Chief of Staff"}
        </div>
        <h2 className="text-lg font-bold mb-1">{hello}</h2>
        <p className="text-sm text-foreground/90 leading-relaxed">{headline}</p>
        <p className="text-xs text-muted-foreground font-mono mt-2">{summary}</p>
        <p className="text-[11px] text-muted-foreground/70 font-mono mt-3">
          Select a department to step inside, or drag to look around.
        </p>
      </div>
    </div>
  );
}
