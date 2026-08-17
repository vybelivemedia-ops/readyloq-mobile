/**
 * Unit tests — executive-dashboard copy-snapshot button
 *
 * Covers:
 *  1. `isCopyButtonDisabled` — button stays inert while loading or copying
 *  2. `runCopySnapshot` while loading — handler is never invoked (guard check)
 *  3. `runCopySnapshot` happy path — fetchText + writeClipboard are called with
 *     the token returned by getToken
 *  4. Label lifecycle — "copy" → "copied" immediately, reset to "copy" after the
 *     scheduled callback fires
 *  5. Error path — onError is called, setCopying resets to false, label stays "copy"
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  isCopyButtonDisabled,
  runCopySnapshot,
  getCopyButtonAccessibilityLabel,
  type CopySnapshotDeps,
} from "../copy-button";

// ─── 1. isCopyButtonDisabled ──────────────────────────────────────────────────

describe("isCopyButtonDisabled", () => {
  it("is disabled when loading is true and copying is false", () => {
    expect(isCopyButtonDisabled(true, false)).toBe(true);
  });

  it("is disabled when loading is false and copying is true", () => {
    expect(isCopyButtonDisabled(false, true)).toBe(true);
  });

  it("is disabled when both loading and copying are true", () => {
    expect(isCopyButtonDisabled(true, true)).toBe(true);
  });

  it("is enabled only when both loading and copying are false", () => {
    expect(isCopyButtonDisabled(false, false)).toBe(false);
  });
});

// ─── Shared helpers ───────────────────────────────────────────────────────────

function makeDefaultDeps(overrides?: Partial<CopySnapshotDeps>): CopySnapshotDeps {
  return {
    getToken: vi.fn().mockResolvedValue("tok_abc"),
    fetchText: vi.fn().mockResolvedValue({ text: "Executive snapshot text" }),
    writeClipboard: vi.fn().mockResolvedValue(undefined),
    setCopying: vi.fn(),
    setCopyLabel: vi.fn(),
    scheduleReset: vi.fn(), // captured so we can fire it manually
    onError: vi.fn(),
    ...overrides,
  };
}

// ─── 2. Guard: button is disabled while loading ───────────────────────────────
//
// The component wires up: `disabled={isCopyButtonDisabled(loading, copying)}`
// React Native's TouchableOpacity does not invoke onPress when disabled=true.
// The test verifies the guard's return value covers all loading/copying states,
// and separately verifies that a caller that respects the guard produces no
// side-effects.  A helper that replicates the onPress wiring is also tested to
// confirm the full interaction contract.

/**
 * Mirrors what the component does: only call runCopySnapshot when the button
 * is not disabled — identical to how TouchableOpacity behaves with disabled=true.
 */
async function pressIfEnabled(
  loading: boolean,
  copying: boolean,
  deps: CopySnapshotDeps,
): Promise<void> {
  if (!isCopyButtonDisabled(loading, copying)) {
    await runCopySnapshot(deps);
  }
}

describe("copy button guard — loading === true", () => {
  it("guard returns true while loading, so onPress is not invoked", async () => {
    const deps = makeDefaultDeps();
    await pressIfEnabled(true, false, deps);

    // None of the handler's side-effects should have fired
    expect(deps.fetchText).not.toHaveBeenCalled();
    expect(deps.writeClipboard).not.toHaveBeenCalled();
    expect(deps.setCopying).not.toHaveBeenCalled();
    expect(deps.setCopyLabel).not.toHaveBeenCalled();
  });

  it("guard returns true while copying (in-flight), so a second tap is ignored", async () => {
    const deps = makeDefaultDeps();
    await pressIfEnabled(false, true, deps);

    expect(deps.fetchText).not.toHaveBeenCalled();
    expect(deps.writeClipboard).not.toHaveBeenCalled();
  });

  it("guard returns false once loading completes, so the handler fires", async () => {
    const deps = makeDefaultDeps();
    await pressIfEnabled(false, false, deps);

    expect(deps.fetchText).toHaveBeenCalledTimes(1);
    expect(deps.writeClipboard).toHaveBeenCalledTimes(1);
  });
});

// ─── 3. Happy path — fetchText and writeClipboard are called ─────────────────

describe("runCopySnapshot — happy path (loading === false)", () => {
  let deps: ReturnType<typeof makeDefaultDeps>;

  beforeEach(async () => {
    deps = makeDefaultDeps();
    await runCopySnapshot(deps);
  });

  it("sets copying = true at the start", () => {
    // First call to setCopying is true (start)
    expect(deps.setCopying).toHaveBeenCalledWith(true);
  });

  it("calls getToken to obtain the auth token", () => {
    expect(deps.getToken).toHaveBeenCalledTimes(1);
  });

  it("calls fetchExecutiveTextPreview (fetchText) with the token from getToken", () => {
    expect(deps.fetchText).toHaveBeenCalledTimes(1);
    expect(deps.fetchText).toHaveBeenCalledWith("tok_abc");
  });

  it("writes the fetched text to the clipboard", () => {
    expect(deps.writeClipboard).toHaveBeenCalledTimes(1);
    expect(deps.writeClipboard).toHaveBeenCalledWith("Executive snapshot text");
  });

  it("sets copyLabel to 'copied' after a successful copy", () => {
    expect(deps.setCopyLabel).toHaveBeenCalledWith("copied");
  });

  it("schedules a label reset callback", () => {
    expect(deps.scheduleReset).toHaveBeenCalledTimes(1);
  });

  it("resets copying = false in the finally block", () => {
    // The last call to setCopying must be false
    const calls = (deps.setCopying as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[calls.length - 1]).toEqual([false]);
  });

  it("does not invoke onError on the happy path", () => {
    expect(deps.onError).not.toHaveBeenCalled();
  });
});

