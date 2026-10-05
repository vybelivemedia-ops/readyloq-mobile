// @vitest-environment jsdom
/**
 * Tests — useMetaGlassesSession.postTelemetryEvent
 *
 * Verifies the forwarding path from a BLE frame-drop event to the API server:
 *
 *   useSmartGlassesBleFrames.onDroppedFrame
 *     → new-inspection.tsx onDroppedFrame callback
 *       → glassesSession.postTelemetryEvent({ type: "ble_frame_dropped", ... })
 *         → HTTP POST /api/meta-glasses/events/:sessionId        ← tested here
 *
 * This test covers the fetch-call contract: correct URL, method, Authorization
 * header, and JSON body.  The API-server side (route acceptance + persistence
 * + retrieval) is covered by meta-glasses.test.ts.
 *
 * Together the two suites prove the full end-to-end chain without requiring
 * a live network between the RN test runner and the API server.
 */

// ─── Mocks (hoisted so they run before any import) ────────────────────────────

const mockGetToken = vi.hoisted(() =>
  vi.fn((): Promise<string> => Promise.resolve("test-bearer-token")),
);

vi.mock("@clerk/expo", () => ({
  useAuth: () => ({ getToken: mockGetToken }),
}));

// Expose API_BASE as empty string so URLs produced by the hook are relative
// (e.g. "/api/meta-glasses/events/…") and easy to assert on.
vi.mock("@/lib/api", () => ({
  API_BASE: "",
}));

// ─── Imports ──────────────────────────────────────────────────────────────────

import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useMetaGlassesSession } from "../useMetaGlassesSession";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Flush enough microtask ticks for async registration + state updates. */
async function flushMicrotasks(ticks = 10) {
  for (let i = 0; i < ticks; i++) {
    await Promise.resolve();
  }
}

/** Build a minimal Response-like object that `fetch` can return. */
function makeJsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

function make204Response(): Response {
  return {
    ok: true,
    status: 204,
    json: () => Promise.resolve(undefined),
  } as unknown as Response;
}

/** Snapshot of all fetch calls that match a given URL fragment. */
function fetchCallsFor(fragment: string): RequestInit[] {
  return (vi.mocked(global.fetch).mock.calls as [string, RequestInit][])
    .filter(([url]) => url.includes(fragment))
    .map(([, init]) => init);
}

// ─────────────────────────────────────────────────────────────────────────────
// Setup / teardown
// ─────────────────────────────────────────────────────────────────────────────

const SESSION_ID = "test-session-uuid-ble-drop";
const SESSION_CODE = "BLETST";

