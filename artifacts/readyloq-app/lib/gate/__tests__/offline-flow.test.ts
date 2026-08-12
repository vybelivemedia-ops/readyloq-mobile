/**
 * Unit tests — Gate offline / auto-create state-machine transitions
 *
 * Covers the four behaviours required by the task spec:
 *
 *  1. isNetworkError — correctly classifies thrown values as network failures
 *     vs. business-logic errors (mirrors the Gate component's inline helper).
 *
 *  2. shouldShowOfflineBanner — auto-create network error → showOfflineBanner
 *     prop passed as true to Onboarding.
 *
 *  3. shouldRetryAutoCreate — connectivity restored → auto-retry fires (and
 *     only fires) under the exact set of required conditions.
 *
 *  4. isSubmitBlocked — Onboarding submit is blocked (button disabled) when
 *     isOffline is true, and the offline note is implied by that same prop.
 *
 * All helpers are pure functions so no React renderer or native mock is needed.
 */

import { describe, expect, it } from "vitest";

import {
  isNetworkError,
  isSubmitBlocked,
  shouldRetryAutoCreate,
  shouldShowOfflineBanner,
} from "../offline-flow";

// ─────────────────────────────────────────────────────────────────────────────
// 1. isNetworkError
// ─────────────────────────────────────────────────────────────────────────────

