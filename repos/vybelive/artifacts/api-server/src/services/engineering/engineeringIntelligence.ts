// ─── Engineering Intelligence Layer (Mission Control V10) ─────────────────────
// The single source of engineering truth — now PORTFOLIO-AWARE. Every snapshot
// belongs to a product (a portfolio asset). For each product the layer runs that
// product's registered providers, merges their contributions into ONE
// deterministic Engineering Snapshot, computes the Health Score / Launch
// Readiness / risks / blockers, detects typed Engineering Events vs the previous
// snapshot, persists everything historically (never overwritten), and exposes
// snapshots, events, and a portfolio overview to executives and Quinn. Providers
// never talk to executives; executives consume only the snapshot returned here.
//
// Adding a product is a portfolio_assets row. Adding a provider for a product is
// a single entry in PROVIDER_REGISTRY — Quinn, executives, briefing, and the
// dashboard are unaffected because they read the normalized snapshot, not
// providers.

import {
  db,
  engineeringSnapshotsTable,
  engineeringEventsTable,
  portfolioAssetsTable,
  type EngineeringSnapshotRow,
  type EngineeringEventRow,
} from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import { logger } from "../../lib/logger.js";
import { githubProvider } from "./providers/githubProvider.js";
import { replitProvider } from "./providers/replitProvider.js";
import type {
  EngineeringEvent,
  EngineeringProduct,
  EngineeringProvider,
  EngineeringSnapshot,
  ExecutiveEngineeringView,
  LaunchReadiness,
  LaunchReadinessFactor,
  PortfolioEngineeringOverview,
  ProductEngineeringSummary,
  ProviderContext,
  ProviderContribution,
  ProviderDiagnostic,
  RiskLevel,
} from "./types.js";

// ─── Provider registry (registration-only extension) ──────────────────────────
// Maps a product slug → the providers that feed its snapshot. Provider order
// matters for merge precedence: later providers fill gaps left by earlier ones
// but do NOT overwrite already-populated repository fields. GitHub is the
// authoritative repository source, so it runs first. A product with no entry
// here (e.g. a placeholder portfolio asset) still produces a well-formed,
// all-unknown snapshot — it is simply unmonitored until providers are registered.
const PROVIDER_REGISTRY: Record<string, EngineeringProvider[]> = {
  "vybe-live": [githubProvider, replitProvider],
};

function getProvidersForProduct(slug: string): EngineeringProvider[] {
  return PROVIDER_REGISTRY[slug] ?? [];
}

// Flagship fallback used when portfolio assets are not yet seeded.
const FLAGSHIP_FALLBACK: EngineeringProduct = {
  id: "",
  slug: "vybe-live",
  name: "VYBE Live",
};

const FRESH_TTL_MS = 20_000; // a snapshot younger than this is reused for reads

function emptyLaunchReadiness(): LaunchReadiness {
  return { score: 0, state: "unknown", factors: [] };
}

function emptySnapshot(id: string, product: EngineeringProduct): EngineeringSnapshot {
  return {
    id,
    productId: product.id,
    productSlug: product.slug,
    productName: product.name,
    capturedAt: new Date().toISOString(),
    repository: {
      branch: "",
      latestCommit: null,
      recentCommits: [],
      openPullRequests: [],
      openIssues: 0,
    },
    build: {
      status: "unknown",
      lastSuccessfulBuildAt: null,
      failedBuilds: 0,
      buildDurationMs: null,
      artifactPath: null,
    },
    deployment: {
      status: "unknown",
      productionHealth: "unknown",
      activeServices: [],
      history: [],
      urls: [],
    },
    runtime: { errors: [], warnings: [], unhealthyServices: [] },
    healthScore: 0,
    launchReadiness: emptyLaunchReadiness(),
    blockers: [],
    deploymentRisk: "unknown",
    launchRisk: "unknown",
    providers: [],
  };
}

