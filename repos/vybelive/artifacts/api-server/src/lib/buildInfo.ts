/**
 * Server build provenance — resolved once at process start.
 *
 * Sources: live Git in dev; the trigger-time build-info.json snapshot in
 * deployed environments without .git; explicit unknowns otherwise.
 */
import { getBuildInfo, shortSha, type BuildInfo } from "@workspace/build-info";

export const buildInfo: BuildInfo = getBuildInfo();
export const buildShortSha: string = shortSha(buildInfo);
