/**
 * Unit tests — week-bar tap-guard and empty-state copy
 *
 * Confirms that:
 *  1. Every bar with a handler is tappable (no silent swallow of taps).
 *  2. Zero-score bars navigate=false → the dashboard shows an Alert instead.
 *  3. Non-zero bars navigate=true → the dashboard opens the drill-down.
 *  4. The Alert copy for zero-score bars is clear and references the week label.
 *  5. The drill-down empty-state copy (race-condition path) is clear and distinct
 *     from the Alert copy so owners are never confused between the two states.
 *
 * These are pure-logic tests — no React Native rendering needed.
 */

import { describe, expect, it } from "vitest";
import {
  isWeekBarTappable,
  weekBarNavigates,
  ZERO_WEEK_ALERT_TITLE,
  zeroWeekAlertBody,
  WEEK_EMPTY_HEADING,
  weekEmptySubtitle,
} from "../week-bar-guard";

// ─── isWeekBarTappable — all bars with a handler are tappable ─────────────────

describe("isWeekBarTappable — every bar must produce visible feedback when tapped", () => {
  it("returns true for a zero-score bar when a handler is provided", () => {
    // Previously silent-swallowed; now an Alert is shown instead.
    expect(isWeekBarTappable({ avgQuality: 0 }, true)).toBe(true);
  });

  it("returns true for a non-zero bar when a handler is provided", () => {
    expect(isWeekBarTappable({ avgQuality: 75 }, true)).toBe(true);
  });

  it("returns true for a perfect-score bar when a handler is provided", () => {
    expect(isWeekBarTappable({ avgQuality: 100 }, true)).toBe(true);
  });

  it("returns false when no handler is provided regardless of score", () => {
    // Without a handler there is nothing to call — bar is decorative.
    expect(isWeekBarTappable({ avgQuality: 0 }, false)).toBe(false);
    expect(isWeekBarTappable({ avgQuality: 80 }, false)).toBe(false);
  });
});

// ─── weekBarNavigates — only non-zero bars open the drill-down ────────────────

describe("weekBarNavigates — controls navigation vs Alert branch in the handler", () => {
  it("returns false for a zero-score bar (Alert path, not navigation)", () => {
    expect(weekBarNavigates({ avgQuality: 0 })).toBe(false);
  });

  it("returns false for a negative score (defensive edge case)", () => {
    expect(weekBarNavigates({ avgQuality: -1 })).toBe(false);
  });

  it("returns true for a non-zero score (navigation path)", () => {
    expect(weekBarNavigates({ avgQuality: 72 })).toBe(true);
  });

  it("returns true for the minimum non-zero score (avgQuality === 1)", () => {
    expect(weekBarNavigates({ avgQuality: 1 })).toBe(true);
  });

  it("returns true for a perfect score (avgQuality === 100)", () => {
    expect(weekBarNavigates({ avgQuality: 100 })).toBe(true);
  });
});

// ─── Zero-bar Alert copy ──────────────────────────────────────────────────────

describe("ZERO_WEEK_ALERT_TITLE — shown when the owner taps an empty week bar", () => {
  it("is a non-empty string", () => {
    expect(typeof ZERO_WEEK_ALERT_TITLE).toBe("string");
    expect(ZERO_WEEK_ALERT_TITLE.length).toBeGreaterThan(0);
  });

  it("signals the absence of scored inspections", () => {
    const lower = ZERO_WEEK_ALERT_TITLE.toLowerCase();
    expect(lower).toContain("no");
    expect(lower).toContain("inspection");
  });

  it("does not contain loading, error, or failed wording", () => {
    const lower = ZERO_WEEK_ALERT_TITLE.toLowerCase();
    expect(lower).not.toContain("loading");
    expect(lower).not.toContain("error");
    expect(lower).not.toContain("failed");
  });
});

