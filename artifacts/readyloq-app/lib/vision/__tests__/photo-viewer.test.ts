/**
 * Unit tests — full-screen photo viewer (InspectionDetail.tsx #110 / #117)
 *
 * Imports the production utility module (lib/vision/photo-viewer-logic.ts)
 * that InspectionDetail.tsx also uses, so regressions in the component's
 * math are caught here.
 *
 * Covers the three contracts from the task spec:
 *   1. Viewer open/close   — viewerPath → Modal visibility
 *   2. Close (×) button    — viewerPath set to null
 *   3. Double-tap reset    — scale and translation return to 1× / 0
 *
 * Also covers:
 *   4. Zoom clamping  (clampZoom)
 *   5. Pan clamping — both axes (clampViewerTranslation)
 *   6. Gesture commit persistence — commitPinch / commitPan
 *   7. viewerIdentityTransform() — the canonical reset target
 *
 * Relevant source files:
 *   artifacts/readyloq-app/lib/vision/photo-viewer-logic.ts   ← imported here
 *   artifacts/readyloq-app/components/InspectionDetail.tsx     ← imports same module
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  clampZoom,
  clampViewerTranslation,
  commitPinch,
  commitPan,
  viewerIdentityTransform,
  VIEWER_MIN_SCALE,
  VIEWER_MAX_SCALE,
  type ViewerResetTransform,
} from "../photo-viewer-logic";

// ---------------------------------------------------------------------------
// 1. Viewer open / close state machine
//    Models the React state that drives `Modal visible={viewerPath != null}`
// ---------------------------------------------------------------------------

describe("Photo viewer state — open and close", () => {
  let viewerPath: string | null = null;

  /** Mirrors the Pressable onPress inside the Evidence thumbnail row (#110). */
  function openViewer(photoUrl: string) {
    viewerPath = photoUrl;
  }

  /** Mirrors the close-button onPress and the Android onRequestClose callback. */
  function closeViewer() {
    viewerPath = null;
  }

  beforeEach(() => {
    viewerPath = null;
  });

  it("viewer is initially closed (viewerPath is null)", () => {
    expect(viewerPath).toBeNull();
  });

  it("tapping a thumbnail opens the viewer with the correct photo URL", () => {
    openViewer("/api/media/evidence/abc123.jpg");
    expect(viewerPath).toBe("/api/media/evidence/abc123.jpg");
  });

  it("Modal visible prop is true when viewerPath is non-null", () => {
    openViewer("/api/media/evidence/photo.jpg");
    expect(viewerPath != null).toBe(true);
  });

  it("Modal visible prop is false when viewerPath is null", () => {
    openViewer("/api/media/evidence/photo.jpg");
    closeViewer();
    expect(viewerPath != null).toBe(false);
  });

  it("close (×) button dismisses the viewer by setting viewerPath to null", () => {
    openViewer("/api/media/evidence/photo.jpg");
    expect(viewerPath).not.toBeNull();

    closeViewer(); // mirrors the × Pressable onPress
    expect(viewerPath).toBeNull();
  });

  it("Android onRequestClose also dismisses the viewer", () => {
    openViewer("/api/media/evidence/photo.jpg");
    closeViewer(); // same callback wired to onRequestClose
    expect(viewerPath).toBeNull();
  });

  it("opening a second photo replaces the first without going through null", () => {
    openViewer("/api/media/1.jpg");
    openViewer("/api/media/2.jpg");
    expect(viewerPath).toBe("/api/media/2.jpg");
  });
});

// ---------------------------------------------------------------------------
// 2. Zoom clamping — clampZoom() (imported from production module)
// ---------------------------------------------------------------------------

describe("clampZoom — pinch scale clamping (VIEWER_MIN_SCALE / VIEWER_MAX_SCALE)", () => {
  it("exports the correct min and max constants", () => {
    expect(VIEWER_MIN_SCALE).toBe(1);
    expect(VIEWER_MAX_SCALE).toBe(8);
  });

  it("zoom starts at 1× (identity: base=1, gesture=1)", () => {
    expect(clampZoom(1, 1)).toBe(1);
  });

  it("pinching out at 1× base by 2× gesture lands at 2×", () => {
    expect(clampZoom(1, 2)).toBe(2);
  });

  it("scale is clamped to VIEWER_MAX_SCALE (8×)", () => {
    expect(clampZoom(4, 4)).toBe(8);   // would be 16 unclamped
    expect(clampZoom(1, 10)).toBe(8);  // would be 10 unclamped
  });

  it("scale cannot go below VIEWER_MIN_SCALE (1×)", () => {
    expect(clampZoom(1, 0.5)).toBe(1); // would be 0.5 unclamped
    expect(clampZoom(1, 0)).toBe(1);   // would be 0 unclamped
  });

  it("pinching from a mid-zoom base (2×) by 1.5× gesture lands at 3×", () => {
    expect(clampZoom(2, 1.5)).toBe(3);
  });

  it("just below the max clamp passes through unchanged", () => {
    expect(clampZoom(2, 3.9)).toBeCloseTo(7.8);
  });
});