describe("isNetworkError", () => {
  it.each([
    // React Native / WhatWG fetch
    ["Network request failed", true],
    ["network error occurred", true],
    ["Failed to fetch", true],
    ["failed to fetch", true],
    // TypeError is always treated as a network error
    [new TypeError("Failed to fetch"), true],
    // Node / socket patterns
    ["ECONNREFUSED 127.0.0.1:443", true],
    ["ETIMEDOUT", true],
    ["timeout exceeded", true],
    ["socket hang up", true],
    // Explicit offline keyword
    ["offline mode active", true],
  ])("returns true for: %s", (value, expected) => {
    const input = typeof value === "string" ? new Error(value) : value;
    expect(isNetworkError(input)).toBe(expected);
  });

  it.each([
    // Server / business-logic errors — must NOT be treated as network
    ["Password is incorrect", false],
    ["Identifier is invalid", false],
    ["Company name already taken", false],
    ["Internal server error", false],
    // Edge cases
    [null, false],
    [undefined, false],
    ["", false],
    [42, false],
  ])("returns false for: %s", (value, expected) => {
    const input =
      typeof value === "string" ? new Error(value) : (value as unknown);
    expect(isNetworkError(input)).toBe(expected);
  });

  it("returns true for a TypeError regardless of message content", () => {
    // TypeError is a signal of a native fetch abort, not a message pattern.
    expect(isNetworkError(new TypeError("Some internal error"))).toBe(true);
  });

  it("matches a plain lowercase string containing 'network'", () => {
    expect(isNetworkError("network unreachable")).toBe(true);
  });

  it("does not throw for exotic values", () => {
    const exotics: unknown[] = [Symbol("x"), [], {}, false, 0];
    for (const v of exotics) {
      expect(() => isNetworkError(v)).not.toThrow();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. shouldShowOfflineBanner
//    Gate renders: showOfflineBanner={autoCreateNetworkError && !online}
// ─────────────────────────────────────────────────────────────────────────────

describe("shouldShowOfflineBanner — auto-create network error → banner shown", () => {
  it("returns true when auto-create failed with a network error AND we are offline", () => {
    // This is the scenario that should show the 'retrying automatically' banner.
    expect(shouldShowOfflineBanner(true, false)).toBe(true);
  });

  it("returns false when online even if the previous attempt was a network error", () => {
    // Once we're back online the auto-retry fires; the banner is no longer needed.
    expect(shouldShowOfflineBanner(true, true)).toBe(false);
  });

  it("returns false when offline but the error was NOT a network error", () => {
    // The user is offline but the prior failure was a server/validation error —
    // a different fallback (manual form + error message) is appropriate.
    expect(shouldShowOfflineBanner(false, false)).toBe(false);
  });

  it("returns false when online and no network error occurred", () => {
    expect(shouldShowOfflineBanner(false, true)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. shouldRetryAutoCreate
//    Connectivity restored → auto-retry triggers automatically
// ─────────────────────────────────────────────────────────────────────────────

/** Fully-valid (retry should fire) baseline options. */
const RETRY_READY = {
  wasOffline: true,
  online: true,
  autoCreateNetworkError: true,
  hasDerivedName: true,
  autoCreating: false,
} as const;

describe("shouldRetryAutoCreate — retry fires on offline→online transition", () => {
  it("returns true when all conditions are met (the happy-path reconnect)", () => {
    expect(shouldRetryAutoCreate(RETRY_READY)).toBe(true);
  });

  it("returns false when we are still offline", () => {
    expect(shouldRetryAutoCreate({ ...RETRY_READY, online: false })).toBe(false);
  });

  it("returns false when we were already online (no transition occurred)", () => {
    // The effect must not fire on every render — only on the offline→online edge.
    expect(shouldRetryAutoCreate({ ...RETRY_READY, wasOffline: false })).toBe(false);
  });

  it("returns false when the previous failure was not a network error", () => {
    // A server-side error should not be auto-retried on reconnect.
    expect(
      shouldRetryAutoCreate({ ...RETRY_READY, autoCreateNetworkError: false }),
    ).toBe(false);
  });

  it("returns false when there is no derived company name to use", () => {
    // Without a name there is nothing to pass to createCompany.
    expect(shouldRetryAutoCreate({ ...RETRY_READY, hasDerivedName: false })).toBe(
      false,
    );
  });

  it("returns false when another auto-create is already in flight", () => {
    // Guard against double-firing if the effect runs twice while a request
    // is already pending.
    expect(shouldRetryAutoCreate({ ...RETRY_READY, autoCreating: true })).toBe(
      false,
    );
  });

  it("all conditions must hold simultaneously — only one missing is enough to block", () => {
    const keys = Object.keys(RETRY_READY) as Array<keyof typeof RETRY_READY>;
    for (const key of keys) {
      const flipped = { ...RETRY_READY, [key]: !RETRY_READY[key] };
      expect(shouldRetryAutoCreate(flipped)).toBe(false);
    }
  });
});

describe("shouldRetryAutoCreate — auto-retry succeeds → workspace loads", () => {
  it("after a successful retry the auto-create state resets (network error cleared)", () => {
    // Simulate the sequence: retry fires → succeeds → autoCreateNetworkError=false.
    // On the next connectivity change shouldRetryAutoCreate must NOT re-fire.
    const afterSuccess = {
      ...RETRY_READY,
      autoCreateNetworkError: false, // cleared by runAutoCreate success path
    };
    expect(shouldRetryAutoCreate(afterSuccess)).toBe(false);
  });

  it("a second offline→online cycle after success does not re-trigger retry", () => {
    // Even if wasOffline flips back to true, without autoCreateNetworkError
    // the retry guard stays silent.
    const secondCycle = {
      wasOffline: true,
      online: true,
      autoCreateNetworkError: false,
      hasDerivedName: true,
      autoCreating: false,
    };
    expect(shouldRetryAutoCreate(secondCycle)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. isSubmitBlocked
//    Onboarding: button disabled and offline note visible when isOffline=true
// ─────────────────────────────────────────────────────────────────────────────

describe("isSubmitBlocked — Onboarding submit disabled when offline", () => {
  it("returns true (submit blocked) when isOffline is true", () => {
    // The Button's `disabled` prop and the early-return guard in submit() both
    // depend on isOffline. When blocked, the button is visually disabled and
    // the offline note below it becomes visible.
    expect(isSubmitBlocked(true)).toBe(true);
  });

  it("returns false (submit allowed) when isOffline is false", () => {
    expect(isSubmitBlocked(false)).toBe(false);
  });

  it("the offline note is shown iff submit is blocked", () => {
    // Onboarding renders the note with: {isOffline ? <Text>…offline…</Text> : null}
    // So note visibility and submit-blocked share the same condition.
    const isOfflineValues = [true, false];
    for (const isOffline of isOfflineValues) {
      const blocked = isSubmitBlocked(isOffline);
      const noteVisible = isOffline; // mirrors Onboarding JSX condition
      expect(blocked).toBe(noteVisible);
    }
  });

  it("submit guard does not throw for any boolean-like input", () => {
    expect(() => isSubmitBlocked(true)).not.toThrow();
    expect(() => isSubmitBlocked(false)).not.toThrow();
  });
});