// Deep-merge a provider contribution onto the snapshot. Repository scalar fields
// are only filled when still empty (GitHub-first precedence); arrays/collections
// prefer the first non-empty contribution.
function mergeContribution(snap: EngineeringSnapshot, c: ProviderContribution): void {
  if (c.repository) {
    const r = c.repository;
    if (!snap.repository.branch && r.branch) snap.repository.branch = r.branch;
    if (!snap.repository.latestCommit && r.latestCommit)
      snap.repository.latestCommit = r.latestCommit;
    if (snap.repository.recentCommits.length === 0 && r.recentCommits?.length)
      snap.repository.recentCommits = r.recentCommits;
    if (snap.repository.openPullRequests.length === 0 && r.openPullRequests?.length)
      snap.repository.openPullRequests = r.openPullRequests;
    if (snap.repository.openIssues === 0 && typeof r.openIssues === "number")
      snap.repository.openIssues = r.openIssues;
  }
  if (c.build) {
    if (snap.build.status === "unknown" && c.build.status) snap.build = { ...snap.build, ...c.build };
    else snap.build = { ...snap.build, ...c.build };
  }
  if (c.deployment) {
    snap.deployment = {
      ...snap.deployment,
      ...c.deployment,
      activeServices: c.deployment.activeServices ?? snap.deployment.activeServices,
      history:
        c.deployment.history && c.deployment.history.length
          ? c.deployment.history
          : snap.deployment.history,
      urls: c.deployment.urls?.length ? c.deployment.urls : snap.deployment.urls,
    };
  }
  if (c.runtime) {
    snap.runtime = {
      errors: [...snap.runtime.errors, ...(c.runtime.errors ?? [])],
      warnings: [...snap.runtime.warnings, ...(c.runtime.warnings ?? [])],
      unhealthyServices: [
        ...new Set([...snap.runtime.unhealthyServices, ...(c.runtime.unhealthyServices ?? [])]),
      ],
    };
  }
}

// Deterministic 0–100 Engineering Health Score. Pure function of the snapshot.
function computeHealthScore(snap: EngineeringSnapshot): number {
  let score = 100;
  // Build
  if (snap.build.status === "failing") score -= 30;
  else if (snap.build.status === "stale") score -= 10;
  else if (snap.build.status === "unknown") score -= 5;
  // Deployment / production health
  if (snap.deployment.productionHealth === "down") score -= 30;
  else if (snap.deployment.productionHealth === "degraded") score -= 15;
  else if (snap.deployment.productionHealth === "unknown") score -= 5;
  // Runtime
  score -= Math.min(30, snap.runtime.errors.length * 10);
  score -= Math.min(10, snap.runtime.warnings.length * 2);
  // Repository pressure
  if (snap.repository.openPullRequests.length > 5) score -= 5;
  if (snap.repository.openIssues > 10) score -= 5;
  // Provider confidence: each unavailable provider lowers certainty
  const unavailable = snap.providers.filter((p) => p.status === "unavailable").length;
  score -= unavailable * 5;
  return Math.max(0, Math.min(100, Math.round(score)));
}

function computeBlockers(snap: EngineeringSnapshot): string[] {
  const blockers: string[] = [];
  if (snap.build.status === "failing") blockers.push("Build is failing");
  if (snap.deployment.productionHealth === "down")
    blockers.push("Production is down (healthz unreachable)");
  if (snap.runtime.errors.length > 0)
    blockers.push(`${snap.runtime.errors.length} runtime error(s) detected`);
  for (const svc of snap.runtime.unhealthyServices) blockers.push(`Service unhealthy: ${svc}`);
  return blockers;
}

function computeDeploymentRisk(snap: EngineeringSnapshot): RiskLevel {
  if (snap.deployment.productionHealth === "down" || snap.build.status === "failing") return "high";
  if (snap.deployment.productionHealth === "degraded" || snap.build.status === "stale")
    return "medium";
  if (snap.deployment.productionHealth === "unknown" && snap.build.status === "unknown")
    return "unknown";
  return "low";
}

function computeLaunchRisk(snap: EngineeringSnapshot): RiskLevel {
  if (snap.blockers.length > 0 || snap.healthScore < 50) return "high";
  if (snap.healthScore < 75) return "medium";
  if (snap.healthScore === 0) return "unknown";
  return "low";
}

// ─── Launch Readiness Score ───────────────────────────────────────────────────
// A single high-level executive metric (0–100). Each factor reports a 0–100
// score or null (no telemetry source yet). The overall score is the weighted
// average over factors that have a known score, so missing sources (streaming
// health, platform approvals, beta stability) never penalize readiness — they
// simply do not contribute until instrumented.
const LAUNCH_FACTOR_WEIGHTS: Record<string, number> = {
  build_stability: 1.5,
  deployment_health: 1.5,
  runtime_stability: 1.25,
  production_errors: 1.25,
  critical_issues: 1,
  open_release_blockers: 1.5,
  streaming_health: 1,
  platform_approvals: 1,
  beta_stability: 1,
};

function factorState(score: number | null): LaunchReadinessFactor["state"] {
  if (score === null) return "unknown";
  if (score >= 80) return "strong";
  if (score >= 50) return "watch";
  return "at_risk";
}

function f(key: string, label: string, score: number | null, detail: string): LaunchReadinessFactor {
  return { key, label, state: factorState(score), score, detail };
}

