// ─── Portfolio Monitor (Mission Control V7) ───────────────────────────────────
// Mission Control oversees a PORTFOLIO of companies, not a single app. Each
// portfolio asset is registered in `portfolio_assets`. A monitor produces a
// health snapshot across a fixed set of dimensions. VYBE Live has a live monitor
// that reads real Mission Control / project state; every other asset (e.g.
// ReadyLoq) falls back to a placeholder monitor until it has live telemetry.
//
// The dispatch loop is asset-agnostic: it never hardcodes app logic. Adding a
// company is a registration row + (optionally) a monitor function keyed by slug.

import {
  db,
  portfolioAssetsTable,
  agentObjectivesTable,
  agentTasksTable,
  agentReportsTable,
  aiExecutivesTable,
  type PortfolioAssetRow,
} from "@workspace/db";
import { count, eq, inArray } from "drizzle-orm";
import { lookup } from "node:dns/promises";
import { ReplitConnectors } from "@replit/connectors-sdk";
import { getProviderStatus } from "./ai/AIProviderFactory.js";
import { logger } from "../lib/logger.js";

export type DimensionStatus = "healthy" | "attention" | "critical" | "unknown";

export type PortfolioDimension = {
  key: string;
  label: string;
  status: DimensionStatus;
  detail: string;
};

export type PortfolioAssetHealth = {
  slug: string;
  name: string;
  description: string;
  monitorType: "live" | "placeholder";
  overall: DimensionStatus;
  dimensions: PortfolioDimension[];
  generatedAt: string;
};

// The canonical dimensions every monitor reports on, in display order.
const DIMENSION_LABELS: { key: string; label: string }[] = [
  { key: "objectives", label: "Objectives" },
  { key: "build_health", label: "Build Health" },
  { key: "api_health", label: "API Health" },
  { key: "production_status", label: "Production Status" },
  { key: "beta_readiness", label: "Beta Readiness" },
  { key: "critical_blockers", label: "Critical Blockers" },
  { key: "open_issues", label: "Open Issues" },
  { key: "exec_workload", label: "Executive Workload" },
  { key: "release_readiness", label: "Release Readiness" },
];

const SEVERITY_RANK: Record<DimensionStatus, number> = {
  unknown: 0,
  healthy: 1,
  attention: 2,
  critical: 3,
};

// Overall status is the worst *known* dimension. Unknown dimensions never
// escalate the rollup; if everything is unknown the asset is unknown.
function rollup(dimensions: PortfolioDimension[]): DimensionStatus {
  const known = dimensions.filter((d) => d.status !== "unknown");
  if (known.length === 0) return "unknown";
  return known.reduce<DimensionStatus>((worst, d) => {
    return SEVERITY_RANK[d.status] > SEVERITY_RANK[worst] ? d.status : worst;
  }, "healthy");
}

function placeholderDimensions(): PortfolioDimension[] {
  return DIMENSION_LABELS.map(({ key, label }) => ({
    key,
    label,
    status: "unknown" as const,
    detail: "No live telemetry yet — registered portfolio asset awaiting instrumentation.",
  }));
}

// ─── External telemetry helpers ──────────────────────────────────────────────
// Used by the generic external monitor AND merged into dedicated live monitors
// when an asset has liveUrl / githubRepo configured. Never throw.

const PING_TIMEOUT_MS = 8_000;
const MAX_REDIRECTS = 3;

// SSRF guard: liveUrl is user-supplied config that the backend fetches, so it
// must never point at loopback, link-local (cloud metadata), or private-range
// hosts. Every hop of a redirect chain is re-validated.
function ipv4IsPrivate(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return true;
  const [a, b] = parts as [number, number, number, number];
  return (
    a === 0 || // 0.0.0.0/8
    a === 10 || // 10/8
    a === 127 || // loopback
    (a === 100 && b >= 64 && b <= 127) || // CGNAT 100.64/10
    (a === 169 && b === 254) || // link-local / metadata
    (a === 172 && b >= 16 && b <= 31) || // 172.16/12
    (a === 192 && b === 168) || // 192.168/16
    (a === 192 && b === 0) || // 192.0.0/24 + 192.0.2/24
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    a >= 224 // multicast + reserved
  );
}

function ipIsPrivate(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower.includes(":")) {
    // IPv6: loopback, unspecified, unique-local, link-local, v4-mapped.
    if (lower === "::1" || lower === "::") return true;
    if (lower.startsWith("fc") || lower.startsWith("fd") || lower.startsWith("fe8") || lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb")) return true;
    const v4 = lower.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (v4) return ipv4IsPrivate(v4[1]!);
    return false;
  }
  return ipv4IsPrivate(lower);
}

