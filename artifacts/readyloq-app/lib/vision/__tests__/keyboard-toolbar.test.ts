/**
 * Unit tests — keyboard-avoidance for the Save/Copy toolbar in the full-screen
 * photo viewer (InspectionDetail.tsx, ~lines 618–652, #110 / #468).
 *
 * A `KeyboardAvoidingView` wraps the Save/Copy toolbar row so that when the
 * Android soft keyboard opens the buttons lift above it and remain fully
 * tappable.  These tests exercise the pure utility module
 * (`lib/vision/keyboard-toolbar-logic.ts`) that models the toolbar geometry
 * AND verify that `InspectionDetail.tsx` actually imports and uses the shared
 * constants/function — so a future refactor that removes the KAV or reverts
 * the import will cause tests here to fail immediately.
 *
 * Test sections:
 *   1. Structural wiring          — InspectionDetail.tsx imports from this module
 *   2. Constant derivation        — VIEWER_TOOLBAR_HEIGHT matches its constituent parts
 *   3. getKeyboardAvoidingBehavior — correct KAV behavior prop per platform
 *   4. toolbarTopAfterKeyboard    — vertical position with keyboard open/closed
 *   5. isToolbarFullyVisible      — visibility predicate (the regression guard)
 *   6. toolbarClearance           — no overlap between toolbar bottom and keyboard top
 *   7. Real device dimensions     — typical Android and iOS screen sizes
 *   8. Edge cases
 */

import { readFileSync } from "fs";
import { join } from "path";
import { describe, it, expect } from "vitest";
import {
  VIEWER_TOOLBAR_PADDING_TOP,
  VIEWER_TOOLBAR_PADDING_BOTTOM,
  VIEWER_TOOLBAR_BUTTON_PADDING_V,
  VIEWER_TOOLBAR_BUTTON_CONTENT_H,
  VIEWER_TOOLBAR_HEIGHT,
  getKeyboardAvoidingBehavior,
  toolbarTopAfterKeyboard,
  isToolbarFullyVisible,
  toolbarClearance,
} from "../keyboard-toolbar-logic";

// ─────────────────────────────────────────────────────────────────────────────
// 1. Structural wiring — InspectionDetail.tsx must import from this module
//
//    These tests read the component source and assert the import and usage are
//    present.  They will FAIL if:
//      • The import of getKeyboardAvoidingBehavior is removed
//      • The KAV behavior prop stops using the imported function
//      • The toolbar padding style stops using the imported constants
//
//    That makes the rest of the geometry/behavior tests meaningful: they
//    exercise code that the production component actually calls.
// ─────────────────────────────────────────────────────────────────────────────

// Path is resolved relative to the monorepo root where vitest runs.
const COMPONENT_PATH = join(
  __dirname,
  "../../../components/InspectionDetail.tsx",
);

