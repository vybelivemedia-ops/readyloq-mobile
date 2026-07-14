import type { ExecStatus } from "@/hq/lib/hqTypes";

export interface ExecStatusStyle {
  label: string;
  dot: string;
  text: string;
  bg: string;
  border: string;
}

const STYLES: Record<string, ExecStatusStyle> = {
  active: {
    label: "Working",
    dot: "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.8)]",
    text: "text-emerald-400",
    bg: "bg-emerald-500/10",
    border: "border-emerald-500/30",
  },
  busy: {
    label: "Busy",
    dot: "bg-amber-500",
    text: "text-amber-400",
    bg: "bg-amber-500/10",
    border: "border-amber-500/30",
  },
  planning: {
    label: "Planning",
    dot: "bg-sky-500 shadow-[0_0_8px_rgba(14,165,233,0.7)]",
    text: "text-sky-400",
    bg: "bg-sky-500/10",
    border: "border-sky-500/30",
  },
  collaborating: {
    label: "Collaborating",
    dot: "bg-violet-500 shadow-[0_0_8px_rgba(139,92,246,0.7)]",
    text: "text-violet-400",
    bg: "bg-violet-500/10",
    border: "border-violet-500/30",
  },
  needs_approval: {
    label: "Needs Approval",
    dot: "bg-fuchsia-500 shadow-[0_0_8px_rgba(217,70,239,0.7)]",
    text: "text-fuchsia-400",
    bg: "bg-fuchsia-500/10",
    border: "border-fuchsia-500/30",
  },
  idle: {
    label: "Idle",
    dot: "bg-muted-foreground",
    text: "text-muted-foreground",
    bg: "bg-muted/10",
    border: "border-border",
  },
  offline: {
    label: "Offline",
    dot: "bg-muted-foreground/40",
    text: "text-muted-foreground",
    bg: "bg-muted/10",
    border: "border-border",
  },
};

export function execStatusStyle(status: ExecStatus | string): ExecStatusStyle {
  return STYLES[status] ?? STYLES.idle;
}
