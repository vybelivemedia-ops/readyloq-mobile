// ─── Engineering Intelligence Layer — Types (Mission Control V10) ─────────────
// One normalized, deterministic Engineering Snapshot is the single source of
// engineering truth. Providers (GitHub, Replit, and future ones) each return a
// partial contribution plus a connectivity diagnostic; the Intelligence Layer
// merges them into the snapshot below. Executives and Quinn consume ONLY this
// snapshot — never the providers directly.

export type ProviderStatus = "connected" | "degraded" | "unavailable";
export type RiskLevel = "low" | "medium" | "high" | "unknown";
export type HealthState = "healthy" | "degraded" | "down" | "unknown";

export interface ProviderDiagnostic {
  name: string;
  status: ProviderStatus;
  latencyMs: number;
  error: string | null;
  lastSyncAt: string | null;
}

export interface CommitInfo {
  sha: string;
  message: string;
  author: string;
  date: string;
  url: string | null;
}

export interface PullRequestInfo {
  number: number;
  title: string;
  author: string;
  url: string | null;
  createdAt: string;
}

export interface RepositoryInfo {
  branch: string;
  latestCommit: CommitInfo | null;
  recentCommits: CommitInfo[];
  openPullRequests: PullRequestInfo[];
  openIssues: number;
}

export interface BuildInfo {
  status: "passing" | "failing" | "stale" | "unknown";
  lastSuccessfulBuildAt: string | null;
  failedBuilds: number;
  buildDurationMs: number | null;
  artifactPath: string | null;
}

export interface ServiceHealth {
  name: string;
  status: HealthState;
  latencyMs: number | null;
}

export interface DeploymentHistoryEntry {
  sha: string;
  message: string;
  deployedAt: string;
  status: string;
}

export interface DeploymentInfo {
  status: "deployed" | "development" | "down" | "unknown";
  productionHealth: HealthState;
  activeServices: ServiceHealth[];
  history: DeploymentHistoryEntry[];
  urls: string[];
}

export interface RuntimeIssue {
  message: string;
  count: number;
  lastSeenAt: string | null;
}

export interface RuntimeInfo {
  errors: RuntimeIssue[];
  warnings: RuntimeIssue[];
  unhealthyServices: string[];
}

// ─── Launch Readiness ─────────────────────────────────────────────────────────
// A single high-level executive metric (0–100) aggregated from weighted factors.
// Each factor reports its own contribution; factors without a telemetry source
// yet (streaming health, platform approvals, beta stability) degrade to an
// "unknown" state and are excluded from the weighted average rather than
// penalizing the score.
export type LaunchReadinessFactorState = "strong" | "watch" | "at_risk" | "unknown";

export interface LaunchReadinessFactor {
  key: string;
  label: string;
  state: LaunchReadinessFactorState;
  score: number | null; // 0–100, or null when unknown (excluded from the average)
  detail: string;
}

export interface LaunchReadiness {
  score: number; // 0–100 weighted average of known factors
  state: "ready" | "approaching" | "not_ready" | "unknown";
  factors: LaunchReadinessFactor[];
}

// The single normalized snapshot. Every field has a deterministic default so the
// snapshot is well-formed even when every provider is unavailable. V10: every
// snapshot belongs to a product (portfolio asset).
export interface EngineeringSnapshot {
  id: string;
  productId: string;
  productSlug: string;
  productName: string;
  capturedAt: string;
  repository: RepositoryInfo;
  build: BuildInfo;
  deployment: DeploymentInfo;
  runtime: RuntimeInfo;
  healthScore: number; // 0–100
  launchReadiness: LaunchReadiness;
  blockers: string[];
  deploymentRisk: RiskLevel;
  launchRisk: RiskLevel;
  providers: ProviderDiagnostic[];
}

// A product Engineering Intelligence monitors. Mirrors a portfolio asset row.
export interface EngineeringProduct {
  id: string;
  slug: string;
  name: string;
}

// What a provider contributes to the snapshot. Each section is optional so a
// provider only fills the parts it knows about; the layer deep-merges them.
export interface ProviderContribution {
  repository?: Partial<RepositoryInfo>;
  build?: Partial<BuildInfo>;
  deployment?: Partial<DeploymentInfo>;
  runtime?: Partial<RuntimeInfo>;
}

export interface ProviderResult {
  data: ProviderContribution;
  diagnostic: ProviderDiagnostic;
}

// Context passed to a provider's collect() so the same provider implementation
// can serve multiple products without code changes — registration only.
export interface ProviderContext {
  productId: string;
  productSlug: string;
}

// Every provider implements this. collect() must NEVER throw — it always returns
// a result, degrading to an "unavailable" diagnostic with empty data on failure.
export interface EngineeringProvider {
  name: string;
  collect(ctx: ProviderContext): Promise<ProviderResult>;
}

// ─── Engineering Events ───────────────────────────────────────────────────────
// Typed events derived by comparing a snapshot against the previous one for the
// same product. Feed the timeline, executive memory, recommendations, briefing,
// and autonomous cycles.
export type EngineeringEventType =
  | "build_failed"
  | "deployment_started"
  | "deployment_succeeded"
  | "deployment_failed"
  | "production_healthy"
  | "production_degraded"
  | "runtime_errors_increased"
  | "runtime_errors_resolved"
  | "new_pull_request"
  | "critical_issue_opened";

export type EngineeringEventSeverity = "info" | "warning" | "critical";

export interface EngineeringEvent {
  id: string;
  productId: string;
  snapshotId: string;
  type: EngineeringEventType;
  severity: EngineeringEventSeverity;
  title: string;
  detail: string;
  createdAt: string;
}

// Per-product summary used by the portfolio overview.
export interface ProductEngineeringSummary {
  product: EngineeringProduct;
  monitored: boolean; // true when the product has registered providers
  healthScore: number;
  launchReadiness: LaunchReadiness;
  deploymentRisk: RiskLevel;
  launchRisk: RiskLevel;
  blockers: string[];
  capturedAt: string;
  providers: ProviderDiagnostic[];
}

// Portfolio-wide engineering view: every product plus an aggregate launch
// readiness across the monitored portfolio.
export interface PortfolioEngineeringOverview {
  generatedAt: string;
  portfolioLaunchReadiness: LaunchReadiness;
  products: ProductEngineeringSummary[];
}

// Role-scoped slice of the snapshot. Each executive sees only their concern.
export interface ExecutiveEngineeringView {
  role: string;
  headline: string;
  focus: string[];
  details: Record<string, unknown>;
}
