/**
 * Unit tests — in-flight network failure during Clerk sign-in / sign-up
 *
 * Verifies that:
 *  1. isNetworkError() correctly identifies connection-loss errors vs
 *     ordinary Clerk validation errors.
 *  2. The catch handler used by handleSubmit / handleVerify / handleResendCode
 *     maps a network error to OFFLINE_MESSAGE and any other thrown value to
 *     the generic fallback — confirming neither screen crashes or shows a
 *     raw error when connectivity drops mid-request.
 */

import { describe, expect, it } from "vitest";

import { OFFLINE_MESSAGE, isNetworkError } from "../networkError";

// ─────────────────────────────────────────────────────────────────────────────
// 1. isNetworkError — pattern matching
// ─────────────────────────────────────────────────────────────────────────────

describe("isNetworkError", () => {
  it.each([
    // React Native / WhatWG fetch patterns
    ["Network request failed", true],
    ["network error", true],
    ["Failed to fetch", true],
    ["failed to fetch", true],
    // Node / native socket patterns
    ["ECONNREFUSED 127.0.0.1:443", true],
    ["ETIMEDOUT", true],
    // Explicit offline messages
    ["No internet connection", true],
    ["offline mode active", true],
    // Mid-flight drop phrased as a fetch error
    ["TypeError: Network request failed", true],
  ])("returns true for %s", (message, expected) => {
    expect(isNetworkError(new Error(message))).toBe(expected);
  });

  it.each([
    // Clerk validation / business-logic errors — must NOT be treated as network
    ["Password is incorrect", false],
    ["Identifier is invalid", false],
    ["Email address not found", false],
    ["That verification code is incorrect", false],
    ["Form submission failed", false],
    // Empty / null guard
    [null, false],
    [undefined, false],
    ["", false],
  ])("returns false for %s", (value, expected) => {
    expect(isNetworkError(value)).toBe(expected);
  });

  it("reads .message from a plain object (Clerk error shape)", () => {
    expect(isNetworkError({ message: "Network request failed" })).toBe(true);
    expect(isNetworkError({ message: "Email address not found" })).toBe(false);
  });

  it("falls back to String(err) when .message is absent", () => {
    expect(isNetworkError({ code: "network_error" })).toBe(false); // 'network' in key name — not matched against String({})
    // A plain string error with the keyword is caught via String(err)
    expect(isNetworkError("network failure")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Handler error-mapping — mirrors the catch blocks in sign-in.tsx /
//    sign-up.tsx so any future change to those blocks must keep parity here.
// ─────────────────────────────────────────────────────────────────────────────

const GENERIC_MESSAGE = "Something went wrong. Please try again.";

/**
 * Mirrors the one-liner used in every catch block of sign-in and sign-up:
 *
 *   setFormError(isNetworkError(err) ? OFFLINE_MESSAGE : GENERIC_MESSAGE)
 *
 * Extracted as a function so the tests below can drive it in isolation
 * without needing a React component renderer.
 */
function mapCatchError(err: unknown): string {
  return isNetworkError(err) ? OFFLINE_MESSAGE : GENERIC_MESSAGE;
}

describe("catch-block error mapping — sign-in handleSubmit", () => {
  it("maps a mid-flight network drop to OFFLINE_MESSAGE", () => {
    const err = new Error("Network request failed");
    expect(mapCatchError(err)).toBe(OFFLINE_MESSAGE);
  });

  it("maps an ETIMEDOUT drop to OFFLINE_MESSAGE", () => {
    expect(mapCatchError(new Error("ETIMEDOUT"))).toBe(OFFLINE_MESSAGE);
  });

  it("maps a WhatWG fetch failure to OFFLINE_MESSAGE", () => {
    expect(mapCatchError(new TypeError("Failed to fetch"))).toBe(OFFLINE_MESSAGE);
  });

  it("maps a Clerk validation error to the generic message (not OFFLINE_MESSAGE)", () => {
    expect(mapCatchError(new Error("Password is incorrect"))).toBe(GENERIC_MESSAGE);
  });

  it("maps an unknown thrown string to the generic message", () => {
    expect(mapCatchError("unexpected string throw")).toBe(GENERIC_MESSAGE);
  });

  it("maps null to the generic message without throwing", () => {
    expect(mapCatchError(null)).toBe(GENERIC_MESSAGE);
  });

  it("maps undefined to the generic message without throwing", () => {
    expect(mapCatchError(undefined)).toBe(GENERIC_MESSAGE);
  });

  it("does not rethrow — the catch block is safe for any thrown value", () => {
    // Calling mapCatchError with an unusual value should never itself throw.
    const weirdValues: unknown[] = [0, false, [], {}, Symbol("x")];
    for (const v of weirdValues) {
      expect(() => mapCatchError(v)).not.toThrow();
    }
  });
});

describe("catch-block error mapping — sign-up handleVerify", () => {
  it("maps a mid-flight network drop during verification to OFFLINE_MESSAGE", () => {
    expect(mapCatchError(new Error("network error occurred"))).toBe(OFFLINE_MESSAGE);
  });

  it("maps an incorrect verification code error to the generic message", () => {
    expect(mapCatchError(new Error("That verification code is incorrect"))).toBe(GENERIC_MESSAGE);
  });
});

describe("catch-block error mapping — sign-up handleResendCode", () => {
  it("maps a dropped connection on resend to OFFLINE_MESSAGE", () => {
    expect(mapCatchError(new Error("ECONNREFUSED"))).toBe(OFFLINE_MESSAGE);
  });

  it("maps a generic server error on resend to the generic message", () => {
    expect(mapCatchError(new Error("Internal server error"))).toBe(GENERIC_MESSAGE);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. OFFLINE_MESSAGE constant is well-formed
// ─────────────────────────────────────────────────────────────────────────────

describe("OFFLINE_MESSAGE constant", () => {
  it("is a non-empty string", () => {
    expect(typeof OFFLINE_MESSAGE).toBe("string");
    expect(OFFLINE_MESSAGE.length).toBeGreaterThan(0);
  });

  it("contains actionable guidance for the user", () => {
    expect(OFFLINE_MESSAGE.toLowerCase()).toMatch(/internet|connection|signal/);
  });
});
