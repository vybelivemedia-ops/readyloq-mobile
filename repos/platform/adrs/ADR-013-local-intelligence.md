# ADR-013: @platform/local-intelligence — Separate Package for On-Device AI

**Status:** Accepted  
**Date:** 2026-07-14  
**Author:** Platform Architecture  
**Supersedes:** Nothing  
**See also:** ADR-003 (ai-core scope), ADR-010 (AIPipeline), ADR-011 (Governance), ADR-012 (platform-intelligence)

---

## Context

Both ReadyLoq and VYBE require AI inference on captured media. As device capabilities improve and privacy requirements grow, on-device (offline) AI inference becomes increasingly important:

- **ReadyLoq:** Technicians work in basements, crawl spaces, and rural properties with intermittent or no connectivity. Batch uploading photos for cloud analysis introduces multi-second latency. An on-device vision model that identifies candidate inspection areas in real-time — while offline — dramatically improves the field experience.

- **VYBE:** Stream caption generation, highlight detection, and clip scoring can benefit from on-device models that work without incurring per-call API costs and without the round-trip latency of cloud inference.

Both apps currently use `ai-core`'s `AIProviderFactory` for cloud inference only. There is no on-device inference infrastructure anywhere in the platform today.

### Why not add on-device inference to `ai-core`?

This was the first option considered. It was rejected for the following reasons:

1. **Fundamentally different model lifecycle.** Cloud AI is stateless — send a request, receive a response. On-device AI is stateful: models must be downloaded (large binary files, 50 MB–2 GB), loaded into a framework runtime (TFLite interpreter, ONNX session, CoreML pipeline), warmed up, and explicitly unloaded to free GPU/CPU memory. This lifecycle has no equivalent in cloud AI and would substantially complicate ai-core.

2. **Framework dependency blast radius.** TFLite, ONNX Runtime, and CoreML are native-SDK dependencies that only make sense on mobile. Adding them to ai-core would force every consumer of ai-core — including pure-web dashboards and server-side reporting tools — to carry those deps. A web app serving reports has no use for `react-native-fast-tflite`.

3. **Resource awareness is a mobile-only concern.** Battery state, thermal throttling, and available RAM are constraints that only apply to on-device inference. Embedding `BatteryAwareness` and `ThermalState` in ai-core would make ai-core mobile-specific when it is currently runtime-agnostic.

4. **Caching semantics are different.** Cloud AI caches on prompt hash and provider response; on-device AI caches on perceptual image hash (so visually-similar frames hit the same cache entry even if pixel-identical comparisons would miss). Merging these two caching systems would produce a brittle combined layer.

5. **Provider selection logic is local-intelligence-specific.** The hybrid mode decision ("use local if offline, cloud if online, defer if battery critical") belongs with the code that knows about battery state and model availability. Putting it in ai-core would require ai-core to know about device resources.

6. **Independent evolution.** ai-core's API surface is stabilised around cloud providers and the session/pipeline model. local-intelligence will evolve rapidly as new device ML frameworks emerge (e.g. Apple's next ANE generation, Qualcomm Hexagon 8 NPU, Google Gemini Nano). Keeping them separate means local-intelligence can iterate without risking ai-core stability.

---

## Decision

Create `@platform/local-intelligence` as a dedicated Level-3 package in the platform DAG.

It provides a complete on-device AI runtime surface:

| Responsibility | Interface |
|---|---|
| Model file management | `ModelRegistry`, `ModelDownloader`, `ModelManager` |
| Hardware-aware inference | `InferenceEngine`, `InferenceQueue`, `BackgroundInferenceScheduler` |
| Computer vision | `VisionEngine` |
| Text extraction | `OCREngine` |
| Semantic similarity | `EmbeddingEngine` |
| Image quality | `ImageQualityEngine` (quality, blur, motion, duplicate) |
| Result caching | `AICache` |
| Resource monitoring | `ResourceMonitor`, `BatteryAwareness`, `ThermalAwareness` |
| Hybrid provider selection | `LocalAIProvider`, `ProviderSelector`, `InferenceThrottlePolicy` |

### Integration with ai-core

`LocalAIProvider` extends `AIProvider` (from ai-core). This means a local provider can be registered in ai-core's `AIProviderFactory` as a fallback at the bottom of the fallback chain, enabling the hybrid pattern natively:

```
AIProviderFactory fallback chain:
  1. OpenAI (cloud, priority=1)
  2. Anthropic (cloud, priority=2)
  3. LocalAIProvider (on-device, priority=99, works offline)
```

When cloud providers are unavailable, the factory falls through to the LocalAIProvider automatically — without any custom routing code.

### Integration with platform-intelligence

`local-intelligence` is registered as a plugin in `platform-intelligence`:

