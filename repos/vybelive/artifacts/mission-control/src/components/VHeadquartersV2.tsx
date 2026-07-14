import { useRef, useState, useEffect } from "react";
import VFrame from "./hq/VFrame";
import ExecDeptCard, { type ExecDeptData } from "./hq/ExecDeptCard";
import QuinnCore from "./hq/QuinnCore";
import AgentZeroEngine from "./hq/AgentZeroEngine";
import HQStatusBar from "./hq/HQStatusBar";
import ObjectiveFlowPath, { type FlowObjective } from "./hq/ObjectiveFlowPath";

export type { ExecDeptData };

export interface VHQObjective {
  id: string;
  title: string;
  status: string;
  priority: string;
  ownerRole?: string | null;
  retryCount?: number;
}

export interface VHeadquartersV2Props {
  executives: ExecDeptData[];
  quinn: ExecDeptData | null;
  objectives: VHQObjective[];
  agentZero: {
    isRunning: boolean;
    workerHealthy: boolean;
    runningJobs: number;
    queuedJobs: number;
    completedToday: number;
    executionConfidence: number;
    avgRuntimeSeconds: number;
    heapUsedMb: number;
    load1: number;
  };
  statusBar: {
    activeObjectives: number;
    tasksRunning: number;
    activeBlockers: number;
    aiCostUsd: number;
    systemLoad: number;
  };
  pendingApprovals: number;
  lastCycleAt?: string | null;
  loading?: boolean;
}

const LEFT_ROLES = ["cto", "engineering", "qa", "quality", "release", "delivery", "product"];
const RIGHT_ROLES = ["marketing", "growth", "creative", "design", "brand", "social", "specialist"];

function classifyExec(exec: ExecDeptData): "left" | "right" | "quinn" {
  const r = exec.role.toLowerCase();
  if (r.includes("chief_of_staff") || r.includes("quinn")) return "quinn";
  if (LEFT_ROLES.some((k) => r.includes(k))) return "left";
  if (RIGHT_ROLES.some((k) => r.includes(k))) return "right";
  return "left";
}

export default function VHeadquartersV2({
  executives,
  quinn,
  objectives,
  agentZero,
  statusBar,
  pendingApprovals,
  lastCycleAt,
  loading,
}: VHeadquartersV2Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver((entries) => {
      const e = entries[0];
      if (e) setContainerSize({ w: e.contentRect.width, h: e.contentRect.height });
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  const leftExecs = executives.filter((e) => classifyExec(e) === "left");
  const rightExecs = executives.filter((e) => classifyExec(e) === "right");

  const flowObjectives: FlowObjective[] = objectives
    .filter((o) => ["in_progress", "planning", "needs_approval"].includes(o.status))
    .slice(0, 8)
    .map((o) => {
      const role = o.ownerRole?.toLowerCase() ?? "";
      let side: FlowObjective["ownerSide"] = "center";
      let ownerIndex = 0;
      if (LEFT_ROLES.some((k) => role.includes(k))) {
        side = "left";
        ownerIndex = leftExecs.findIndex((e) => e.role.toLowerCase().includes(role.split("_")[0] ?? ""));
        if (ownerIndex < 0) ownerIndex = 0;
      } else if (RIGHT_ROLES.some((k) => role.includes(k))) {
        side = "right";
        ownerIndex = rightExecs.findIndex((e) => e.role.toLowerCase().includes(role.split("_")[0] ?? ""));
        if (ownerIndex < 0) ownerIndex = 0;
      }
      return {
        id: o.id,
        title: o.title,
        ownerSide: side,
        ownerIndex: Math.max(0, ownerIndex),
        status: o.status,
        priority: o.priority,
        retryCount: o.retryCount ?? 0,
      };
    });

  return (
    <div className="flex flex-col gap-4">
      <HQStatusBar {...statusBar} loading={loading} />

      <div className="lg:hidden">
        <MobileLayout
          leftExecs={leftExecs}
          rightExecs={rightExecs}
          quinn={quinn}
          pendingApprovals={pendingApprovals}
          lastCycleAt={lastCycleAt}
          agentZero={agentZero}
        />
      </div>

      <div className="hidden lg:block">
        <div
          ref={containerRef}
          className="relative"
          style={{ minHeight: 420 }}
        >
          <VFrame className="opacity-60" />

          <ObjectiveFlowPath
            objectives={flowObjectives}
            containerWidth={containerSize.w}
            containerHeight={containerSize.h}
          />

          <div className="relative flex items-start justify-between gap-4 px-2">
            <div className="flex flex-col gap-2 pt-8 w-52 flex-shrink-0">
              {leftExecs.length === 0 && (
                <div className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                  No engineering executives
                </div>
              )}
              {leftExecs.map((e) => (
                <ExecDeptCard key={e.id} exec={e} side="left" />
              ))}
            </div>

            <div className="flex flex-1 flex-col items-center gap-4 pt-4">
              <div className="flex items-center justify-center">
                <QuinnCore
                  id={quinn?.id}
                  status={quinn?.status ?? "idle"}
                  statusMessage={quinn?.statusMessage}
                  pendingApprovals={pendingApprovals}
                  lastCycleAt={lastCycleAt}
                  isActive={!!quinn && ["active", "planning", "busy"].includes(quinn.status)}
                />
              </div>

              <div className="w-full max-w-xl">
                <AgentZeroEngine {...agentZero} />
              </div>
            </div>

            <div className="flex flex-col gap-2 pt-8 w-52 flex-shrink-0">
              {rightExecs.length === 0 && (
                <div className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                  No creative executives
                </div>
              )}
              {rightExecs.map((e) => (
                <ExecDeptCard key={e.id} exec={e} side="right" />
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MobileLayout({
  leftExecs,
  rightExecs,
  quinn,
  pendingApprovals,
  lastCycleAt,
  agentZero,
}: {
  leftExecs: ExecDeptData[];
  rightExecs: ExecDeptData[];
  quinn: ExecDeptData | null;
  pendingApprovals: number;
  lastCycleAt?: string | null;
  agentZero: VHeadquartersV2Props["agentZero"];
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-2">
          <p className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">Engineering</p>
          {leftExecs.map((e) => (
            <ExecDeptCard key={e.id} exec={e} side="left" />
          ))}
        </div>
        <div className="flex flex-col gap-2">
          <p className="font-mono text-[9px] uppercase tracking-widest text-muted-foreground">Creative</p>
          {rightExecs.map((e) => (
            <ExecDeptCard key={e.id} exec={e} side="right" />
          ))}
        </div>
      </div>

      <div className="flex justify-center">
        <QuinnCore
          id={quinn?.id}
          status={quinn?.status ?? "idle"}
          statusMessage={quinn?.statusMessage}
          pendingApprovals={pendingApprovals}
          lastCycleAt={lastCycleAt}
          isActive={!!quinn && ["active", "planning", "busy"].includes(quinn.status)}
        />
      </div>

      <AgentZeroEngine {...agentZero} />
    </div>
  );
}
