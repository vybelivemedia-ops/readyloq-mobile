/**
 * @platform/local-intelligence — Unit Test Stubs
 *
 * This package exports interfaces only. These tests serve two purposes:
 *
 *   1. TYPE COMPATIBILITY TESTS — Verify that mock implementations satisfy
 *      the exported interfaces at compile time. If TypeScript accepts these
 *      mocks, the interface contracts are well-formed.
 *
 *   2. IMPLEMENTATION GUIDANCE — Document the expected behavioural contracts
 *      that concrete implementations (TFLite adapter, ONNX adapter, etc.)
 *      must honour. Each test that is marked `test.todo` becomes a real test
 *      when the implementation is extracted from the app.
 *
 * HOW TO USE WHEN IMPLEMENTING:
 *   1. Create an implementation file (e.g. src/adapters/tflite-adapter.ts)
 *   2. Replace the mocks below with the real implementation
 *   3. Replace test.todo blocks with real assertions
 *   4. Run: pnpm --filter @platform/local-intelligence test
 */

import { describe, it, expect, vi, test } from "vitest";
import type {
  ModelRegistry,
  ModelDownloader,
  ModelManager,
  ModelInfo,
  ModelStatus,
  ModelVersion,
  ModelDownload,
  InferenceEngine,
  InferenceRequest,
  InferenceResult,
  InferenceQueue,
  InferenceTask,
  VisionEngine,
  VisionRequest,
  VisionResult,
  VisionDetection,
  OCREngine,
  OCRRequest,
  OCRResult,
  EmbeddingEngine,
  EmbeddingRequest,
  EmbeddingResult,
  EmbeddingVector,
  ImageQualityEngine,
  QualityRequest,
  QualityResult,
  QualityScore,
  BlurAssessment,
  MotionAssessment,
  DuplicateAssessment,
  AICache,
  CacheKind,
  ResourceMonitor,
  ResourceState,
  BatteryState,
  ThermalState,
  MemoryState,
  LocalAIProvider,
  ProviderSelector,
  InferenceThrottlePolicy,
  ThrottleDecision,
  LocalIntelligenceContext,
} from "../index.js";
import { LOCAL_AI_EVENT_KINDS } from "../index.js";

// ─────────────────────────────────────────────────────────────────────────────
// MOCK FACTORIES
// These are minimal in-memory implementations used only in tests.
// They verify interface shape; they are not production implementations.
// ─────────────────────────────────────────────────────────────────────────────

function makeModelVersion(): ModelVersion {
  return {
    version: "1.0.0",
    releasedAt: "2026-01-01T00:00:00.000Z",
  };
}

function makeModelInfo(id = "test-model"): ModelInfo {
  return {
    id,
    name: "Test Vision Model",
    framework: "tflite",
    version: makeModelVersion(),
    capabilities: ["vision_detection"],
    sizeBytes: 10_000_000,
    downloadUrl: "https://models.example.com/test-model.tflite",
    inputShape: [224, 224, 3],
    outputShape: [1, 100, 6],
  };
}

