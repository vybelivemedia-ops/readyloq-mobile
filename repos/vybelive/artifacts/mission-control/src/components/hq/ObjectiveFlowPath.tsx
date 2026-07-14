import { useEffect, useRef } from "react";

export interface FlowObjective {
  id: string;
  title: string;
  ownerSide: "left" | "right" | "center";
  ownerIndex: number;
  status: string;
  priority: string;
  retryCount: number;
}

interface ObjectiveFlowPathProps {
  objectives: FlowObjective[];
  containerWidth: number;
  containerHeight: number;
}

function priorityColor(priority: string, status: string): string {
  if (status === "failed") return "#ef4444";
  if (status === "completed") return "#34d399";
  if (priority === "critical") return "#ef4444";
  if (priority === "high") return "#f59e0b";
  return "#a064ff";
}

export default function ObjectiveFlowPath({
  objectives,
  containerWidth,
  containerHeight,
}: ObjectiveFlowPathProps) {
  const canvasRef = useRef<SVGSVGElement>(null);

  const inProgress = objectives.filter((o) =>
    ["in_progress", "planning", "needs_approval"].includes(o.status),
  );

  if (inProgress.length === 0 || containerWidth === 0) return null;

  const quinnX = containerWidth / 2;
  const quinnY = containerHeight * 0.62;
  const agentY = containerHeight * 0.85;

  function execPosition(obj: FlowObjective): { x: number; y: number } {
    const cardH = 62;
    const gapH = 8;
    const topOffset = 80;
    const y = topOffset + obj.ownerIndex * (cardH + gapH) + cardH / 2;
    if (obj.ownerSide === "left") return { x: containerWidth * 0.14, y };
    if (obj.ownerSide === "right") return { x: containerWidth * 0.86, y };
    return { x: quinnX, y: quinnY };
  }

  return (
    <svg
      ref={canvasRef}
      className="pointer-events-none absolute inset-0"
      width={containerWidth}
      height={containerHeight}
      aria-hidden
    >
      <defs>
        {inProgress.map((obj) => {
          const color = priorityColor(obj.priority, obj.status);
          return (
            <marker
              key={`arrow-${obj.id}`}
              id={`arrow-${obj.id}`}
              viewBox="0 0 6 6"
              refX="5"
              refY="3"
              markerWidth="4"
              markerHeight="4"
              orient="auto"
            >
              <path d="M 0 0 L 6 3 L 0 6 z" fill={color} opacity="0.7" />
            </marker>
          );
        })}
      </defs>

      {inProgress.map((obj, i) => {
        const start = execPosition(obj);
        const color = priorityColor(obj.priority, obj.status);
        const animDur = 2.5 + i * 0.4;
        const delay = i * 0.6;

        const cx1 = start.x + (quinnX - start.x) * 0.5;
        const cy1 = start.y;
        const cx2 = quinnX;
        const cy2 = start.y + (quinnY - start.y) * 0.4;
        const path1 = `M ${start.x},${start.y} C ${cx1},${cy1} ${cx2},${cy2} ${quinnX},${quinnY}`;
        const path2 = `M ${quinnX},${quinnY} L ${quinnX},${agentY}`;

        return (
          <g key={obj.id}>
            <path d={path1} fill="none" stroke={color} strokeWidth="1" strokeDasharray="5 4" opacity="0.35" />
            <path d={path2} fill="none" stroke={color} strokeWidth="1" strokeDasharray="5 4" opacity="0.35" />

            <circle r="4" fill={color} opacity="0.9">
              <animateMotion
                dur={`${animDur}s`}
                begin={`${delay}s`}
                repeatCount="indefinite"
                path={path1 + " " + path2.replace("M", "L")}
              />
            </circle>
          </g>
        );
      })}
    </svg>
  );
}
