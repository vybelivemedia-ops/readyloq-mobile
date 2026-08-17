/**
 * Tests — CoPilotHUD BLE/Cloud badge visibility
 *
 * The CoPilotHUD header renders a connection badge only when a glasses session
 * is active. The rendering guard in CoPilotHUD.tsx (~line 606) delegates to the
 * production helper imported from badge-display:
 *
 *   hudShouldShowBadge(glassesSessionActive, isBleConnected, bleFrameCount)
 *
 * When all three inputs are "no-glasses" (false/0), the predicate returns false
 * and the badge View + Text are short-circuited by the && operator — the header
 * renders with neither "BLE · direct" nor "Cloud · relay" visible.
 *
 * This file tests `hudShouldShowBadge` directly (the same function CoPilotHUD
 * calls) so a change to the production guard is immediately caught here.
 *
 * Task #560 requirements:
 *   ✓ Badge predicate false for phone-only inspection (glassesSessionActive=false,
 *     isBleConnected=false, bleFrameCount=0) — no badge rendered at all
 *   ✓ Neither "BLE · direct" nor "Cloud · relay" label would appear in that state
 *   ✓ Badge predicate true when glassesSessionActive=true (cloud-relay session)
 *   ✓ Badge predicate true when BLE path is active (isBleConnected / bleFrameCount)
 *   ✓ Rendered badge label is always one of the two known constant strings
 */

import { describe, expect, it } from "vitest";

import {
  BLE_DIRECT_STYLE,
  CLOUD_RELAY_STYLE,
  getBleBadgeStyle,
  hudShouldShowBadge,
} from "../../lib/ble/badge-display";

// ─── The two badge label strings that CoPilotHUD can render ──────────────────

const BADGE_LABELS = [BLE_DIRECT_STYLE.label, CLOUD_RELAY_STYLE.label] as const;
// "BLE · direct" | "Cloud · relay"

// ─────────────────────────────────────────────────────────────────────────────
// 1. Phone-only inspection — badge must be completely absent
//    glassesSessionActive=false, isBleConnected=false, bleFrameCount=0
// ─────────────────────────────────────────────────────────────────────────────

describe("CoPilotHUD — no badge for phone-only inspection (glassesSessionActive=false)", () => {
  const phoneOnly = {
    glassesSessionActive: false,
    isBleConnected: false,
    bleFrameCount: 0,
  } as const;

  it("hudShouldShowBadge returns false — the badge View is not rendered", () => {
    expect(
      hudShouldShowBadge(
        phoneOnly.glassesSessionActive,
        phoneOnly.isBleConnected,
        phoneOnly.bleFrameCount,
      ),
    ).toBe(false);
  });

  it('"BLE · direct" label cannot appear — badge subtree is short-circuited', () => {
    // hudShouldShowBadge is the && guard in CoPilotHUD.  When false, the entire
    // badge subtree (including the Text containing BLE_DIRECT_STYLE.label) is
    // never rendered.  Confirm the guard is false AND the label constant is what
    // the component would have rendered so a rename breaks this test explicitly.
    expect(
      hudShouldShowBadge(
        phoneOnly.glassesSessionActive,
        phoneOnly.isBleConnected,
        phoneOnly.bleFrameCount,
      ),
    ).toBe(false);
    expect(BLE_DIRECT_STYLE.label).toBe("BLE · direct");
  });

  it('"Cloud · relay" label cannot appear — badge subtree is short-circuited', () => {
    // Same guard — the cloud-relay label (rendered for isBleConnected=false) is
    // also absent when hudShouldShowBadge returns false.
    expect(
      hudShouldShowBadge(
        phoneOnly.glassesSessionActive,
        phoneOnly.isBleConnected,
        phoneOnly.bleFrameCount,
      ),
    ).toBe(false);
    expect(CLOUD_RELAY_STYLE.label).toBe("Cloud · relay");
  });

  it("no badge label of any kind would appear in the rendered output", () => {
    // Both BADGE_LABELS are absent when the predicate is false.
    const show = hudShouldShowBadge(
      phoneOnly.glassesSessionActive,
      phoneOnly.isBleConnected,
      phoneOnly.bleFrameCount,
    );
    expect(show).toBe(false);
    // Confirm both constants are accounted for (exhaustiveness guard).
    expect(BADGE_LABELS).toHaveLength(2);
  });

  it("remains hidden for all zero-glasses combinations", () => {
    // The only combination that must produce no badge:
    expect(
      hudShouldShowBadge(false, false, 0),
    ).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Badge IS present when glassesSessionActive=true (cloud-relay)
// ─────────────────────────────────────────────────────────────────────────────

describe("CoPilotHUD — badge shown when glassesSessionActive=true", () => {
  it("hudShouldShowBadge returns true for a cloud-relay session (no BLE)", () => {
    expect(hudShouldShowBadge(true, false, 0)).toBe(true);
  });

  it("would render 'Cloud · relay' label when glassesSessionActive=true and BLE not connected", () => {
    expect(hudShouldShowBadge(true, false, 0)).toBe(true);
    const label = getBleBadgeStyle(false /* isBleConnected */).label;
    expect(label).toBe("Cloud · relay");
    expect(BADGE_LABELS).toContain(label);
  });

  it("would render 'BLE · direct' label when glassesSessionActive=true and BLE is connected", () => {
    expect(hudShouldShowBadge(true, true, 5)).toBe(true);
    const label = getBleBadgeStyle(true /* isBleConnected */).label;
    expect(label).toBe("BLE · direct");
    expect(BADGE_LABELS).toContain(label);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Badge shown via the BLE path even when glassesSessionActive=false
// ─────────────────────────────────────────────────────────────────────────────

describe("CoPilotHUD — badge shown via BLE path when glassesSessionActive=false", () => {
  it("returns true when isBleConnected=true even if glassesSessionActive=false", () => {
    expect(hudShouldShowBadge(false, true, 0)).toBe(true);
  });

  it("returns true when bleFrameCount>0 even if glassesSessionActive=false", () => {
    expect(hudShouldShowBadge(false, false, 1)).toBe(true);
  });

  it("badge hidden only when ALL three inputs are 'no-glasses'", () => {
    // The single combination that must produce no badge:
    expect(hudShouldShowBadge(false, false, 0)).toBe(false);

    // Every other meaningful combination must show a badge:
    const showCases: [boolean, boolean, number][] = [
      [true,  false, 0],
      [false, true,  0],
      [false, false, 1],
      [true,  true,  5],
    ];
    for (const [gs, ble, frames] of showCases) {
      expect(hudShouldShowBadge(gs, ble, frames)).toBe(true);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Badge label exhaustiveness — CoPilotHUD can only render two label strings
// ─────────────────────────────────────────────────────────────────────────────

describe("CoPilotHUD — badge label values are exactly the two expected strings", () => {
  it('getBleBadgeStyle(true).label is "BLE · direct"', () => {
    expect(getBleBadgeStyle(true).label).toBe("BLE · direct");
  });

  it('getBleBadgeStyle(false).label is "Cloud · relay"', () => {
    expect(getBleBadgeStyle(false).label).toBe("Cloud · relay");
  });

  it("BADGE_LABELS is exhaustive — exactly two strings, both known", () => {
    expect(BADGE_LABELS).toHaveLength(2);
    expect(BADGE_LABELS).toContain("BLE · direct");
    expect(BADGE_LABELS).toContain("Cloud · relay");
  });
});
