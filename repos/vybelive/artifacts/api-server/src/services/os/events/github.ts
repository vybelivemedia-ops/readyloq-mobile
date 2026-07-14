// ─── OS Event Bus — GitHub Domain Events ──────────────────────────────────────
// All events originating from GitHub activity (pushes, PRs, reviews,
// deployments, workflow runs). These are produced by the portfolio monitor,
// the engineering intelligence layer, or a future GitHub webhook receiver.

export interface GitHubPushPayload {
  /** owner/repo slug */
  repo: string;
  branch: string;
  /** Short SHA of the HEAD commit */
  sha: string;
  /** Number of commits in the push */
  commitCount: number;
  /** Author login of the HEAD commit */
  author: string;
  /** HEAD commit message (first 120 chars) */
  message: string;
  /** True when the push is to the default branch */
  isDefaultBranch: boolean;
}

export interface GitHubPRPayload {
  repo: string;
  prNumber: number;
  title: string;
  author: string;
  /** Target branch (e.g. "main") */
  base: string;
  /** Source branch */
  head: string;
  /** PR body / description (first 500 chars) */
  body: string;
  additions: number;
  deletions: number;
  changedFiles: number;
}

export interface GitHubPRMergedPayload extends GitHubPRPayload {
  mergedBy: string;
  mergedAt: string; // ISO timestamp
}

export interface GitHubReviewPayload {
  repo: string;
  prNumber: number;
  reviewer: string;
  /** "approved" | "changes_requested" | "commented" */
  state: "approved" | "changes_requested" | "commented";
  body: string;
}

export interface GitHubWorkflowPayload {
  repo: string;
  /** Workflow file name, e.g. "ci.yml" */
  workflowName: string;
  /** "success" | "failure" | "cancelled" | "skipped" */
  conclusion: "success" | "failure" | "cancelled" | "skipped";
  /** Git ref that triggered the run */
  ref: string;
  /** Duration in seconds */
  durationSeconds: number;
  runUrl: string;
}

export interface GitHubDeploymentPayload {
  repo: string;
  environment: string;
  /** "pending" | "success" | "failure" | "error" | "inactive" */
  state: "pending" | "success" | "failure" | "error" | "inactive";
  creator: string;
  description: string;
}

export interface GitHubEventMap {
  "github.push": GitHubPushPayload;
  "github.pr.opened": GitHubPRPayload;
  "github.pr.merged": GitHubPRMergedPayload;
  "github.pr.closed": GitHubPRPayload;
  "github.review.submitted": GitHubReviewPayload;
  "github.workflow.completed": GitHubWorkflowPayload;
  "github.deployment.created": GitHubDeploymentPayload;
}