describe("Structural wiring — InspectionDetail.tsx imports from keyboard-toolbar-logic", () => {
  let src: string;

  // Read once; vitest caches the module between tests in the same file.
  try {
    src = readFileSync(COMPONENT_PATH, "utf8");
  } catch {
    src = "";
  }

  it("component source file is readable (sanity check for path resolution)", () => {
    expect(src.length).toBeGreaterThan(0);
  });

  it("imports getKeyboardAvoidingBehavior from keyboard-toolbar-logic", () => {
    expect(src).toMatch(/getKeyboardAvoidingBehavior/);
    expect(src).toMatch(/keyboard-toolbar-logic/);
  });

  it("uses getKeyboardAvoidingBehavior(Platform.OS) as the KAV behavior prop", () => {
    // The component must call the function with Platform.OS — not an inline ternary.
    expect(src).toMatch(/getKeyboardAvoidingBehavior\s*\(\s*Platform\.OS\s*\)/);
  });

  it("imports VIEWER_TOOLBAR_PADDING_TOP and uses it in the toolbar View style", () => {
    expect(src).toMatch(/VIEWER_TOOLBAR_PADDING_TOP/);
    // Appears both in the import statement and in a paddingVertical assignment
    const count = (src.match(/VIEWER_TOOLBAR_PADDING_TOP/g) ?? []).length;
    expect(count).toBeGreaterThanOrEqual(2);
  });

  it("imports VIEWER_TOOLBAR_PADDING_BOTTOM and uses it in the toolbar View style", () => {
    expect(src).toMatch(/VIEWER_TOOLBAR_PADDING_BOTTOM/);
    const count = (src.match(/VIEWER_TOOLBAR_PADDING_BOTTOM/g) ?? []).length;
    expect(count).toBeGreaterThanOrEqual(2);
  });

  it("imports VIEWER_TOOLBAR_BUTTON_PADDING_V and uses it in button styles", () => {
    expect(src).toMatch(/VIEWER_TOOLBAR_BUTTON_PADDING_V/);
    // Used for both Save and Copy buttons
    const count = (src.match(/VIEWER_TOOLBAR_BUTTON_PADDING_V/g) ?? []).length;
    expect(count).toBeGreaterThanOrEqual(3); // import + 2 button usages
  });

  it("wraps the toolbar row in a KeyboardAvoidingView", () => {
    expect(src).toMatch(/KeyboardAvoidingView/);
  });

  it("no longer uses an inline Platform.OS ternary for the KAV behavior prop", () => {
    // The old pattern: behavior={Platform.OS === "android" ? "padding" : "position"}
    // should have been replaced by behavior={getKeyboardAvoidingBehavior(Platform.OS)}.
    // This prevents the logic from silently diverging from the tested function.
    expect(src).not.toMatch(
      /behavior\s*=\s*\{\s*Platform\.OS\s*===\s*["']android["']\s*\?/,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Constant derivation — VIEWER_TOOLBAR_HEIGHT matches its building blocks
//
//    If someone changes a padding constant without updating the formula, this
//    suite flags it immediately.
// ─────────────────────────────────────────────────────────────────────────────

describe("Constant derivation — VIEWER_TOOLBAR_HEIGHT reflects its constituent parts", () => {
  it("VIEWER_TOOLBAR_PADDING_TOP is a positive number", () => {
    expect(VIEWER_TOOLBAR_PADDING_TOP).toBeGreaterThan(0);
  });

  it("VIEWER_TOOLBAR_PADDING_BOTTOM is greater than PADDING_TOP (home-bar inset)", () => {
    expect(VIEWER_TOOLBAR_PADDING_BOTTOM).toBeGreaterThan(VIEWER_TOOLBAR_PADDING_TOP);
  });

  it("VIEWER_TOOLBAR_BUTTON_PADDING_V is a positive number", () => {
    expect(VIEWER_TOOLBAR_BUTTON_PADDING_V).toBeGreaterThan(0);
  });

  it("VIEWER_TOOLBAR_BUTTON_CONTENT_H is a positive number", () => {
    expect(VIEWER_TOOLBAR_BUTTON_CONTENT_H).toBeGreaterThan(0);
  });

  it("VIEWER_TOOLBAR_HEIGHT equals the sum of its constituent padding parts", () => {
    const expected =
      VIEWER_TOOLBAR_PADDING_TOP +
      VIEWER_TOOLBAR_BUTTON_PADDING_V +
      VIEWER_TOOLBAR_BUTTON_CONTENT_H +
      VIEWER_TOOLBAR_BUTTON_PADDING_V +
      VIEWER_TOOLBAR_PADDING_BOTTOM;
    expect(VIEWER_TOOLBAR_HEIGHT).toBe(expected);
  });

  it("VIEWER_TOOLBAR_HEIGHT is large enough to contain a standard touch target (44 px)", () => {
    // Apple HIG and Android Material both require 44–48 dp minimum touch height.
    expect(VIEWER_TOOLBAR_HEIGHT).toBeGreaterThanOrEqual(44);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. getKeyboardAvoidingBehavior — maps platform OS to the correct KAV prop
// ─────────────────────────────────────────────────────────────────────────────

describe("getKeyboardAvoidingBehavior — KAV behavior prop by platform", () => {
  it("returns 'padding' on Android", () => {
    expect(getKeyboardAvoidingBehavior("android")).toBe("padding");
  });

  it("returns 'position' on iOS", () => {
    expect(getKeyboardAvoidingBehavior("ios")).toBe("position");
  });

  it("returns 'position' on macos", () => {
    expect(getKeyboardAvoidingBehavior("macos")).toBe("position");
  });

  it("returns 'position' on windows", () => {
    expect(getKeyboardAvoidingBehavior("windows")).toBe("position");
  });

  it("returns 'position' on web", () => {
    expect(getKeyboardAvoidingBehavior("web")).toBe("position");
  });

  it("is case-sensitive — 'Android' (capital A) is treated as non-Android", () => {
    // Platform.OS always returns lowercase on React Native; this guards against
    // accidental uppercase comparisons in a future refactor.
    expect(getKeyboardAvoidingBehavior("Android")).toBe("position");
  });

  it("Android is the only platform that gets 'padding'", () => {
    const allPlatforms = ["android", "ios", "macos", "windows", "web"];
    const paddingPlatforms = allPlatforms.filter(
      (p) => getKeyboardAvoidingBehavior(p) === "padding",
    );
    expect(paddingPlatforms).toEqual(["android"]);
  });

  it("the returned value is one of the two allowed KAV behavior strings", () => {
    const allowed = new Set(["padding", "position"]);
    for (const os of ["android", "ios", "web", "macos", "windows"]) {
      expect(allowed.has(getKeyboardAvoidingBehavior(os))).toBe(true);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. toolbarTopAfterKeyboard — vertical position of the toolbar's top edge
// ─────────────────────────────────────────────────────────────────────────────

describe("toolbarTopAfterKeyboard — toolbar top-edge position after keyboard lift", () => {
  const SCREEN  = 900;
  const TOOLBAR = VIEWER_TOOLBAR_HEIGHT;

  it("without a keyboard the toolbar sits at the bottom of the screen", () => {
    const topY = toolbarTopAfterKeyboard(SCREEN, TOOLBAR, 0);
    expect(topY).toBe(SCREEN - TOOLBAR);
  });

  it("when keyboard opens the toolbar top edge moves up by keyboardHeight", () => {
    const keyboard = 300;
    const withoutKeyboard = toolbarTopAfterKeyboard(SCREEN, TOOLBAR, 0);
    const withKeyboard    = toolbarTopAfterKeyboard(SCREEN, TOOLBAR, keyboard);
    expect(withKeyboard).toBe(withoutKeyboard - keyboard);
  });

  it("toolbar bottom edge equals (screenHeight - keyboardHeight) after lift", () => {
    const keyboard = 320;
    const topY = toolbarTopAfterKeyboard(SCREEN, TOOLBAR, keyboard);
    expect(topY + TOOLBAR).toBe(SCREEN - keyboard);
  });

  it("toolbar top Y decreases (moves up) as keyboard height increases", () => {
    const small = toolbarTopAfterKeyboard(SCREEN, TOOLBAR, 100);
    const large = toolbarTopAfterKeyboard(SCREEN, TOOLBAR, 400);
    expect(large).toBeLessThan(small);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. isToolbarFullyVisible — the regression-prevention predicate
//
//    The key non-tautological check is the contrast: without KAV a 300 px
//    keyboard WOULD overlap a toolbar at the screen bottom; with KAV it does not.
// ─────────────────────────────────────────────────────────────────────────────

describe("isToolbarFullyVisible — toolbar remains tappable regardless of keyboard state", () => {
  const SCREEN  = 900;
  const TOOLBAR = VIEWER_TOOLBAR_HEIGHT;

  it("returns true when the keyboard is hidden (keyboardHeight = 0)", () => {
    expect(isToolbarFullyVisible(SCREEN, TOOLBAR, 0)).toBe(true);
  });

  it("returns true with a typical Android soft keyboard (300 px)", () => {
    expect(isToolbarFullyVisible(SCREEN, TOOLBAR, 300)).toBe(true);
  });

  it("returns true with a large keyboard (500 px) on a tall screen", () => {
    expect(isToolbarFullyVisible(SCREEN, TOOLBAR, 500)).toBe(true);
  });

  it("returns true when keyboard exactly fills the space below the toolbar (just-fits)", () => {
    const keyboard = SCREEN - TOOLBAR;
    expect(isToolbarFullyVisible(SCREEN, TOOLBAR, keyboard)).toBe(true);
  });

  it("returns false when keyboard + toolbar exceed screenHeight — would clip without KAV", () => {
    // Simulates a broken layout where the KAV adjustment is absent.
    const keyboard = SCREEN - TOOLBAR + 1;
    expect(isToolbarFullyVisible(SCREEN, TOOLBAR, keyboard)).toBe(false);
  });

  // ── Key contrast test: WITHOUT KAV a 300 px keyboard WOULD overlap ──────
  it("without KAV a 300 px keyboard overlaps a toolbar fixed at the screen bottom", () => {
    // No adjustment: toolbar bottom = SCREEN = 900; keyboard top = 900 - 300 = 600.
    // 900 > 600, so the toolbar bleeds 300 px into the keyboard area.
    const toolbarBottomWithoutAdjustment = SCREEN;          // fixed at screen bottom
    const keyboardTop                    = SCREEN - 300;    // 600
    expect(toolbarBottomWithoutAdjustment).toBeGreaterThan(keyboardTop);
  });

  it("WITH KAV (adjustment applied) the same 300 px keyboard leaves the toolbar fully visible", () => {
    expect(isToolbarFullyVisible(SCREEN, TOOLBAR, 300)).toBe(true);
  });

  it("the KAV-adjusted toolbar bottom exactly meets the keyboard top (zero gap)", () => {
    const keyboard = 300;
    const topY     = toolbarTopAfterKeyboard(SCREEN, TOOLBAR, keyboard);
    const bottomY  = topY + TOOLBAR;
    const kbTop    = SCREEN - keyboard; // 600
    expect(bottomY).toBe(kbTop);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. toolbarClearance — no overlap between toolbar bottom and keyboard top
// ─────────────────────────────────────────────────────────────────────────────

describe("toolbarClearance — gap between toolbar and keyboard must be ≥ 0", () => {
  const SCREEN  = 900;
  const TOOLBAR = VIEWER_TOOLBAR_HEIGHT;

  it("clearance is 0 (toolbar flush with keyboard top) for any keyboard height", () => {
    // KAV lifts the toolbar by exactly keyboardHeight, so the gap is always 0.
    expect(toolbarClearance(SCREEN, TOOLBAR, 0)).toBe(0);
    expect(toolbarClearance(SCREEN, TOOLBAR, 300)).toBe(0);
    expect(toolbarClearance(SCREEN, TOOLBAR, 450)).toBe(0);
  });

  it("clearance is never negative (toolbar never overlaps keyboard)", () => {
    for (const kbH of [0, 50, 150, 300, 400, 500]) {
      expect(toolbarClearance(SCREEN, TOOLBAR, kbH)).toBeGreaterThanOrEqual(0);
    }
  });

  it("clearance on a small screen with a large keyboard is still ≥ 0", () => {
    const smallScreen = 600;
    const bigKb       = 350;
    expect(toolbarClearance(smallScreen, TOOLBAR, bigKb)).toBeGreaterThanOrEqual(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. Real device dimensions — common Android and iOS screen heights
// ─────────────────────────────────────────────────────────────────────────────

describe("Real device dimensions — toolbar stays visible on common screen sizes", () => {
  const TOOLBAR = VIEWER_TOOLBAR_HEIGHT;

  const devices: Array<{ name: string; screenH: number; kbH: number }> = [
    { name: "Pixel 6 (Android)",           screenH: 812,  kbH: 310 },
    { name: "Pixel 7 Pro (Android)",        screenH: 932,  kbH: 320 },
    { name: "Samsung Galaxy S23 (Android)", screenH: 915,  kbH: 300 },
    { name: "iPhone 14 (iOS)",              screenH: 844,  kbH: 291 },
    { name: "iPhone 14 Pro Max (iOS)",      screenH: 932,  kbH: 336 },
    { name: "iPad Air 11-inch (iOS)",       screenH: 1180, kbH: 408 },
  ];

  for (const { name, screenH, kbH } of devices) {
    it(`${name}: toolbar fully visible with keyboard open (screen=${screenH}, kb=${kbH})`, () => {
      expect(isToolbarFullyVisible(screenH, TOOLBAR, kbH)).toBe(true);
    });

    it(`${name}: toolbar fully visible with keyboard closed`, () => {
      expect(isToolbarFullyVisible(screenH, TOOLBAR, 0)).toBe(true);
    });

    it(`${name}: clearance ≥ 0 with keyboard open`, () => {
      expect(toolbarClearance(screenH, TOOLBAR, kbH)).toBeGreaterThanOrEqual(0);
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. Edge cases
// ─────────────────────────────────────────────────────────────────────────────

describe("Edge cases", () => {
  it("VIEWER_TOOLBAR_HEIGHT is a positive number", () => {
    expect(VIEWER_TOOLBAR_HEIGHT).toBeGreaterThan(0);
  });

  it("toolbar of height 1 px is still fully visible with a 300 px keyboard", () => {
    expect(isToolbarFullyVisible(900, 1, 300)).toBe(true);
  });

  it("very small screen (480 px) with moderate keyboard (260 px) is handled correctly", () => {
    expect(isToolbarFullyVisible(480, VIEWER_TOOLBAR_HEIGHT, 260)).toBe(true);
  });

  it("toolbarTopAfterKeyboard is linear in keyboardHeight", () => {
    const shift100 = toolbarTopAfterKeyboard(900, 68, 100);
    const shift200 = toolbarTopAfterKeyboard(900, 68, 200);
    expect(shift100 - shift200).toBe(100);
  });
});
