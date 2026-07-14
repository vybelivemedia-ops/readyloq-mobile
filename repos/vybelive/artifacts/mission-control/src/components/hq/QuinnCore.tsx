import { Link } from "wouter";
import { ShieldAlert, BrainCircuit, RefreshCw } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

interface QuinnCoreProps {
  id?: string;
  status: string;
  statusMessage?: string | null;
  pendingApprovals: number;
  lastCycleAt?: string | null;
  isActive: boolean;
}

export default function QuinnCore({
  status,
  statusMessage,
  pendingApprovals,
  lastCycleAt,
  isActive,
}: QuinnCoreProps) {
  const isRunning = ["active", "planning", "busy"].includes(status);

  return (
    <Link href="/quinn">
      <div
        className={`group relative cursor-pointer rounded-2xl border-2 bg-card/90 px-5 py-4 text-center transition-all duration-300 hover:shadow-lg ${
          isRunning
            ? "border-primary shadow-[0_0_20px_rgba(160,100,255,0.3)]"
            : pendingApprovals > 0
              ? "border-red-400/60 shadow-[0_0_12px_rgba(255,50,100,0.2)]"
              : "border-border"
        }`}
        data-testid="quinn-core"
        style={{ minWidth: 160 }}
      >
        <div className="flex items-center justify-center gap-2">
          <BrainCircuit
            className={`h-4 w-4 ${isRunning ? "text-primary animate-pulse" : "text-muted-foreground"}`}
          />
          <span className="font-mono text-xs font-bold uppercase tracking-widest text-foreground group-hover:text-primary transition-colors">
            Quinn
          </span>
        </div>

        <p className="mt-0.5 font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
          Chief of Staff
        </p>

        {statusMessage && (
          <p className="mt-1.5 line-clamp-2 text-[10px] text-muted-foreground">
            {statusMessage}
          </p>
        )}

        {pendingApprovals > 0 && (
          <div className="mt-2 flex items-center justify-center gap-1">
            <ShieldAlert className="h-3 w-3 text-red-400" />
            <span className="font-mono text-[10px] text-red-400">
              {pendingApprovals} pending
            </span>
          </div>
        )}

        {isActive && lastCycleAt && (
          <div className="mt-2 flex items-center justify-center gap-1 text-muted-foreground">
            <RefreshCw className="h-2.5 w-2.5" />
            <span className="font-mono text-[9px]">
              {formatDistanceToNow(new Date(lastCycleAt), { addSuffix: true })}
            </span>
          </div>
        )}

        <div
          className={`absolute -bottom-px left-1/2 h-px w-3/4 -translate-x-1/2 ${
            isRunning ? "bg-primary/50" : "bg-border/50"
          }`}
        />
      </div>
    </Link>
  );
}
