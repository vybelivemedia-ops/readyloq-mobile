# ADR-018: Platform Consumption Roadmap — Workspace Link → Versioned Packages

**Status:** Accepted  
**Date:** 2026-07-18  
**Author:** Platform Architecture  
**Supersedes:** Nothing  
**See also:** ADR-016 (independent repository), GOVERNANCE.md § 4 (versioning strategy)

---

## Context

Once the platform is an independent repository (ADR-016), consuming applications need a strategy for how they reference its packages during different phases of development.

Three mechanisms are in play:

**1. Workspace link** (`workspace:*`)  
Both `readyloq-mobile` and the platform live in the same pnpm workspace. `pnpm-workspace.yaml` in `readyloq-mobile` includes `repos/platform/packages/*`. All `@platform/*` deps resolve to the local source tree. Changes to the platform are immediately visible in the application — no publish step, no version bump, no lockfile churn.

Limitation: requires the platform repository to be checked out alongside the application repository on every developer machine and CI runner. A fresh clone of `readyloq-mobile` without also cloning `repos/platform/` will fail at `pnpm install`.

**2. Git-based dependency** (`github:org/repo#sha` or git submodule)  
`package.json` can reference a platform package directly from a specific commit SHA. This gives reproducible installs from a single clone without a publish step. Git submodules are a structural alternative that pins the checkout at the repo level rather than per-package.

Limitation: git-based deps are awkward to iterate on — a change to the platform requires a commit, a SHA update in the application, and a re-install. Git submodule workflows add friction for contributors unfamiliar with submodule commands. Neither mechanism provides semantic versioning.

**3. Versioned packages** (npm / GitHub Packages)  
The platform publishes each `@platform/*` package with a semver version tag to a private registry (GitHub Packages or equivalent). Applications declare explicit version constraints (`@platform/camera-core: ^1.0.0`). A standard `pnpm install` resolves everything with no manual checkout.

Limitation: adds a publish step to the platform's release process. Not worth the overhead while the platform API is still changing frequently.

---

## Decision

The consumption mechanism advances through three phases tied to API maturity:

### Phase 1 — Active Development (current)

**Mechanism:** pnpm workspace link.

`readyloq-mobile/pnpm-workspace.yaml` includes `repos/platform/packages/*`. The platform source lives at `repos/platform/` and must be checked out alongside the application. No publish step; no version pin.

Fresh-clone setup:
```bash
git clone https://github.com/vybelivemedia-ops/readyloq-mobile.git
git clone https://github.com/vybelivemedia-ops/platform.git repos/platform
pnpm install
```

This setup step should be documented in the repository README and, optionally, automated via `scripts/setup.sh`.

### Phase 2 — API Stabilising (optional transition)

**Mechanism:** git-based dependency or submodule, if repository isolation is required before package publishing is ready.

This phase is optional. It applies if the team needs ReadyLoq and the platform to be independently checkable before full package publishing infrastructure is in place. The correct mechanism at this point is a git dependency per package in `package.json`, not a submodule — it avoids submodule workflow complexity while still pinning the platform at a specific commit.

**Git submodules are explicitly not the preferred model.** Reasons:
- Detached HEAD state is confusing for contributors.
- `git clone` without `--recurse-submodules` silently produces a broken checkout.
- `git pull` does not update the submodule — a separate command is required.
- The primary motivation for submodules in this context was a CI validation check, not an architectural requirement.

### Phase 3 — Platform API Stable

**Mechanism:** versioned packages published to GitHub Packages (or equivalent private registry).

Once the platform API stabilises (breaking changes become infrequent, a semver `1.0.0` tag is appropriate), each `@platform/*` package is published as a versioned release. Applications declare explicit semver deps:

```json
{
  "@platform/camera-core": "^1.0.0",
  "@platform/smart-vision": "^1.0.0"
}
```

At this point, `repos/platform/` is removed from the `readyloq-mobile` pnpm workspace. A standard `pnpm install` resolves everything.

---

## Consequences

**What this enables:**
- No wasted effort locking into submodule workflows that will be replaced.
- Workspace link gives the fastest possible inner loop during active platform development.
- Versioned packages, when the time comes, are the correct long-term model for a platform SDK consumed by multiple independent applications.

**What this constrains:**
- Phase 1 requires all contributors to clone the platform repository separately. This must be documented and ideally scripted.
- Phase 3 requires publishing infrastructure (GitHub Actions workflow, npm token in CI secrets, changelog tooling). This should be planned before the `1.0.0` milestone.

**Trigger conditions for advancing phases:**
- Phase 1 → Phase 2: Only if repository isolation is required before versioned publishing is ready. Not mandatory.
- Phase 2 → Phase 3: When the platform API stabilises and breaking changes become rare enough to warrant semver discipline.

**What is forbidden:**  
Introducing a git submodule as the long-term model. If a submodule is ever introduced as a Phase 2 bridge, it must be accompanied by a committed timeline for publishing and removal.