async function assertPublicHost(rawUrl: string): Promise<URL> {
  const u = new URL(rawUrl);
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error(`Blocked non-HTTP protocol "${u.protocol}"`);
  }
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) {
    throw new Error(`Blocked non-public hostname "${host}"`);
  }
  // IP literal or DNS — every resolved address must be publicly routable.
  const addresses = /^[\d.]+$|:/.test(host)
    ? [{ address: host }]
    : await lookup(host, { all: true });
  for (const a of addresses) {
    if (ipIsPrivate(a.address)) {
      throw new Error(`Blocked private/internal address for "${host}"`);
    }
  }
  return u;
}

// Fetch with manual redirect handling so every hop passes the SSRF guard.
async function safePing(rawUrl: string): Promise<Response> {
  let current = rawUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublicHost(current);
    const res = await fetch(current, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(PING_TIMEOUT_MS),
    });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) return res;
      current = new URL(loc, current).toString();
      continue;
    }
    return res;
  }
  throw new Error(`Too many redirects for ${rawUrl}`);
}

async function checkLiveUrl(url: string): Promise<PortfolioDimension> {
  const start = Date.now();
  try {
    const res = await safePing(url);
    const latency = Date.now() - start;
    if (res.ok) {
      return {
        key: "production_status",
        label: "Production Status",
        status: "healthy",
        detail: `Live at ${url} — HTTP ${res.status} in ${latency}ms.`,
      };
    }
    return {
      key: "production_status",
      label: "Production Status",
      status: res.status >= 500 ? "critical" : "attention",
      detail: `${url} responded HTTP ${res.status} in ${latency}ms.`,
    };
  } catch (err) {
    logger.warn({ err, url }, "portfolio: live URL check failed");
    return {
      key: "production_status",
      label: "Production Status",
      status: "critical",
      detail: `${url} is unreachable (timeout or connection error).`,
    };
  }
}

interface GhRepoMeta {
  open_issues_count?: number;
  pushed_at?: string;
  default_branch?: string;
}