```typescript
// Application bootstrap (ReadyLoq example):
const plugin = new LocalIntelligencePlugin({
  models: modelManager,
  inference: inferenceEngine,
  // ... other engines
});
await platform.plugins.register(plugin);

// Workflow steps then request vision inference via the ProviderCoordinator,
// not by importing local-intelligence directly.
```

---

## Hybrid Provider Selection Logic

The `ProviderSelector` follows this decision tree:

```
Is a local model available and loaded?
  No  → use cloud (if network) or deny (if offline)
  Yes →
    Is the network available?
      No  → always use local
      Yes →
        Is the request priority HIGH?
          Yes → use cloud (lower latency, better quality for user-facing calls)
          No  →
            Is battery CRITICAL and not charging?
              Yes → use local (avoid network radio drain)
              No  → use cloud (default to better quality)
            Is the thermal state SERIOUS or CRITICAL?
              Yes → use local (avoid GPU/cloud request overhead)
              No  → use cloud
```

Applications can replace the default `ProviderSelector` with a custom strategy by passing their own implementation to the `LocalIntelligenceContext`.

---

## Performance Considerations

### Memory
- Never load more models than RAM allows. `ModelManager.ensure()` checks `ResourceMonitor.memory` before loading.
- `ModelManager.unload()` must be called explicitly in `platform-intelligence` session teardown hooks.
- Recommended pattern: load a model before the workflow step that needs it; unload it in that step's cleanup.

### Battery
- On-device inference is CPU/GPU-intensive. `InferenceThrottlePolicy` enforces a default: if battery < 10% and not charging, defer background inference and warn on foreground inference.
- Applications can override the policy with a stricter or looser threshold.

### Thermal
- Sustained inference causes device heating. After the ThermalState reaches `"serious"`, the `InferenceQueue` automatically adds a 1-second delay between consecutive local inferences.
- At `"critical"`, the queue denies all new tasks until the device cools.

### Latency
- `ModelManager.warmup()` runs a dummy inference on load to pre-JIT the model. First-real-inference latency drops from ~500ms to ~50ms after warmup.
- `AICache` keys on perceptual hash (pHash) for images — visually-similar frames (burst-shot duplicates) return cached results in <1ms.

### Scalability
- The `InferenceQueue` prevents concurrent inference on the same model (GPU doesn't multi-thread ML workloads). Multiple models can run concurrently on separate GPU contexts where hardware supports it.
- `BackgroundInferenceScheduler` batches low-priority work for execution during device-idle windows (e.g. charging, screen off).

---

## Migration Guide

### For ReadyLoq

**Phase 3.5** (between ai-core migration and Phase 4):

1. Register a `LocalIntelligencePlugin` in the `platform-intelligence` bootstrap.
2. Register vision model(s) with `ModelRegistry` at app startup (model IDs and download URLs defined in readyloq-app, not in platform).
3. Replace the current `QualityGate` (inline Laplacian in camera-core) with `ImageQualityEngine.detectBlur()` for captured frames.
4. Use `VisionEngine.detect()` for on-device candidate finding during offline inspections.
5. Keep cloud AI (ai-core pipeline) as the primary path for full batch analysis — local model is the fallback and the offline-capable path.

**What stays in ReadyLoq:**
- Model IDs, download URLs, model file names (domain-specific)
- Confidence thresholds for pest-relevant detections
- Logic that acts on `VisionDetection.label` (pest species parsing)
- Report generation using inference results

### For VYBE

**Phase 4 / Concurrent with live-session-core migration:**

1. Register a `LocalIntelligencePlugin` with stream-specific models.
2. Use `EmbeddingEngine` for clip deduplication and highlight scoring.
3. Use `OCREngine` for on-screen text detection in stream thumbnails.
4. Use `BackgroundInferenceScheduler` for post-stream clip analysis (non-urgent, runs when device is charging).

---

## Consequences

### Positive
- Cloud AI cost reduction (local inference is free after download)
- Offline functionality for both apps
- Battery-aware inference prevents UX degradation on low-power devices
- Clean separation of concerns — ai-core stays cloud-agnostic
- LocalAIProvider slots into ai-core's fallback chain without any ai-core changes

### Risks
- Model file sizes (50 MB–2 GB) add to initial app install or first-run download
  - Mitigation: `ModelDownloader` with pause/resume; download only on WiFi by default
- On-device model quality may be lower than cloud model quality
  - Mitigation: hybrid mode defaults to cloud for user-facing high-priority inference
- Framework (TFLite, ONNX) updates can break models
  - Mitigation: `ModelVersion.minFrameworkVersion` + `ModelRegistry` deprecation flags

### Neutral
- Adds a Level-3 package alongside `platform-intelligence` — both are final recipients, neither imports the other
- Applications must explicitly register the plugin; there is no implicit activation