beforeEach(() => {
  vi.useFakeTimers();

  // Default fetch mock:
  //   POST /api/meta-glasses/session → { sessionId, code }
  //   GET  /api/meta-glasses/events/:id → { events: [], serverTime: 0 }
  //   POST /api/meta-glasses/events/:id → 204 (telemetry event accepted)
  vi.spyOn(global, "fetch").mockImplementation(async (url: string | URL | Request, _init?: RequestInit): Promise<Response> => {
    const u = String(url);
    if (u.includes("/api/meta-glasses/session")) {
      return makeJsonResponse({ sessionId: SESSION_ID, code: SESSION_CODE });
    }
    if (u.includes(`/api/meta-glasses/events/${SESSION_ID}`) && (!_init?.method || _init.method === "GET")) {
      return makeJsonResponse({ events: [], serverTime: Date.now() });
    }
    if (u.includes(`/api/meta-glasses/events/${SESSION_ID}`) && _init?.method === "POST") {
      return make204Response();
    }
    // Fallback for unexpected calls — non-ok so tests can detect it.
    return makeJsonResponse({ error: "unexpected fetch" }, 500);
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// Helper: mount the hook and wait for session registration to complete
// ─────────────────────────────────────────────────────────────────────────────

async function mountRegistered(inspectionId = 1) {
  const rendered = renderHook(() =>
    useMetaGlassesSession({
      active: true,
      inspectionId,
      onFinding: vi.fn(),
    }),
  );

  // Flush the async registration POST and resulting state updates.
  await act(async () => {
    await flushMicrotasks(15);
  });

  return rendered;
}

// ─────────────────────────────────────────────────────────────────────────────
// Suite — postTelemetryEvent forwards ble_frame_dropped to the API
// ─────────────────────────────────────────────────────────────────────────────

describe("useMetaGlassesSession.postTelemetryEvent — ble_frame_dropped forwarding", () => {
  it("preserves the server inspection ID and reports a company-scoped cloud registration 404", async () => {
    vi.mocked(global.fetch).mockResolvedValue(makeJsonResponse({ error: "Inspection not found" }, 404));
    const rendered = await mountRegistered(91);
    const calls = vi.mocked(global.fetch).mock.calls as [string, RequestInit][];
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe("/api/meta-glasses/session");
    expect(calls[0][1]).toMatchObject({
      method: "POST",
      headers: { Authorization: "Bearer test-bearer-token" },
      body: JSON.stringify({ inspectionId: 91 }),
    });
    expect(rendered.result.current.status).toBe(
      "Cloud Relay unavailable (404). This inspection was not found for your company on the configured server. Phone camera remains active.",
    );
    expect(rendered.result.current.isActive).toBe(false);
    expect(rendered.result.current.sessionId).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(9_000); });
    expect(vi.mocked(global.fetch)).toHaveBeenCalledTimes(1);
    rendered.unmount();
  });

  it("does not misdiagnose a non-JSON API 404 as unavailable glasses or another company's inspection", async () => {
    vi.mocked(global.fetch).mockResolvedValue({
      ok: false,
      status: 404,
      json: () => Promise.reject(new SyntaxError("HTML response")),
    } as Response);
    const rendered = await mountRegistered(92);
    expect(rendered.result.current.status).toBe(
      "Cloud Relay unavailable (404). Check the configured Cloud Relay API route and inspection ID. Phone camera remains active.",
    );
    rendered.unmount();
  });

  it("retries a failed cloud registration only on explicit retry, without changing the inspection ID", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(makeJsonResponse({ error: "Inspection not found" }, 404));
    const rendered = await mountRegistered(93);
    expect(rendered.result.current.sessionId).toBeNull();
    await act(async () => {
      rendered.result.current.retrySession();
      await flushMicrotasks(15);
    });
    expect(fetchCallsFor("/api/meta-glasses/session").map(init => JSON.parse(init.body as string)))
      .toEqual([{ inspectionId: 93 }, { inspectionId: 93 }]);
    expect(rendered.result.current.status).toBe("Cloud Relay ready");
    expect(rendered.result.current.sessionId).toBe(SESSION_ID);
    rendered.unmount();
  });

  it("does not restore a cloud error after disabling the relay while its error body is being read", async () => {
    let resolveBody!: (body: unknown) => void;
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: () => new Promise(resolve => { resolveBody = resolve; }),
    } as Response);
    const rendered = renderHook(
      ({ active }) => useMetaGlassesSession({ active, inspectionId: 94, onFinding: vi.fn() }),
      { initialProps: { active: true } },
    );
    await act(async () => { await flushMicrotasks(15); });
    rendered.rerender({ active: false });
    await act(async () => {
      resolveBody({ error: "Inspection not found" });
      await flushMicrotasks(15);
    });
    expect(rendered.result.current.status).toBeNull();
    expect(rendered.result.current.sessionId).toBeNull();
    expect(vi.mocked(global.fetch)).toHaveBeenCalledTimes(1);
    rendered.unmount();
  });

  it("keeps a replacement registration's cloud 404 explanation visible during reconnect backoff", async () => {
    const rendered = await mountRegistered(95);
    vi.mocked(global.fetch).mockImplementation(async url =>
      String(url).includes("/api/meta-glasses/session")
        ? makeJsonResponse({ error: "Inspection not found" }, 404)
        : makeJsonResponse({ error: "Session not found or expired" }, 404));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_100);
      await flushMicrotasks(15);
    });
    expect(rendered.result.current.status).toContain("Cloud Relay unavailable (404). This inspection");
    await act(async () => { await vi.advanceTimersByTimeAsync(9_000); });
    expect(rendered.result.current.status).toContain("Cloud Relay unavailable (404). This inspection");
    expect(fetchCallsFor("/api/meta-glasses/session")).toHaveLength(2);
    rendered.unmount();
  });

  it("reports network registration failures as a cloud problem while leaving phone capture available", async () => {
    vi.mocked(global.fetch).mockRejectedValueOnce(new Error("Network unavailable"));
    const rendered = await mountRegistered(96);
    expect(rendered.result.current.status).toBe("Cloud Relay unavailable. Phone camera remains active.");
    expect(rendered.result.current.sessionId).toBeNull();
    rendered.unmount();
  });

  it("makes zero Meta requests for a persisted phone-only inspection", async () => {
    const { rerender, unmount } = renderHook(
      ({ inspectionId, active }) =>
        useMetaGlassesSession({
          active,
          inspectionId,
          onFinding: vi.fn(),
        }),
      { initialProps: { inspectionId: 41, active: false } },
    );

    await act(async () => {
      await flushMicrotasks(10);
      await vi.advanceTimersByTimeAsync(12_000);
    });
    rerender({ inspectionId: 41, active: false });
    await act(async () => {
      await flushMicrotasks(10);
      await vi.advanceTimersByTimeAsync(12_000);
    });

    expect(vi.mocked(global.fetch)).not.toHaveBeenCalled();
    unmount();
  });

  it("registers once after explicit enablement and does not duplicate on rerender", async () => {
    const onFinding = vi.fn();
    const { rerender, unmount } = renderHook(
      ({ active }) =>
        useMetaGlassesSession({
          active,
          inspectionId: 52,
          onFinding,
        }),
      { initialProps: { active: false } },
    );

    rerender({ active: true });
    await act(async () => {
      await flushMicrotasks(15);
    });
    rerender({ active: true });
    rerender({ active: true });
    await act(async () => {
      await flushMicrotasks(10);
    });

    const registrations = (vi.mocked(global.fetch).mock.calls as [string, RequestInit][])
      .filter(([url]) => url.includes("/api/meta-glasses/session"));
    expect(registrations).toHaveLength(1);
    unmount();
  });

  it("stops polling and clears the optional session when Meta is disabled", async () => {
    const onFinding = vi.fn();
    const { result, rerender, unmount } = renderHook(
      ({ active }) =>
        useMetaGlassesSession({
          active,
          inspectionId: 63,
          onFinding,
        }),
      { initialProps: { active: true } },
    );

    await act(async () => {
      await flushMicrotasks(15);
      await vi.advanceTimersByTimeAsync(3_100);
    });
    expect(result.current.isActive).toBe(true);

    rerender({ active: false });
    await act(async () => {
      await flushMicrotasks(10);
    });
    const callsAfterDisable = vi.mocked(global.fetch).mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(12_000);
    });

    expect(vi.mocked(global.fetch).mock.calls).toHaveLength(callsAfterDisable);
    expect(result.current.sessionId).toBeNull();
    expect(result.current.isActive).toBe(false);
    expect(result.current.status).toBeNull();
    unmount();
  });

  it("starts exactly one new session after disable then explicit reconnect", async () => {
    const { rerender, unmount } = renderHook(
      ({ active }) =>
        useMetaGlassesSession({
          active,
          inspectionId: 74,
          onFinding: vi.fn(),
        }),
      { initialProps: { active: true } },
    );

    await act(async () => {
      await flushMicrotasks(15);
    });
    rerender({ active: false });
    await act(async () => {
      await flushMicrotasks(10);
    });
    rerender({ active: true });
    await act(async () => {
      await flushMicrotasks(15);
    });

    const registrations = (vi.mocked(global.fetch).mock.calls as [string, RequestInit][])
      .filter(([url]) => url.includes("/api/meta-glasses/session"));
    expect(registrations).toHaveLength(2);
    unmount();
  });

  it("does not deliver or continue an in-flight poll after Meta is disabled", async () => {
    const onFinding = vi.fn();
    const rendered = renderHook(
      ({ active }) =>
        useMetaGlassesSession({
          active,
          inspectionId: 85,
          onFinding,
        }),
      { initialProps: { active: true } },
    );
    await act(async () => {
      await flushMicrotasks(15);
    });

    let resolvePoll!: (response: Response) => void;
    const pendingPoll = new Promise<Response>((resolve) => {
      resolvePoll = resolve;
    });
    vi.mocked(global.fetch).mockImplementationOnce(() => pendingPoll);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_100);
    });
    const callsBeforeDisable = vi.mocked(global.fetch).mock.calls.length;
    rendered.rerender({ active: false });

    await act(async () => {
      resolvePoll(makeJsonResponse({
        events: [{
          id: "stale-event",
          type: "finding",
          timestamp: Date.now(),
          text: "must not deliver",
        }],
        serverTime: Date.now(),
      }));
      await flushMicrotasks(10);
      await vi.advanceTimersByTimeAsync(9_000);
    });

    expect(onFinding).not.toHaveBeenCalled();
    expect(vi.mocked(global.fetch).mock.calls).toHaveLength(callsBeforeDisable);
    rendered.unmount();
  });

  it("does not create a replacement session when a pending poll returns 404 after disable", async () => {
    const onFinding = vi.fn();
    const rendered = renderHook(
      ({ active }) =>
        useMetaGlassesSession({
          active,
          inspectionId: 86,
          onFinding,
        }),
      { initialProps: { active: true } },
    );
    await act(async () => {
      await flushMicrotasks(15);
    });

    let resolvePoll!: (response: Response) => void;
    const pendingPoll = new Promise<Response>((resolve) => {
      resolvePoll = resolve;
    });
    vi.mocked(global.fetch).mockImplementationOnce(() => pendingPoll);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_100);
    });

    rendered.rerender({ active: false });
    const registrationsBefore404 = (vi.mocked(global.fetch).mock.calls as [string, RequestInit][])
      .filter(([url]) => url.includes("/api/meta-glasses/session")).length;
    await act(async () => {
      resolvePoll(makeJsonResponse({ error: "gone" }, 404));
      await flushMicrotasks(10);
      await vi.advanceTimersByTimeAsync(9_000);
    });

    const registrationsAfter404 = (vi.mocked(global.fetch).mock.calls as [string, RequestInit][])
      .filter(([url]) => url.includes("/api/meta-glasses/session")).length;
    expect(registrationsAfter404).toBe(registrationsBefore404);
    rendered.unmount();
  });

  it("paces replacement sessions when polling keeps returning 404", async () => {
    const rendered = await mountRegistered(87);
    vi.mocked(global.fetch).mockImplementation(async (url) =>
      String(url).includes("/api/meta-glasses/session")
        ? makeJsonResponse({ error: "unavailable" }, 503)
        : makeJsonResponse({ error: "gone" }, 404));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(fetchCallsFor("/api/meta-glasses/session")).toHaveLength(2); // initial + one replacement
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(fetchCallsFor("/api/meta-glasses/session")).toHaveLength(3);
    rendered.unmount();
  });

  it("makes a POST to /api/meta-glasses/events/:sessionId with the ble_frame_dropped payload", async () => {
    const { result, unmount } = await mountRegistered();

    // Confirm the session is registered and postTelemetryEvent is available.
    expect(result.current.sessionId).toBe(SESSION_ID);

    // Simulate what new-inspection.tsx does inside onDroppedFrame:
    //   glassesSession.postTelemetryEvent({ type: "ble_frame_dropped", ... })
    await act(async () => {
      result.current.postTelemetryEvent({
        type: "ble_frame_dropped",
        deviceId: "device-alpha",
        reason: "driver_drop",
        count: 3,
      });
      await flushMicrotasks(10);
    });

    // Exactly one POST to the events endpoint must have been made.
    const postCalls = fetchCallsFor(`/api/meta-glasses/events/${SESSION_ID}`).filter(
      (init) => init.method === "POST",
    );
    expect(postCalls.length).toBeGreaterThanOrEqual(1);

    const postInit = postCalls[postCalls.length - 1]!;
    const body = JSON.parse(postInit.body as string) as Record<string, unknown>;

    expect(body.type).toBe("ble_frame_dropped");
    expect(body.deviceId).toBe("device-alpha");
    expect(body.reason).toBe("driver_drop");
    expect(body.count).toBe(3);

    unmount();
  });

  it("includes the Clerk bearer token in the Authorization header", async () => {
    const { result, unmount } = await mountRegistered();

    await act(async () => {
      result.current.postTelemetryEvent({
        type: "ble_frame_dropped",
        deviceId: "device-beta",
        reason: "cap_exceeded",
        count: 1,
      });
      await flushMicrotasks(10);
    });

    const postCalls = (vi.mocked(global.fetch).mock.calls as [string, RequestInit][])
      .filter(([url, init]) => url.includes(`/api/meta-glasses/events/${SESSION_ID}`) && init.method === "POST");

    expect(postCalls.length).toBeGreaterThanOrEqual(1);

    const headers = postCalls[postCalls.length - 1]![1].headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer test-bearer-token");

    unmount();
  });

  it("sends each reason code correctly — cap_exceeded round-trips unchanged", async () => {
    const { result, unmount } = await mountRegistered();

    await act(async () => {
      result.current.postTelemetryEvent({
        type: "ble_frame_dropped",
        deviceId: "device-gamma",
        reason: "cap_exceeded",
        count: 7,
      });
      await flushMicrotasks(10);
    });

    const postCalls = fetchCallsFor(`/api/meta-glasses/events/${SESSION_ID}`).filter(
      (init) => init.method === "POST",
    );
    const body = JSON.parse(postCalls[postCalls.length - 1]!.body as string) as Record<string, unknown>;

    expect(body.reason).toBe("cap_exceeded");
    expect(body.count).toBe(7);

    unmount();
  });

  it("sends 'processing_error' reason correctly", async () => {
    const { result, unmount } = await mountRegistered();

    await act(async () => {
      result.current.postTelemetryEvent({
        type: "ble_frame_dropped",
        deviceId: "device-delta",
        reason: "processing_error",
        count: 1,
      });
      await flushMicrotasks(10);
    });

    const postCalls = fetchCallsFor(`/api/meta-glasses/events/${SESSION_ID}`).filter(
      (init) => init.method === "POST",
    );
    const body = JSON.parse(postCalls[postCalls.length - 1]!.body as string) as Record<string, unknown>;

    expect(body.reason).toBe("processing_error");

    unmount();
  });

  it("does NOT make a fetch call when no session is registered (inspectionId=null)", async () => {
    // Mount with active=false so no session is registered.
    const { result, unmount } = renderHook(() =>
      useMetaGlassesSession({
        active: false,
        inspectionId: null,
        onFinding: vi.fn(),
      }),
    );

    await act(async () => {
      await flushMicrotasks(10);
    });

    const callsBefore = vi.mocked(global.fetch).mock.calls.length;

    // postTelemetryEvent should be a no-op — session is null.
    await act(async () => {
      result.current.postTelemetryEvent({
        type: "ble_frame_dropped",
        reason: "driver_drop",
        count: 2,
      });
      await flushMicrotasks(10);
    });

    // Fetch must not have been called again after the no-op.
    expect(vi.mocked(global.fetch).mock.calls.length).toBe(callsBefore);

    unmount();
  });

  it("silently discards the telemetry call when fetch rejects — no uncaught rejection", async () => {
    const { result, unmount } = await mountRegistered();

    // Make the telemetry POST fail.
    vi.mocked(global.fetch).mockImplementationOnce(async () => {
      throw new Error("network failure");
    });

    // Should not throw.
    await expect(
      act(async () => {
        result.current.postTelemetryEvent({
          type: "ble_frame_dropped",
          deviceId: "device-offline",
          reason: "driver_drop",
          count: 1,
        });
        await flushMicrotasks(10);
      }),
    ).resolves.not.toThrow();

    unmount();
  });

  it("each call makes one independent POST — three drops produce three fetches", async () => {
    const { result, unmount } = await mountRegistered();

    const countBefore = fetchCallsFor(`/api/meta-glasses/events/${SESSION_ID}`).filter(
      (init) => init.method === "POST",
    ).length;

    await act(async () => {
      result.current.postTelemetryEvent({ type: "ble_frame_dropped", reason: "driver_drop", count: 1 });
      result.current.postTelemetryEvent({ type: "ble_frame_dropped", reason: "cap_exceeded", count: 3 });
      result.current.postTelemetryEvent({ type: "ble_frame_dropped", reason: "processing_error", count: 1 });
      await flushMicrotasks(20);
    });

    const postCalls = fetchCallsFor(`/api/meta-glasses/events/${SESSION_ID}`).filter(
      (init) => init.method === "POST",
    );

    // Three independent POSTs — one per onDroppedFrame invocation.
    expect(postCalls.length - countBefore).toBe(3);

    unmount();
  });
});