export function computeLaunchReadiness(snap: EngineeringSnapshot): LaunchReadiness {
  const factors: LaunchReadinessFactor[] = [];

  // Build Stability
  const build = snap.build.status;
  factors.push(
    f(
      "build_stability",
      "Build Stability",
      build === "passing" ? 100 : build === "stale" ? 60 : build === "failing" ? 0 : null,
      `Build is ${build}.`,
    ),
  );

  // Deployment Health
  const ph = snap.deployment.productionHealth;
  factors.push(
    f(
      "deployment_health",
      "Deployment Health",
      ph === "healthy" ? 100 : ph === "degraded" ? 50 : ph === "down" ? 0 : null,
      `Production health is ${ph} (deployment ${snap.deployment.status}).`,
    ),
  );

  // Runtime Stability — based on warnings + unhealthy services when known.
  const hasRuntimeSignal = snap.providers.some((p) => p.status !== "unavailable");
  const runtimePenalty =
    Math.min(60, snap.runtime.warnings.length * 10) +
    Math.min(40, snap.runtime.unhealthyServices.length * 20);
  factors.push(
    f(
      "runtime_stability",
      "Runtime Stability",
      hasRuntimeSignal ? Math.max(0, 100 - runtimePenalty) : null,
      hasRuntimeSignal
        ? `${snap.runtime.warnings.length} warning(s), ${snap.runtime.unhealthyServices.length} unhealthy service(s).`
        : "No runtime telemetry.",
    ),
  );

  // Production Errors
  factors.push(
    f(
      "production_errors",
      "Production Errors",
      hasRuntimeSignal ? Math.max(0, 100 - snap.runtime.errors.length * 25) : null,
      hasRuntimeSignal ? `${snap.runtime.errors.length} runtime error(s).` : "No error telemetry.",
    ),
  );

  // Critical Issues — open GitHub issues as a coarse proxy when known.
  const repoKnown = snap.providers.some((p) => p.name === "github" && p.status === "connected");
  factors.push(
    f(
      "critical_issues",
      "Critical Issues",
      repoKnown ? Math.max(0, 100 - snap.repository.openIssues * 10) : null,
      repoKnown ? `${snap.repository.openIssues} open issue(s).` : "No issue tracker telemetry.",
    ),
  );

  // Open Release Blockers
  factors.push(
    f(
      "open_release_blockers",
      "Open Release Blockers",
      snap.providers.length > 0 ? Math.max(0, 100 - snap.blockers.length * 50) : null,
      `${snap.blockers.length} open blocker(s).`,
    ),
  );

  // Factors awaiting a telemetry source — registered but unknown until wired.
  factors.push(f("streaming_health", "Streaming Health", null, "Awaiting streaming telemetry."));
  factors.push(
    f("platform_approvals", "Platform Approvals", null, "Awaiting store/platform approval feed."),
  );
  factors.push(f("beta_stability", "Beta Stability", null, "Awaiting beta cohort telemetry."));

  // Weighted average over known factors.
  let weightedSum = 0;
  let weightTotal = 0;
  for (const factor of factors) {
    if (factor.score === null) continue;
    const w = LAUNCH_FACTOR_WEIGHTS[factor.key] ?? 1;
    weightedSum += factor.score * w;
    weightTotal += w;
  }
  if (weightTotal === 0) return { score: 0, state: "unknown", factors };
  const score = Math.round(weightedSum / weightTotal);
  const state: LaunchReadiness["state"] =
    score >= 80 ? "ready" : score >= 60 ? "approaching" : "not_ready";
  return { score, state, factors };
}

const inFlight = new Map<string, Promise<EngineeringSnapshot>>();

