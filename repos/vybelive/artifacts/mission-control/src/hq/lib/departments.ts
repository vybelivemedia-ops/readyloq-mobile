import type { ExecRole, TimeOfDay } from "./hqTypes";

export type DeptTheme = "board" | "code" | "lab" | "ops" | "planning" | "studio" | "campaign";

export interface DeptConfig {
  role: ExecRole;
  label: string;
  short: string;
  /** Fallback accent if the API does not supply one. */
  color: string;
  /** Angle (degrees) of the office around the central ring. */
  angle: number;
  theme: DeptTheme;
  /** Chief of Staff presides over the central command center rather than a ring office. */
  center?: boolean;
}

/** The six ring departments + the central Chief of Staff boardroom. */
export const DEPARTMENTS: Record<ExecRole, DeptConfig> = {
  cto: { role: "cto", label: "Engineering", short: "CTO", color: "#22d3ee", angle: 0, theme: "code" },
  qa_director: { role: "qa_director", label: "Quality Lab", short: "QA", color: "#34d399", angle: 60, theme: "lab" },
  release_manager: { role: "release_manager", label: "Release Ops", short: "REL", color: "#a78bfa", angle: 120, theme: "ops" },
  product_manager: { role: "product_manager", label: "Product", short: "PRD", color: "#f59e0b", angle: 180, theme: "planning" },
  creative_director: { role: "creative_director", label: "Creative Studio", short: "CRE", color: "#ec4899", angle: 240, theme: "studio" },
  marketing_director: { role: "marketing_director", label: "Growth", short: "MKT", color: "#38bdf8", angle: 300, theme: "campaign" },
  chief_of_staff: { role: "chief_of_staff", label: "Boardroom", short: "COS", color: "#06b6d4", angle: 0, theme: "board", center: true },
};

/** Display order for ring departments (excludes the central chief of staff). */
export const RING_ROLES: ExecRole[] = [
  "cto",
  "qa_director",
  "release_manager",
  "product_manager",
  "creative_director",
  "marketing_director",
];

export const RING_RADIUS = 17;

/** World-space ground position (feet anchor) of a department office. */
export function officePosition(role: ExecRole, radius = RING_RADIUS): [number, number, number] {
  const cfg = DEPARTMENTS[role];
  if (cfg.center) return [0, 0, 0];
  const a = (cfg.angle * Math.PI) / 180;
  return [Math.sin(a) * radius, 0, Math.cos(a) * radius];
}

export function getTimeOfDay(date = new Date()): TimeOfDay {
  const h = date.getHours();
  if (h >= 6 && h < 12) return "morning";
  if (h >= 12 && h < 17) return "afternoon";
  if (h >= 17 && h < 20) return "evening";
  return "night";
}

export interface TimePalette {
  skyTop: string;
  skyHorizon: string;
  fog: string;
  ambient: number;
  keyIntensity: number;
  keyColor: string;
  keyPos: [number, number, number];
  stars: boolean;
  cityGlow: number;
}

export const TIME_PALETTES: Record<TimeOfDay, TimePalette> = {
  morning: {
    skyTop: "#0f2a52",
    skyHorizon: "#f4a06a",
    fog: "#13294a",
    ambient: 0.55,
    keyIntensity: 1.5,
    keyColor: "#ffd9a8",
    keyPos: [40, 25, 30],
    stars: false,
    cityGlow: 0.5,
  },
  afternoon: {
    skyTop: "#0b2a5c",
    skyHorizon: "#5fa8d8",
    fog: "#103056",
    ambient: 0.7,
    keyIntensity: 1.8,
    keyColor: "#e8f4ff",
    keyPos: [30, 45, 20],
    stars: false,
    cityGlow: 0.35,
  },
  evening: {
    skyTop: "#241546",
    skyHorizon: "#ff6a4d",
    fog: "#1a1233",
    ambient: 0.45,
    keyIntensity: 1.3,
    keyColor: "#ff9a6a",
    keyPos: [-35, 18, 25],
    stars: true,
    cityGlow: 0.85,
  },
  night: {
    skyTop: "#04060f",
    skyHorizon: "#0a1530",
    fog: "#05080f",
    ambient: 0.3,
    keyIntensity: 0.7,
    keyColor: "#8ab4ff",
    keyPos: [-30, 40, -20],
    stars: true,
    cityGlow: 1.0,
  },
};

export function greetingForTime(t: TimeOfDay): string {
  switch (t) {
    case "morning":
      return "Good morning";
    case "afternoon":
      return "Good afternoon";
    case "evening":
      return "Good evening";
    case "night":
      return "Working late";
  }
}
