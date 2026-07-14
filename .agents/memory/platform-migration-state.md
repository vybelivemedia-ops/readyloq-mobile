---
name: Platform migration state
description: Which packages have been extracted, what changed, what's next in the migration sequence.
---

## Completed

### Phase 0 — @platform/core (scaffolding only)
- 28 exports: Result, AsyncResult, Option, Brand, ID, Timestamp, Version, Service, Registry, etc.
- Zero external deps. Typechecks clean. Pushed to vybelivemedia-ops/platform (68146a99).

### Phase 1 — @platform/shared-types (PR 1 complete)
- Platform commit: 560d3dbf (vybelivemedia-ops/platform)
- readyloq-mobile commit: c58765ca (vybelivemedia-ops/readyloq-mobile)
- What was extracted from `artifacts/readyloq-app/lib/vision/types.ts`:
  CaptureSource, EvidenceItem, QualityAssessment, CaptureMode, CaptureTransport,
  PreviewKind, CaptureCapabilities
- These are now re-exported from @platform/shared-types; vision/types.ts re-exports them.
- App-specific provider contracts remain in vision/types.ts for Phase 2 (camera-core).
- Typecheck: @platform/core ✅, @platform/shared-types ✅, @workspace/readyloq-app ✅
- Pre-existing baseline errors: @workspace/readyloq (queryKey/null), @workspace/api-server (TS7030 in gemini.ts)

## Workspace wiring
- `pnpm-workspace.yaml` now includes `repos/platform/packages/*`
- `@platform/core` must be built (`pnpm --filter @platform/core run build`) before
  typechecking `@platform/shared-types` (project references require dist/.d.ts files).
- Vitest bumped from ^1.6.0 to ^4.1.8 in platform packages (1.6.x blocked by Replit firewall).

### Phase 2 — @platform/camera-core (PR 2 complete)
- Platform commit: 7a14c212 (vybelivemedia-ops/platform)
- readyloq-mobile commit: cc596175 (vybelivemedia-ops/readyloq-mobile)
- Replaced wrong scaffold types (string-literal ProviderAvailability, 4-state ProviderStatus, CameraProvider unified interface)
- Added canonical types from ReadyLoq: ProviderAvailability (discriminated union), ProviderStatus (6-state),
  EvidenceIntake, CaptureProviderBase, RequestCaptureProvider, CaptureSession, SessionCaptureProvider,
  PushCaptureSession, PushCaptureProvider, CaptureProvider, VisionProvider
- Updated ProviderRegistry to use CaptureProvider (canonical union) instead of removed CameraProvider
- Kept scaffold abstractions: AssessEvidence, CaptureModeRouter, ProviderState, ProviderRegistry (interface contracts)
- lib/vision/types.ts now has ZERO local type definitions — pure platform re-exports
- readyloq-app typecheck: ✅ zero errors; camera-core build: ✅ zero errors
- VYBE: unaffected (VYBE ProviderStatus is a completely different AI/engineering type)

## Next (Phase 3 — infrastructure, one PR per package)

**Phase 3.1: @platform/storage-core**
- Canonical source: `artifacts/api-server/src/lib/objectStorage.ts`
- ObjectStorageClient, StorageNamespace, SignedUrlRequest interfaces
- No app-level type imports needed (server-side only)
- Unblocks: @platform/evidence-core, @platform/live-session-core

**Phase 2.3: @platform/sync-engine**
- Canonical source: `artifacts/readyloq-app/lib/sync/engine.ts`
- Needs SyncStep[] defined by app layer first (see ARCHITECTURE.md note)

**Why:** The extraction order follows the DAG — each package's types/interfaces must be
settled before downstream packages (evidence-core, etc.) can be extracted.