// Collect a fresh snapshot for a product from its registered providers,
// normalize, score, detect events, and persist. Coalesces concurrent callers
// for the same product onto a single in-flight collection.
export async function collectSnapshot(product: EngineeringProduct): Promise<EngineeringSnapshot> {
  const existing = inFlight.get(product.id || product.slug);
  if (existing) return existing;
  const run = (async () => {
    const id = randomUUID();
    const snap = emptySnapshot(id, product);
    const diagnostics: ProviderDiagnostic[] = [];
    const providers = getProvidersForProduct(product.slug);
    const ctx: ProviderContext = { productId: product.id, productSlug: product.slug };

    const results = await Promise.allSettled(providers.map((p) => p.collect(ctx)));
    results.forEach((r, i) => {
      if (r.status === "fulfilled") {
        diagnostics.push(r.value.diagnostic);
        mergeContribution(snap, r.value.data);
      } else {
        // collect() is contracted never to throw, but guard anyway.
        diagnostics.push({
          name: providers[i].name,
          status: "unavailable",
          latencyMs: 0,
          error: r.reason instanceof Error ? r.reason.message : String(r.reason),
          lastSyncAt: null,
        });
      }
    });

    snap.providers = diagnostics;
    snap.healthScore = computeHealthScore(snap);
    snap.blockers = computeBlockers(snap);
    snap.deploymentRisk = computeDeploymentRisk(snap);
    snap.launchRisk = computeLaunchRisk(snap);
    snap.launchReadiness = computeLaunchReadiness(snap);

    // Detect + persist typed events vs the product's previous snapshot. This runs
    // BEFORE we persist `snap`, so the immediate predecessor is the LATEST already-
    // persisted row — not getPreviousSnapshot() (which assumes `snap` is already
    // persisted and would return the second-newest, lagging detection by one).
    const prev = await getLatestPersistedSnapshot(product.id || "");
    const events = detectEngineeringEvents(prev, snap);
    await persistSnapshot(snap);
    if (events.length) await persistEngineeringEvents(events);
    return snap;
  })();
  inFlight.set(product.id || product.slug, run);
  try {
    return await run;
  } finally {
    inFlight.delete(product.id || product.slug);
  }
}

async function persistSnapshot(snap: EngineeringSnapshot): Promise<void> {
  try {
    await db.insert(engineeringSnapshotsTable).values({
      id: snap.id,
      productId: snap.productId,
      capturedAt: new Date(snap.capturedAt),
      healthScore: snap.healthScore,
      launchReadinessScore: snap.launchReadiness.score,
      deploymentRisk: snap.deploymentRisk,
      launchRisk: snap.launchRisk,
      blockers: snap.blockers,
      branch: snap.repository.branch,
      latestCommitSha: snap.repository.latestCommit?.sha ?? "",
      latestCommitMessage: snap.repository.latestCommit?.message ?? "",
      openPullRequests: snap.repository.openPullRequests.length,
      openIssues: snap.repository.openIssues,
      buildStatus: snap.build.status,
      deploymentStatus: snap.deployment.status,
      runtimeStatus:
        snap.deployment.productionHealth === "healthy"
          ? "healthy"
          : snap.deployment.productionHealth,
      errorCount: snap.runtime.errors.length,
      providers: snap.providers,
      snapshot: snap as unknown as Record<string, unknown>,
    });
  } catch (err) {
    // Persistence is best-effort: a DB write failure must not break callers that
    // already have a well-formed in-memory snapshot.
    logger.warn({ err }, "engineeringIntelligence: persistSnapshot failed");
  }
}

function rowToSnapshot(row: EngineeringSnapshotRow): EngineeringSnapshot {
  const stored = row.snapshot as unknown as Partial<EngineeringSnapshot> | undefined;
  if (stored && stored.id) {
    // Trust the persisted normalized snapshot but refresh volatile/derived fields
    // and backfill product + launch readiness for snapshots stored before V10
    // portfolio-awareness.
    const base: EngineeringSnapshot = {
      ...(stored as EngineeringSnapshot),
      capturedAt: row.capturedAt.toISOString(),
      productId: stored.productId ?? row.productId,
      productSlug: stored.productSlug ?? "",
      productName: stored.productName ?? "",
    };
    if (!base.launchReadiness) base.launchReadiness = computeLaunchReadiness(base);
    return base;
  }
  // Fallback reconstruction from summary columns (older rows).
  const base = emptySnapshot(row.id, {
    id: row.productId,
    slug: "",
    name: "",
  });
  base.capturedAt = row.capturedAt.toISOString();
  base.healthScore = row.healthScore;
  base.deploymentRisk = row.deploymentRisk as RiskLevel;
  base.launchRisk = row.launchRisk as RiskLevel;
  base.blockers = row.blockers;
  base.repository.branch = row.branch;
  base.repository.openIssues = row.openIssues;
  base.build.status = row.buildStatus as EngineeringSnapshot["build"]["status"];
  base.deployment.status = row.deploymentStatus as EngineeringSnapshot["deployment"]["status"];
  base.providers = row.providers;
  base.launchReadiness = computeLaunchReadiness(base);
  return base;
}

// ─── Products (portfolio assets) ──────────────────────────────────────────────
export async function getActiveProducts(): Promise<EngineeringProduct[]> {
  try {
    const rows = await db
      .select()
      .from(portfolioAssetsTable)
      .where(eq(portfolioAssetsTable.isActive, true))
      .orderBy(portfolioAssetsTable.sortOrder);
    if (rows.length === 0) return [FLAGSHIP_FALLBACK];
    return rows.map((r) => ({ id: r.id, slug: r.slug, name: r.name }));
  } catch (err) {
    logger.warn({ err }, "engineeringIntelligence: getActiveProducts failed; using fallback");
    return [FLAGSHIP_FALLBACK];
  }
}

