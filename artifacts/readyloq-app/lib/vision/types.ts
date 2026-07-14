/**
 * Universal AI Vision Platform — core contracts.
 *
 * ReadyLoq's inspection workflow is camera-agnostic: evidence can come from
 * the phone camera, imported footage (GoPro / smart-glasses / body-cam clips
 * pulled off the camera roll), or — in future tiers — live external streams
 * (USB scopes, Wi-Fi/drone cams) and push devices (Meta Ray-Ban glasses).
 * Every source funnels through the same `EvidenceItem` contract into the same
 * local-first persistence, upload, and AI-analysis pipeline. Providers are
 * dumb capture adapters; ALL business logic (persist → sync → analyze) stays
 * outside this module.
 *
 * PLATFORM MIGRATION:
 *   Phase 1 (@platform/shared-types):
 *     CaptureSource, EvidenceItem, QualityAssessment, CaptureMode,
 *     CaptureTransport, PreviewKind, CaptureCapabilities
 *
 *   Phase 2 (@platform/camera-core):
 *     ProviderAvailability, ProviderStatus, EvidenceIntake, CaptureProviderBase,
 *     RequestCaptureProvider, CaptureSession, SessionCaptureProvider,
 *     PushCaptureSession, PushCaptureProvider, CaptureProvider, VisionProvider
 *
 *   All existing `import { X } from "./types"` callers continue to work
 *   without any changes — this file re-exports everything from its canonical
 *   platform location.
 */

// ─── Re-export @platform/shared-types canonical types ────────────────────────
export type {
  CaptureSource,
  EvidenceItem,
  QualityAssessment,
  CaptureMode,
  CaptureTransport,
  PreviewKind,
  CaptureCapabilities,
} from "@platform/shared-types";

// ─── Re-export @platform/camera-core canonical provider contracts ─────────────
export type {
  ProviderAvailability,
  ProviderStatus,
  EvidenceIntake,
  CaptureProviderBase,
  RequestCaptureProvider,
  CaptureSession,
  SessionCaptureProvider,
  PushCaptureSession,
  PushCaptureProvider,
  CaptureProvider,
  VisionProvider,
} from "@platform/camera-core";
