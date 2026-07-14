// ─── Replit Provider (Engineering Intelligence Layer) ─────────────────────────
// Contributes build, deployment, and runtime telemetry from the Replit
// environment: build-artifact freshness, deployment status (REPLIT_DEPLOYMENT /
// REPLIT_DOMAINS), and a live healthz probe with latency. Also supplies a local
// git branch/commit fallback so the repository section degrades gracefully when
// GitHub is unavailable. NEVER throws.

import { execSync } from "child_process";
import { statSync, existsSync, readdirSync } from "fs";
import path from "path";
import { logger } from "../../../lib/logger.js";
import type {
  BuildInfo,
  CommitInfo,
  DeploymentInfo,
  EngineeringProvider,
  ProviderResult,
  RuntimeInfo,
  ServiceHealth,
} from "../types.js";

const DIST_DIR = path.resolve(process.cwd(), "artifacts/api-server/dist");
const BUILD_STALE_MS = 24 * 60 * 60 * 1000; // a build older than 24h is "stale"
const HEALTHZ_URL = "http://localhost:80/api/healthz";

function newestArtifact(): { path: string; mtimeMs: number } | null {
  try {
    if (!existsSync(DIST_DIR)) return null;
    const files = readdirSync(DIST_DIR).filter((f) => f.endsWith(".mjs") || f.endsWith(".js"));
    let newest: { path: string; mtimeMs: number } | null = null;
    for (const f of files) {
      const full = path.join(DIST_DIR, f);
      const m = statSync(full).mtimeMs;
      if (!newest || m > newest.mtimeMs) newest = { path: full, mtimeMs: m };
    }
    return newest;
  } catch {
    return null;
  }
}

function collectBuild(): BuildInfo {
  const artifact = newestArtifact();
  if (!artifact) {
    return {
      status: "unknown",
      lastSuccessfulBuildAt: null,
      failedBuilds: 0,
      buildDurationMs: null,
      artifactPath: null,
    };
  }
  const ageMs = Date.now() - artifact.mtimeMs;
  return {
    status: ageMs > BUILD_STALE_MS ? "stale" : "passing",
    lastSuccessfulBuildAt: new Date(artifact.mtimeMs).toISOString(),
    failedBuilds: 0,
    buildDurationMs: null,
    artifactPath: path.relative(process.cwd(), artifact.path),
  };
}

function localGitFallback(): { branch: string; latestCommit: CommitInfo | null } {
  try {
    const branch = execSync("git rev-parse --abbrev-ref HEAD", {
      encoding: "utf8",
      timeout: 3000,
    }).trim();
    const raw = execSync('git log -1 --pretty=format:"%h%x1f%s%x1f%an%x1f%aI"', {
      encoding: "utf8",
      timeout: 3000,
    }).trim();
    const [sha, message, author, date] = raw.split("\u001f");
    return {
      branch,
      latestCommit: sha
        ? { sha, message: message ?? "", author: author ?? "", date: date ?? "", url: null }
        : null,
    };
  } catch {
    return { branch: "", latestCommit: null };
  }
}

async function probeRuntime(): Promise<{
  deploymentHealth: DeploymentInfo["productionHealth"];
  services: ServiceHealth[];
  runtime: RuntimeInfo;
}> {
  const startedAt = Date.now();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    const res = await fetch(HEALTHZ_URL, { signal: controller.signal });
    clearTimeout(timeout);
    const latencyMs = Date.now() - startedAt;
    const ok = res.ok;
    return {
      deploymentHealth: ok ? "healthy" : "degraded",
      services: [{ name: "api-server", status: ok ? "healthy" : "down", latencyMs }],
      runtime: {
        errors: ok ? [] : [{ message: `healthz returned ${res.status}`, count: 1, lastSeenAt: new Date().toISOString() }],
        warnings: [],
        unhealthyServices: ok ? [] : ["api-server"],
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      deploymentHealth: "down",
      services: [{ name: "api-server", status: "down", latencyMs: Date.now() - startedAt }],
      runtime: {
        errors: [{ message: `healthz unreachable: ${message}`, count: 1, lastSeenAt: new Date().toISOString() }],
        warnings: [],
        unhealthyServices: ["api-server"],
      },
    };
  }
}

function deploymentStatus(): DeploymentInfo["status"] {
  // REPLIT_DEPLOYMENT is only set in the published production runtime.
  if (process.env.REPLIT_DEPLOYMENT) return "deployed";
  if (process.env.REPLIT_DOMAINS) return "development";
  return "unknown";
}

export const replitProvider: EngineeringProvider = {
  name: "replit",
  async collect(_ctx): Promise<ProviderResult> {
    void _ctx;
    const startedAt = Date.now();
    try {
      const build = collectBuild();
      const git = localGitFallback();
      const probe = await probeRuntime();

      const urls = (process.env.REPLIT_DOMAINS ?? "")
        .split(",")
        .map((d) => d.trim())
        .filter(Boolean)
        .map((d) => `https://${d}`);

      const deployment: DeploymentInfo = {
        status: deploymentStatus(),
        productionHealth: probe.deploymentHealth,
        activeServices: probe.services,
        history: git.latestCommit
          ? [
              {
                sha: git.latestCommit.sha,
                message: git.latestCommit.message,
                deployedAt: build.lastSuccessfulBuildAt ?? "",
                status: probe.deploymentHealth,
              },
            ]
          : [],
        urls,
      };

      const latencyMs = Date.now() - startedAt;
      return {
        data: {
          // Local git is a fallback for the repository section; GitHub (when
          // available) overrides these via the layer's merge order.
          repository: { branch: git.branch, latestCommit: git.latestCommit },
          build,
          deployment,
          runtime: probe.runtime,
        },
        diagnostic: {
          name: "replit",
          status: probe.deploymentHealth === "down" ? "degraded" : "connected",
          latencyMs,
          error: null,
          lastSyncAt: new Date().toISOString(),
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn({ err }, "replitProvider: collect failed (degrading)");
      return {
        data: {},
        diagnostic: {
          name: "replit",
          status: "unavailable",
          latencyMs: Date.now() - startedAt,
          error: message,
          lastSyncAt: null,
        },
      };
    }
  },
};
