/**
 * Mobile build provenance — captured at build time by app.config.ts
 * (live git locally; the committed build-info.json snapshot on EAS servers,
 * which archive the working tree without .git) and embedded in the Expo
 * manifest under `extra.buildInfo`.
 *
 * Use this in crash reports and diagnostics screens.
 */
import Constants from "expo-constants";

export interface MobileBuildInfo {
  branch: string;
  commitSha: string;
  commitMessage: string;
  buildTimestamp: string;
  workingTreeStatus: "clean" | "dirty" | "unknown";
  source: "git" | "snapshot" | "unknown";
}

const UNKNOWN: MobileBuildInfo = {
  branch: "unknown",
  commitSha: "unknown",
  commitMessage: "unknown",
  buildTimestamp: "unknown",
  workingTreeStatus: "unknown",
  source: "unknown",
};

const raw = Constants.expoConfig?.extra?.["buildInfo"] as Partial<MobileBuildInfo> | undefined;

export const buildInfo: MobileBuildInfo =
  raw && typeof raw.commitSha === "string" ? { ...UNKNOWN, ...raw } : UNKNOWN;

export const buildShortSha =
  buildInfo.commitSha === "unknown" ? "unknown" : buildInfo.commitSha.slice(0, 7);
