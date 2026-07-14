import { Link } from "wouter";
import { ShieldAlert, CheckCircle2, Loader2, Clock } from "lucide-react";

export interface ExecDeptData {
  id: string;
  name: string;
  role: string;
  status: string;
  statusMessage?: string | null;
  hasBlocker?: boolean;
  recentlyCompleted?: boolean;
}

interface ExecDeptCardProps {
  exec: ExecDeptData;
  side: "left" | "right";
}

const STATUS_DOT: Record<string, string> = {
  active: "bg-primary animate-pulse",
  planning: "bg-primary/70 animate-pulse",
  busy: "bg-amber-400 animate-pulse",
  collaborating: "bg-sky-400 animate-pulse",
  needs_approval: "bg-red-400 animate-pulse",
  idle: "bg-border",
};

const STATUS_RING: Record<string, string> = {
  active: "border-primary/60",
  planning: "border-primary/40",
  busy: "border-amber-400/50",
  collaborating: "border-sky-400/50",
  needs_approval: "border-red-400/70",
  idle: "border-border",
};

function roleLabel(role: string): string {
  return role
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function ExecDeptCard({ exec, side }: ExecDeptCardProps) {
  const isActive = ["active", "planning", "collaborating", "busy"].includes(exec.status);
  const isBlocked = exec.hasBlocker || exec.status === "needs_approval";
  const isDone = exec.recentlyCompleted;

  const ringClass = isBlocked
    ? "border-red-400/70"
    : isDone
      ? "border-emerald-400/60"
      : (STATUS_RING[exec.status] ?? "border-border");

  const dotClass = isBlocked
    ? "bg-red-400 animate-pulse"
    : isDone
      ? "bg-emerald-400"
      : (STATUS_DOT[exec.status] ?? "bg-border");

  const href = exec.role === "agent_specialists" ? "/specialists" : `/executives/${exec.id}`;

  return (
    <Link href={href}>
      <div
        className={`group relative rounded-lg border bg-card/80 px-3 py-2.5 transition-all duration-200 hover:bg-card hover:shadow-md cursor-pointer ${ringClass}`}
        data-testid={`exec-dept-${exec.id}`}
      >
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 flex-shrink-0 rounded-full ${dotClass}`} />
          <span className="truncate font-mono text-[11px] font-semibold uppercase tracking-wider text-foreground group-hover:text-primary transition-colors">
            {exec.name}
          </span>
          {isBlocked && <ShieldAlert className="ml-auto h-3 w-3 flex-shrink-0 text-red-400" />}
          {isDone && !isBlocked && <CheckCircle2 className="ml-auto h-3 w-3 flex-shrink-0 text-emerald-400" />}
          {isActive && !isBlocked && !isDone && (
            <Loader2 className="ml-auto h-3 w-3 flex-shrink-0 animate-spin text-primary/60" />
          )}
          {!isActive && !isBlocked && !isDone && (
            <Clock className="ml-auto h-3 w-3 flex-shrink-0 text-muted-foreground/40" />
          )}
        </div>
        <p className="mt-0.5 truncate font-mono text-[9px] uppercase tracking-widest text-muted-foreground">
          {roleLabel(exec.role)}
        </p>
        {exec.statusMessage && (
          <p className={`mt-1 line-clamp-1 text-[10px] ${isBlocked ? "text-red-400/80" : "text-muted-foreground"}`}>
            {exec.statusMessage}
          </p>
        )}
      </div>
    </Link>
  );
}
