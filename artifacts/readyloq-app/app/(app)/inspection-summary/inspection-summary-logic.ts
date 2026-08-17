/**
 * Pure decision functions that drive the conditional rendering in [localId].tsx.
 *
 * The component imports and calls these functions so tests exercise the same
 * code path the UI uses.  Keep this file free of React imports.
 *
 * Each variant that maps to a `SectionNotGenerated` placeholder carries the
 * `reason`, `icon`, and `tone` props the component will pass through verbatim.
 * Tests can assert these strings to confirm the correct message appears.
 */

import type { Ionicons } from "@expo/vector-icons";

// ─── Shared placeholder-prop types ──────────────────────────────────────────

export type PlaceholderTone = "muted" | "error";

export interface PlaceholderProps {
  reason: string;
  icon: keyof typeof Ionicons.glyphMap;
  tone?: PlaceholderTone;
}

// ─── AI findings card ────────────────────────────────────────────────────────

export type AnalysisCardVariant =
  /** Inspection not yet uploaded; the sync-pending card is shown instead. */
  | { kind: "not-finalized" }
  /** analysisQ still in flight. */
  | { kind: "loading" }
  /**
   * HTTP-level failure: network error, 500, auth.
   * → render SectionNotGenerated with these props.
   */
  | { kind: "query-error"; placeholder: PlaceholderProps }
  /**
   * Analysis record returned but the pipeline didn't finish (status != "complete").
   * → render SectionNotGenerated with these props.
   */
  | { kind: "pipeline-incomplete"; placeholder: PlaceholderProps }
  /**
   * Pipeline completed with per-image errors and zero usable findings.
   * → render SectionNotGenerated with these props.
   */
  | { kind: "analysis-errors-no-findings"; errorCount: number; placeholder: PlaceholderProps }
  /**
   * No photos captured — AI had nothing to work with.
   * → render SectionNotGenerated with these props.
   */
  | { kind: "no-photos"; placeholder: PlaceholderProps }
  /** Pipeline completed with zero findings and photos present (clean inspection). */
  | { kind: "clean" }
  /**
   * Pipeline completed with findings.
   * `analysisErrors` may be > 0 for a partial-failure warning shown below the list.
   */
  | { kind: "findings"; count: number; analysisErrors: number }
  /**
   * Server finalized but produced no analysis record at all.
   * → render SectionNotGenerated with these props.
   */
  | { kind: "no-analysis-record"; hasPhotos: boolean; placeholder: PlaceholderProps };

export interface AnalysisQueryState {
  finalized: boolean;
  isError: boolean;
  isSuccess: boolean;
  /** Undefined while loading, null when the server produced no record. */
  analysis:
    | {
        status: string;
        analysisErrors?: number | null;
        findings?: Array<unknown>;
        /** Server-provided reason the analysis was skipped or failed. */
        failureReason?: string | null;
      }
    | null
    | undefined;
  photoCount: number;
}

/**
 * Maps the async query state to the variant the component should render.
 * Mirrors the conditional chain at lines 320–415 of [localId].tsx.
 */
export function resolveAnalysisCardVariant(s: AnalysisQueryState): AnalysisCardVariant {
  if (!s.finalized) return { kind: "not-finalized" };

  if (s.isError) {
    return {
      kind: "query-error",
      placeholder: {
        reason:
          "AI analysis couldn't be retrieved. This may be a temporary issue — try viewing the full inspection or contact support if it persists.",
        icon: "alert-circle-outline",
        tone: "error",
      },
    };
  }

  if (s.isSuccess) {
    const analysis = s.analysis;

    if (analysis != null) {
      if (analysis.status !== "complete") {
        const genericReason =
          "AI analysis didn't complete for this inspection. The server may have skipped it or encountered an error — no action needed.";
        return {
          kind: "pipeline-incomplete",
          placeholder: {
            reason: analysis.failureReason ?? genericReason,
            icon: "alert-circle-outline",
            tone: "error",
          },
        };
      }

      const findings = analysis.findings ?? [];
      const errCount = analysis.analysisErrors ?? 0;

      if (errCount > 0 && findings.length === 0) {
        const genericErrorReason = `Analysis completed with ${errCount} error${errCount !== 1 ? "s" : ""}. Some or all photos couldn't be processed — check the full inspection for details.`;
        return {
          kind: "analysis-errors-no-findings",
          errorCount: errCount,
          placeholder: {
            reason: analysis.failureReason ?? genericErrorReason,
            icon: "alert-circle-outline",
            tone: "error",
          },
        };
      }

      if (findings.length === 0 && s.photoCount === 0) {
        return {
          kind: "no-photos",
          placeholder: {
            reason: "No photos were captured for this inspection, so AI analysis was skipped.",
            icon: "camera-outline",
          },
        };
      }

      if (findings.length === 0) return { kind: "clean" };

      return { kind: "findings", count: findings.length, analysisErrors: errCount };
    }

    // analysis === null → server produced no record at all
    const hasPhotos = s.photoCount > 0;
    return {
      kind: "no-analysis-record",
      hasPhotos,
      placeholder: hasPhotos
        ? {
            reason:
              "AI analysis wasn't generated for this inspection. This can happen when photos couldn't be processed — no action is needed.",
            icon: "sparkles-outline",
          }
        : {
            reason: "No photos were captured for this inspection, so AI analysis was skipped.",
            icon: "camera-outline",
          },
    };
  }

  // isError=false, isSuccess=false → still loading
  return { kind: "loading" };
}

// ─── Delivery section ────────────────────────────────────────────────────────

export type DeliveryCardVariant =
  /** Registry not yet probed — render nothing to avoid a flash of "unavailable". */
  | { kind: "loading" }
  /** Registry resolved with zero methods → render SectionNotGenerated. */
  | { kind: "no-methods"; placeholder: PlaceholderProps }
  /** At least one method available → render the method buttons. */
  | { kind: "has-methods"; count: number };

/**
 * Maps delivery-method registry state to the variant the component renders.
 * Mirrors DeliverySection lines 774–786 of [localId].tsx.
 */
export function resolveDeliveryCardVariant(
  methodsLoaded: boolean,
  methodCount: number,
): DeliveryCardVariant {
  if (!methodsLoaded) return { kind: "loading" };
  if (methodCount === 0) {
    return {
      kind: "no-methods",
      placeholder: {
        reason: "No delivery channels are available on this device. Try again after the app updates.",
        icon: "alert-circle-outline",
      },
    };
  }
  return { kind: "has-methods", count: methodCount };
}

// ─── Sync status card ────────────────────────────────────────────────────────

export type LocalSyncPhase = "synced" | "syncing" | "waiting" | "failed";

export type SyncStatusVariant =
  /** phase is null → show "Sync status unavailable". */
  | { kind: "unavailable"; label: string }
  /** A known sync phase. */
  | { kind: "phase"; phase: LocalSyncPhase };

/** Text shown in the unavailable card. Exported for test assertions. */
export const SYNC_STATUS_UNAVAILABLE_LABEL = "Sync status unavailable";

/**
 * Maps the sync phase to the card variant.
 * Mirrors SyncStatusCard lines 1093–1102 of [localId].tsx.
 */
export function resolveSyncStatusVariant(phase: LocalSyncPhase | null): SyncStatusVariant {
  if (phase === null) return { kind: "unavailable", label: SYNC_STATUS_UNAVAILABLE_LABEL };
  return { kind: "phase", phase };
}
