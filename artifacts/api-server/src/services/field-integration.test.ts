/**
 * Unit tests for the field-integration service's auth-error fast-path.
 *
 * These tests mock `fetch` directly (not the whole module) so that the real
 * `isRetryableResponse` / `withRetryTracked` wiring is exercised.  The goal
 * is to confirm that:
 *
 *   1. A 401/403 response causes syncInspectionToExternalSystem to throw after
 *      exactly ONE fetch call — zero retries.
 *   2. The error message explicitly contains "auth failure" so operators
 *      can distinguish dead credentials from transient server errors in the
 *      sync log.
 *
 * Transient errors (5xx) ARE retried — that path is covered here too to
 * confirm the contrast.
 */

import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import { syncInspectionToExternalSystem } from "./field-integration";
import type { SyncPayload } from "./field-integration";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal PestPac payload — enough for the note-POST path. */
const BASE_PAYLOAD: SyncPayload = {
  externalSystem: "pestpac",
  accountId: "acct-123",
  apiKey: "dead-key",
  inspectionDate: "2026-08-17",
  reportSummary: "Test summary",
  photos: [],
  treatmentConditions: { pestsFound: [], chemicalsUsed: [] },
};

/** Build a Response object with a given status code and body. */
function mockResponse(status: number, body = ""): Response {
  return new Response(body, { status });
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("syncInspectionToExternalSystem — auth failure fast-path (PestPac)", () => {
  let fetchSpy: MockInstance;

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("stops after exactly 1 fetch call when PestPac returns 401 — zero retries", async () => {
    fetchSpy.mockResolvedValue(mockResponse(401, "Unauthorized"));

    await expect(syncInspectionToExternalSystem(BASE_PAYLOAD)).rejects.toThrow();

    // isRetryableResponse returns false for 401, so withRetryTracked returns
    // immediately on the first attempt.  Only ONE fetch call must be made.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("stops after exactly 1 fetch call when PestPac returns 403 — zero retries", async () => {
    fetchSpy.mockResolvedValue(mockResponse(403, "Forbidden"));

    await expect(syncInspectionToExternalSystem(BASE_PAYLOAD)).rejects.toThrow();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("error message for 401 explicitly says 'auth failure' to distinguish from transient errors", async () => {
    fetchSpy.mockResolvedValue(mockResponse(401, "Unauthorized"));

    let errorMessage = "";
    try {
      await syncInspectionToExternalSystem(BASE_PAYLOAD);
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : String(err);
    }

    // Must be clearly labelled so the sync log is actionable for operators.
    expect(errorMessage).toMatch(/auth failure/i);
    // Must include the HTTP status code so operators know which response triggered it.
    expect(errorMessage).toContain("401");
    // Must mention that no retries were performed so operators know the attempt
    // count in the sync log is not inflated by useless retries.
    expect(errorMessage).toMatch(/no retries/i);
  });

  it("error message for 403 explicitly says 'auth failure'", async () => {
    fetchSpy.mockResolvedValue(mockResponse(403, "Forbidden"));

    let errorMessage = "";
    try {
      await syncInspectionToExternalSystem(BASE_PAYLOAD);
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : String(err);
    }

    expect(errorMessage).toMatch(/auth failure/i);
    expect(errorMessage).toContain("403");
  });

  it("a transient 503 does NOT contain 'auth failure' — contrast with auth errors", async () => {
    // 503 is a transient server error.  isRetryableResponse returns true for it,
    // so withRetryTracked retries up to maxAttempts times.  We stub all three
    // attempts to avoid real network I/O and confirm the error label differs.
    fetchSpy.mockResolvedValue(mockResponse(503, "Service Unavailable"));

    let errorMessage = "";
    try {
      await syncInspectionToExternalSystem({ ...BASE_PAYLOAD });
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : String(err);
    }

    // Transient errors must NOT be labelled as auth failures.
    expect(errorMessage).not.toMatch(/auth failure/i);
    // The 503 status should appear in the message.
    expect(errorMessage).toContain("503");
    // withRetryTracked fires up to 3 attempts for retryable errors.
    expect(fetchSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});
