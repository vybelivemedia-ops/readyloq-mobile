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
 * PLATFORM MIGRATION (Phase 1 — @platform/shared-types):
 *   The foundational types (CaptureSource, EvidenceItem, QualityAssessment,
 *   CaptureMode, CaptureTransport, PreviewKind, CaptureCapabilities) are now
 *   canonical in @platform/shared-types. This file re-exports them from there
 *   so all existing `import { X } from "./types"` callers continue to work
 *   without any changes.
 *
 *   Camera-specific provider contracts (ProviderStatus, ProviderAvailability,
 *   EvidenceIntake, RequestCaptureProvider, SessionCaptureProvider, etc.) remain
 *   here until Phase 2 (→ @platform/camera-core).
 */

import type {
  CaptureCapabilities,
  CaptureSource,
  EvidenceItem,
  PreviewKind,
} from "@platform/shared-types";

// ─── Re-export platform-canonical types ──────────────────────────────────────
// All callers that do `import { X } from "./types"` continue to work unchanged.
export type {
  CaptureSource,
  EvidenceItem,
  QualityAssessment,
  CaptureMode,
  CaptureTransport,
  PreviewKind,
  CaptureCapabilities,
} from "@platform/shared-types";

// ─── Camera-specific provider contracts (Phase 2 → @platform/camera-core) ───

/** Whether a source is usable on THIS device right now. */
export type ProviderAvailability =
  | { available: true }
  | { available: false; reason: string };

/** Live connection state for session/push providers. */
export type ProviderStatus =
  | "unavailable"
  | "disconnected"
  | "connecting"
  | "ready"
  | "capturing"
  | "error";

/**
 * The single sink every source feeds. Request/response callers pass the result
 * of `capture()` here; session/push providers call it whenever frames arrive —
 * even asynchronously. This is what decouples "evidence arrived" from "the user
 * pressed a button" (the requirement for glasses/drone). The implementation
 * (persist → dedupe → quality-gate → sync) lives in the capture screen and
 * needs no change when a new source is added.
 */
export type EvidenceIntake = (
  items: EvidenceItem[],
  ctx: { providerId: string; source: CaptureSource },
) => Promise<void>;

/** Common fields shared by every capture provider. */
export type CaptureProviderBase = {
  id: string;
  source: CaptureSource;
  label: string;
  capabilities: CaptureCapabilities;
};

/** Pull model: phone camera, library import, USB/Wi-Fi still-grab. */
export type RequestCaptureProvider = CaptureProviderBase & {
  /**
   * Resolves with zero or more evidence items — zero when the user cancels,
   * several for multi-select imports. MUST throw on real failures (never
   * swallow) so callers can surface errors.
   */
  capture: () => Promise<EvidenceItem[]>;
};

/** An open connection to a streaming source. */
export type CaptureSession = {
  /** Grab a still/frame from the live feed on demand. */
  grab: () => Promise<EvidenceItem[]>;
  disconnect: () => Promise<void>;
};

/** Session model: connection-oriented live streams (USB scope, Wi-Fi/drone). */
export type SessionCaptureProvider = CaptureProviderBase & {
  previewKind: PreviewKind;
  /** Open the connection; frames grabbed later flow through `intake`. */
  connect: (intake: EvidenceIntake) => Promise<CaptureSession>;
};

/** A live push session that delivers evidence until ended. */
export type PushCaptureSession = { end: () => Promise<void> };

/** Push model: the device initiates capture (glasses, wearables). */
export type PushCaptureProvider = CaptureProviderBase & {
  /** Start listening; the device pushes evidence through `intake` as it arrives. */
  startSession: (intake: EvidenceIntake) => Promise<PushCaptureSession>;
};

export type CaptureProvider =
  | RequestCaptureProvider
  | SessionCaptureProvider
  | PushCaptureProvider;

/**
 * @deprecated Use `RequestCaptureProvider`. Retained as an alias so existing
 * imports keep compiling; the two are structurally identical.
 */
export type VisionProvider = RequestCaptureProvider;
