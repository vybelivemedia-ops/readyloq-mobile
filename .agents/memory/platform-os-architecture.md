---
name: Platform OS architecture
description: Key decisions for the 12-package platform in repos/platform/ — OS kernel model, naming, governance, and the 4-level DAG
---

# Platform OS Architecture

## The OS kernel model

platform-intelligence is the 12th package and acts as the OS kernel. Applications (ReadyLoq, VYBE) do NOT call platform packages directly — they register plugins with platform-intelligence and define workflow definitions. The platform provides capabilities; the application defines purpose. Analogy: Windows/Linux/Android/iOS.

**Why:** prevents applications from hard-coupling to multiple packages at once; provides a single integration point that can evolve independently of individual capability packages.

**How to apply:** any new feature that needs two or more platform packages should go through platform-intelligence's WorkflowEngine / PluginRegistry / ProviderCoordinator rather than importing both packages directly into the app.

## Package naming conventions

- `asset-core` (NOT property-core) — "property" is too limiting; "asset" covers buildings, equipment, vehicles, infrastructure, manufacturing lines, cell towers, solar farms. AssetType union is deliberately broad.
- `live-session-core` (NOT streaming-core) — "streaming" implies one-way; "live session" is bidirectional (pause/resume, viewer count, recording, social re-stream).
- `evidence-core` is separate from `camera-core` — camera-core = acquisition; evidence-core = post-capture lifecycle. Web dashboards can depend on evidence-core without pulling in any native camera SDK.

## 4-level dependency DAG

The DAG is law. No package may import above its level.

```
Level 0: shared-types
Level 1: storage-core, ai-core, camera-core, asset-core, ui-core
Level 2: evidence-core, sync-engine, meta-wearables, voice-intelligence, live-session-core
Level 3: platform-intelligence  ← top of platform; bottom of app
Level 4: readyloq-mobile, vybelive  ← never imported by platform
```

Key hard rules:
- camera-core CANNOT import evidence-core (one-way flow: capture → evidence)
- sync-engine does NOT import storage-core (FileUploader injected)
- asset-core has no platform deps beyond shared-types (maximum adoption surface)
- ai-core does not import camera-core, evidence-core, or live-session-core
- platform-intelligence does not import asset-core, sync-engine, meta-wearables, or live-session-core (these are plugins, not static imports)

## GOVERNANCE.md

`repos/platform/GOVERNANCE.md` is the canonical boundary document. It defines:
- What is allowed / forbidden in shared packages (no domain logic, no AI prompts, no business rules)
- The 4-level DAG with all hard rules
- Versioning strategy (semver; breaking changes require ADR + both-app sign-off)
- Package proposal process (ADR required before any new package directory is created)
- Anti-corruption layer pattern (each app wraps platform types in domain types at app boundary)
- Automated CI enforcement (madge circular check + grep for forbidden domain strings)
- Package ownership table (ReadyLoq owns camera-core; VYBE owns ai-core; both own platform-intelligence)

## The forbidden boundary

These never enter platform packages:
- ReadyLoq: pest species/intelligence, inspection guidance rules, proposal engine, CRM, report templates
- VYBE: Mission Control, autonomy engine, social publishing business logic, creator analytics, audience intelligence