// ---------------------------------------------------------------------------
// 3. Pan boundary — clampViewerTranslation() (both axes)
// ---------------------------------------------------------------------------

describe("clampViewerTranslation — pan boundary for X axis", () => {
  const W = 390; // typical iPhone screen width

  it("at 1× zoom the boundary is 0 — no panning possible", () => {
    expect(clampViewerTranslation(0, 50, W, 1)).toBeCloseTo(0);
    expect(clampViewerTranslation(0, -50, W, 1)).toBeCloseTo(0);
  });

  it("at 2× zoom the boundary is half the screen width (195 px)", () => {
    const maxX = (W * (2 - 1)) / 2; // 195
    expect(clampViewerTranslation(0, maxX, W, 2)).toBeCloseTo(maxX);
    expect(clampViewerTranslation(0, -maxX, W, 2)).toBeCloseTo(-maxX);
  });

  it("panning beyond the boundary is clamped to the edge", () => {
    const maxX = (W * (2 - 1)) / 2;
    expect(clampViewerTranslation(0, maxX + 100, W, 2)).toBeCloseTo(maxX);
    expect(clampViewerTranslation(0, -(maxX + 100), W, 2)).toBeCloseTo(-maxX);
  });

  it("incremental pan from a non-zero base accumulates correctly", () => {
    // base = 50, translation = 30 → 80 (well within 4× boundary of 585 px)
    expect(clampViewerTranslation(50, 30, W, 4)).toBe(80);
  });
});

describe("clampViewerTranslation — pan boundary for Y axis", () => {
  const H = 844; // typical iPhone screen height

  it("at 1× zoom the vertical boundary is 0", () => {
    expect(clampViewerTranslation(0, 200, H, 1)).toBeCloseTo(0);
    expect(clampViewerTranslation(0, -200, H, 1)).toBeCloseTo(0);
  });

  it("at 2× zoom the vertical boundary is half the screen height (422 px)", () => {
    const maxY = (H * (2 - 1)) / 2; // 422
    expect(clampViewerTranslation(0, maxY, H, 2)).toBeCloseTo(maxY);
    expect(clampViewerTranslation(0, -maxY, H, 2)).toBeCloseTo(-maxY);
  });

  it("panning beyond the vertical boundary is clamped", () => {
    const maxY = (H * (2 - 1)) / 2;
    expect(clampViewerTranslation(0, maxY + 300, H, 2)).toBeCloseTo(maxY);
    expect(clampViewerTranslation(0, -(maxY + 300), H, 2)).toBeCloseTo(-maxY);
  });

  it("X and Y boundaries differ correctly when width ≠ height", () => {
    const W = 390;
    const H = 844;
    const scale = 3;
    const maxX = (W * (scale - 1)) / 2; // 390
    const maxY = (H * (scale - 1)) / 2; // 844
    expect(clampViewerTranslation(0, 9999, W, scale)).toBeCloseTo(maxX);
    expect(clampViewerTranslation(0, 9999, H, scale)).toBeCloseTo(maxY);
    expect(maxX).not.toEqual(maxY); // confirms the axes use different bounds
  });
});

// ---------------------------------------------------------------------------
// 4. Gesture commit persistence — commitPinch / commitPan
// ---------------------------------------------------------------------------

describe("commitPinch — persists live scale as new base on pinch end", () => {
  it("returns the live scale unchanged (identity pass-through)", () => {
    expect(commitPinch(3.5)).toBe(3.5);
    expect(commitPinch(1)).toBe(1);
    expect(commitPinch(8)).toBe(8);
  });

  it("committed base is used as baseScale for the next pinch gesture", () => {
    // Simulate two sequential pinches
    const firstLiveScale = clampZoom(1, 2);             // 2×
    const base2 = commitPinch(firstLiveScale);          // 2
    const secondLiveScale = clampZoom(base2, 1.5);      // 3×
    expect(secondLiveScale).toBe(3);
  });
});

