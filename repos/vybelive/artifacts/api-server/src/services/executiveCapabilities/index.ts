// ─── Executive capabilities registry ──────────────────────────────────────────
// Maps each executive role to a capability that inspects REAL workspace resources
// and returns a structured report. This is the seam that replaces generic chat
// with genuine project awareness. The Chief of Staff aggregates the others.

import type { ReportMetric, ReportFinding } from "@workspace/db";
import { inspectCodebase } from "./codebase.js";
import { inspectQuality } from "./quality.js";
import { inspectRelease } from "./release.js";
import { inspectProduct } from "./product.js";
import { inspectDesign } from "./design.js";
import { inspectMarketing } from "./marketing.js";
import { aggregateChiefOfStaff } from "./chiefOfStaff.js";

export type ReportStatus = "healthy" | "attention" | "critical";

export type ExecutiveReport = {
  status: ReportStatus;
  headline: string;
  summary: string;
  metrics: ReportMetric[];
  findings: ReportFinding[];
};

export type CapabilityInfo = {
  /** What this executive is responsible for, in one line. */
  responsibility: string;
  /** The real project resources this executive is permitted to inspect. */
  resources: string[];
};

export const CAPABILITY_INFO: Record<string, CapabilityInfo> = {
  cto: {
    responsibility: "Inspect the codebase, architecture, and engineering health.",
    resources: ["Source tree & LOC", "Artifacts", "DB schema", "API routes", "Dependencies"],
  },
  qa_director: {
    responsibility: "Audit test coverage and scan logs for regressions.",
    resources: ["Test files", "Workflow logs", "Error/warning signals", "Test smells"],
  },
  release_manager: {
    responsibility: "Track build status and deployment readiness.",
    resources: ["Git status", "Build output", "Recent commits", "Deploy config"],
  },
  product_manager: {
    responsibility: "Review the roadmap and task backlog.",
    resources: ["Roadmap milestones", "Backlog (agent tasks)", "Stale milestones"],
  },
  creative_director: {
    responsibility: "Review UI and design assets.",
    resources: ["Design tokens", "Image assets", "UI components", "Mobile screens"],
  },
  marketing_director: {
    responsibility: "Organize launch assets and campaigns.",
    resources: ["Beta waitlist", "Launch assets", "Marketing site", "Roadmap stage"],
  },
  chief_of_staff: {
    responsibility: "Aggregate every executive's report into one daily briefing.",
    resources: ["All executive reports"],
  },
};

export const ROLES_WITH_CAPABILITY = [
  "cto",
  "qa_director",
  "release_manager",
  "product_manager",
  "creative_director",
  "marketing_director",
] as const;

export type CapabilityRole = (typeof ROLES_WITH_CAPABILITY)[number];

export function hasCapability(role: string): boolean {
  return role in CAPABILITY_INFO;
}

/** Run a single executive's capability against real workspace resources. */
export async function runCapability(role: string): Promise<ExecutiveReport> {
  switch (role) {
    case "cto":
      return inspectCodebase();
    case "qa_director":
      return inspectQuality();
    case "release_manager":
      return inspectRelease();
    case "product_manager":
      return inspectProduct();
    case "creative_director":
      return inspectDesign();
    case "marketing_director":
      return inspectMarketing();
    default:
      throw new Error(`No capability registered for role "${role}"`);
  }
}

export { aggregateChiefOfStaff };

/** Worst-of helper: combine report statuses into one overall status. */
export function worstStatus(statuses: ReportStatus[]): ReportStatus {
  if (statuses.includes("critical")) return "critical";
  if (statuses.includes("attention")) return "attention";
  return "healthy";
}
