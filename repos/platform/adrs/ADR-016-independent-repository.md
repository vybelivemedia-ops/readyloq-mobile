# ADR-016: Platform Extracted into an Independent Repository

**Status:** Accepted  
**Date:** 2026-07-18  
**Author:** Platform Architecture  
**Supersedes:** Nothing  
**See also:** ADR-017 (product AI agents), ADR-018 (consumption roadmap), ADR-019 (platform boundary)

---

## Context

ReadyLoq and VYBE LIVE began as separate applications that each contained large amounts of duplicated infrastructure — camera abstractions, storage clients, sync engines, AI provider wrappers, evidence pipelines, and UI contracts. Over time, synchronising fixes across two independent codebases became error-prone and slowed feature delivery in both products.

The decision to extract a shared platform was made to eliminate that duplication. The question was how to structure it:

**Option A — Monorepo with all products**  
Keep ReadyLoq, VYBE, and the platform in a single repository. Simplest for day-to-day development; no separate clone or dependency step. Drawback: organisational boundary is invisible — engineers in one product can accidentally import the other product's code; the platform has no clear surface area.

**Option B — Platform as a shared library inside one product's repo**  
Embed the platform under `packages/` in one product. Simpler than a separate repo but creates a governance asymmetry: one product "owns" the platform while the other consumes it as a guest. Doesn't survive ownership changes.

**Option C — Platform as a standalone independent repository**  
`vybelivemedia-ops/platform` is a repository that belongs to neither product team. It has its own governance document, its own CI, its own package versioning, and its own ADR trail. ReadyLoq and VYBE are both consumers. No product team can unilaterally merge domain logic into it.

---

## Decision

**Option C — independent repository.**

The platform lives at `vybelivemedia-ops/platform`. It is not a subdirectory of `readyloq-mobile` or `vybelive`. It is consumed by both applications as a dependency, not co-located as application code.

---

## Consequences

**What this enables:**
- A clean ownership boundary: the platform is a supplier, not a tenant.
- Both products can evolve their application code at their own pace without the platform having any knowledge of them.
- New products (a third app, an internal tool, a customer portal) can adopt `@platform/*` without touching either existing product's repository.
- The platform can have its own release cadence, CI pipeline, and governance reviews independent of application sprint cycles.

**What this constrains:**
- Making a change that affects both the platform and an application now requires coordinating across two repositories. The mitigation is the workspace-link development model (see ADR-018): during active development, both repos live in the same pnpm workspace and changes are visible immediately — no publish step required.
- Fresh clones of `readyloq-mobile` or `vybelive` require a separate checkout of `vybelivemedia-ops/platform` until versioned package publishing is in place (see ADR-018).

**Dependency impact:**  
N/A — this is a repository-level structural decision, not a package-level one.

**What is forbidden in this repository:**  
Nothing from this ADR extends the existing forbidden list. See GOVERNANCE.md § 2 and ADR-019 for the content boundary rules.
