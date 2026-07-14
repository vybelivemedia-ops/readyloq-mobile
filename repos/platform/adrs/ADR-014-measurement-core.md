# ADR-014: @platform/measurement-core — Separate Package for Computer Vision Measurements

**Status:** Accepted  
**Date:** 2026-07-14  
**Author:** Platform Architecture  
**Supersedes:** Nothing  
**See also:** ADR-003 (ai-core scope), ADR-013 (local-intelligence), ADR-012 (platform-intelligence)

---

## Context

Two production applications need to estimate real-world measurements from images:

**ReadyLoq (pest inspection):**
- Technicians photograph gaps under doors, rodent holes in walls, pipe penetrations, window clearances, and material areas.
- These measurements inform treatment recommendations and proposal pricing.
- Examples: "This gap is 6mm wide — large enough for a mouse", "This pipe penetration has a 12mm gap — requires exclusion material".
- Currently: no automated measurement exists. Technicians estimate by eye, which introduces human error and inconsistency.

**VYBE (live streaming):**
- Creators configure studio layouts, camera-to-subject distances, and scene framing.
- Scene measurements improve automatic camera placement recommendations and AR overlay alignment.
- Currently: no measurement tooling.

**Future products named by users:**
- Construction measurement (wall dimensions, room area)
- Insurance damage assessment (crack width, water damage area)
- Facilities management (pipe diameter, duct clearance)
- Security (gap size for intrusion detection zones)

All of these applications share a common need: **given an image and calibration data, estimate the real-world dimensions of features visible in the frame.**

### Why not add this to ai-core?

ai-core manages AI provider orchestration — it knows about LLMs, vision APIs, confidence scoring, and session management. It does NOT know about:
- Optics and photogrammetry (focal length, sensor width, pixel-to-mm conversion)
- Calibration profiles (EXIF extraction, reference object detection, manual scale)
- Geometric calculations (polygon area, volume from cross-section, angle between segments)
- Reference object databases (credit card = 85.6mm wide; US electrical outlet faceplate = 70mm wide)
- Evidence annotation versioning (measurement revised by technician → new version, old deactivated)
- Depth map projection (relative depth → absolute → 3D point cloud)

Adding these to ai-core would make ai-core into a geometry + optics + measurement service, which violates ADR-003 (ai-core stays generic) and would impose measurement dependencies on every consumer of ai-core.

### Why not add this to local-intelligence?

local-intelligence manages the on-device ML runtime — model lifecycle, InferenceEngine, resource monitoring. It provides the *means* of inference but does not define *what domain* that inference serves.

measurement-core is one specific application of inference: estimating dimensions. Adding measurement concepts (CalibrationProfile, ReferenceObject, DimensionEstimate, MeasurementHistory) into local-intelligence would make local-intelligence domain-aware, violating its purpose.

The relationship is: measurement-core USES inference (via `MeasurementInferenceProvider` injection), but the inference machinery is provided by local-intelligence or cloud providers — measurement-core does not know which.

### Why not add this to evidence-core?

evidence-core manages the lifecycle of captured evidence — storage, upload, annotation types. Measurement is one specific annotation kind, but measurement-core brings its own geometry engine, calibration service, depth estimator, reference object library, and history service. The full measurement domain is too large to be a sub-module of evidence-core.

The relationship is: MeasurementAnnotation (from measurement-core) extends evidence-core's annotation concept by attaching DimensionEstimates to EvidenceItems.

---

## Decision

Create `@platform/measurement-core` as a **Level 3** package in the platform DAG.

It provides a complete measurement domain surface:

| Responsibility | Interface |
|---|---|
| Orchestration | `MeasurementEngine`, `MeasurementProvider` |
| Calibration | `CalibrationService`, `CalibrationProfile` |
| Reference objects | `ReferenceObjectService`, `ReferenceObject` |
| Depth estimation | `DepthEstimator`, `DepthMap` |
| Scale computation | `ScaleEstimator` |
| Dimension computation | `DimensionEstimator`, `DimensionEstimate` |
| Pure geometry | `GeometryService` (area, volume, angle, unit conversion) |
| Evidence linking | `MeasurementAnnotation`, `MeasurementHistory` |
| Caching | `MeasurementCache` |
| Plugin interface | `MeasurementContext` for platform-intelligence |

### Dependency design: NO direct import of local-intelligence or ai-core

measurement-core defines `MeasurementInferenceProvider` — a narrow, two-method interface for the inference calls it needs (object detection + depth estimation). Both `LocalAIProvider` (from local-intelligence) and cloud providers (from ai-core) satisfy this interface structurally.

Applications inject whichever provider they have:

```typescript
// ReadyLoq (on-device, offline-capable):
const engine = createMeasurementEngine({
  inferenceProvider: localAIProvider, // satisfies MeasurementInferenceProvider
  calibration: calibrationService,
  ...
});

// VYBE (cloud-first):
const engine = createMeasurementEngine({
  inferenceProvider: cloudVisionProvider, // also satisfies MeasurementInferenceProvider
  calibration: calibrationService,
  ...
});
```

This keeps measurement-core at Level 3 without requiring a dependency on either Level-3 package (local-intelligence or platform-intelligence).

### DAG position

```
Level 3 (peers — none imports any other):
  platform-intelligence
  local-intelligence
  measurement-core       → shared-types, camera-core, storage-core, evidence-core
```

---

## Hybrid Provider Selection

The MeasurementEngine delegates inference to whatever `MeasurementInferenceProvider` is injected. Applications that want hybrid (local-first, cloud-fallback) behaviour:

