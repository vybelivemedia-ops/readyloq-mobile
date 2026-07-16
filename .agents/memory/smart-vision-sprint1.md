---
name: smart-vision Sprint 1
description: @platform/smart-vision complete module list, key design decisions, and governance rules for all new files added in Sprint 1
---

# @platform/smart-vision — Sprint 1

## Final file inventory (16 source files, all typechecked clean)

Original 9: frame.ts, tracking.ts, zoom.ts, crop.ts, auto-capture.ts, super-resolution.ts, quality.ts, capability.ts, scene-memory.ts

Sprint 1 additions:
- detection.ts — DetectionEngine (model-agnostic), DetectedObject, DetectionResult, ClassMapping, DetectionConfidenceSummary
- enhancement.ts — DenoiseProvider, SharpenProvider, HDRProvider, ContrastProvider, EnhancementPipeline
- guidance.ts — GuidanceCode (14 generic signal codes), GuidanceDirective, GuidanceEngine, GuidanceFilter
- capture-policy.ts — CapturePolicy (interface), AutoCaptureEngine, CaptureDecision, CaptureScore, CaptureReason, BuiltInPolicyId (5 named policies)
- events.ts — SmartVisionEventBus, SmartVisionEvent (23 typed events, "sv.*" namespace)
- config.ts — SmartVisionConfig, SmartVisionFeatureFlags (13 flags), DEFAULT_SMART_VISION_CONFIG
- engine.ts — SmartVisionEngine, SmartVisionSession, SmartVisionDependencies (DI container), SmartVisionFactory

frame.ts was extended with: FramePriority, ScheduledFrame, FrameDropPolicy, FrameScheduler

## Key design decisions

**DetectionEngine is model-agnostic:** classId values are application-defined integers. ClassMapping (classId → label) is injected from the application layer. The platform never interprets what classId 7 means.

**CapturePolicy is pluggable:** 5 built-in policy IDs ("manual", "quality_first", "confidence_first", "balanced", "continuous"). Applications register custom policies via AutoCaptureEngine.registerPolicy(). ReadyLoq and VYBE each choose a different policy — the engine doesn't change.

**GuidanceCodes are signal-level only:** "move_closer", "hold_steady", "increase_lighting" etc. — never domain strings like "look for German roaches". Applications map GuidanceCode to domain-specific copy in the application layer.

**SmartVisionDependencies is the extension point:** All sub-systems are optional injectable deps. An app with no DetectionEngine gets quality-only capture; an app with no GuidanceEngine gets silent operation. The engine degrades gracefully.

**auto-capture.ts is preserved for backward compatibility:** The new capture-policy.ts supersedes it for new code. Both are exported from index.ts.

## Governance rule

Zero pest/creator/product-specific identifiers in any source file. classId is always `number`. GuidanceCode values must describe optical/physical state, never domain objects.

**Why:** VYBE (creator app) and ReadyLoq (inspection app) both consume this package. A domain string in a GuidanceCode would break one consumer or force a fork.
