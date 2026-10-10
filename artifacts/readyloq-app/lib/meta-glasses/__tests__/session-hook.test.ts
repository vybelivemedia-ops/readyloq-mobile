// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useMetaWearablesSession } from "../../../hooks/useMetaWearablesSession";

const bridge = vi.hoisted(() => ({
  listeners: new Map<string, Set<(value: unknown) => void>>(),
  listenerError: false,
  native: {
    getStatus: vi.fn(), startRegistration: vi.fn(), requestCameraPermission: vi.fn(),
    startSession: vi.fn(), stopSession: vi.fn(), capturePhoto: vi.fn(), removeCapture: vi.fn(),
  },
}));
vi.mock("react-native", () => ({
  Platform: { OS: "android" },
  NativeModules: { ReadyLoqMetaWearables: bridge.native },
  NativeEventEmitter: class {
    constructor() { if (bridge.listenerError) throw new Error("React bridge unavailable"); }
    addListener(name: string, callback: (value: unknown) => void) {
      const listeners = bridge.listeners.get(name) ?? new Set();
      bridge.listeners.set(name, listeners);
      listeners.add(callback);
      return { remove: () => listeners.delete(callback) };
    }
  },
}));

const ready = {
  registrationState: "REGISTERED", cameraPermission: "GRANTED", deviceCount: 1,
  sessionState: "IDLE", streamState: "STOPPED", canCapture: false,
};
const connected = { ...ready, sessionState: "STARTED", streamState: "STREAMING", canCapture: true };
function emit(value: unknown, event = "ReadyLoqMetaWearablesStatus") {
  bridge.listeners.get(event)?.forEach(listener => listener(value));
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
beforeEach(() => {
  vi.clearAllMocks();
  bridge.listeners.clear();
  bridge.listenerError = false;
  bridge.native.getStatus.mockResolvedValue(ready);
  bridge.native.startSession.mockResolvedValue(connected);
  bridge.native.stopSession.mockResolvedValue(ready);
  bridge.native.removeCapture.mockResolvedValue(undefined);
});
afterEach(async () => { cleanup(); await Promise.resolve(); });

describe("post-Connect Meta session hook", () => {
  it("keeps the inspection owner mounted across STARTED, green capture, and rerenders", async () => {
    const pending = deferred<typeof connected>();
    bridge.native.startSession.mockReturnValue(pending.promise);
    const { result, rerender } = renderHook(
      ({ consumer }) => useMetaWearablesSession({ onCapture: consumer }),
      { initialProps: { consumer: vi.fn() } },
    );
    await waitFor(() => expect(result.current.canStartSession).toBe(true));
    let connect!: Promise<void>;
    act(() => { connect = result.current.startSession(); });
    act(() => emit({ ...ready, sessionState: "STARTED" }));
    expect(result.current.canStartSession).toBe(false);
    expect(result.current.canCapture).toBe(false);
    act(() => emit(connected));
    expect(result.current.title).toBe("Meta glasses connected");
    expect(result.current.canCapture).toBe(true);
    rerender({ consumer: vi.fn() });
    rerender({ consumer: vi.fn() });
    await act(async () => { pending.resolve(connected); await connect; });
    expect(result.current.canCapture).toBe(true);
    expect(bridge.native.stopSession).not.toHaveBeenCalled();
    expect(bridge.listeners.get("ReadyLoqMetaWearablesCapture")?.size).toBe(1);
  });

  it("handles malformed post-Connect events without throwing or tearing down", async () => {
    const { result } = renderHook(() => useMetaWearablesSession({ onCapture: vi.fn() }));
    await waitFor(() => expect(result.current.canStartSession).toBe(true));
    act(() => emit(connected));
    for (const value of [null, { ...connected, streamState: 123 }, { ...connected, deviceCount: NaN }]) {
      expect(() => act(() => emit(value))).not.toThrow();
      expect(result.current.availability).toBe("error");
      expect(result.current.canCapture).toBe(false);
    }
    act(() => emit(connected));
    expect(result.current.canCapture).toBe(true);
    expect(bridge.native.stopSession).not.toHaveBeenCalled();
  });

  it("does not treat pause/resume status as inspection unmount", async () => {
    const { result } = renderHook(() => useMetaWearablesSession({ onCapture: vi.fn() }));
    await waitFor(() => expect(result.current.canStartSession).toBe(true));
    act(() => emit(connected));
    act(() => emit({ ...connected, sessionState: "PAUSED", canCapture: false }));
    expect(result.current.availability).toBe("paused");
    act(() => emit(connected));
    expect(result.current.canCapture).toBe(true);
    expect(bridge.native.stopSession).not.toHaveBeenCalled();
  });

  it("shows a startup failure in place and permits an explicit retry", async () => {
    bridge.native.startSession.mockRejectedValueOnce(new Error("Camera attachment failed"));
    const { result } = renderHook(() => useMetaWearablesSession({ onCapture: vi.fn() }));
    await waitFor(() => expect(result.current.canStartSession).toBe(true));
    await act(async () => { await result.current.startSession(); });
    expect(result.current.error).toBe("Camera attachment failed");
    await act(async () => { await result.current.startSession(); });
    expect(result.current.canCapture).toBe(true);
    expect(bridge.native.stopSession).not.toHaveBeenCalled();
  });

  it("drops old Connect completions after the inspection owner unmounts", async () => {
    const pending = deferred<typeof connected>();
    bridge.native.startSession.mockReturnValue(pending.promise);
    const owner = renderHook(() => useMetaWearablesSession({ onCapture: vi.fn() }));
    await waitFor(() => expect(owner.result.current.canStartSession).toBe(true));
    let connect!: Promise<void>;
    act(() => { connect = owner.result.current.startSession(); });
    owner.unmount();
    const replacement = renderHook(() => useMetaWearablesSession());
    await waitFor(() => expect(replacement.result.current.canStartSession).toBe(true));
    await act(async () => { pending.resolve(connected); await connect; });
    expect(replacement.result.current.canCapture).toBe(false);
    expect(bridge.native.stopSession).toHaveBeenCalledTimes(1);
  });

  it("contains event-listener initialization failures instead of throwing from React", async () => {
    bridge.listenerError = true;
    const pending = deferred<typeof ready>();
    bridge.native.getStatus.mockReturnValue(pending.promise);
    const { result } = renderHook(() => useMetaWearablesSession());
    expect(result.current.error).toBe("React bridge unavailable");
    await act(async () => { pending.resolve(ready); await pending.promise; });
    expect(result.current.error).toBe("React bridge unavailable");
    expect(result.current.canCapture).toBe(false);
  });

  it("contains a synchronous native stop exception during unmount", async () => {
    bridge.native.stopSession.mockImplementationOnce(() => { throw new Error("Bridge destroyed"); });
    const owner = renderHook(() => useMetaWearablesSession({ onCapture: vi.fn() }));
    await waitFor(() => expect(owner.result.current.canStartSession).toBe(true));
    expect(() => owner.unmount()).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
    expect(bridge.native.stopSession).toHaveBeenCalledTimes(1);
  });

  it("preserves single durable evidence delivery for duplicate capture events", async () => {
    const consume = vi.fn().mockResolvedValue(undefined);
    renderHook(() => useMetaWearablesSession({ onCapture: consume }));
    const capture = {
      uri: "file:///cache/meta.jpg", capturedAt: "2026-10-08T23:00:00Z",
      source: "meta_wearables_dat", mimeType: "image/jpeg",
    };
    act(() => { emit(capture, "ReadyLoqMetaWearablesCapture"); emit(capture, "ReadyLoqMetaWearablesCapture"); });
    await waitFor(() => expect(consume).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(bridge.native.removeCapture).toHaveBeenCalledWith(capture.uri));
  });
});