1. Wrap `LocalAIProvider` + a cloud provider in a `HybridMeasurementProvider` (defined in the app, not here)
2. Inject the hybrid provider into MeasurementEngine

The selection policy (when to use local vs cloud) is the same policy as `ProviderSelector` from local-intelligence — measurement-core does not need to reimplement it.

---

## Calibration Accuracy Tiers

| Method | Typical accuracy | Notes |
|--------|----------------|-------|
| AR world anchors | ±1–2mm | Best; requires ARKit/ARCore session |
| LiDAR + RGB | ±3–5mm | Future; Apple LiDAR / ToF sensor |
| Stereo camera | ±5–10mm | Future; dedicated hardware |
| Reference object (credit card) | ±3–8mm | Good when object is clearly visible |
| EXIF focal length | ±5–15mm | Depends on subject distance accuracy |
| ML monocular depth | ±10–50mm | Highly variable; no reference |
| Manual annotation | Ground truth | Best for corrections; no estimation error |

The `MeasurementConfidence.uncertaintyMm` field communicates this to consumers.

---

## Evidence Integration

ReadyLoq's inspection photos already flow through evidence-core as `EvidenceItem` records. `MeasurementAnnotation` attaches to these items via `evidenceItemId`, creating a 1:N relationship (one photo can have many measurements at different points in time or by different methods).

The version model (version: number, isActive: boolean) supports:
1. **Initial auto-estimate** (version 1, low confidence)
2. **Technician correction** (version 2, manual, high confidence — becomes the active version)
3. **Re-measurement after recalibration** (version 3, better accuracy — becomes active)

The history store retains all versions for audit purposes. Only version querying (not deletion) is the default consumer pattern.

---

## Performance Considerations

### Latency
- Reference object detection adds ~150ms (local model) or ~500ms (cloud) to the measurement pipeline.
- Monocular depth estimation adds ~200–400ms (local model).
- Geometry calculations (area, volume, unit conversion) are <1ms.
- `MeasurementCache` keyed on perceptual hash means identical frames return in <1ms after the first inference.

### Battery & Memory
- Inference is delegated to the injected provider, which carries its own `InferenceThrottlePolicy` (from local-intelligence).
- measurement-core itself has no battery or thermal awareness — it relies on the provider's throttling.
- Calibration profiles are loaded once and cached in memory for a session. Multiple measurements in the same session share the same calibration at zero additional inference cost.

### Offline-First
- `CalibrationService.findBestForDevice()` returns a cached profile from storage-core — no network needed.
- `MeasurementCache` (storage-core backed) survives app restarts.
- If no inference provider is available (fully offline AND no local model), the engine falls back to EXIF focal-length estimation (no ML) or returns an uncalibrated estimate with `calibrationStatus: "uncalibrated"` and a low confidence score.
- All measurements are stored to `MeasurementHistory` via storage-core before any sync — sync-engine will upload them when connectivity returns.

### Scalability
- `MeasurementHistory.search()` is backed by the storage-core query interface, which supports indexes on `entityType + entityId` and `evidenceItemId`.
- Large evidence sets (thousands of photos per inspection) are handled by the offset/limit pagination on `MeasurementHistorySearchFilter`.
- `MeasurementCache` max entries and TTL are configurable per application context.

---

## Migration Guide

### For ReadyLoq (Phase 3.6 — after platform-intelligence integration)

1. Register a `MeasurementPlugin` at app bootstrap with the ReadyLoq local AI provider.
2. Add `MeasurementAnnotation` persistence to the api-server (via storage-core HTTP routes).
3. In the inspection new-capture flow: after photo upload, call `MeasurementEngine.measure()` with the photo + any detected reference object.
4. Surface the `DimensionEstimate` in the findings UI: "Estimated gap width: 8mm ± 2mm (medium confidence)".
5. Allow technician to revise via `MeasurementEngine.reviseAnnotation()` — this creates version 2.
6. Wire revised measurements to ReadyLoq's proposal engine (still in readyloq-mobile — NOT in measurement-core).

**What stays in ReadyLoq (never in measurement-core):**
- Gap thresholds by pest type ("a 6mm gap is passable for a house mouse")
- Material area → pricing logic (cost per square foot)
- Proposal line-item generation from measurements
- Finding categories that reference measurements

### For VYBE (Phase 4)

1. Register a `MeasurementPlugin` with a cloud vision provider (no local model needed initially).
2. In studio setup: call `MeasurementEngine.measure()` on a room reference photo.
3. Use `DimensionEstimate` to populate camera placement recommendations.
4. Store studio measurements in `MeasurementHistory` keyed by `entityType: "studio", entityId: studioId`.

---

## Consequences

### Positive
- ReadyLoq and VYBE share calibration code, reference object library, and geometry engine
- Future products (construction, insurance, facilities) adopt measurement-core immediately
- Measurement history provides an audit trail for corrected measurements
- Clean separation: business rules (what the measurement means) stay in the app
- No domain contamination in ai-core or local-intelligence

### Risks

| Risk | Mitigation |
|------|-----------|
| Monocular depth ML accuracy is low for small features | Confidence score + uncertaintyMm communicate this; reference object fallback is recommended |
| Reference object not present in frame | Auto-detect warns user; EXIF focal length is the fallback |
| Calibration profile invalidated by camera switch | `deviceModel` field allows profile invalidation on device change |
| Large measurement history tables | Pagination on search; TTL on cache; storage-core handles the persistence layer |
| Perceptual hash cache collisions on similar-but-different images | Low probability (pHash collision rate < 0.01%); version history provides recovery |