describe("zeroWeekAlertBody — Alert body references the week label", () => {
  it("includes the week label", () => {
    expect(zeroWeekAlertBody("Aug 11")).toContain("Aug 11");
  });

  it("mentions 'scored' so owners understand why there is no data", () => {
    expect(zeroWeekAlertBody("Aug 11").toLowerCase()).toContain("scored");
  });

  it("gives owners a next action (complete and score an inspection)", () => {
    const body = zeroWeekAlertBody("Aug 11").toLowerCase();
    expect(body).toContain("inspection");
    // Should hint that scoring one will populate the bar
    expect(body.length).toBeGreaterThan(40);
  });

  it("works with different week label formats", () => {
    expect(zeroWeekAlertBody("2026-08-10")).toContain("2026-08-10");
    expect(zeroWeekAlertBody("Week 33")).toContain("Week 33");
  });

  it("does not contain undefined or null placeholders", () => {
    const body = zeroWeekAlertBody("Aug 11");
    expect(body).not.toContain("undefined");
    expect(body).not.toContain("null");
  });
});

// ─── Drill-down empty-state copy (race-condition path) ───────────────────────

describe("WEEK_EMPTY_HEADING — shown in the drill-down when the API returns 0 results", () => {
  it("is a non-empty string", () => {
    expect(typeof WEEK_EMPTY_HEADING).toBe("string");
    expect(WEEK_EMPTY_HEADING.length).toBeGreaterThan(0);
  });

  it("clearly signals the absence of inspections", () => {
    const lower = WEEK_EMPTY_HEADING.toLowerCase();
    expect(lower).toContain("no");
    expect(lower).toContain("inspection");
  });

  it("is DIFFERENT from the Alert title so owners can distinguish the two states", () => {
    expect(WEEK_EMPTY_HEADING).not.toBe(ZERO_WEEK_ALERT_TITLE);
  });
});

describe("weekEmptySubtitle — drill-down subtitle references the selected week", () => {
  it("includes the week label", () => {
    expect(weekEmptySubtitle("Aug 11")).toContain("Aug 11");
  });

  it("mentions 'scored' so owners understand why the list is empty", () => {
    expect(weekEmptySubtitle("Aug 11").toLowerCase()).toContain("scored");
  });

  it("works with different week label formats", () => {
    expect(weekEmptySubtitle("2026-08-10")).toContain("2026-08-10");
    expect(weekEmptySubtitle("Week 33")).toContain("Week 33");
  });

  it("does not contain undefined or null placeholders", () => {
    const subtitle = weekEmptySubtitle("Aug 11");
    expect(subtitle).not.toContain("undefined");
    expect(subtitle).not.toContain("null");
  });
});

// ─── Handler branching contract (simulated dashboard logic) ──────────────────

describe("Dashboard handler contract — zero bar shows Alert, non-zero bar navigates", () => {
  function simulateBarTap(
    avgQuality: number,
    weekLabel: string,
  ): { action: "alert"; title: string; body: string } | { action: "navigate" } {
    if (!weekBarNavigates({ avgQuality })) {
      return {
        action: "alert",
        title: ZERO_WEEK_ALERT_TITLE,
        body: zeroWeekAlertBody(weekLabel),
      };
    }
    return { action: "navigate" };
  }

  it("zero-score bar tap produces an Alert, not navigation", () => {
    const result = simulateBarTap(0, "Aug 11");
    expect(result.action).toBe("alert");
  });

  it("the Alert references the tapped week label", () => {
    const result = simulateBarTap(0, "Aug 11");
    if (result.action !== "alert") throw new Error("expected alert");
    expect(result.body).toContain("Aug 11");
  });

  it("the Alert title is ZERO_WEEK_ALERT_TITLE", () => {
    const result = simulateBarTap(0, "Aug 11");
    if (result.action !== "alert") throw new Error("expected alert");
    expect(result.title).toBe(ZERO_WEEK_ALERT_TITLE);
  });

  it("non-zero bar tap produces navigation (opens the drill-down)", () => {
    const result = simulateBarTap(72, "Aug 11");
    expect(result.action).toBe("navigate");
  });

  it("race-condition: non-zero bar navigates; drill-down shows WEEK_EMPTY_HEADING when API returns 0 rows", () => {
    // Bar was tappable (avgQuality=72 from trend load) → navigate
    const tapResult = simulateBarTap(72, "Aug 11");
    expect(tapResult.action).toBe("navigate");

    // Drill-down receives 0 rows → empty-state heading is coherent
    expect(WEEK_EMPTY_HEADING).toBeTruthy();
    expect(weekEmptySubtitle("Aug 11")).toContain("Aug 11");
  });
});
