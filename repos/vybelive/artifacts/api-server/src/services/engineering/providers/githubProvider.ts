// ─── GitHub Provider (Engineering Intelligence Layer) ─────────────────────────
// Contributes repository telemetry — branch, recent commits, open PRs, open
// issues — via the Replit GitHub connector proxy. NEVER throws: any failure
// (connector down, rate limit, parse error) degrades to an "unavailable"
// diagnostic with empty data so the rest of the snapshot is unaffected.

import { execSync } from "child_process";
import { ReplitConnectors } from "@replit/connectors-sdk";
import { logger } from "../../../lib/logger.js";
import type {
  CommitInfo,
  EngineeringProvider,
  ProviderResult,
  PullRequestInfo,
} from "../types.js";

const FALLBACK_OWNER = "hgwashingllc-wq";
const FALLBACK_REPO = "Vybe-live";

// Resolve owner/repo from the local git remote, falling back to the known repo.
function resolveRepo(): { owner: string; repo: string } {
  try {
    const url = execSync("git remote get-url origin", {
      encoding: "utf8",
      timeout: 3000,
    }).trim();
    // Matches git@github.com:owner/repo.git and https://github.com/owner/repo(.git)
    const m = url.match(/github\.com[/:]([^/]+)\/([^/.]+)(?:\.git)?$/i);
    if (m) return { owner: m[1], repo: m[2] };
  } catch {
    /* fall through to fallback */
  }
  return { owner: FALLBACK_OWNER, repo: FALLBACK_REPO };
}

async function ghJson<T>(connectors: ReplitConnectors, path: string): Promise<T> {
  const res = await connectors.proxy("github", path);
  if (!res.ok) {
    throw new Error(`GitHub ${path} → ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}

interface GhCommit {
  sha: string;
  html_url?: string;
  commit: { message: string; author?: { name?: string; date?: string } };
  author?: { login?: string } | null;
}
interface GhPull {
  number: number;
  title: string;
  html_url?: string;
  created_at: string;
  user?: { login?: string } | null;
}
interface GhRepo {
  default_branch?: string;
  open_issues_count?: number;
}

export const githubProvider: EngineeringProvider = {
  name: "github",
  async collect(_ctx): Promise<ProviderResult> {
    void _ctx;
    const startedAt = Date.now();
    const { owner, repo } = resolveRepo();
    try {
      const connectors = new ReplitConnectors();
      const base = `/repos/${owner}/${repo}`;

      const [repoMeta, commits, pulls] = await Promise.all([
        ghJson<GhRepo>(connectors, base),
        ghJson<GhCommit[]>(connectors, `${base}/commits?per_page=10`),
        ghJson<GhPull[]>(connectors, `${base}/pulls?state=open&per_page=20`),
      ]);

      const recentCommits: CommitInfo[] = (commits ?? []).map((c) => ({
        sha: c.sha.slice(0, 10),
        message: (c.commit?.message ?? "").split("\n")[0].slice(0, 200),
        author: c.author?.login ?? c.commit?.author?.name ?? "unknown",
        date: c.commit?.author?.date ?? "",
        url: c.html_url ?? null,
      }));

      const openPullRequests: PullRequestInfo[] = (pulls ?? []).map((p) => ({
        number: p.number,
        title: p.title.slice(0, 200),
        author: p.user?.login ?? "unknown",
        url: p.html_url ?? null,
        createdAt: p.created_at,
      }));

      // GitHub's open_issues_count includes PRs; subtract open PRs for true issues.
      const openIssues = Math.max(
        0,
        (repoMeta?.open_issues_count ?? 0) - openPullRequests.length,
      );

      const latencyMs = Date.now() - startedAt;
      return {
        data: {
          repository: {
            branch: repoMeta?.default_branch ?? "",
            latestCommit: recentCommits[0] ?? null,
            recentCommits,
            openPullRequests,
            openIssues,
          },
        },
        diagnostic: {
          name: "github",
          status: "connected",
          latencyMs,
          error: null,
          lastSyncAt: new Date().toISOString(),
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn({ err, owner, repo }, "githubProvider: collect failed (degrading)");
      return {
        data: {},
        diagnostic: {
          name: "github",
          status: "unavailable",
          latencyMs: Date.now() - startedAt,
          error: message,
          lastSyncAt: null,
        },
      };
    }
  },
};
