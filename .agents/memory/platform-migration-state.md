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

### Phase 3 — @platform/storage-core (PR 3 complete)
- Platform commit: 53dc2b29 (vybelivemedia-ops/platform only — no app changes)
- Added: ObjectNotFoundError (canonical — identical in both apps), StorageNotConfiguredError,
  REPLIT_SIDECAR_ENDPOINT constant, SidecarSignedUrlRequest interface, SignedUrlMethod type
- Updated: companyNamespace now accepts string|number (ReadyLoq uses numeric DB IDs)
- Kept: StorageNamespace, IdentityNamespace, UploadOptions, UploadResult, PresignedUrlOptions,
  ObjectStorageService interface (forward-looking contract)
- Neither app imports from @platform/storage-core yet — both use concrete GCS classes
- VYBE workspace wiring deferred (repos/vybelive/ not in pnpm-workspace.yaml)
- Build: ✅ zero errors; apps: unaffected; api-server TS7030 in gemini.ts is pre-existing baseline

### Phase 4 — @platform/sync-engine (PR 4 complete)
- Platform commit: d1e46ac9 (vybelivemedia-ops/platform only — no app changes)
- Corrections: DEFAULT_RETRY_POLICY constants wrong vs canonical
  - baseDelayMs 1_000→10_000, maxDelayMs 30_000→300_000, maxAttempts 5→0 (unlimited)
  - Canonical formula: Math.min(10_000 * 2^(max(attempts-1,0)), 300_000)
- Added: DEFAULT_DEBOUNCE_MS=1_200 (canonical requestSync() default)
- Retained: SyncableEntity, KVAdapter, FileUploader, SyncPipelineStep, SyncCheckpoint,
  SyncEngineOptions<T>, SyncEngine<T> — generic design is correct direction
- Canonical engine.ts is a module singleton (not a class), Inspection-specific; no import changes yet
- VYBE has no offline sync; sync-engine is ReadyLoq-only for now
- Build: ✅ zero errors; readyloq-app typecheck: ✅ zero errors

### Phase 5 — @platform/ai-core (PR 5 complete)
- Platform commit: daa6f0de (shared-types + ai-core; no app changes)
- ai-core stub was already accurate — no ai-core changes needed
- shared-types corrections (2 changes):
  - AIResponse.text → AIResponse.content (VYBE canonical uses "content")
  - AIResponse.parsed?: Record<string,unknown> added (VYBE canonical)
  - AIRequest.responseFormat?: "json"|"text" added (VYBE canonical)
- Canonical VYBE: AIProvider.ts — AITask type, provider interface, MODEL_PRICING table
  (MODEL_PRICING not extracted — goes stale; ai-core has no pricing tables)
- Canonical ReadyLoq: intelligence-ai.ts — all domain-specific, none extracted
- Build: shared-types ✅ ai-core ✅ readyloq-app typecheck ✅

### Phase 6 — @platform/evidence-core (PR 6 complete)
- Platform commit: (see push output) — shared-types only; evidence-core stub already accurate
- evidence-core stub validated as accurate: EvidenceQualityRecord, EvidenceAnnotation,
  EvidenceCollection, EvidenceStore, EvidenceQuery (minQualityScore 0–100 ✓), 
  UploadPhase/Progress/EvidenceUploadPipeline, EvidenceCollectionManager
- shared-types correction: EvidenceItem.id: string added (was missing; evidenceId refs
  in EvidenceStore.get/Annotation/QualityRecord required it)
- App changes: native-camera-provider.ts + media-import-provider.ts each add
  id: Crypto.randomUUID() — matches expo-crypto pattern from inspection-store.ts
- VYBE has no evidence-core usage
- Build: shared-types ✅ evidence-core ✅ readyloq-app typecheck ✅

### Phase 7 — @platform/live-session-core (PR 7 complete)
- Canonical: repos/vybelive/ (VYBE-owned; ReadyLoq has no streaming)
- Correction: SocialPlatform missing "facebook" + "kick" — added
  - Canonical OAUTH_PUSH_PLATFORMS = ["youtube","facebook","twitch","instagram","kick"]
  - platformsTable.type also includes "tiktok" + "custom_rtmp" (manual RTMP)
- All else validated accurate: StreamSession/Publisher/AgoraAdapter, CloudRecording,
  ClipProcessor, StreamMediaUploader, SocialPublisher/Options
- CloudRecording.start() correctly collapses Agora's 2-step (acquireResourceId+start)
- Build: @platform/live-session-core ✅

