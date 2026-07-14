import React from "react";
import { Link } from "wouter";

type HQExecStatus = "idle" | "active" | "planning" | "collaborating" | "needs_approval" | "busy" | string;

export interface ExecutiveRoom {
  id: string;
  name: string;
  role: string;
  status: HQExecStatus;
  statusMessage?: string | null;
  hasBlocker?: boolean;
  recentlyCompleted?: boolean;
}

export interface VHeadquartersProps {
  executives: ExecutiveRoom[];
  agentZeroStatus: {
    isRunning: boolean;
    workerHealth: string;
    completedToday: number;
  };
}

const Room = ({ 
  x, y, width, height, exec, labelPos, alignment 
}: { 
  x: number, y: number, width: number, height: number, exec?: ExecutiveRoom, labelPos: "left" | "right", alignment: "left" | "right" 
}) => {
  if (!exec) {
    return (
      <g>
        <rect x={x} y={y} width={width} height={height} fill="rgba(20,25,45,0.4)" stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
        <line x1={x} y1={y} x2={x+width} y2={y+height} stroke="rgba(255,255,255,0.02)" strokeWidth="1" />
        <line x1={x+width} y1={y} x2={x} y2={y+height} stroke="rgba(255,255,255,0.02)" strokeWidth="1" />
      </g>
    );
  }

  const isActive = ["active", "planning", "collaborating", "busy"].includes(exec.status);
  const isBlocked = exec.hasBlocker || exec.status === "needs_approval";
  const isCompleted = exec.recentlyCompleted;

  let glowColor = "rgba(100, 150, 255, 0.0)";
  let strokeColor = "rgba(255,255,255,0.1)";
  let fillOpacity = 0.3;

  if (isBlocked) {
    glowColor = "rgba(255, 50, 100, 0.6)";
    strokeColor = "rgba(255, 50, 100, 0.8)";
    fillOpacity = 0.5;
  } else if (isCompleted) {
    glowColor = "rgba(50, 255, 150, 0.6)";
    strokeColor = "rgba(50, 255, 150, 0.8)";
    fillOpacity = 0.5;
  } else if (isActive) {
    glowColor = "rgba(160, 100, 255, 0.6)"; // Primary electric violet glow
    strokeColor = "rgba(160, 100, 255, 0.8)";
    fillOpacity = 0.5;
  }

  const textX = labelPos === "left" ? x - 10 : x + width + 10;
  const textAnchor = labelPos === "left" ? "end" : "start";
  
  return (
    <g className="cursor-pointer transition-all duration-300 group" style={{ transformOrigin: `${x + width/2}px ${y + height/2}px` }}>
      <Link href={exec.role === "agent_specialists" ? "/specialists" : `/executives/${exec.id}`}>
        <defs>
          <filter id={`glow-${exec.id}`} x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
        </defs>

        <rect 
          x={x} y={y} width={width} height={height} 
          fill={`rgba(20,25,45,${fillOpacity})`} 
          stroke={strokeColor} 
          strokeWidth="1.5"
          filter={(isActive || isBlocked || isCompleted) ? `url(#glow-${exec.id})` : ""}
          className="group-hover:fill-[rgba(160,100,255,0.3)] transition-colors duration-300"
        />

        {/* Room details inside for larger screens or just abstract lines */}
        <line x1={x+5} y1={y+height-5} x2={x+width-5} y2={y+height-5} stroke={strokeColor} strokeWidth="2" opacity="0.5" />
        
        {isActive && !isBlocked && !isCompleted && (
          <circle cx={x + (alignment === "left" ? width - 10 : 10)} cy={y + 10} r="3" fill="#a064ff" className="animate-pulse" />
        )}
        {isBlocked && (
          <circle cx={x + (alignment === "left" ? width - 10 : 10)} cy={y + 10} r="3" fill="#ff3264" className="animate-pulse" />
        )}
        {isCompleted && (
          <circle cx={x + (alignment === "left" ? width - 10 : 10)} cy={y + 10} r="3" fill="#32ff96" className="animate-pulse" />
        )}

        {/* Executive Label */}
        <text x={textX} y={y + height/2 - 2} fill="#fff" fontSize="12" fontFamily="monospace" textAnchor={textAnchor} className="group-hover:fill-[#a064ff] transition-colors">
          {exec.name.toUpperCase()}
        </text>
        <text x={textX} y={y + height/2 + 10} fill="rgba(255,255,255,0.5)" fontSize="9" fontFamily="monospace" textAnchor={textAnchor}>
          {exec.role.toUpperCase().replace("_", " ")}
        </text>
        {exec.statusMessage && (
          <text x={textX} y={y + height/2 + 20} fill={isBlocked ? "#ff3264" : "rgba(160,100,255,0.8)"} fontSize="8" fontFamily="monospace" textAnchor={textAnchor} opacity="0.8">
            {exec.statusMessage.substring(0, 20)}{exec.statusMessage.length > 20 ? "..." : ""}
          </text>
        )}
      </Link>
    </g>
  );
};

