# Repository Governance

**Established:** 2026-07-18  
**Applies to:** `vybelivemedia-ops/readyloq-mobile`, `vybelivemedia-ops/platform`

---

## Repository ownership

| Repository | Owns | Does not own |
|---|---|---|
| `vybelivemedia-ops/platform` | Reusable `@platform/*` packages; ADRs; GOVERNANCE.md | Any product-specific logic |
| `vybelivemedia-ops/readyloq-mobile` | Inspection product; AI pipeline; reports; sync engine | Platform infrastructure |
| `vybelivemedia-ops/vybe` (future) | Streaming; Quinn; Agent Zero | Platform infrastructure |

Platform packages must never contain product-specific code. See `repos/platform/GOVERNANCE.md` for the boundary rules and ADR-019.

---

## Rule 1 — One writer per repository

At any given time, exactly one mechanism may update a repository's commit history.

| Repository | Designated writer | Prohibited |
|---|---|---|
| `readyloq-mobile` | Replit Git (checkpoint → branch → PR) | GitHub REST API commits, direct `git push` to main |
| `platform` | GitHub REST API or normal `git push` from a local clone | Replit checkpoints |

**Why this matters:** Replit checkpoints and the GitHub REST API each create independent commit graphs with no shared ancestors. Running both on the same branch guarantees divergence and forces expensive history reconciliation. The rule eliminates the class of problem entirely.

**Recovery exception:** If the designated writer becomes unavailable, the other mechanism may be used once to restore a known-good state. Document the incident in a commit message and restore the designated writer immediately after.

---

## Rule 2 — Never commit directly to `main`

`main` is the integration target, not the working surface.

```
feature/live-session
        │
        ▼
   (CI + review)
        │
        ▼
      main
```

All changes land through one of:

| Branch prefix | Purpose |
|---|---|
| `phase/*` | Multi-session platform extraction or migration phases |
| `feature/*` | New product or platform features |
| `fix/*` | Bug fixes |
| `hotfix/*` | Critical production patches (may fast-forward directly to main with post-merge note) |

**Merge strategy:** fast-forward only. No merge commits on `main`. Rebase the branch onto `main` before merging if there are conflicts.

---

## Rule 3 — GitHub REST API is read-only for commit history

The GitHub API may be used for:

- Opening and reviewing pull requests
- Reading file contents and commit history
- Triggering CI workflows
- Creating releases and tags
- Reading branch protection status

The GitHub API must not be used to:

- Create blob, tree, or commit objects
- PATCH `refs/heads/*` (move branch pointers)
- Force-push via API

Normal `git` owns commit history. The API is an observer.

---

## Rule 4 — Every phase starts from the current remote

Before beginning any new phase or feature:

```bash
git fetch origin
git switch main
git pull --ff-only
git switch -c phase-X/description   # or feature/description
```

This guarantees the branch builds on the latest integrated state and prevents the "ahead of origin before the first commit" problem.

If `git pull --ff-only` fails, stop. Investigate what diverged before creating a new branch.

---

## Rule 5 — CI verifies the tree before merge

No branch merges to `main` until all of the following pass:

| Check | Command |
|---|---|
| TypeScript (all packages) | `pnpm -r typecheck` |
| Tests | `pnpm -r test --if-present` |
| No product code in platform | `scripts/pre-push-check.sh --platform-boundary` |
| No duplicate platform code | `scripts/pre-push-check.sh --no-duplicate-platform` |
| Generated code is current | `pnpm --filter @workspace/api-zod generate && git diff --exit-code` |
| Platform dep versions consistent | `scripts/pre-push-check.sh --platform-versions` |

Run `scripts/pre-push-check.sh` locally before pushing. It runs the same checks CI does.

---

## Sync policy

Never mix these mechanisms on the same branch simultaneously:

- Replit checkpoint commits
- GitHub REST API commits
- `git push` from a local clone

Pick one. If you inherit a branch touched by multiple mechanisms, resolve the divergence first (compare content, not ancestry) before continuing development.

---

## Platform dependency lifecycle

| Phase | How ReadyLoq consumes `@platform/*` |
|---|---|
| Active development | Workspace link: `repos/platform/packages/*` in `pnpm-workspace.yaml`. Run `git clone https://github.com/vybelivemedia-ops/platform.git repos/platform` after fresh clone. |
| API stabilising | Optionally pin via git-based dep if repo isolation is needed before semver. |
| API stable | Publish to GitHub Packages as versioned releases. Remove `repos/platform/` from workspace. |

See ADR-018 for the full rationale.

---

## Commit message format

```
<type>(<scope>): <short description>

<body — what changed and why>

<footer — breaking changes, issue refs, ADR refs>
```

Types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`  
Scopes: `api-server`, `readyloq-app`, `readyloq`, `platform`, `db`, `api-spec`, `api-zod`, `api-client`

---

## Escalation

If you encounter a situation not covered by this document:

1. Stop — do not push.
2. Open an issue describing the situation.
3. Resolve via PR with the governance update included in the same commit.

Do not improvise a new mechanism under time pressure. History repairs are significantly more expensive than the pause to do it right.