// The flagship product is the first active portfolio asset (sortOrder 0) — by
// convention VYBE Live. Used where a single representative snapshot is needed.
export async function getFlagshipProduct(): Promise<EngineeringProduct> {
  const products = await getActiveProducts();
  return products.find((p) => p.slug === "vybe-live") ?? products[0] ?? FLAGSHIP_FALLBACK;
}

export async function getProductById(productId: string): Promise<EngineeringProduct | null> {
  const products = await getActiveProducts();
  return products.find((p) => p.id === productId) ?? null;
}

// Return the most recent snapshot for a product, collecting a fresh one if none
// exists or the latest is older than maxAgeMs. Powers the live dashboard.
export async function getLatestSnapshot(
  product: EngineeringProduct,
  maxAgeMs = FRESH_TTL_MS,
): Promise<EngineeringSnapshot> {
  const rows = await db
    .select()
    .from(engineeringSnapshotsTable)
    .where(eq(engineeringSnapshotsTable.productId, product.id))
    .orderBy(desc(engineeringSnapshotsTable.capturedAt))
    .limit(1);
  const latest = rows[0];
  if (latest) {
    const ageMs = Date.now() - latest.capturedAt.getTime();
    if (ageMs <= maxAgeMs) return rowToSnapshot(latest);
  }
  return collectSnapshot(product);
}

// Convenience: latest snapshot for the flagship product.
export async function getFlagshipSnapshot(maxAgeMs = FRESH_TTL_MS): Promise<EngineeringSnapshot> {
  const product = await getFlagshipProduct();
  return getLatestSnapshot(product, maxAgeMs);
}

// Return the previous persisted snapshot for a product relative to the latest
// (for change detection), or null if there are fewer than two. Use this AFTER the
// current snapshot has been persisted (it returns the second-newest row).
export async function getPreviousSnapshot(productId: string): Promise<EngineeringSnapshot | null> {
  const rows = await db
    .select()
    .from(engineeringSnapshotsTable)
    .where(eq(engineeringSnapshotsTable.productId, productId))
    .orderBy(desc(engineeringSnapshotsTable.capturedAt))
    .limit(2);
  if (rows.length < 2) return null;
  return rowToSnapshot(rows[1]);
}

// Return the latest persisted snapshot for a product, or null if none exist. Use
// this for pre-persist change detection: before a fresh in-memory snapshot is
// written, the latest persisted row IS its immediate predecessor.
export async function getLatestPersistedSnapshot(
  productId: string,
): Promise<EngineeringSnapshot | null> {
  const rows = await db
    .select()
    .from(engineeringSnapshotsTable)
    .where(eq(engineeringSnapshotsTable.productId, productId))
    .orderBy(desc(engineeringSnapshotsTable.capturedAt))
    .limit(1);
  return rows[0] ? rowToSnapshot(rows[0]) : null;
}

export async function getSnapshotHistory(
  productId: string,
  limit = 20,
): Promise<EngineeringSnapshot[]> {
  const rows = await db
    .select()
    .from(engineeringSnapshotsTable)
    .where(eq(engineeringSnapshotsTable.productId, productId))
    .orderBy(desc(engineeringSnapshotsTable.capturedAt))
    .limit(limit);
  return rows.map(rowToSnapshot);
}

export async function getSnapshotById(id: string): Promise<EngineeringSnapshot | null> {
  const rows = await db
    .select()
    .from(engineeringSnapshotsTable)
    .where(eq(engineeringSnapshotsTable.id, id))
    .limit(1);
  return rows[0] ? rowToSnapshot(rows[0]) : null;
}

// Collect a fresh snapshot for every active product (one autonomous sweep).
export async function collectAllSnapshots(): Promise<EngineeringSnapshot[]> {
  const products = await getActiveProducts();
  const results = await Promise.allSettled(products.map((p) => collectSnapshot(p)));
  const snapshots: EngineeringSnapshot[] = [];
  results.forEach((r, i) => {
    if (r.status === "fulfilled") snapshots.push(r.value);
    else logger.warn({ err: r.reason, product: products[i].slug }, "collectAllSnapshots: product failed");
  });
  return snapshots;
}

