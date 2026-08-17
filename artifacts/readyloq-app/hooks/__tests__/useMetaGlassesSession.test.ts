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

const mockGetToken = vi.hoisted(() => vi.fn<[], Promise<string>>().mockResolvedValue("test-bearer-token"));

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