export default function VHeadquarters({ executives, agentZeroStatus }: VHeadquartersProps) {
  
  // Find specific executives
  const findExec = (roleKeywords: string[]) => executives.find(e => roleKeywords.some(k => e.role.includes(k)));
  
  const ada = findExec(["cto", "engineering"]);
  const mara = findExec(["qa", "quality"]);
  const theo = findExec(["release", "delivery"]);
  const nadia = findExec(["product"]);
  
  const iris = findExec(["creative", "design"]);
  const dario = findExec(["marketing", "growth"]);
  
  // Mock a specialists room if no specific exec
  const specialists: ExecutiveRoom = {
    id: "specialists",
    name: "Specialist Bench",
    role: "agent_specialists",
    status: executives.filter(e => e.role !== "chief_of_staff" && e.status === "active").length > 2 ? "active" : "idle"
  };

  const quinn = findExec(["chief_of_staff", "quinn"]);

  // V dimensions
  const vWidth = 800;
  const vHeight = 600;
  
  return (
    <div className="w-full h-full min-h-[500px] flex items-center justify-center relative overflow-visible">
      {/* Background glow behind the V */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-3/4 h-3/4 bg-primary/5 rounded-full blur-[100px] pointer-events-none" />
      
      <svg viewBox={`0 0 ${vWidth} ${vHeight}`} className="w-full h-full max-h-[80vh] overflow-visible drop-shadow-[0_0_15px_rgba(160,100,255,0.2)]">
        
        {/* The V Structure - Outer Hull */}
        <path 
          d="M 50,50 L 350,500 L 450,500 L 750,50 L 600,50 L 400,400 L 200,50 Z" 
          fill="rgba(10, 15, 30, 0.8)" 
          stroke="rgba(160, 100, 255, 0.4)" 
          strokeWidth="2" 
        />
        <path 
          d="M 60,60 L 345,490 L 455,490 L 740,60 L 610,60 L 400,390 L 190,60 Z" 
          fill="none" 
          stroke="rgba(0, 255, 255, 0.1)" 
          strokeWidth="1" 
        />

        {/* Founder Overview Strip - Top Center connecting the V */}
        <g className="group cursor-pointer">
          <Link href="/founder-profile">
            <rect x={250} y={20} width={300} height={20} fill="rgba(0, 255, 255, 0.1)" stroke="rgba(0, 255, 255, 0.5)" strokeWidth="1" />
            <text x={400} y={34} fill="#0ff" fontSize="10" fontFamily="monospace" textAnchor="middle" letterSpacing="4">FOUNDER OVERVIEW</text>
            <line x1={250} y1={40} x2={200} y2={50} stroke="rgba(0, 255, 255, 0.3)" strokeWidth="1" strokeDasharray="2 2" />
            <line x1={550} y1={40} x2={600} y2={50} stroke="rgba(0, 255, 255, 0.3)" strokeWidth="1" strokeDasharray="2 2" />
          </Link>
        </g>

        {/* LEFT BRANCH (Top to Bottom) */}
        {/* Ada (CTO) */}
        <g transform="translate(100, 80) rotate(56)">
          <Room x={0} y={0} width={100} height={50} exec={ada} labelPos="left" alignment="right" />
        </g>
        
        {/* Mara (QA) */}
        <g transform="translate(145, 150) rotate(56)">
          <Room x={0} y={0} width={100} height={50} exec={mara} labelPos="left" alignment="right" />
        </g>

        {/* Theo (Release) */}
        <g transform="translate(190, 220) rotate(56)">
          <Room x={0} y={0} width={100} height={50} exec={theo} labelPos="left" alignment="right" />
        </g>

        {/* Nadia (Product) */}
        <g transform="translate(235, 290) rotate(56)">
          <Room x={0} y={0} width={100} height={50} exec={nadia} labelPos="left" alignment="right" />
        </g>

        {/* RIGHT BRANCH (Top to Bottom) */}
        {/* Iris (Creative) */}
        <g transform="translate(560, 160) rotate(-56)">
          <Room x={0} y={0} width={100} height={50} exec={iris} labelPos="right" alignment="left" />
        </g>

        {/* Dario (Marketing) */}
        <g transform="translate(515, 230) rotate(-56)">
          <Room x={0} y={0} width={100} height={50} exec={dario} labelPos="right" alignment="left" />
        </g>

        {/* Specialists */}
        <g transform="translate(470, 300) rotate(-56)">
          <Room x={0} y={0} width={100} height={50} exec={specialists} labelPos="right" alignment="left" />
        </g>


        {/* CENTER / CORE */}
        {/* Quinn Bridge */}
        <g className="cursor-pointer group">
          <Link href="/quinn">
            <defs>
              <filter id="glow-quinn" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="5" result="blur" />
                <feComposite in="SourceGraphic" in2="blur" operator="over" />
              </filter>
            </defs>
            <polygon 
              points="350,250 450,250 400,320" 
              fill={quinn?.status === "active" ? "rgba(160, 100, 255, 0.4)" : "rgba(20, 25, 45, 0.8)"}
              stroke="rgba(160, 100, 255, 0.8)" 
              strokeWidth="2" 
              filter={quinn?.status === "active" ? "url(#glow-quinn)" : ""}
              className="group-hover:fill-[rgba(160,100,255,0.6)] transition-all"
            />
            <text x={400} y={240} fill="#fff" fontSize="12" fontFamily="monospace" textAnchor="middle" className="group-hover:fill-[#a064ff] transition-colors">
              COMMAND BRIDGE
            </text>
            <text x={400} y={270} fill="rgba(255,255,255,0.8)" fontSize="10" fontFamily="monospace" textAnchor="middle">
              QUINN
            </text>
            {quinn?.status === "active" && (
              <circle cx={400} cy={290} r="4" fill="#a064ff" className="animate-pulse" />
            )}
          </Link>
        </g>

        {/* Agent Zero Core */}
        <g className="cursor-pointer group" transform="translate(0, 20)">
          <Link href="/operations">
            <defs>
              <filter id="glow-core" x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur stdDeviation={agentZeroStatus.isRunning ? "10" : "3"} result="blur" />
                <feComposite in="SourceGraphic" in2="blur" operator="over" />
              </filter>
            </defs>
            <circle 
              cx={400} 
              cy={460} 
              r={40} 
              fill={agentZeroStatus.isRunning ? "rgba(0, 255, 255, 0.3)" : "rgba(10, 15, 30, 0.9)"}
              stroke={agentZeroStatus.isRunning ? "#0ff" : "rgba(0, 255, 255, 0.3)"}
              strokeWidth="3"
              filter="url(#glow-core)"
              className="group-hover:stroke-[#fff] transition-all"
            />
            {agentZeroStatus.isRunning && (
              <circle cx={400} cy={460} r={25} fill="none" stroke="#0ff" strokeWidth="1" strokeDasharray="4 4">
                <animateTransform attributeName="transform" type="rotate" from="0 400 460" to="360 400 460" dur="4s" repeatCount="indefinite" />
              </circle>
            )}
            
            <text x={400} y={525} fill="#0ff" fontSize="12" fontFamily="monospace" textAnchor="middle" className="neon-text-accent">
              AGENT ZERO ENGINE
            </text>
            <text x={400} y={540} fill="rgba(255,255,255,0.6)" fontSize="10" fontFamily="monospace" textAnchor="middle">
              {agentZeroStatus.isRunning ? "EXECUTING" : "STANDBY"} • {agentZeroStatus.completedToday} DONE
            </text>
            
            {/* Core connection lines to branches */}
            <path d="M 400,420 L 400,340" fill="none" stroke={agentZeroStatus.isRunning ? "#0ff" : "rgba(0,255,255,0.2)"} strokeWidth="2" strokeDasharray="4 4" className={agentZeroStatus.isRunning ? "animate-pulse" : ""} />
            <path d="M 365,445 L 300,380" fill="none" stroke="rgba(0,255,255,0.2)" strokeWidth="1" />
            <path d="M 435,445 L 500,380" fill="none" stroke="rgba(0,255,255,0.2)" strokeWidth="1" />
          </Link>
        </g>
        
      </svg>
    </div>
  );
}
