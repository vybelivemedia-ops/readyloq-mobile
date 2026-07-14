/**
 * Build provenance capture.
 *
 * Captures Git metadata (branch, commit SHA, commit message, working-tree
 * status) plus a build timestamp so every build artifact can carry its exact
 * source provenance.
 *
 * Capture strategy, in priority order:
 *  1. Live Git (`git --no-optional-locks ...`) — used when a `.git` directory
 *     is reachable (local dev builds, CI with VCS).
 *  2. Snapshot file (`build-info.json`) — written at build-trigger time by
 *     `scripts/src/write-build-info.mjs`. This is the fallback for build
 *     environments that archive the working tree without `.git` (EAS builds
 *     run with `EAS_NO_VCS=1`, Replit deployments).
 *  3. Unknown — explicit "unknown" values; never silently fabricated.
 */
import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

export interface BuildInfo {
  /** Git branch name at build time. */
  branch: string;
  /** Full commit SHA at build time. */
  commitSha: string;
  /** Subject line of the commit at build time. */
  commitMessage: string;
  /** ISO-8601 timestamp of when the metadata was captured. */
  buildTimestamp: string;
  /** Whether the working tree had uncommitted changes at capture time. */
  workingTreeStatus: "clean" | "dirty" | "unknown";
  /** Where the metadata came from. */
  source: "git" | "snapshot" | "unknown";
}

export const UNKNOWN_BUILD_INFO: BuildInfo = {
  branch: "unknown",
  commitSha: "unknown",
  commitMessage: "unknown",
  buildTimestamp: "unknown",
  workingTreeStatus: "unknown",
  source: "unknown",
};

function git(args: string, cwd: string): string {
  return execSync(`git --no-optional-locks ${args}`, {
    cwd,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "ignore"],
    timeout: 5000,
  }).trim();
}

/** Capture provenance from a live Git repository, or return null. */
export function captureFromGit(cwd: string = process.cwd()): BuildInfo | null {
  try {
    const commitSha = git("rev-parse HEAD", cwd);
    const branch = git("rev-parse --abbrev-ref HEAD", cwd);
    const commitMessage = git("log -1 --format=%s", cwd);
    let workingTreeStatus: BuildInfo["workingTreeStatus"] = "unknown";
    try {
      workingTreeStatus = git("status --porcelain", cwd) === "" ? "clean" : "dirty";
    } catch {
      // status can fail (e.g. lock contention) even when rev-parse works
    }
    return {
      branch,
      commitSha,
      commitMessage,
      buildTimestamp: new Date().toISOString(),
      workingTreeStatus,
      source: "git",
    };
  } catch {
    return null;
  }
}

/** Walk up from `startDir` looking for a `build-info.json` snapshot. */
export function findSnapshot(startDir: string = process.cwd()): string | null {
  let dir = path.resolve(startDir);
  for (;;) {
    const candidate = path.join(dir, "build-info.json");
    if (fs.existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** Load a snapshot file, or return null when missing/invalid. */
export function loadSnapshot(snapshotPath: string): BuildInfo | null {
  try {
    const raw = JSON.parse(fs.readFileSync(snapshotPath, "utf-8")) as Partial<BuildInfo>;
    if (typeof raw.commitSha !== "string" || raw.commitSha.length === 0) return null;
    return {
      branch: raw.branch ?? "unknown",
      commitSha: raw.commitSha,
      commitMessage: raw.commitMessage ?? "unknown",
      buildTimestamp: raw.buildTimestamp ?? "unknown",
      workingTreeStatus: raw.workingTreeStatus ?? "unknown",
      source: "snapshot",
    };
  } catch {
    return null;
  }
}

/**
 * Resolve build provenance: live Git first, then the nearest snapshot file,
 * then explicit unknowns.
 */
export function getBuildInfo(startDir: string = process.cwd()): BuildInfo {
  const fromGit = captureFromGit(startDir);
  if (fromGit) return fromGit;
  const snapshotPath = findSnapshot(startDir);
  if (snapshotPath) {
    const fromSnapshot = loadSnapshot(snapshotPath);
    if (fromSnapshot) return fromSnapshot;
  }
  return { ...UNKNOWN_BUILD_INFO };
}

/** Short (7-char) commit SHA, safe against "unknown". */
export function shortSha(info: BuildInfo): string {
  return info.commitSha === "unknown" ? "unknown" : info.commitSha.slice(0, 7);
}
