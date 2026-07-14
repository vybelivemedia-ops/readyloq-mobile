/**
 * Client build provenance, injected at build time via Vite `define`.
 * Exposed on window for deployment diagnostics and crash reports.
 */
import type { BuildInfo } from "@workspace/build-info";

declare const __BUILD_INFO__: BuildInfo;

export const buildInfo: BuildInfo = __BUILD_INFO__;

declare global {
  interface Window {
    __VYBE_BUILD_INFO__?: BuildInfo;
  }
}

window.__VYBE_BUILD_INFO__ = buildInfo;
console.info(
  `[build] ${buildInfo.branch}@${buildInfo.commitSha.slice(0, 7)} (${buildInfo.workingTreeStatus}) built ${buildInfo.buildTimestamp}`
);