// ─── 4. Label lifecycle: "Copied!" resets to copy icon after 2 s ─────────────

describe("copy label lifecycle", () => {
  it("immediately shows 'copied' after clipboard write", async () => {
    const deps = makeDefaultDeps();
    await runCopySnapshot(deps);

    const labelCalls = (deps.setCopyLabel as ReturnType<typeof vi.fn>).mock.calls;
    expect(labelCalls[0]).toEqual(["copied"]);
  });

  it("resets label to 'copy' when the scheduled callback fires", async () => {
    let capturedCb: (() => void) | undefined;
    const scheduleReset = vi.fn((cb: () => void) => {
      capturedCb = cb;
    });

    const deps = makeDefaultDeps({ scheduleReset });
    await runCopySnapshot(deps);

    // Before the callback fires, label is "copied"
    const labelCalls = (deps.setCopyLabel as ReturnType<typeof vi.fn>).mock.calls;
    expect(labelCalls[labelCalls.length - 1]).toEqual(["copied"]);

    // Fire the scheduled callback (simulates the 2-second timeout)
    expect(capturedCb).toBeDefined();
    capturedCb!();

    const allLabelCalls = (deps.setCopyLabel as ReturnType<typeof vi.fn>).mock.calls;
    expect(allLabelCalls[allLabelCalls.length - 1]).toEqual(["copy"]);
  });

  it("scheduleReset is called exactly once per copy invocation", async () => {
    const deps = makeDefaultDeps();
    await runCopySnapshot(deps);
    expect(deps.scheduleReset).toHaveBeenCalledTimes(1);
  });
});

// ─── 5. Error path ────────────────────────────────────────────────────────────

describe("runCopySnapshot — error path", () => {
  it("calls onError when fetchText throws", async () => {
    const fetchError = new Error("Network request failed");
    const deps = makeDefaultDeps({
      fetchText: vi.fn().mockRejectedValue(fetchError),
    });

    await runCopySnapshot(deps);

    expect(deps.onError).toHaveBeenCalledWith(fetchError);
  });

  it("calls onError when writeClipboard throws", async () => {
    const clipError = new Error("Clipboard unavailable");
    const deps = makeDefaultDeps({
      writeClipboard: vi.fn().mockRejectedValue(clipError),
    });

    await runCopySnapshot(deps);

    expect(deps.onError).toHaveBeenCalledWith(clipError);
  });

  it("still resets copying = false even when fetchText throws", async () => {
    const deps = makeDefaultDeps({
      fetchText: vi.fn().mockRejectedValue(new Error("timeout")),
    });

    await runCopySnapshot(deps);

    const calls = (deps.setCopying as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[calls.length - 1]).toEqual([false]);
  });

  it("does not set copyLabel to 'copied' when an error occurs", async () => {
    const deps = makeDefaultDeps({
      fetchText: vi.fn().mockRejectedValue(new Error("api down")),
    });

    await runCopySnapshot(deps);

    const labelCalls = (deps.setCopyLabel as ReturnType<typeof vi.fn>).mock.calls;
    // setCopyLabel should never have been called with "copied"
    expect(labelCalls.every((c) => c[0] !== "copied")).toBe(true);
  });

  it("does not call writeClipboard when getToken throws", async () => {
    const deps = makeDefaultDeps({
      getToken: vi.fn().mockRejectedValue(new Error("auth expired")),
    });

    await runCopySnapshot(deps);

    expect(deps.writeClipboard).not.toHaveBeenCalled();
    expect(deps.onError).toHaveBeenCalled();
  });
});

// ─── 6. Accessibility label — VoiceOver / TalkBack announcement ───────────────

describe("getCopyButtonAccessibilityLabel", () => {
  it("returns 'Copy snapshot' when idle (copyLabel='copy', not copying)", () => {
    expect(getCopyButtonAccessibilityLabel(false, "copy")).toBe("Copy snapshot");
  });

  it("returns 'Copied!' when the confirmation state is shown (copyLabel='copied', not copying)", () => {
    expect(getCopyButtonAccessibilityLabel(false, "copied")).toBe("Copied!");
  });

  it("returns 'Copy snapshot' while in-flight (copying=true, copyLabel='copy')", () => {
    // The button is disabled during the fetch; VoiceOver reads "Copy snapshot, dimmed"
    expect(getCopyButtonAccessibilityLabel(true, "copy")).toBe("Copy snapshot");
  });

  it("returns 'Copy snapshot' while in-flight even if copyLabel happens to be 'copied'", () => {
    // Defensive: copying=true means the flow is still running — label should
    // not flip to 'Copied!' until the write has completed and copying resets.
    expect(getCopyButtonAccessibilityLabel(true, "copied")).toBe("Copy snapshot");
  });
});
