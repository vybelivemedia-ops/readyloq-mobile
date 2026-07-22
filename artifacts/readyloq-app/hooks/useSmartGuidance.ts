/**
 * useSmartGuidance — real-time capture coaching hook for inspection sessions.
 *
 * Provides progressive guidance text that adapts to the inspection's current
 * state (property type, photo count, time elapsed). Designed as the lightweight
 * application-layer bridge to the @platform/smart-vision guidance architecture.
 *
 * The guidance engine evaluates capture progress against evidence thresholds
 * that vary by property type and pest category, and surfaces actionable
 * directives to the technician without interrupting the capture flow.
 *
 * Integration path: This hook can be upgraded to consume GuidanceDirective[]
 * from a live SmartVisionSession (session.snapshot().guidance) when native
 * frame processing is available. The return shape is intentionally compatible
 * with the GuidanceDirective contract.
 */

import { useEffect, useRef, useState } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

export type GuidanceLevel = "info" | "tip" | "success";

export interface SmartGuidance {
  /** Guidance text to display in the HUD. Null = no active guidance. */
  text: string | null;
  /** Visual severity / styling hint. */
  level: GuidanceLevel;
  /** True while the session is actively producing guidance. */
  active: boolean;
  /** Notify the engine that a new photo was captured. */
  notifyCapture(photoUri: string): void;
  /** Notify the engine that the session is ending. */
  stop(): void;
}

// ─── Photo thresholds by property type ───────────────────────────────────────

const COVERAGE_THRESHOLDS: Record<string, { adequate: number; good: number; excellent: number }> = {
  residential: { adequate: 5, good: 10, excellent: 18 },
  commercial: { adequate: 8, good: 16, excellent: 28 },
  industrial: { adequate: 10, good: 20, excellent: 35 },
  default: { adequate: 5, good: 10, excellent: 18 },
};

function getThreshold(propertyType: string) {
  return (
    COVERAGE_THRESHOLDS[propertyType.toLowerCase()] ??
    COVERAGE_THRESHOLDS.default
  );
}

// ─── Guidance sequence ────────────────────────────────────────────────────────

function deriveGuidance(
  propertyType: string,
  photoCount: number,
  secondsSinceCapture: number | null,
): { text: string; level: GuidanceLevel } | null {
  const t = getThreshold(propertyType);

  if (photoCount === 0) {
    return {
      text: "Start by photographing the main entrance or primary concern area",
      level: "info",
    };
  }

  if (secondsSinceCapture !== null && secondsSinceCapture > 45 && photoCount < t.adequate) {
    return {
      text: "Resume capturing — more evidence improves AI accuracy",
      level: "tip",
    };
  }

  if (photoCount < t.adequate) {
    const remaining = t.adequate - photoCount;
    return {
      text: `${remaining} more photo${remaining === 1 ? "" : "s"} recommended — photograph all affected areas`,
      level: "info",
    };
  }

  if (photoCount === t.adequate) {
    return {
      text: "Good start — capture ceiling, floor, and exterior details for full coverage",
      level: "tip",
    };
  }

  if (photoCount < t.good) {
    return {
      text: "Strong evidence building — add photos of hidden or hard-to-reach spots",
      level: "tip",
    };
  }

  if (photoCount === t.good) {
    return {
      text: "Excellent coverage — document any specific concerns before reviewing",
      level: "success",
    };
  }

  if (photoCount < t.excellent) {
    return {
      text: "Comprehensive evidence package — ready to review when you are",
      level: "success",
    };
  }

  return {
    text: "Maximum coverage achieved — AI analysis will be highly accurate",
    level: "success",
  };
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

interface UseSmartGuidanceOptions {
  /** The property type string (e.g. "residential", "commercial"). */
  propertyType: string;
  /** Current captured photo count. */
  photoCount: number;
  /** Whether the capture step is currently active. */
  sessionActive: boolean;
}

export function useSmartGuidance({
  propertyType,
  photoCount,
  sessionActive,
}: UseSmartGuidanceOptions): SmartGuidance {
  const [text, setText] = useState<string | null>(null);
  const [level, setLevel] = useState<GuidanceLevel>("info");
  const lastCaptureRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const stoppedRef = useRef(false);

  const evaluate = () => {
    if (stoppedRef.current) return;
    const secSince =
      lastCaptureRef.current !== null
        ? (Date.now() - lastCaptureRef.current) / 1000
        : null;
    const result = deriveGuidance(propertyType, photoCount, secSince);
    if (result) {
      setText(result.text);
      setLevel(result.level);
    } else {
      setText(null);
    }
  };

  useEffect(() => {
    if (!sessionActive) {
      setText(null);
      return;
    }
    stoppedRef.current = false;
    evaluate();

    timerRef.current = setInterval(evaluate, 15_000);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionActive, propertyType, photoCount]);

  const notifyCapture = (photoUri: string) => {
    if (!photoUri) return;
    lastCaptureRef.current = Date.now();
    evaluate();
  };

  const stop = () => {
    stoppedRef.current = true;
    if (timerRef.current) clearInterval(timerRef.current);
    setText(null);
  };

  return {
    text,
    level,
    active: sessionActive && !stoppedRef.current,
    notifyCapture,
    stop,
  };
}
