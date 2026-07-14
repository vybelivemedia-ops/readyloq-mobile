// ─── Release Manager capability: build status & deployment readiness ──────────
import path from "path";
import { execSync } from "child_process";
import type { ExecutiveReport } from "./index.js";
import { findRepoRoot, fileExists, fileMtime, listDirs } from "./repo.js";

function git(root: string, args: string): string | null {
  try {
    return execSync(`git --no-optional-locks ${args}`, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 8000,
    }).trim();
  } catch {
    return null;
  }
}

export async function inspectRelease(): Promise<ExecutiveReport> {
  const root = findRepoRoot();

  const porcelain = git(root, "status --porcelain");
  const uncommitted = porcelain === null ? null : porcelain ? porcelain.split("\n").length : 0;
  const lastCommit = git(root, "log -1 --pretty=%h%x09%s%x09%cr");
  const branch = git(root, "rev-parse --abbrev-ref HEAD");

  const apiDist = path.join(root, "artifacts/api-server/dist");
  const buildPresent = fileExists(apiDist);
  const buildMtime = buildPresent ? fileMtime(apiDist) : null;

  const artifacts = listDirs(path.join(root, "artifacts"));
  const hasReplitConfig = fileExists(path.join(root, ".replit"));

  let lastCommitMsg = "unknown";
  let lastCommitWhen = "unknown";
  if (lastCommit) {
    const parts = lastCommit.split("\t");
    lastCommitMsg = parts[1] ?? lastCommit;
    lastCommitWhen = parts[2] ?? "unknown";
  }

  const findings: ExecutiveReport["findings"] = [];
  if (uncommitted === null) {
    findings.push({ severity: "info", text: "Git status unavailable in this environment." });
  } else if (uncommitted > 0) {
    findings.push({
      severity: uncommitted > 20 ? "warning" : "info",
      text: `${uncommitted} uncommitted change(s) in the working tree — commit before deploying.`,
    });
  } else {
    findings.push({ severity: "info", text: "Working tree is clean — ready to deploy." });
  }
  if (!buildPresent) {
    findings.push({
      severity: "warning",
      text: "No api-server build output (dist/) found — run the build before deploying.",
    });
  } else {
    findings.push({
      severity: "info",
      text: `Build output present (last built ${buildMtime ? buildMtime.toISOString().slice(0, 16).replace("T", " ") : "unknown"}).`,
    });
  }
  if (!hasReplitConfig) {
    findings.push({ severity: "warning", text: "No .replit deployment config detected." });
  }

  const readyChecks = [
    uncommitted === 0,
    buildPresent,
    hasReplitConfig,
    lastCommit !== null,
  ];
  const ready = readyChecks.filter(Boolean).length;
  const status: ExecutiveReport["status"] =
    !buildPresent || !hasReplitConfig ? "attention" : ready === readyChecks.length ? "healthy" : "attention";

  return {
    status,
    headline: `Deploy readiness ${ready}/${readyChecks.length} — ${uncommitted ?? "?"} uncommitted change(s)`,
    summary:
      `On branch ${branch ?? "unknown"}. Last commit: "${lastCommitMsg}" (${lastCommitWhen}). ` +
      `Working tree has ${uncommitted ?? "unknown"} uncommitted change(s). ` +
      `Build output is ${buildPresent ? "present" : "missing"}; deploy config ${hasReplitConfig ? "detected" : "missing"}. ` +
      `${artifacts.length} artifacts in the deployable set.`,
    metrics: [
      { label: "Readiness", value: `${ready}/${readyChecks.length}` },
      { label: "Uncommitted", value: uncommitted === null ? "n/a" : String(uncommitted) },
      { label: "Branch", value: branch ?? "n/a" },
      { label: "Build output", value: buildPresent ? "present" : "missing" },
      { label: "Artifacts", value: String(artifacts.length) },
      { label: "Deploy config", value: hasReplitConfig ? "yes" : "no" },
    ],
    findings,
  };
}