// ─── Engineering Events ───────────────────────────────────────────────────────
// Compare a fresh snapshot against the product's previous snapshot and emit
// typed events. Returns [] when nothing material changed.
export function detectEngineeringEvents(
  prev: EngineeringSnapshot | null,
  curr: EngineeringSnapshot,
): EngineeringEvent[] {
  if (!prev) return []; // first snapshot for a product: nothing to compare against
  const events: EngineeringEvent[] = [];
  const push = (
    type: EngineeringEvent["type"],
    severity: EngineeringEvent["severity"],
    title: string,
    detail: string,
  ): void => {
    events.push({
      id: randomUUID(),
      productId: curr.productId,
      snapshotId: curr.id,
      type,
      severity,
      title,
      detail,
      createdAt: curr.capturedAt,
    });
  };

  // Build
  if (prev.build.status !== "failing" && curr.build.status === "failing")
    push("build_failed", "critical", "Build failed", `Build went ${prev.build.status} → failing.`);

  // Deployment lifecycle
  if (prev.repository.latestCommit?.sha !== curr.repository.latestCommit?.sha && curr.repository.latestCommit)
    push(
      "deployment_started",
      "info",
      "Deployment started",
      `New commit ${curr.repository.latestCommit.sha}: ${curr.repository.latestCommit.message}`,
    );
  if (prev.deployment.status !== "deployed" && curr.deployment.status === "deployed")
    push("deployment_succeeded", "info", "Deployment succeeded", "Deployment status is now deployed.");
  if (prev.deployment.status !== "down" && curr.deployment.status === "down")
    push("deployment_failed", "critical", "Deployment failed", "Deployment status dropped to down.");

  // Production health
  const wasHealthy = prev.deployment.productionHealth === "healthy";
  const isHealthy = curr.deployment.productionHealth === "healthy";
  if (!wasHealthy && isHealthy)
    push("production_healthy", "info", "Production healthy", "Production health recovered to healthy.");
  if (wasHealthy && !isHealthy && curr.deployment.productionHealth !== "unknown")
    push(
      "production_degraded",
      "critical",
      "Production degraded",
      `Production health dropped to ${curr.deployment.productionHealth}.`,
    );

  // Runtime errors
  if (curr.runtime.errors.length > prev.runtime.errors.length)
    push(
      "runtime_errors_increased",
      "warning",
      "Runtime errors increased",
      `Runtime errors rose ${prev.runtime.errors.length} → ${curr.runtime.errors.length}.`,
    );
  if (curr.runtime.errors.length < prev.runtime.errors.length && curr.runtime.errors.length === 0)
    push("runtime_errors_resolved", "info", "Runtime errors resolved", "Runtime errors cleared.");

  // Repository
  if (curr.repository.openPullRequests.length > prev.repository.openPullRequests.length)
    push(
      "new_pull_request",
      "info",
      "New pull request",
      `Open PRs rose ${prev.repository.openPullRequests.length} → ${curr.repository.openPullRequests.length}.`,
    );
  if (curr.blockers.length > prev.blockers.length)
    push(
      "critical_issue_opened",
      "critical",
      "Critical issue opened",
      curr.blockers[curr.blockers.length - 1] ?? "A new engineering blocker appeared.",
    );

  return events;
}

async function persistEngineeringEvents(events: EngineeringEvent[]): Promise<void> {
  try {
    await db.insert(engineeringEventsTable).values(
      events.map((e) => ({
        id: e.id,
        productId: e.productId,
        snapshotId: e.snapshotId,
        type: e.type,
        severity: e.severity,
        title: e.title,
        detail: e.detail,
        createdAt: new Date(e.createdAt),
      })),
    );
  } catch (err) {
    logger.warn({ err }, "engineeringIntelligence: persistEngineeringEvents failed");
  }
}

