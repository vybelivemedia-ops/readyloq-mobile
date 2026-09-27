/**
 * Unit tests — inspection summary placeholder rendering logic
 *
 * These tests exercise the same functions that [localId].tsx imports and calls,
 * so a regression in the component's conditional chain is caught here.
 *
 * Covers the three contracts from the task spec:
 *
 *   1. AI findings card shows the "Not generated" error placeholder when
 *      `analysisQ.isError` is true (HTTP-level failure) — asserts the exact
 *      user-visible reason text so a copy change is caught immediately.
 *   2. Deliver Report card shows a placeholder when no delivery methods are
 *      registered on the device — asserts reason text and icon.
 *   3. Sync status card shows "Sync status unavailable" when phase is null —
 *      asserts the exact label string.
 *
 * Source files under test (both consumed by the component and tested here):
 *   artifacts/readyloq-app/app/(app)/inspection-summary/inspection-summary-logic.ts
 */

import { describe, it, expect } from "vitest";
import {
  resolveAnalysisCardVariant,
  resolveDeliveryCardVariant,
  resolveSyncStatusVariant,
  SYNC_STATUS_UNAVAILABLE_LABEL,
  type AnalysisQueryState,
} from "@/app/(app)/inspection-summary/inspection-summary-logic";

// ─────────────────────────────────────────────────────────────────────────────
// 1. AI findings card — error placeholder (task spec #1)
// ─────────────────────────────────────────────────────────────────────────────

