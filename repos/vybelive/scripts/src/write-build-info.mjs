/**
 * Snapshot Git build provenance into build-info.json files.
 *
 * Run at build-trigger time (root `pnpm run build`, and before `eas build`
 * for mobile) so that build environments without `.git` — EAS with
 * EAS_NO_VCS=1, Replit deployments — still carry accurate provenance.
 *
 * Writes:
 *  - <repo root>/build-info.json           (server + web builds)
 *  - <repo root>/artifacts/mobile/build-info.json  (EAS archive includes it)
 *
 * Both files are committed; they are refreshed on every build trigger.
 * Plain .mjs (no TS) so it runs directly under `node` from any build script.
 */
import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function git(args) {
  return execSync(`git --no-optional-locks ${args}`, {
    cwd: repoRoot,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "ignore"],
    timeout: 5000,
  }).trim();
}

let info;
try {
  let workingTreeStatus = "unknown";
  try {
    workingTreeStatus = git("status --porcelain") === "" ? "clean" : "dirty";
  } catch {
    // best-effort
  }
  info = {
    branch: git("rev-parse --abbrev-ref HEAD"),
    commitSha: git("rev-parse HEAD"),
    commitMessage: git("log -1 --format=%s"),
    buildTimestamp: new Date().toISOString(),
    workingTreeStatus,
  };
} catch (err) {
  // No git available: keep any existing snapshots rather than overwrite them
  // with unknowns — the previous trigger-time snapshot is the best truth.
  console.warn("[write-build-info] git unavailable, keeping existing snapshots:", String(err));
  process.exit(0);
}

const targets = [
  path.join(repoRoot, "build-info.json"),
  path.join(repoRoot, "artifacts", "mobile", "build-info.json"),
];

for (const target of targets) {
  fs.writeFileSync(target, JSON.stringify(info, null, 2) + "\n");
  console.log(`[write-build-info] wrote ${path.relative(repoRoot, target)} (${info.commitSha.slice(0, 7)}, ${info.branch}, ${info.workingTreeStatus})`);
}