### Phase 8 — @platform/ui-core (PR 8 complete)
- Canonical: readyloq web (shadcn), readyloq-app native, VYBE GlowButton/LiveBadge
- Corrections (4):
  - ColorTokens: added secondary/secondaryForeground, accent/accentForeground,
    destructive/destructiveForeground, muted/mutedForeground (all in canonical components)
  - ButtonVariant: "danger"→"destructive" (ReadyLoq web+native both use "destructive";
    VYBE GlowButton's "danger" is VYBE-specific, not cross-platform)
  - ButtonSize: removed "xs" (zero canonical backing across all 3 source files)
  - BadgeVariant: added "primary" (ReadyLoq native BadgeTone) + "secondary" (shadcn web)
- Build: @platform/ui-core ✅

### Phase 9 — @platform/asset-core (PR 9 complete)
- Canonical: repos/readyloq-mobile/lib/db/src/schema/properties.ts
- IMPORTANT: actual schema is "propertyProfilesTable" (NOT "properties"), much simpler:
  id (serial), companyId, addressKey (text, normalised key), siteAddress (free-text),
  clientName (inline), propertyType (free-text, no enum), technicianKnowledge, hotspots[]
  Also: propertyNotesTable — separate table (not a simple internalNotes field)
- Stub types are internally coherent but platform-forward (not canonically grounded):
  AddressComponents, AssetType union, GeoCoordinates, AssetContact, areaSqm/yearBuilt/isActive
  ReadyLoq uses free-text siteAddress + normalised addressKey as primary lookup
- Correction: documentation-only — corrected false "properties table" header claim
- Build: @platform/asset-core ✅

### Phase 10 — @platform/voice-intelligence (PR 10 complete)
- STATUS: new package — no existing code in either app (roadmap-planned both)
- VYBE canonical: transcribeAudio(audioFilePath): Promise<string|null> — plain text, no confidence/language returned
- Corrections (3):
  - Removed unused `import type { AIRequest }` (not referenced in any exported type)
  - TranscriptionResult.confidence: number → confidence?: number (VYBE returns string|null only)
  - TranscriptionResult.language: string → language?: string (VYBE hardcodes "en" but doesn't return detected lang)
- VoiceCaptureMode, VoiceRecorder, VoiceCommandRouter: forward-looking design, no canonical backing
- Build: @platform/voice-intelligence ✅

### Phase 11 — @platform/local-intelligence (PR 11 complete)
- STATUS: new package — no existing on-device ML code in either app
- ReadyLoq canonical reviewed: guidance-engine.ts, intelligence-ai.ts (cloud AI, not on-device); vision/ (Laplacian sharpness inline — already modelled in camera-core)
- VYBE: no on-device ML code, cloud-only via aiGeneration.ts
- Build errors (3):
  - ConfidenceResult imported from @platform/shared-types → fix to @platform/ai-core (lives at ai-core:438)
  - Pick<EvidenceItem, "id" | "localUri"> × 2 → "localUri" doesn't exist on EvidenceItem; correct field is "uri"
- Build: @platform/local-intelligence ✅

### Phase 12 — @platform/measurement-core (PR 12 complete)
- STATUS: new package — no existing measurement code in either app (roadmap only)
- 4 build errors corrected:
  - ConfidenceResult imported from @platform/shared-types (not ai-core) — but shared-types didn't have it. Fix: added ConfidenceResult to shared-types (correct home for packages that can't depend on ai-core by design per ADR-014)
  - Test polygonAreaPx Shoelace: pts[i].x → pts[i]!.x × 4 (noUncheckedIndexedAccess)
  - Test polygonPerimeterPx: same issue × 2 (lines 138-139)
  - Test stats() mock: sizeBytes: undefined → omit field (sizeBytes?: number can't be set to undefined)
- shared-types addition: ConfidenceResult { score, method, breakdown? } — structurally identical to ai-core's, TypeScript structural typing ensures compat
- Build: @platform/shared-types ✅  @platform/measurement-core ✅

### Phase 13 — @platform/meta-wearables (PR 13 complete)
- Canonical source: readyloq-app/lib/vision/future-source-providers.ts (FUTURE_PROVIDER_DEFINITIONS)
- VYBE: no wearable code — Agora SDK on device camera only
- Full rewrite needed (7 error categories):
  - CameraProvider → CaptureProviderBase (correct extendable base type; CaptureProvider is a union)
  - EvidenceItem unused import removed
  - modes: [...] → mode: single_value × 4 (CaptureCapabilities.mode is singular)
  - transports: [...] → transport: single_value × 4 (singular), offlineCapable/streamingCapable don't exist
  - "remote_camera" → "usb_camera" / "wifi_stream" (canonical CaptureSource values)
  - availability: ProviderAvailability was assigned string "future" — ProviderAvailability is { available, reason } object; fix to { available: false, reason: "...no driver yet." }
  - All capability objects rewritten from canonical future-source-providers.ts values
- Build: @platform/meta-wearables ✅

### Phase 14 — @platform/platform-intelligence (PR 14 complete — MIGRATION COMPLETE)
- Final package: Platform OS kernel (plugin registry, workflow engine, intelligence session,
  guidance engine, measurement state, memory orchestrator, provider coordinator, event router)
- Canonical: ReadyLoq inspection workflow + VYBE live-session; domain logic stays in apps
- Build errors (2, targeted):
  - CameraProvider → CaptureProvider (same root cause as Phase 13 meta-wearables fix)
  - VoiceProvider not in voice-intelligence: added composite interface { recorder, transcription }
    (natural container for VoicePlugin to assemble and register with ProviderCoordinator)
- Build: @platform/voice-intelligence ✅  @platform/platform-intelligence ✅

## Platform roadmap (post-migration)

**New packages (user-confirmed 2026-07-15) — design, not migration**

FULL DAG after new packages inserted:

  @platform/core
       │
       ▼
  @platform/shared-types
       │
       ▼
  @platform/provider-registry     ← generic registration/discovery/health/lifecycle contract
       │                             ALL registries across the platform implement this
       ▼
  @platform/device-core           ← universal hardware abstraction (foundational contract)
       │
  ┌────┼────────┬──────────┬────────────────┐
  │    │        │          │                │
camera  voice  measurement meta-wearables  live-session-core
-core   -intel  -core
       │    ... (all hardware packages)
       ▼
  @platform/platform-intelligence  (OS kernel — top of the graph)


─── @platform/provider-registry ───────────────────────────────────────────────
PURPOSE: Generic registration and discovery mechanism that all provider-based
packages use. Eliminates per-package registry reinvention.

RESPONSIBILITIES (user-defined 2026-07-15):
  Registration, discovery, health checks, capability matching, lifecycle management.
  All provider registries across the platform share this pattern:
  AI providers, device providers, storage providers, measurement providers, voice providers.

DAG: sits between shared-types and device-core. Existing packages (ai-core, camera-core,
voice-intelligence, storage-core) would adopt it in a subsequent refactor pass.
New packages start with it from day one.


─── @platform/device-core ──────────────────────────────────────────────────────
PURPOSE: Universal hardware abstraction. Every hardware provider implements the same
contract — the inspection engine / stream engine never knows the manufacturer.

RESPONSIBILITIES (user-defined 2026-07-15):
  DeviceProvider, DeviceRegistry (implements provider-registry contract), DeviceCapabilities,
  DeviceConnection, DeviceStatus, DeviceIdentity, DeviceDiscovery, DeviceLifecycle,
  DeviceHealth, DeviceBattery, DeviceThermal, DevicePermissions, DeviceEvents,
  DeviceDiagnostics, DeviceFirmware, DeviceProfile

ReadyLoq hardware beyond cameras (all implement DeviceProvider):
  Moisture meters, temperature/humidity sensors, thermal imagers, borescopes,
  laser distance meters, environmental sensors, smart bait stations, BLE traps,
  future IoT devices. Inspection engine sees DeviceProvider + discovers capabilities.

VYBE hardware (all implement DeviceProvider):
  Meta Ray-Ban, GoPro, DJI, Insta360, USB cameras, FLIR thermal, Wi-Fi inspection cameras,
  future streaming wearables, future LiDAR devices.

FUTURE-PROOFING: New device in 3 years = one new provider implementing DeviceProvider.
No architecture change. The rest of the platform works unchanged.

NOT a migration: no existing code to extract. New platform capability.
camera-core, voice-intelligence, measurement-core, meta-wearables adopt device-core
as their foundation in a subsequent refactor pass.


─── SEQUENCING ─────────────────────────────────────────────────────────────────
  1. Migration DONE (Phases 0–14, all 15 packages complete).
  2. Stabilize the platform.
  3. Build @platform/provider-registry (generic pattern).
  4. Build @platform/device-core (depends on provider-registry).
  5. Add hardware integrations (each implements DeviceProvider — never ad hoc again).
  6. Refactor existing hardware packages to adopt device-core foundation.

STRATEGIC FRAMING (user, 2026-07-15):
  "This is starting to look less like two apps sharing code and more like a genuine
   platform SDK. ReadyLoq and VYBE become products built on top of a common operating
   layer rather than independent applications with duplicated infrastructure."