async function checkGithubRepo(
  repoFullName: string,
): Promise<{ buildHealth: PortfolioDimension; openIssues: PortfolioDimension }> {
  const unknownPair = (detail: string) => ({
    buildHealth: { key: "build_health", label: "Build Health", status: "unknown" as const, detail },
    openIssues:  { key: "open_issues",  label: "Open Issues",  status: "unknown" as const, detail },
  });
  const cleaned = repoFullName.replace(/^https?:\/\/github\.com\//i, "").replace(/\.git$/, "");
  if (!/^[\w.-]+\/[\w.-]+$/.test(cleaned)) {
    return unknownPair(`Invalid GitHub repo reference "${repoFullName}".`);
  }
  try {
    const connectors = new ReplitConnectors();
    const res = await connectors.proxy("github", `/repos/${cleaned}`);
    if (!res.ok) {
      return unknownPair(`GitHub /repos/${cleaned} → ${res.status}.`);
    }
    const meta = (await res.json()) as GhRepoMeta;
    const pushedAt = meta.pushed_at ? new Date(meta.pushed_at) : null;
    const daysSincePush = pushedAt
      ? Math.floor((Date.now() - pushedAt.getTime()) / (24 * 60 * 60 * 1000))
      : null;
    const issueCount = meta.open_issues_count ?? 0;
    return {
      buildHealth: {
        key: "build_health",
        label: "Build Health",
        status:
          daysSincePush === null ? "unknown" : daysSincePush > 30 ? "attention" : "healthy",
        detail:
          daysSincePush === null
            ? `No push history for ${cleaned}.`
            : daysSincePush === 0
              ? `${cleaned}: pushed today (branch ${meta.default_branch ?? "main"}).`
              : `${cleaned}: last push ${daysSincePush} day(s) ago (branch ${meta.default_branch ?? "main"}).`,
      },
      openIssues: {
        key: "open_issues",
        label: "Open Issues",
        status: issueCount > 20 ? "attention" : "healthy",
        detail: `${issueCount} open issue(s)/PR(s) on ${cleaned}.`,
      },
    };
  } catch (err) {
    logger.warn({ err, repo: cleaned }, "portfolio: GitHub repo check failed");
    return unknownPair(`GitHub telemetry unavailable for ${cleaned}.`);
  }
}

// Generic external monitor: any asset with a liveUrl and/or githubRepo gets
// real telemetry without app-specific code. Dimensions without a data source
// stay "unknown" and never affect the rollup.
async function externalMonitor(asset: PortfolioAssetRow): Promise<PortfolioAssetHealth> {
  const dims = placeholderDimensions();
  const replace = (dim: PortfolioDimension) => {
    const i = dims.findIndex((d) => d.key === dim.key);
    if (i >= 0) dims[i] = dim;
  };

  const [urlDim, ghDims] = await Promise.all([
    asset.liveUrl ? checkLiveUrl(asset.liveUrl) : Promise.resolve(null),
    asset.githubRepo ? checkGithubRepo(asset.githubRepo) : Promise.resolve(null),
  ]);
  if (urlDim) replace(urlDim);
  if (ghDims) {
    replace(ghDims.buildHealth);
    replace(ghDims.openIssues);
  }

  return {
    slug: asset.slug,
    name: asset.name,
    description: asset.description,
    monitorType: "live",
    overall: rollup(dims),
    dimensions: dims,
    generatedAt: new Date().toISOString(),
  };
}

// Placeholder monitor: never fails, never blocks. Used for any asset without a
// dedicated live monitor (e.g. ReadyLoq before it has telemetry wired up).
function placeholderMonitor(asset: PortfolioAssetRow): PortfolioAssetHealth {
  const dimensions = placeholderDimensions();
  return {
    slug: asset.slug,
    name: asset.name,
    description: asset.description,
    monitorType: "placeholder",
    overall: "unknown",
    dimensions,
    generatedAt: new Date().toISOString(),
  };
}

// Live monitor for VYBE Live — derives health from real Mission Control state.
async function monitorVybeLive(asset: PortfolioAssetRow): Promise<PortfolioAssetHealth> {
  // External telemetry (prod URL ping + GitHub activity) runs alongside the
  // internal DB queries when configured on the asset row.
  const [urlDim, ghDims] = await Promise.all([
    asset.liveUrl ? checkLiveUrl(asset.liveUrl) : Promise.resolve(null),
    asset.githubRepo ? checkGithubRepo(asset.githubRepo) : Promise.resolve(null),
  ]);
  const [objGroups, taskGroups, blockedTasks, workloadRows, criticalReports, execCount] =
    await Promise.all([
      db
        .select({ status: agentObjectivesTable.status, n: count() })
        .from(agentObjectivesTable)
        .groupBy(agentObjectivesTable.status),
      db
        .select({ status: agentTasksTable.status, n: count() })
        .from(agentTasksTable)
        .groupBy(agentTasksTable.status),
      db
        .select({ n: count() })
        .from(agentTasksTable)
        .where(eq(agentTasksTable.status, "blocked")),
      db
        .select({ executiveId: agentTasksTable.executiveId, n: count() })
        .from(agentTasksTable)
        .where(inArray(agentTasksTable.status, ["backlog", "in_progress", "blocked", "review"]))
        .groupBy(agentTasksTable.executiveId),
      db
        .select({ n: count() })
        .from(agentReportsTable)
        .where(eq(agentReportsTable.status, "critical")),
      db.select({ n: count() }).from(aiExecutivesTable),
    ]);

  const objByStatus = Object.fromEntries(objGroups.map((g) => [g.status, g.n]));
  const taskByStatus = Object.fromEntries(taskGroups.map((g) => [g.status, g.n]));
  const activeObjectives =
    (objByStatus["planning"] ?? 0) +
    (objByStatus["in_progress"] ?? 0) +
    (objByStatus["needs_approval"] ?? 0);
  const completedObjectives = objByStatus["completed"] ?? 0;
  const failedObjectives = objByStatus["failed"] ?? 0;
  const needsApproval = objByStatus["needs_approval"] ?? 0;
  const blocked = blockedTasks[0]?.n ?? 0;
  const openIssues =
    (taskByStatus["backlog"] ?? 0) +
    (taskByStatus["in_progress"] ?? 0) +
    (taskByStatus["blocked"] ?? 0) +
    (taskByStatus["review"] ?? 0);
  const maxWorkload = workloadRows.reduce((m, r) => Math.max(m, r.n), 0);
  const criticalCount = criticalReports[0]?.n ?? 0;

  let apiHealthy = true;
  let aiActive = "unknown";
  try {
    const ps = getProviderStatus();
    aiActive = ps.active;
  } catch {
    apiHealthy = false;
  }

  const dims: PortfolioDimension[] = [
    {
      key: "objectives",
      label: "Objectives",
      status: failedObjectives > 0 ? "attention" : activeObjectives > 0 ? "healthy" : "unknown",
      detail:
        activeObjectives > 0 || completedObjectives > 0
          ? `${activeObjectives} active, ${completedObjectives} completed${failedObjectives > 0 ? `, ${failedObjectives} failed` : ""}`
          : "No objectives yet.",
    },
    ghDims?.buildHealth ?? {
      key: "build_health",
      label: "Build Health",
      status: "unknown",
      detail: "No CI/build telemetry connected yet.",
    },
    {
      key: "api_health",
      label: "API Health",
      status: apiHealthy ? "healthy" : "critical",
      detail: apiHealthy
        ? `API + database reachable; AI provider "${aiActive}" active.`
        : "AI provider status unavailable.",
    },
    urlDim ?? {
      key: "production_status",
      label: "Production Status",
      status: "unknown",
      detail: "No production deployment telemetry connected yet.",
    },
    {
      key: "beta_readiness",
      label: "Beta Readiness",
      status: blocked > 0 || criticalCount > 0 ? "attention" : "healthy",
      detail:
        blocked > 0 || criticalCount > 0
          ? `${blocked} blocked task(s), ${criticalCount} critical report(s) gating readiness.`
          : "No blockers or critical reports outstanding.",
    },
    {
      key: "critical_blockers",
      label: "Critical Blockers",
      status: blocked > 0 ? "critical" : criticalCount > 0 ? "attention" : "healthy",
      detail:
        blocked > 0
          ? `${blocked} task(s) blocked.`
          : criticalCount > 0
            ? `${criticalCount} executive report(s) flagged critical.`
            : "No critical blockers.",
    },
    {
      key: "open_issues",
      label: "Open Issues",
      status: openIssues > 20 ? "attention" : "healthy",
      detail: `${openIssues} open task(s) across the team.`,
    },
    {
      key: "exec_workload",
      label: "Executive Workload",
      status: maxWorkload > 8 ? "attention" : "healthy",
      detail: `${execCount[0]?.n ?? 0} executive(s); peak load ${maxWorkload} open task(s).`,
    },
    {
      key: "release_readiness",
      label: "Release Readiness",
      status: blocked > 0 ? "attention" : needsApproval > 0 ? "attention" : "healthy",
      detail:
        blocked > 0
          ? "Blockers must clear before release."
          : needsApproval > 0
            ? `${needsApproval} objective(s) awaiting founder approval.`
            : "No release blockers.",
    },
  ];

  return {
    slug: asset.slug,
    name: asset.name,
    description: asset.description,
    monitorType: "live",
    overall: rollup(dims),
    dimensions: dims,
    generatedAt: new Date().toISOString(),
  };
}

// Registry of live monitors keyed by asset slug. Anything not present here is
// served by the placeholder monitor — no app-specific branching in the loop.
const LIVE_MONITORS: Record<string, (asset: PortfolioAssetRow) => Promise<PortfolioAssetHealth>> = {
  "vybe-live": monitorVybeLive,
};

async function monitorAsset(asset: PortfolioAssetRow): Promise<PortfolioAssetHealth> {
  const live = asset.monitorType === "live" ? LIVE_MONITORS[asset.slug] : undefined;
  try {
    if (live) return await live(asset);
    // Any asset with external telemetry config gets real monitoring without
    // app-specific code — this is how new portfolio companies come online.
    if (asset.liveUrl || asset.githubRepo) return await externalMonitor(asset);
    return placeholderMonitor(asset);
  } catch (err) {
    // A monitor must never take down the portfolio view — degrade to placeholder.
    logger.warn({ err, slug: asset.slug }, "portfolio: live monitor failed; using placeholder");
    return placeholderMonitor(asset);
  }
}

// Health snapshot across every active portfolio asset (sorted by sortOrder).
export async function getPortfolioHealth(): Promise<{
  generatedAt: string;
  assets: PortfolioAssetHealth[];
}> {
  const assets = await db
    .select()
    .from(portfolioAssetsTable)
    .where(eq(portfolioAssetsTable.isActive, true))
    .orderBy(portfolioAssetsTable.sortOrder);
  const results = await Promise.all(assets.map((a) => monitorAsset(a)));
  return { generatedAt: new Date().toISOString(), assets: results };
}

// Compact rollup used by Diagnostics and the autonomy engine's signal gathering.
export async function getPortfolioSummary(): Promise<{
  totalAssets: number;
  healthy: number;
  attention: number;
  critical: number;
  assets: PortfolioAssetHealth[];
}> {
  const { assets } = await getPortfolioHealth();
  return {
    totalAssets: assets.length,
    healthy: assets.filter((a) => a.overall === "healthy").length,
    attention: assets.filter((a) => a.overall === "attention").length,
    critical: assets.filter((a) => a.overall === "critical").length,
    assets,
  };
}
