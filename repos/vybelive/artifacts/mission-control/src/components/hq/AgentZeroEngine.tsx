import { Link } from "wouter";
import { Cpu, Loader2, CheckCircle2, Activity, MemoryStick } from "lucide-react";

interface AgentZeroEngineProps {
  isRunning: boolean;
  workerHealthy: boolean;
  runningJobs: number;
  queuedJobs: number;
  completedToday: number;
  executionConfidence: number;
  avgRuntimeSeconds: number;
  heapUsedMb: number;
  load1: number;
}

export default function AgentZeroEngine({
  isRunning,
  workerHealthy,
  runningJobs,
  queuedJobs,
  completedToday,
  executionConfidence,
  avgRuntimeSeconds,
  heapUsedMb,
  load1,
}: AgentZeroEngineProps) {
  return (
    <Link href="/operations">
      <div
        className={`group relative cursor-pointer rounded-xl border-2 bg-card/90 p-4 transition-all duration-300 hover:shadow-lg ${
          isRunning
            ? "border-cyan-400/60 shadow-[0_0_20px_rgba(0,255,255,0.15)]"
            : workerHealthy
              ? "border-border"
              : "border-red-400/40"
        }`}
        data-testid="agent-zero-engine"
      >
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            {isRunning ? (
              <div className="relative flex h-8 w-8 items-center justify-center">
                <Cpu className="h-5 w-5 text-cyan-400" />
                <span className="absolute inset-0 animate-ping rounded-full bg-cyan-400/20" />
              </div>
            ) : (
              <Cpu className={`h-5 w-5 ${workerHealthy ? "text-muted-foreground" : "text-red-400"}`} />
            )}
            <div>
              <p className="font-mono text-xs font-bold uppercase tracking-widest text-foreground group-hover:text-cyan-400 transition-colors">
                Agent Zero
              </p>
              <p className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
                Execution Engine
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <span
              className={`rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider ${
                isRunning
                  ? "border-cyan-400/40 bg-cyan-400/10 text-cyan-400"
                  : workerHealthy
                    ? "border-border bg-secondary text-muted-foreground"
                    : "border-red-400/40 bg-red-400/10 text-red-400"
              }`}
            >
              {isRunning ? "executing" : workerHealthy ? "standby" : "offline"}
            </span>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-3 border-t border-border pt-3 md:grid-cols-6">
          <Metric label="Running" value={runningJobs} icon={<Loader2 className={`h-3 w-3 ${runningJobs > 0 ? "animate-spin text-cyan-400" : "text-muted-foreground"}`} />} />
          <Metric label="Queued" value={queuedJobs} icon={<Activity className="h-3 w-3 text-muted-foreground" />} />
          <Metric label="Done today" value={completedToday} icon={<CheckCircle2 className="h-3 w-3 text-emerald-400" />} />
          <Metric label="Confidence" value={`${executionConfidence}%`} highlight={executionConfidence >= 80} />
          <Metric label="Avg runtime" value={`${avgRuntimeSeconds}s`} />
          <Metric label="Heap" value={`${heapUsedMb}MB`} icon={<MemoryStick className="h-3 w-3 text-muted-foreground" />} />
        </div>

        <div className="mt-2 h-1 overflow-hidden rounded-full bg-secondary">
          <div
            className="h-full rounded-full bg-cyan-400/60 transition-all duration-500"
            style={{ width: `${Math.max(2, executionConfidence)}%` }}
          />
        </div>
      </div>
    </Link>
  );
}

function Metric({
  label,
  value,
  icon,
  highlight,
}: {
  label: string;
  value: string | number;
  icon?: React.ReactNode;
  highlight?: boolean;
}) {
  return (
    <div className="text-center">
      {icon && <div className="mb-0.5 flex justify-center">{icon}</div>}
      <p className={`font-mono text-sm font-semibold ${highlight ? "text-emerald-400" : "text-foreground"}`}>
        {value}
      </p>
      <p className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground">{label}</p>
    </div>
  );
}