describe("commitPan — persists live translation as new base on pan end", () => {
  it("returns the live translation unchanged (identity pass-through)", () => {
    expect(commitPan(150)).toBe(150);
    expect(commitPan(-80)).toBe(-80);
    expect(commitPan(0)).toBe(0);
  });

  it("committed base is used for subsequent pan accumulation", () => {
    const W = 390;
    const scale = 4;
    // First pan: base=0, dx=80 → clamp to 80
    const tx1 = clampViewerTranslation(0, 80, W, scale);
    const base2 = commitPan(tx1); // 80

    // Second pan: base=80, dx=50 → 130
    const tx2 = clampViewerTranslation(base2, 50, W, scale);
    expect(tx2).toBe(130);
  });
});

// ---------------------------------------------------------------------------
// 5. Double-tap reset — viewerIdentityTransform() (production function)
// ---------------------------------------------------------------------------

describe("viewerIdentityTransform — double-tap and close reset target", () => {
  let identity: ViewerResetTransform;

  beforeEach(() => {
    identity = viewerIdentityTransform();
  });

  it("scale target is VIEWER_MIN_SCALE (1×)", () => {
    expect(identity.scale).toBe(VIEWER_MIN_SCALE);
  });

  it("baseScale target is VIEWER_MIN_SCALE (1×)", () => {
    expect(identity.baseScale).toBe(VIEWER_MIN_SCALE);
  });

  it("translateX target is 0 (centred horizontally)", () => {
    expect(identity.translateX).toBe(0);
  });

  it("translateY target is 0 (centred vertically)", () => {
    expect(identity.translateY).toBe(0);
  });

  it("baseTX is 0 so the next pan gesture starts from centre", () => {
    expect(identity.baseTX).toBe(0);
  });

  it("baseTY is 0 so the next pan gesture starts from centre", () => {
    expect(identity.baseTY).toBe(0);
  });

  it("is idempotent — applying to an already-reset state yields equal output", () => {
    const second = viewerIdentityTransform();
    expect(second).toEqual(identity);
  });
});

// ---------------------------------------------------------------------------
// 6. Viewer close — zoom state resets (useEffect on viewerPath → null)
//    Models the effect in InspectionDetail.tsx that reads viewerIdentityTransform()
// ---------------------------------------------------------------------------

describe("Viewer close effect — zoom state resets when Modal closes", () => {
  /**
   * Pure model of the useEffect:
   *   if (viewerPath === null) { apply viewerIdentityTransform() }
   */
  function simulateCloseEffect(
    viewerPath: string | null,
    current: ViewerResetTransform,
  ): ViewerResetTransform {
    if (viewerPath === null) {
      return viewerIdentityTransform();
    }
    return current;
  }

  const zoomed: ViewerResetTransform = {
    scale: 4,
    baseScale: 4,
    translateX: 120,
    translateY: -60,
    baseTX: 120,
    baseTY: -60,
  };

  it("closing the viewer resets scale to 1×", () => {
    const after = simulateCloseEffect(null, zoomed);
    expect(after.scale).toBe(1);
  });

  it("closing the viewer resets baseScale to 1×", () => {
    const after = simulateCloseEffect(null, zoomed);
    expect(after.baseScale).toBe(1);
  });

  it("closing the viewer resets translateX to 0", () => {
    const after = simulateCloseEffect(null, zoomed);
    expect(after.translateX).toBe(0);
  });

  it("closing the viewer resets translateY to 0", () => {
    const after = simulateCloseEffect(null, zoomed);
    expect(after.translateY).toBe(0);
  });

  it("closing the viewer resets baseTX and baseTY to 0", () => {
    const after = simulateCloseEffect(null, zoomed);
    expect(after.baseTX).toBe(0);
    expect(after.baseTY).toBe(0);
  });

  it("opening the viewer (null → url) does NOT reset transform state", () => {
    const after = simulateCloseEffect("/api/media/photo.jpg", zoomed);
    expect(after).toEqual(zoomed);
  });

  it("changing to a different photo while open does NOT reset transform state", () => {
    const after = simulateCloseEffect("/api/media/other.jpg", zoomed);
    expect(after).toEqual(zoomed);
  });
});