describe("resolveAnalysisCardVariant — query-error branch (task spec #1)", () => {
  const base: AnalysisQueryState = {
    finalized: true,
    isError: true,
    isSuccess: false,
    analysis: undefined,
    photoCount: 3,
  };

  it("returns 'query-error' when isError is true and the inspection is finalized", () => {
    expect(resolveAnalysisCardVariant(base).kind).toBe("query-error");
  });

  it("carries user-visible placeholder text so SectionNotGenerated shows the right message", () => {
    const variant = resolveAnalysisCardVariant(base);
    expect(variant.kind).toBe("query-error");
    if (variant.kind === "query-error") {
      expect(variant.placeholder.reason).toMatch(/AI analysis couldn't be retrieved/);
      expect(variant.placeholder.icon).toBe("alert-circle-outline");
      expect(variant.placeholder.tone).toBe("error");
    }
  });

  it("returns 'query-error' regardless of photoCount", () => {
    expect(resolveAnalysisCardVariant({ ...base, photoCount: 0 }).kind).toBe("query-error");
    expect(resolveAnalysisCardVariant({ ...base, photoCount: 100 }).kind).toBe("query-error");
  });

  it("does NOT return 'query-error' when the inspection is not yet finalized", () => {
    const result = resolveAnalysisCardVariant({ ...base, finalized: false });
    expect(result.kind).not.toBe("query-error");
    expect(result.kind).toBe("ai-queued");
  });

  it("does NOT return 'query-error' when isError is false and analysis is available", () => {
    const result = resolveAnalysisCardVariant({
      ...base,
      isError: false,
      isSuccess: true,
      analysis: null,
    });
    expect(result.kind).not.toBe("query-error");
  });
});

describe("resolveAnalysisCardVariant — independent AI states", () => {
  const base: AnalysisQueryState = {
    finalized: true,
    isError: false,
    isSuccess: true,
    analysis: { status: "failed", analysisErrors: 0, findings: [] },
    photoCount: 3,
  };

  it("returns 'ai-failed' for an explicit failed status", () => {
    expect(resolveAnalysisCardVariant(base).kind).toBe("ai-failed");
  });

  it("carries the generic placeholder text when failureReason is absent", () => {
    const variant = resolveAnalysisCardVariant(base);
    if (variant.kind === "ai-failed") {
      expect(variant.placeholder.reason).toMatch(/AI analysis is incomplete/);
      expect(variant.placeholder.icon).toBe("alert-circle-outline");
      expect(variant.placeholder.tone).toBe("error");
    }
  });

  it("uses the server-provided failureReason instead of the generic fallback when present", () => {
    const variant = resolveAnalysisCardVariant({
      ...base,
      analysis: { status: "failed", findings: [], failureReason: "Image resolution too low" },
    });
    expect(variant.kind).toBe("ai-failed");
    if (variant.kind === "ai-failed") {
      expect(variant.placeholder.reason).toBe("Image resolution too low");
    }
  });

  it("falls back to the generic reason when failureReason is null", () => {
    const variant = resolveAnalysisCardVariant({
      ...base,
      analysis: { status: "failed", findings: [], failureReason: null },
    });
    expect(variant.kind).toBe("ai-failed");
    if (variant.kind === "ai-failed") {
      expect(variant.placeholder.reason).toMatch(/AI analysis is incomplete/);
    }
  });

  it("uses the server failureReason verbatim for any failure message", () => {
    const reason = "Service temporarily unavailable — please retry later";
    const variant = resolveAnalysisCardVariant({
      ...base,
      analysis: { status: "skipped", findings: [], failureReason: reason },
    });
    expect(variant.kind).toBe("pipeline-incomplete");
    if (variant.kind === "pipeline-incomplete") {
      expect(variant.placeholder.reason).toBe(reason);
    }
  });

  it("distinguishes queued, analyzing, partial, complete, and failed", () => {
    const expected = new Map([
      ["queued", "ai-queued"],
      ["pending", "ai-queued"],
      ["analyzing", "ai-analyzing"],
      ["processing", "ai-analyzing"],
      ["partial", "ai-partial"],
      ["failed", "ai-failed"],
      ["error", "ai-failed"],
    ]);
    for (const [status, kind] of expected) {
      const result = resolveAnalysisCardVariant({
        ...base,
        analysis: { status, analysisErrors: status === "partial" ? 1 : 0, findings: [] },
      });
      expect(result.kind).toBe(kind);
    }
  });

  it("fails closed for unknown non-complete statuses", () => {
    for (const status of ["skipped", ""]) {
      const result = resolveAnalysisCardVariant({
        ...base,
        analysis: { status, findings: [] },
      });
      expect(result.kind).toBe("pipeline-incomplete");
    }
  });

  it("never represents queued, analyzing, partial, or failed AI as clean", () => {
    for (const status of ["queued", "analyzing", "partial", "failed"]) {
      const result = resolveAnalysisCardVariant({
        ...base,
        analysis: { status, analysisErrors: status === "partial" ? 1 : 0, findings: [] },
      });
      expect(result.kind).not.toBe("clean");
    }
  });

  it("does NOT return 'pipeline-incomplete' when status is 'complete'", () => {
    const result = resolveAnalysisCardVariant({
      ...base,
      analysis: { status: "complete", findings: [] },
    });
    expect(result.kind).not.toBe("pipeline-incomplete");
  });
});

describe("resolveAnalysisCardVariant — analysis-errors-no-findings branch", () => {
  it("returns 'analysis-errors-no-findings' when pipeline completed with errors and zero findings", () => {
    const result = resolveAnalysisCardVariant({
      finalized: true,
      isError: false,
      isSuccess: true,
      analysis: { status: "complete", analysisErrors: 2, findings: [] },
      photoCount: 5,
    });
    expect(result.kind).toBe("analysis-errors-no-findings");
    if (result.kind === "analysis-errors-no-findings") {
      expect(result.errorCount).toBe(2);
      expect(result.placeholder.reason).toMatch(/Analysis completed with 2 errors/);
      expect(result.placeholder.tone).toBe("error");
    }
  });

  it("pluralises correctly for a single error", () => {
    const result = resolveAnalysisCardVariant({
      finalized: true,
      isError: false,
      isSuccess: true,
      analysis: { status: "complete", analysisErrors: 1, findings: [] },
      photoCount: 5,
    });
    if (result.kind === "analysis-errors-no-findings") {
      expect(result.placeholder.reason).toMatch(/1 error[^s]/);
    }
  });

  it("uses the server failureReason instead of the count-based fallback when present", () => {
    const result = resolveAnalysisCardVariant({
      finalized: true,
      isError: false,
      isSuccess: true,
      analysis: {
        status: "complete",
        analysisErrors: 3,
        findings: [],
        failureReason: "Photos could not be processed by the AI analysis service. This is usually a temporary issue — retrying the inspection sync should resolve it.",
      },
      photoCount: 3,
    });
    expect(result.kind).toBe("analysis-errors-no-findings");
    if (result.kind === "analysis-errors-no-findings") {
      expect(result.placeholder.reason).toBe(
        "Photos could not be processed by the AI analysis service. This is usually a temporary issue — retrying the inspection sync should resolve it.",
      );
      // Count-based generic text should NOT appear when the server provides a reason.
      expect(result.placeholder.reason).not.toMatch(/Analysis completed with \d+ error/);
    }
  });

  it("falls back to the count-based generic reason when failureReason is null", () => {
    const result = resolveAnalysisCardVariant({
      finalized: true,
      isError: false,
      isSuccess: true,
      analysis: { status: "complete", analysisErrors: 2, findings: [], failureReason: null },
      photoCount: 5,
    });
    if (result.kind === "analysis-errors-no-findings") {
      expect(result.placeholder.reason).toMatch(/Analysis completed with 2 errors/);
    }
  });

  it("does NOT return 'analysis-errors-no-findings' when findings are present even with errors", () => {
    const result = resolveAnalysisCardVariant({
      finalized: true,
      isError: false,
      isSuccess: true,
      analysis: { status: "complete", analysisErrors: 1, findings: [{}] },
      photoCount: 5,
    });
    expect(result.kind).toBe("findings");
  });
});

describe("resolveAnalysisCardVariant — no-photos branch", () => {
  it("returns 'no-photos' when pipeline completed, zero findings, and zero photos", () => {
    const result = resolveAnalysisCardVariant({
      finalized: true,
      isError: false,
      isSuccess: true,
      analysis: { status: "complete", analysisErrors: 0, findings: [] },
      photoCount: 0,
    });
    expect(result.kind).toBe("no-photos");
    if (result.kind === "no-photos") {
      expect(result.placeholder.reason).toMatch(/No photos were captured/);
      expect(result.placeholder.icon).toBe("camera-outline");
    }
  });
});

describe("resolveAnalysisCardVariant — clean branch", () => {
  it("returns 'clean' when pipeline completed with zero findings but photos exist", () => {
    const result = resolveAnalysisCardVariant({
      finalized: true,
      isError: false,
      isSuccess: true,
      analysis: { status: "complete", analysisErrors: 0, findings: [] },
      photoCount: 4,
    });
    expect(result.kind).toBe("clean");
  });
});

describe("resolveAnalysisCardVariant — findings branch", () => {
  it("returns 'findings' with the correct count when the pipeline completed with results", () => {
    const result = resolveAnalysisCardVariant({
      finalized: true,
      isError: false,
      isSuccess: true,
      analysis: { status: "complete", analysisErrors: 0, findings: [{}, {}, {}] },
      photoCount: 5,
    });
    expect(result.kind).toBe("findings");
    if (result.kind === "findings") {
      expect(result.count).toBe(3);
      expect(result.analysisErrors).toBe(0);
    }
  });

  it("includes the error count when findings are present alongside per-image errors", () => {
    const result = resolveAnalysisCardVariant({
      finalized: true,
      isError: false,
      isSuccess: true,
      analysis: { status: "complete", analysisErrors: 2, findings: [{}, {}] },
      photoCount: 5,
    });
    expect(result.kind).toBe("findings");
    if (result.kind === "findings") {
      expect(result.analysisErrors).toBe(2);
    }
  });
});

describe("resolveAnalysisCardVariant — no-analysis-record branch", () => {
  it("carries the correct placeholder text when no record exists but photos do", () => {
    const result = resolveAnalysisCardVariant({
      finalized: true,
      isError: false,
      isSuccess: true,
      analysis: null,
      photoCount: 3,
    });
    expect(result.kind).toBe("no-analysis-record");
    if (result.kind === "no-analysis-record") {
      expect(result.hasPhotos).toBe(true);
      expect(result.placeholder.reason).toMatch(/AI analysis wasn't generated/);
      expect(result.placeholder.icon).toBe("sparkles-outline");
    }
  });

  it("uses the no-photos message when neither a record nor any photos exist", () => {
    const result = resolveAnalysisCardVariant({
      finalized: true,
      isError: false,
      isSuccess: true,
      analysis: null,
      photoCount: 0,
    });
    expect(result.kind).toBe("no-analysis-record");
    if (result.kind === "no-analysis-record") {
      expect(result.hasPhotos).toBe(false);
      expect(result.placeholder.reason).toMatch(/No photos were captured/);
      expect(result.placeholder.icon).toBe("camera-outline");
    }
  });
});

describe("resolveAnalysisCardVariant — queued and analyzing branches", () => {
  it("returns 'ai-queued' when finalized is false and no analysis exists", () => {
    expect(
      resolveAnalysisCardVariant({
        finalized: false,
        isError: false,
        isSuccess: false,
        analysis: undefined,
        photoCount: 5,
      }).kind,
    ).toBe("ai-queued");
  });

  it("'ai-queued' wins over a query error while evidence is still syncing", () => {
    const result = resolveAnalysisCardVariant({
      finalized: false,
      isError: true,
      isSuccess: false,
      analysis: undefined,
      photoCount: 0,
    });
    expect(result.kind).toBe("ai-queued");
    expect(result.kind).not.toBe("query-error");
  });

  it("returns 'ai-analyzing' when registered evidence is actively processing", () => {
    const result = resolveAnalysisCardVariant({
      finalized: false,
      analysisInProgress: true,
      isError: false,
      isSuccess: true,
      analysis: null,
      photoCount: 3,
    });
    expect(result.kind).toBe("ai-analyzing");
  });

  it("returns 'ai-analyzing' when finalized and neither error nor success", () => {
    const result = resolveAnalysisCardVariant({
      finalized: true,
      isError: false,
      isSuccess: false,
      analysis: undefined,
      photoCount: 3,
    });
    expect(result.kind).toBe("ai-analyzing");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Delivery section — no-methods placeholder (task spec #2)
// ─────────────────────────────────────────────────────────────────────────────

describe("resolveDeliveryCardVariant — no-methods placeholder (task spec #2)", () => {
  it("returns 'no-methods' when the registry has loaded but found zero methods", () => {
    expect(resolveDeliveryCardVariant(true, 0).kind).toBe("no-methods");
  });

  it("carries user-visible placeholder text so SectionNotGenerated shows the right message", () => {
    const variant = resolveDeliveryCardVariant(true, 0);
    expect(variant.kind).toBe("no-methods");
    if (variant.kind === "no-methods") {
      expect(variant.placeholder.reason).toMatch(/No delivery channels are available/);
      expect(variant.placeholder.icon).toBe("alert-circle-outline");
    }
  });

  it("returns 'loading' while the registry probe is still in flight", () => {
    expect(resolveDeliveryCardVariant(false, 0).kind).toBe("loading");
  });

  it("returns 'loading' even if a method count is supplied before the probe finishes", () => {
    // methodsLoaded=false is the authoritative signal; methodCount is ignored.
    expect(resolveDeliveryCardVariant(false, 5).kind).toBe("loading");
  });

  it("does NOT return 'no-methods' when at least one method is available", () => {
    expect(resolveDeliveryCardVariant(true, 1).kind).not.toBe("no-methods");
    expect(resolveDeliveryCardVariant(true, 3).kind).not.toBe("no-methods");
  });

  it("returns 'has-methods' with the correct count when methods are present", () => {
    const result = resolveDeliveryCardVariant(true, 3);
    expect(result.kind).toBe("has-methods");
    if (result.kind === "has-methods") {
      expect(result.count).toBe(3);
    }
  });

  it("boundary: exactly one method is 'has-methods', not 'no-methods'", () => {
    expect(resolveDeliveryCardVariant(true, 1).kind).toBe("has-methods");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Sync status card — "Sync status unavailable" when phase is null
//    (task spec #3)
// ─────────────────────────────────────────────────────────────────────────────

describe("resolveSyncStatusVariant — 'Sync status unavailable' when phase is null (task spec #3)", () => {
  it("returns 'unavailable' when phase is null", () => {
    expect(resolveSyncStatusVariant(null).kind).toBe("unavailable");
  });

  it("carries the exact label text that the card renders ('Sync status unavailable')", () => {
    const variant = resolveSyncStatusVariant(null);
    expect(variant.kind).toBe("unavailable");
    if (variant.kind === "unavailable") {
      expect(variant.label).toBe(SYNC_STATUS_UNAVAILABLE_LABEL);
      expect(variant.label).toBe("Sync status unavailable");
    }
  });

  it("does NOT return 'unavailable' for any known phase value", () => {
    for (const phase of ["synced", "syncing", "waiting", "failed"] as const) {
      expect(resolveSyncStatusVariant(phase).kind).not.toBe("unavailable");
    }
  });

  it("returns 'phase' with the correct phase for 'synced'", () => {
    const result = resolveSyncStatusVariant("synced");
    expect(result.kind).toBe("phase");
    if (result.kind === "phase") expect(result.phase).toBe("synced");
  });

  it("returns 'phase' with the correct phase for 'syncing'", () => {
    const result = resolveSyncStatusVariant("syncing");
    expect(result.kind).toBe("phase");
    if (result.kind === "phase") expect(result.phase).toBe("syncing");
  });

  it("returns 'phase' with the correct phase for 'waiting'", () => {
    const result = resolveSyncStatusVariant("waiting");
    expect(result.kind).toBe("phase");
    if (result.kind === "phase") expect(result.phase).toBe("waiting");
  });

  it("returns 'phase' with the correct phase for 'failed'", () => {
    const result = resolveSyncStatusVariant("failed");
    expect(result.kind).toBe("phase");
    if (result.kind === "phase") expect(result.phase).toBe("failed");
  });
});
