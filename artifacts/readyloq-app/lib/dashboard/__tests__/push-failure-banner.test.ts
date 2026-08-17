/**
 * Unit tests — push-failure banner dismiss & re-registration flow
 *
 * Covers:
 *  1. `isBannerVisible` — banner render condition
 *  2. Optimistic update — pushLastFailedAt is cleared in the cache
 *     **before** the network round-trip completes (no reload required)
 *  3. `setUserCache` is called even when getToken is slow (optimism is first)
 *  4. API success — banner stays hidden after the server responds
 *  5. API failure (network error) — optimistic update persists (best-effort)
 *  6. getToken failure — optimistic update already applied; API not called
 *  7. No-op when the cache entry is null/undefined (prev == null)
 *  8. setUserCache updater preserves all other user fields
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  isBannerVisible,
  runDismissPushFailure,
  runReRegisterPushToken,
  type DismissPushFailureDeps,
  type ReRegisterPushTokenDeps,
} from "../push-failure-banner";

// ─── 1. isBannerVisible ───────────────────────────────────────────────────────

describe("isBannerVisible", () => {
  it("is visible when pushLastFailedAt is a non-empty ISO string", () => {
    expect(isBannerVisible("2026-08-15T10:00:00.000Z")).toBe(true);
  });

  it("is hidden when pushLastFailedAt is null", () => {
    expect(isBannerVisible(null)).toBe(false);
  });

  it("is hidden when pushLastFailedAt is undefined", () => {
    expect(isBannerVisible(undefined)).toBe(false);
  });

  it("is hidden when pushLastFailedAt is an empty string", () => {
    expect(isBannerVisible("")).toBe(false);
  });
});

// ─── Shared helpers ───────────────────────────────────────────────────────────

// FakeUser extends the minimum UserWithPushStatus shape and adds extra fields
// to verify the updater preserves them.
type FakeUser = { pushLastFailedAt: string | null; role: string; id: number };

function makeDefaultDeps(overrides?: {
  getToken?: DismissPushFailureDeps<FakeUser>["getToken"];
  callDismissApi?: DismissPushFailureDeps<FakeUser>["callDismissApi"];
  setUserCache?: DismissPushFailureDeps<FakeUser>["setUserCache"];
}): DismissPushFailureDeps<FakeUser> & {
  currentCache: FakeUser | null | undefined;
  capturedUpdater: ((prev: FakeUser | null | undefined) => FakeUser | null | undefined) | null;
} {
  const state: { cache: FakeUser | null | undefined } = {
    cache: { pushLastFailedAt: "2026-08-15T10:00:00.000Z", role: "owner", id: 1 },
  };

  let capturedUpdater: ((prev: FakeUser | null | undefined) => FakeUser | null | undefined) | null = null;

  const setUserCache: DismissPushFailureDeps<FakeUser>["setUserCache"] = vi.fn(
    (updater: (prev: FakeUser | null | undefined) => FakeUser | null | undefined) => {
      capturedUpdater = updater;
      state.cache = updater(state.cache);
    },
  );

  return {
    getToken: vi.fn<() => Promise<string | null>>().mockResolvedValue("tok_owner_abc"),
    callDismissApi: vi.fn<(t: string | null) => Promise<unknown>>().mockResolvedValue({ success: true }),
    setUserCache,
    get currentCache() { return state.cache; },
    get capturedUpdater() { return capturedUpdater; },
    ...overrides,
  };
}

// ─── 2. Optimistic update fires before the network call ───────────────────────
//
// The order of operations in runDismissPushFailure must be:
//   setUserCache(null) → getToken() → callDismissApi()
//
// This test verifies the cache is already cleared at the moment getToken is
// awaited — proving the update is truly optimistic (not post-response).

describe("runDismissPushFailure — optimistic update order", () => {
  it("clears pushLastFailedAt in the cache before getToken resolves", async () => {
    const callOrder: string[] = [];

    let resolveCacheUpdate!: () => void;
    const cacheUpdateSettled = new Promise<void>((r) => (resolveCacheUpdate = r));

    const setUserCache: DismissPushFailureDeps<FakeUser>["setUserCache"] = vi.fn((_updater) => {
      callOrder.push("setUserCache");
      resolveCacheUpdate();
    });

    const getToken = vi.fn(async () => {
      await cacheUpdateSettled; // wait until setUserCache has fired
      callOrder.push("getToken");
      return "tok_abc" as string | null;
    });

    const callDismissApi = vi.fn(async (_t: string | null) => {
      callOrder.push("callDismissApi");
      return { success: true };
    });

    await runDismissPushFailure<FakeUser>({ getToken, callDismissApi, setUserCache });

    expect(callOrder).toEqual(["setUserCache", "getToken", "callDismissApi"]);
  });

  it("banner becomes hidden (pushLastFailedAt === null) before getToken resolves", async () => {
    const state: { cache: FakeUser | null | undefined } = {
      cache: { pushLastFailedAt: "2026-08-15T10:00:00.000Z", role: "owner", id: 1 },
    };

    let resolveToken!: (v: string | null) => void;
    const tokenPromise = new Promise<string | null>((r) => (resolveToken = r));

    const setUserCache: DismissPushFailureDeps<FakeUser>["setUserCache"] = vi.fn(
      (updater) => { state.cache = updater(state.cache); },
    );

    const getToken = vi.fn(() => tokenPromise);
    const callDismissApi = vi.fn<(t: string | null) => Promise<unknown>>().mockResolvedValue({ success: true });

    // Start the dismiss flow — do NOT await yet
    const dismissPromise = runDismissPushFailure<FakeUser>({
      getToken,
      callDismissApi,
      setUserCache,
    });

    // setUserCache has been called synchronously (before the first await)
    // so the cache should already reflect pushLastFailedAt: null
    expect(setUserCache).toHaveBeenCalledTimes(1);
    expect(state.cache?.pushLastFailedAt).toBeNull();
    expect(isBannerVisible(state.cache?.pushLastFailedAt)).toBe(false);

    // Unblock the async chain
    resolveToken("tok_abc");
    await dismissPromise;
  });
});

// ─── 3. Happy path — full round-trip ─────────────────────────────────────────

describe("runDismissPushFailure — happy path", () => {
  let deps: ReturnType<typeof makeDefaultDeps>;

  beforeEach(async () => {
    deps = makeDefaultDeps();
    await runDismissPushFailure(deps);
  });

  it("calls setUserCache exactly once", () => {
    expect(deps.setUserCache).toHaveBeenCalledTimes(1);
  });

  it("calls getToken to obtain the auth token", () => {
    expect(deps.getToken).toHaveBeenCalledTimes(1);
  });

  it("calls callDismissApi with the token from getToken", () => {
    expect(deps.callDismissApi).toHaveBeenCalledTimes(1);
    expect(deps.callDismissApi).toHaveBeenCalledWith("tok_owner_abc");
  });

  it("banner is hidden after the full round-trip (pushLastFailedAt === null)", () => {
    expect(deps.currentCache?.pushLastFailedAt).toBeNull();
    expect(isBannerVisible(deps.currentCache?.pushLastFailedAt)).toBe(false);
  });
});

// ─── 4. setUserCache updater — cache mutation contract ───────────────────────

describe("setUserCache updater function", () => {
  it("sets pushLastFailedAt to null when prev has a failure timestamp", () => {
    const deps = makeDefaultDeps();
    void runDismissPushFailure(deps);

    const updater = deps.capturedUpdater!;
    expect(updater).not.toBeNull();

    const prev: FakeUser = {
      pushLastFailedAt: "2026-08-15T10:00:00.000Z",
      role: "owner",
      id: 42,
    };
    const next = updater(prev);
    expect(next?.pushLastFailedAt).toBeNull();
  });

  it("preserves all other user fields when applying the optimistic update", () => {
    const deps = makeDefaultDeps();
    void runDismissPushFailure(deps);

    const updater = deps.capturedUpdater!;
    const prev: FakeUser = { pushLastFailedAt: "2026-08-15T10:00:00.000Z", role: "owner", id: 99 };
    const next = updater(prev);

    expect(next?.role).toBe("owner");
    expect(next?.id).toBe(99);
  });

  it("returns undefined when prev is undefined (empty cache)", () => {
    const deps = makeDefaultDeps();
    void runDismissPushFailure(deps);

    const updater = deps.capturedUpdater!;
    expect(updater(undefined)).toBeUndefined();
  });

  it("returns null when prev is null (query returned null)", () => {
    const deps = makeDefaultDeps();
    void runDismissPushFailure(deps);

    const updater = deps.capturedUpdater!;
    expect(updater(null)).toBeNull();
  });
});

// ─── 5. API failure — optimistic update persists (best-effort) ───────────────

describe("runDismissPushFailure — callDismissApi throws", () => {
  it("does not re-surface the banner when the API call fails", async () => {
    const state: { cache: FakeUser | null | undefined } = {
      cache: { pushLastFailedAt: "2026-08-15T10:00:00.000Z", role: "owner", id: 1 },
    };

    const setUserCache: DismissPushFailureDeps<FakeUser>["setUserCache"] = vi.fn(
      (updater) => { state.cache = updater(state.cache); },
    );

    const deps = makeDefaultDeps({
      callDismissApi: vi.fn<(t: string | null) => Promise<unknown>>().mockRejectedValue(new Error("Network timeout")),
      setUserCache,
    });

    await runDismissPushFailure(deps);

    expect(state.cache?.pushLastFailedAt).toBeNull();
    expect(isBannerVisible(state.cache?.pushLastFailedAt)).toBe(false);
  });

  it("does not throw even when callDismissApi rejects", async () => {
    const deps = makeDefaultDeps({
      callDismissApi: vi.fn<(t: string | null) => Promise<unknown>>().mockRejectedValue(new Error("500 Internal Server Error")),
    });

    await expect(runDismissPushFailure(deps)).resolves.toBeUndefined();
  });

  it("still calls setUserCache before the error is thrown", async () => {
    const setUserCache: DismissPushFailureDeps<FakeUser>["setUserCache"] = vi.fn();
    const deps = makeDefaultDeps({
      callDismissApi: vi.fn<(t: string | null) => Promise<unknown>>().mockRejectedValue(new Error("timeout")),
      setUserCache,
    });

    await runDismissPushFailure(deps);

    expect(setUserCache).toHaveBeenCalledTimes(1);
  });
});

// ─── 6. getToken failure ──────────────────────────────────────────────────────

describe("runDismissPushFailure — getToken throws", () => {
  it("does not call callDismissApi when getToken rejects", async () => {
    const callDismissApi = vi.fn<(t: string | null) => Promise<unknown>>();
    const deps = makeDefaultDeps({
      getToken: vi.fn<() => Promise<string | null>>().mockRejectedValue(new Error("auth session expired")),
      callDismissApi,
    });

    await runDismissPushFailure(deps);

    expect(callDismissApi).not.toHaveBeenCalled();
  });

  it("still applies the optimistic update even when getToken rejects", async () => {
    const state: { cache: FakeUser | null | undefined } = {
      cache: { pushLastFailedAt: "2026-08-15T10:00:00.000Z", role: "owner", id: 1 },
    };

    const setUserCache: DismissPushFailureDeps<FakeUser>["setUserCache"] = vi.fn(
      (updater) => { state.cache = updater(state.cache); },
    );

    const deps = makeDefaultDeps({
      getToken: vi.fn<() => Promise<string | null>>().mockRejectedValue(new Error("auth session expired")),
      setUserCache,
    });

    await runDismissPushFailure(deps);

    expect(state.cache?.pushLastFailedAt).toBeNull();
  });

  it("does not throw when getToken rejects", async () => {
    const deps = makeDefaultDeps({
      getToken: vi.fn<() => Promise<string | null>>().mockRejectedValue(new Error("auth session expired")),
    });

    await expect(runDismissPushFailure(deps)).resolves.toBeUndefined();
  });
});

// ─── 7. Re-registration round-trip simulation ─────────────────────────────────
//
// Simulates the full owner journey:
//   (a) A push delivery failure sets pushLastFailedAt to a non-null timestamp.
//   (b) The owner taps "Dismiss" — banner should disappear immediately.
//   (c) The server call succeeds (DELETE /me/push-failure clears the flag).
//   (d) No full page reload is required.

describe("re-registration round-trip", () => {
  it("banner is visible before dismiss and hidden immediately after tap (no reload)", async () => {
    const state: { cache: FakeUser | null | undefined } = {
      cache: { pushLastFailedAt: "2026-08-14T08:30:00.000Z", role: "owner", id: 7 },
    };

    // (a) banner visible before dismiss
    expect(isBannerVisible(state.cache?.pushLastFailedAt)).toBe(true);

    const setUserCache: DismissPushFailureDeps<FakeUser>["setUserCache"] = vi.fn(
      (updater) => { state.cache = updater(state.cache); },
    );

    let serverResolved = false;
    const callDismissApi = vi.fn(async (_t: string | null) => {
      await new Promise<void>((r) => setTimeout(r, 500));
      serverResolved = true;
      return { success: true };
    });

    // (b) owner taps dismiss — start but don't await
    const dismissPromise = runDismissPushFailure<FakeUser>({
      getToken: vi.fn<() => Promise<string | null>>().mockResolvedValue("tok_abc"),
      callDismissApi,
      setUserCache,
    });

    // Banner is already gone before the server responds
    expect(isBannerVisible(state.cache?.pushLastFailedAt)).toBe(false);
    expect(serverResolved).toBe(false);

    // (c) let the full round-trip finish
    await dismissPromise;
    expect(serverResolved).toBe(true);

    // (d) banner stays hidden after the server responds — no reload needed
    expect(isBannerVisible(state.cache?.pushLastFailedAt)).toBe(false);
  });

  it("no-reload: setUserCache is invoked exactly once (not twice)", async () => {
    const setUserCache: DismissPushFailureDeps<FakeUser>["setUserCache"] = vi.fn();
    const deps = makeDefaultDeps({ setUserCache });

    await runDismissPushFailure(deps);

    // A second call would indicate an extra refetch or double-update
    expect(setUserCache).toHaveBeenCalledTimes(1);
  });
});

// ─── runReRegisterPushToken — Settings handler-level tests ────────────────────
//
// These tests exercise the re-registration orchestration function that backs
// the Settings "Fix" / "Re-register" button, with focus on:
//   a) Optimistic update order — banner hides BEFORE acquireToken is awaited
//   b) Rollback on permission denied
//   c) Rollback on registration failure
//   d) Happy path — banner stays hidden, onSuccess is called

function makeReRegDeps(
  overrides?: Partial<ReRegisterPushTokenDeps<FakeUser>>,
): ReRegisterPushTokenDeps<FakeUser> & { currentCache: FakeUser | null | undefined } {
  const state: { cache: FakeUser | null | undefined } = {
    cache: { pushLastFailedAt: "2026-08-14T08:30:00.000Z", role: "owner", id: 5 },
  };

  const setUserCache: ReRegisterPushTokenDeps<FakeUser>["setUserCache"] = vi.fn(
    (updater) => { state.cache = updater(state.cache); },
  );

  return {
    currentPushLastFailedAt: "2026-08-14T08:30:00.000Z",
    setUserCache,
    acquireToken: vi.fn<() => Promise<{ status: "granted"; expoPushToken: string } | { status: "denied" }>>()
      .mockResolvedValue({ status: "granted", expoPushToken: "ExponentPushToken[abc123]" }),
    getToken: vi.fn<() => Promise<string | null>>().mockResolvedValue("tok_owner"),
    registerWithServer: vi.fn<(t: string | null, p: string) => Promise<unknown>>().mockResolvedValue({ success: true }),
    onSuccess: vi.fn(),
    onPermissionDenied: vi.fn(),
    onError: vi.fn(),
    get currentCache() { return state.cache; },
    ...overrides,
  };
}

describe("runReRegisterPushToken — optimistic update fires before acquireToken", () => {
  it("clears pushLastFailedAt in the cache before acquireToken resolves", async () => {
    const callOrder: string[] = [];

    let resolveCacheUpdate!: () => void;
    const cacheUpdateSettled = new Promise<void>((r) => (resolveCacheUpdate = r));

    const setUserCache: ReRegisterPushTokenDeps<FakeUser>["setUserCache"] = vi.fn((_updater) => {
      callOrder.push("setUserCache");
      resolveCacheUpdate();
    });

    const acquireToken = vi.fn(async () => {
      await cacheUpdateSettled; // waits until setUserCache has fired
      callOrder.push("acquireToken");
      return { status: "granted" as const, expoPushToken: "ExponentPushToken[abc]" };
    });

    const registerWithServer = vi.fn(async (_t: string | null, _p: string) => {
      callOrder.push("registerWithServer");
      return { success: true };
    });

    await runReRegisterPushToken<FakeUser>({
      currentPushLastFailedAt: "2026-08-14T08:30:00.000Z",
      setUserCache,
      acquireToken,
      getToken: vi.fn<() => Promise<string | null>>().mockResolvedValue("tok"),
      registerWithServer,
      onSuccess: vi.fn(),
      onPermissionDenied: vi.fn(),
      onError: vi.fn(),
    });

    expect(callOrder).toEqual(["setUserCache", "acquireToken", "registerWithServer"]);
  });

  it("banner is hidden immediately after tap (before acquireToken resolves)", async () => {
    const state: { cache: FakeUser | null | undefined } = {
      cache: { pushLastFailedAt: "2026-08-14T08:30:00.000Z", role: "owner", id: 5 },
    };

    let resolveAcquire!: (v: { status: "granted"; expoPushToken: string }) => void;
    const acquirePromise = new Promise<{ status: "granted"; expoPushToken: string }>(
      (r) => (resolveAcquire = r),
    );

    const setUserCache: ReRegisterPushTokenDeps<FakeUser>["setUserCache"] = vi.fn(
      (updater) => { state.cache = updater(state.cache); },
    );

    // Start but do NOT await
    const promise = runReRegisterPushToken<FakeUser>({
      currentPushLastFailedAt: "2026-08-14T08:30:00.000Z",
      setUserCache,
      acquireToken: () => acquirePromise,
      getToken: vi.fn<() => Promise<string | null>>().mockResolvedValue("tok"),
      registerWithServer: vi.fn<(t: string | null, p: string) => Promise<unknown>>().mockResolvedValue({}),
      onSuccess: vi.fn(),
      onPermissionDenied: vi.fn(),
      onError: vi.fn(),
    });

    // setUserCache has been called synchronously — banner already hidden
    expect(setUserCache).toHaveBeenCalledTimes(1);
    expect(state.cache?.pushLastFailedAt).toBeNull();
    expect(isBannerVisible(state.cache?.pushLastFailedAt)).toBe(false);

    resolveAcquire({ status: "granted", expoPushToken: "ExponentPushToken[abc]" });
    await promise;
  });
});

describe("runReRegisterPushToken — happy path", () => {
  it("banner stays hidden after successful registration", async () => {
    const deps = makeReRegDeps();
    await runReRegisterPushToken(deps);
    expect(deps.currentCache?.pushLastFailedAt).toBeNull();
    expect(isBannerVisible(deps.currentCache?.pushLastFailedAt)).toBe(false);
  });

  it("calls onSuccess after registration completes", async () => {
    const deps = makeReRegDeps();
    await runReRegisterPushToken(deps);
    expect(deps.onSuccess).toHaveBeenCalledTimes(1);
  });

  it("calls registerWithServer with the token from getToken and the Expo push token", async () => {
    const deps = makeReRegDeps();
    await runReRegisterPushToken(deps);
    expect(deps.registerWithServer).toHaveBeenCalledWith("tok_owner", "ExponentPushToken[abc123]");
  });

  it("does not call onError on the happy path", async () => {
    const deps = makeReRegDeps();
    await runReRegisterPushToken(deps);
    expect(deps.onError).not.toHaveBeenCalled();
  });
});

describe("runReRegisterPushToken — permission denied → rollback", () => {
  it("rolls back pushLastFailedAt to original value when permission is denied", async () => {
    const deps = makeReRegDeps({
      acquireToken: vi.fn<() => Promise<{ status: "granted"; expoPushToken: string } | { status: "denied" }>>()
        .mockResolvedValue({ status: "denied" }),
    });

    await runReRegisterPushToken(deps);

    expect(deps.currentCache?.pushLastFailedAt).toBe("2026-08-14T08:30:00.000Z");
    expect(isBannerVisible(deps.currentCache?.pushLastFailedAt)).toBe(true);
  });

  it("calls onPermissionDenied (not onError) when permission is denied", async () => {
    const deps = makeReRegDeps({
      acquireToken: vi.fn<() => Promise<{ status: "granted"; expoPushToken: string } | { status: "denied" }>>()
        .mockResolvedValue({ status: "denied" }),
    });

    await runReRegisterPushToken(deps);

    expect(deps.onPermissionDenied).toHaveBeenCalledTimes(1);
    expect(deps.onError).not.toHaveBeenCalled();
  });

  it("does not call registerWithServer when permission is denied", async () => {
    const deps = makeReRegDeps({
      acquireToken: vi.fn<() => Promise<{ status: "granted"; expoPushToken: string } | { status: "denied" }>>()
        .mockResolvedValue({ status: "denied" }),
    });

    await runReRegisterPushToken(deps);

    expect(deps.registerWithServer).not.toHaveBeenCalled();
  });
});

describe("runReRegisterPushToken — registration failure → rollback", () => {
  it("rolls back pushLastFailedAt to original value when registerWithServer throws", async () => {
    const deps = makeReRegDeps({
      registerWithServer: vi.fn<(t: string | null, p: string) => Promise<unknown>>()
        .mockRejectedValue(new Error("Network error")),
    });

    await runReRegisterPushToken(deps);

    expect(deps.currentCache?.pushLastFailedAt).toBe("2026-08-14T08:30:00.000Z");
    expect(isBannerVisible(deps.currentCache?.pushLastFailedAt)).toBe(true);
  });

  it("calls onError (not onSuccess) when registerWithServer throws", async () => {
    const err = new Error("500 Server Error");
    const deps = makeReRegDeps({
      registerWithServer: vi.fn<(t: string | null, p: string) => Promise<unknown>>()
        .mockRejectedValue(err),
    });

    await runReRegisterPushToken(deps);

    expect(deps.onError).toHaveBeenCalledWith(err);
    expect(deps.onSuccess).not.toHaveBeenCalled();
  });

  it("does not throw when registerWithServer rejects", async () => {
    const deps = makeReRegDeps({
      registerWithServer: vi.fn<(t: string | null, p: string) => Promise<unknown>>()
        .mockRejectedValue(new Error("timeout")),
    });

    await expect(runReRegisterPushToken(deps)).resolves.toBeUndefined();
  });

  it("rolls back when acquireToken itself throws", async () => {
    const deps = makeReRegDeps({
      acquireToken: vi.fn<() => Promise<{ status: "granted"; expoPushToken: string } | { status: "denied" }>>()
        .mockRejectedValue(new Error("Expo token unavailable")),
    });

    await runReRegisterPushToken(deps);

    expect(deps.currentCache?.pushLastFailedAt).toBe("2026-08-14T08:30:00.000Z");
    expect(deps.onError).toHaveBeenCalled();
  });
});