function eventRowToEvent(row: EngineeringEventRow): EngineeringEvent {
  return {
    id: row.id,
    productId: row.productId,
    snapshotId: row.snapshotId,
    type: row.type,
    severity: row.severity as EngineeringEvent["severity"],
    title: row.title,
    detail: row.detail,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function getRecentEvents(productId: string, limit = 30): Promise<EngineeringEvent[]> {
  const rows = await db
    .select()
    .from(engineeringEventsTable)
    .where(eq(engineeringEventsTable.productId, productId))
    .orderBy(desc(engineeringEventsTable.createdAt))
    .limit(limit);
  return rows.map(eventRowToEvent);
}

export async function getEventById(id: string): Promise<EngineeringEvent | null> {
  const rows = await db
    .select()
    .from(engineeringEventsTable)
    .where(and(eq(engineeringEventsTable.id, id)))
    .limit(1);
  return rows[0] ? eventRowToEvent(rows[0]) : null;
}

// ─── Portfolio overview + aggregate launch readiness ──────────────────────────
function aggregateLaunchReadiness(snapshots: EngineeringSnapshot[]): LaunchReadiness {
  // Average across products that have a known (monitored) launch readiness score.
  const scored = snapshots.filter((s) => s.providers.length > 0 && s.launchReadiness.score > 0);
  if (scored.length === 0) return { score: 0, state: "unknown", factors: [] };
  const score = Math.round(
    scored.reduce((sum, s) => sum + s.launchReadiness.score, 0) / scored.length,
  );
  const state: LaunchReadiness["state"] =
    score >= 80 ? "ready" : score >= 60 ? "approaching" : "not_ready";
  // Roll up factors by key, averaging known scores across products.
  const byKey = new Map<string, { label: string; scores: number[] }>();
  for (const s of scored) {
    for (const factor of s.launchReadiness.factors) {
      if (factor.score === null) continue;
      const entry = byKey.get(factor.key) ?? { label: factor.label, scores: [] };
      entry.scores.push(factor.score);
      byKey.set(factor.key, entry);
    }
  }
  const factors: LaunchReadinessFactor[] = Array.from(byKey.entries()).map(([key, v]) => {
    const avg = Math.round(v.scores.reduce((a, b) => a + b, 0) / v.scores.length);
    return f(key, v.label, avg, `Avg across ${v.scores.length} product(s).`);
  });
  return { score, state, factors };
}

export async function getPortfolioOverview(): Promise<PortfolioEngineeringOverview> {
  const products = await getActiveProducts();
  const snapshots = await Promise.all(products.map((p) => getLatestSnapshot(p)));
  const summaries: ProductEngineeringSummary[] = products.map((product, i) => {
    const snap = snapshots[i];
    return {
      product,
      monitored: getProvidersForProduct(product.slug).length > 0,
      healthScore: snap.healthScore,
      launchReadiness: snap.launchReadiness,
      deploymentRisk: snap.deploymentRisk,
      launchRisk: snap.launchRisk,
      blockers: snap.blockers,
      capturedAt: snap.capturedAt,
      providers: snap.providers,
    };
  });
  return {
    generatedAt: new Date().toISOString(),
    portfolioLaunchReadiness: aggregateLaunchReadiness(snapshots),
    products: summaries,
  };
}

// ─── Change detection (snapshot-to-snapshot, used by autonomy) ────────────────
export interface SnapshotChange {
  field: string;
  from: string;
  to: string;
  significance: "info" | "improvement" | "regression";
}

// Detect meaningful changes between two snapshots. Returns [] when nothing
// material changed (Quinn does nothing in that case).
export function detectChanges(
  prev: EngineeringSnapshot | null,
  curr: EngineeringSnapshot,
): SnapshotChange[] {
  if (!prev) {
    return [
      {
        field: "snapshot",
        from: "none",
        to: "first snapshot captured",
        significance: "info",
      },
    ];
  }
  const changes: SnapshotChange[] = [];

  if (prev.build.status !== curr.build.status) {
    changes.push({
      field: "build.status",
      from: prev.build.status,
      to: curr.build.status,
      significance: curr.build.status === "passing" ? "improvement" : "regression",
    });
  }
  if (prev.deployment.productionHealth !== curr.deployment.productionHealth) {
    changes.push({
      field: "deployment.productionHealth",
      from: prev.deployment.productionHealth,
      to: curr.deployment.productionHealth,
      significance: curr.deployment.productionHealth === "healthy" ? "improvement" : "regression",
    });
  }
  if (prev.deployment.status !== curr.deployment.status) {
    changes.push({
      field: "deployment.status",
      from: prev.deployment.status,
      to: curr.deployment.status,
      significance: curr.deployment.status === "deployed" ? "improvement" : "info",
    });
  }
  if (prev.repository.latestCommit?.sha !== curr.repository.latestCommit?.sha && curr.repository.latestCommit) {
    changes.push({
      field: "repository.latestCommit",
      from: prev.repository.latestCommit?.sha ?? "none",
      to: curr.repository.latestCommit.sha,
      significance: "info",
    });
  }
  if (prev.runtime.errors.length !== curr.runtime.errors.length) {
    changes.push({
      field: "runtime.errors",
      from: String(prev.runtime.errors.length),
      to: String(curr.runtime.errors.length),
      significance: curr.runtime.errors.length < prev.runtime.errors.length ? "improvement" : "regression",
    });
  }
  // Health score swings of 10+ points are meaningful.
  if (Math.abs(prev.healthScore - curr.healthScore) >= 10) {
    changes.push({
      field: "healthScore",
      from: String(prev.healthScore),
      to: String(curr.healthScore),
      significance: curr.healthScore > prev.healthScore ? "improvement" : "regression",
    });
  }
  if (prev.blockers.length !== curr.blockers.length) {
    changes.push({
      field: "blockers",
      from: String(prev.blockers.length),
      to: String(curr.blockers.length),
      significance: curr.blockers.length < prev.blockers.length ? "improvement" : "regression",
    });
  }
  return changes;
}

// ─── Role-scoped executive awareness ──────────────────────────────────────────
// Each executive sees only their slice of the snapshot. Quinn (chief_of_staff)
// gets everything.
export function getExecutiveView(
  role: string,
  snap: EngineeringSnapshot,
): ExecutiveEngineeringView {
  switch (role) {
    case "cto":
      return {
        role,
        headline: `Health ${snap.healthScore}/100 · deploy risk ${snap.deploymentRisk}`,
        focus: ["architecture", "commits", "deployment risk"],
        details: {
          branch: snap.repository.branch,
          latestCommit: snap.repository.latestCommit,
          recentCommits: snap.repository.recentCommits.slice(0, 5),
          openPullRequests: snap.repository.openPullRequests.length,
          deploymentRisk: snap.deploymentRisk,
          blockers: snap.blockers,
        },
      };
    case "qa_director":
      return {
        role,
        headline: `Build ${snap.build.status} · ${snap.runtime.errors.length} runtime error(s)`,
        focus: ["builds", "tests", "regressions", "runtime failures"],
        details: {
          build: snap.build,
          runtimeErrors: snap.runtime.errors,
          runtimeWarnings: snap.runtime.warnings,
          unhealthyServices: snap.runtime.unhealthyServices,
        },
      };
    case "release_manager":
      return {
        role,
        headline: `Deployment ${snap.deployment.status} · ${snap.deployment.productionHealth}`,
        focus: ["deployments", "rollout readiness", "release blockers"],
        details: {
          deployment: snap.deployment,
          deploymentRisk: snap.deploymentRisk,
          blockers: snap.blockers,
          buildStatus: snap.build.status,
        },
      };
    case "product_manager":
      return {
        role,
        headline: `${snap.repository.recentCommits.length} recent commits · ${snap.repository.openPullRequests.length} open PRs`,
        focus: ["engineering velocity", "roadmap impact"],
        details: {
          recentCommits: snap.repository.recentCommits.length,
          openPullRequests: snap.repository.openPullRequests.length,
          openIssues: snap.repository.openIssues,
          healthScore: snap.healthScore,
        },
      };
    case "marketing_director":
      return {
        role,
        headline: `Launch readiness ${snap.launchReadiness.score}/100 (${snap.launchReadiness.state})`,
        focus: ["launch readiness"],
        details: {
          launchReadiness: snap.launchReadiness,
          launchRisk: snap.launchRisk,
          deploymentStatus: snap.deployment.status,
          productionHealth: snap.deployment.productionHealth,
        },
      };
    case "chief_of_staff":
    default:
      return {
        role: role || "chief_of_staff",
        headline: `Engineering health ${snap.healthScore}/100 · launch readiness ${snap.launchReadiness.score}/100`,
        focus: ["full engineering snapshot"],
        details: { snapshot: snap },
      };
  }
}

export const EXECUTIVE_ROLES = [
  "cto",
  "qa_director",
  "release_manager",
  "product_manager",
  "marketing_director",
  "chief_of_staff",
] as const;

// ─── Diagnostics ──────────────────────────────────────────────────────────────
export interface EngineeringDiagnostics {
  snapshotAgeMs: number;
  lastSuccessfulSyncAt: string | null;
  engineeringConfidence: number; // 0–100, share of providers connected
  providers: ProviderDiagnostic[];
  healthScore: number;
}

export async function getDiagnostics(product?: EngineeringProduct): Promise<EngineeringDiagnostics> {
  const snap = product ? await getLatestSnapshot(product) : await getFlagshipSnapshot();
  const ageMs = Date.now() - new Date(snap.capturedAt).getTime();
  const connected = snap.providers.filter((p) => p.status === "connected").length;
  const total = snap.providers.length || 1;
  const lastSync = snap.providers
    .map((p) => p.lastSyncAt)
    .filter((s): s is string => Boolean(s))
    .sort()
    .pop() ?? null;
  return {
    snapshotAgeMs: ageMs,
    lastSuccessfulSyncAt: lastSync,
    engineeringConfidence: Math.round((connected / total) * 100),
    providers: snap.providers,
    healthScore: snap.healthScore,
  };
}