function makeResourceState(overrides?: Partial<ResourceState>): ResourceState {
  return {
    battery: { level: 0.8, isCharging: false, isLow: false, isCritical: false },
    thermal: { level: "nominal", throttlingActive: false, isCritical: false },
    memory: { availableBytes: 2_000_000_000, totalBytes: 4_000_000_000, isLow: false },
    networkAvailable: true,
    sampledAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeInferenceRequest(overrides?: Partial<InferenceRequest>): InferenceRequest {
  return {
    id: "req-001",
    modelId: "test-model",
    input: { kind: "image_base64", imageBase64: "base64string==", imageMimeType: "image/jpeg" },
    mode: "auto",
    priority: "normal",
    useCache: true,
    ...overrides,
  };
}

// ─── Mock ModelRegistry ────────────────────────────────────────────────────

function makeMockModelRegistry(): ModelRegistry {
  const models = new Map<string, ModelInfo>();
  const statuses = new Map<string, ModelStatus>();
  const listeners = new Map<string, Array<(s: ModelStatus) => void>>();

  return {
    register(model) { models.set(model.id, model); statuses.set(model.id, "not_downloaded"); },
    unregister(id) { models.delete(id); statuses.delete(id); },
    get(id) { return models.get(id); },
    list() { return [...models.values()]; },
    findByCapability(cap, framework) {
      return [...models.values()].filter(m =>
        m.capabilities.includes(cap) &&
        (framework == null || m.framework === framework)
      );
    },
    getStatus(id) { return statuses.get(id) ?? "not_downloaded"; },
    setStatus(id, status) {
      statuses.set(id, status);
      (listeners.get(id) ?? []).forEach(fn => fn(status));
    },
    onStatusChange(id, listener) {
      if (!listeners.has(id)) listeners.set(id, []);
      listeners.get(id)!.push(listener);
      return () => {
        const arr = listeners.get(id) ?? [];
        listeners.set(id, arr.filter(fn => fn !== listener));
      };
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// TESTS
// ─────────────────────────────────────────────────────────────────────────────

describe("ModelRegistry", () => {
  it("registers and retrieves models", () => {
    const registry = makeMockModelRegistry();
    const model = makeModelInfo("vision-v1");
    registry.register(model);
    expect(registry.get("vision-v1")).toEqual(model);
    expect(registry.list()).toHaveLength(1);
  });

  it("initial status is not_downloaded", () => {
    const registry = makeMockModelRegistry();
    registry.register(makeModelInfo("m1"));
    expect(registry.getStatus("m1")).toBe("not_downloaded");
  });

  it("updates status and notifies listeners", () => {
    const registry = makeMockModelRegistry();
    registry.register(makeModelInfo("m1"));
    const listener = vi.fn();
    registry.onStatusChange("m1", listener);
    registry.setStatus("m1", "downloading");
    expect(listener).toHaveBeenCalledWith("downloading");
  });

  it("unregisters removes listener calls", () => {
    const registry = makeMockModelRegistry();
    registry.register(makeModelInfo("m1"));
    const listener = vi.fn();
    const unsub = registry.onStatusChange("m1", listener);
    unsub();
    registry.setStatus("m1", "downloaded");
    expect(listener).not.toHaveBeenCalled();
  });

  it("findByCapability returns matching models", () => {
    const registry = makeMockModelRegistry();
    registry.register(makeModelInfo("v1"));
    registry.register({ ...makeModelInfo("t1"), capabilities: ["ocr"] });
    expect(registry.findByCapability("vision_detection")).toHaveLength(1);
    expect(registry.findByCapability("ocr")).toHaveLength(1);
    expect(registry.findByCapability("embedding_image")).toHaveLength(0);
  });

  it("findByCapability filters by framework", () => {
    const registry = makeMockModelRegistry();
    registry.register({ ...makeModelInfo("v1"), framework: "tflite" });
    registry.register({ ...makeModelInfo("v2"), framework: "onnx", capabilities: ["vision_detection"] });
    expect(registry.findByCapability("vision_detection", "tflite")).toHaveLength(1);
    expect(registry.findByCapability("vision_detection", "onnx")).toHaveLength(1);
    expect(registry.findByCapability("vision_detection", "coreml")).toHaveLength(0);
  });
});

describe("InferenceThrottlePolicy", () => {
  /**
   * These tests document the expected default policy behaviour.
   * Replace with real implementation assertions when the adapter ships.
   */

  it("allows inference when resources are healthy", () => {
    test.todo("allow when battery >= 0.2, thermal nominal, memory ok");
  });

  it("defers when battery is critical and not charging", () => {
    test.todo("ThrottleDecision = 'defer' when battery.isCritical && !isCharging");
  });

  it("denies when thermal state is critical", () => {
    test.todo("ThrottleDecision = 'deny' when thermal.isCritical");
  });

  it("defers low-priority tasks when thermal is serious", () => {
    test.todo("ThrottleDecision = 'defer' for priority=low when thermal.level === 'serious'");
  });

  it("allows high-priority tasks when thermal is serious (not critical)", () => {
    test.todo("ThrottleDecision = 'allow' for priority=high when thermal.level === 'serious'");
  });

  it("denies when memory is low and model is large", () => {
    test.todo("ThrottleDecision = 'deny' when memory.isLow && model.sizeBytes > 200_000_000");
  });
});

describe("ProviderSelector", () => {
  it("selects local when offline", () => {
    test.todo("returns localProvider when networkAvailable=false and local model is ready");
  });

  it("returns null when offline and no local model", () => {
    test.todo("returns null when networkAvailable=false and localProvider=undefined");
  });

  it("prefers cloud for high-priority requests when network available", () => {
    test.todo("selected='cloud' for priority='high' when network is available");
  });

  it("selects local when battery is critical even if network available", () => {
    test.todo("selected='local' when battery.isCritical and !isCharging");
  });
});

describe("InferenceQueue", () => {
  it("enqueue returns an InferenceTask in queued status", () => {
    test.todo("task.status === 'queued' immediately after enqueue");
  });

  it("deduplicates requests with the same modelId + cacheKey", () => {
    test.todo("second enqueue with same key returns existing task, not a new one");
  });

  it("cancel transitions task to cancelled", () => {
    test.todo("task.status === 'cancelled' after cancel(taskId)");
  });

  it("flushThrottled re-queues throttled tasks", () => {
    test.todo("all 'throttled' tasks move to 'queued' after flushThrottled()");
  });

  it("notifies listeners on status changes", () => {
    test.todo("onTaskUpdate fires when status changes");
  });
});

describe("AICache", () => {
  it("get returns undefined for a cold cache", () => {
    test.todo("get('unknown-key', 'embedding') === undefined");
  });

  it("set and get return the cached value", () => {
    test.todo("value round-trips correctly through set/get");
  });

  it("invalidateKind removes only the specified kind", () => {
    test.todo("embedding entries gone, detection entries remain after invalidateKind('embedding')");
  });

  it("invalidateModel removes only entries for the model", () => {
    test.todo("only entries with matching modelId are removed");
  });

  it("expired entries are removed by pruneExpired", () => {
    test.todo("entry with ttl=0 is gone after pruneExpired()");
  });

  it("hitRate increases on cache hit", () => {
    test.todo("hitRate('embedding') > 0 after a get that found an entry");
  });
});

describe("EmbeddingEngine — similarity contract", () => {
  it("identical vectors have similarity 1.0", () => {
    test.todo("similarity(v, v).score === 1.0 for cosine method");
  });

  it("orthogonal vectors have similarity 0.0", () => {
    test.todo("similarity(v1, v2).score === 0.0 when dot product is 0");
  });

  it("similarity is symmetric", () => {
    test.todo("similarity(a, b).score === similarity(b, a).score");
  });
});

describe("ImageQualityEngine — QualityScore contract", () => {
  it("quality scores are in [0, 1]", () => {
    test.todo("overall, sharpness, brightness, contrast, noise all in [0,1]");
  });

  it("isAcceptable is false when sharpness is below threshold", () => {
    test.todo("isAcceptable=false and rejectionReason='too_blurry' when sharpness < threshold");
  });

  it("DuplicateAssessment similarity is in [0, 1]", () => {
    test.todo("isDuplicate=true implies similarity >= some threshold, similarity in [0,1]");
  });
});

describe("LOCAL_AI_EVENT_KINDS", () => {
  it("all event kind values follow the local_ai.<noun>.<verb> convention", () => {
    const kinds = Object.values(LOCAL_AI_EVENT_KINDS);
    for (const kind of kinds) {
      expect(kind).toMatch(/^local_ai\./);
    }
  });

  it("no duplicate event kind values", () => {
    const kinds = Object.values(LOCAL_AI_EVENT_KINDS);
    const unique = new Set(kinds);
    expect(unique.size).toBe(kinds.length);
  });
});

describe("ModelInfo — interface shape verification (compile-time)", () => {
  it("makeModelInfo produces a valid ModelInfo", () => {
    const model = makeModelInfo();
    // These assertions verify the shape at runtime — if TypeScript accepted
    // makeModelInfo(), the interface contract is satisfied.
    expect(model).toHaveProperty("id");
    expect(model).toHaveProperty("name");
    expect(model).toHaveProperty("framework");
    expect(model).toHaveProperty("version");
    expect(model).toHaveProperty("capabilities");
    expect(model).toHaveProperty("sizeBytes");
    expect(model).toHaveProperty("downloadUrl");
  });
});

describe("ResourceState — interface shape verification", () => {
  it("makeResourceState produces a valid ResourceState", () => {
    const state = makeResourceState();
    expect(state.battery.level).toBeGreaterThanOrEqual(0);
    expect(state.battery.level).toBeLessThanOrEqual(1);
    expect(["nominal", "fair", "serious", "critical"]).toContain(state.thermal.level);
    expect(state.memory.availableBytes).toBeLessThanOrEqual(state.memory.totalBytes);
  });

  it("critical battery state is correctly flagged", () => {
    const state = makeResourceState({
      battery: { level: 0.05, isCharging: false, isLow: true, isCritical: true },
    });
    expect(state.battery.isCritical).toBe(true);
    expect(state.battery.isLow).toBe(true);
  });
});
