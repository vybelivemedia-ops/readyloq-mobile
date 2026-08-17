/**
 * Unit tests — executive-dashboard share-snapshot button
 *
 * Covers:
 *  1. `isShareButtonDisabled` — button stays inert while loading or sharing
 *  2. Guard: handler is never invoked while loading or sharing
 *  3. Happy path (MailComposer available) — fetchEmailPreview + composeEmail
 *     are called; fetchTextPreview and shareText are NOT called
 *  4. Happy path (MailComposer unavailable) — fetchTextPreview + shareText
 *     are called; fetchEmailPreview and composeEmail are NOT called
 *  5. Error path — onError is called and setSharing resets to false
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  isShareButtonDisabled,
  runShareSnapshot,
  type ShareSnapshotDeps,
} from "../share-snapshot";

// ─── 1. isShareButtonDisabled ─────────────────────────────────────────────────

describe("isShareButtonDisabled", () => {
  it("is disabled when loading is true and sharing is false", () => {
    expect(isShareButtonDisabled(true, false)).toBe(true);
  });

  it("is disabled when loading is false and sharing is true", () => {
    expect(isShareButtonDisabled(false, true)).toBe(true);
  });

  it("is disabled when both loading and sharing are true", () => {
    expect(isShareButtonDisabled(true, true)).toBe(true);
  });

  it("is enabled only when both loading and sharing are false", () => {
    expect(isShareButtonDisabled(false, false)).toBe(false);
  });
});

// ─── Shared helpers ───────────────────────────────────────────────────────────

function makeDefaultDeps(overrides?: Partial<ShareSnapshotDeps>): ShareSnapshotDeps {
  return {
    getToken: vi.fn().mockResolvedValue("tok_share"),
    checkMailAvailable: vi.fn().mockResolvedValue(true),
    fetchEmailPreview: vi.fn().mockResolvedValue({ html: "<p>Report</p>", subject: "Daily Report" }),
    fetchTextPreview: vi.fn().mockResolvedValue({ text: "Report text", subject: "Daily Report" }),
    composeEmail: vi.fn().mockResolvedValue(undefined),
    shareText: vi.fn().mockResolvedValue(undefined),
    setSharing: vi.fn(),
    onError: vi.fn(),
    ...overrides,
  };
}

/**
 * Mirrors what the component does: only call runShareSnapshot when the button
 * is not disabled — identical to how TouchableOpacity behaves with disabled=true.
 */
async function pressIfEnabled(
  loading: boolean,
  sharing: boolean,
  deps: ShareSnapshotDeps,
): Promise<void> {
  if (!isShareButtonDisabled(loading, sharing)) {
    await runShareSnapshot(deps);
  }
}

// ─── 2. Guard: handler is inert while loading or sharing ──────────────────────

describe("share button guard — loading === true", () => {
  it("guard returns true while loading, so onPress is not invoked", async () => {
    const deps = makeDefaultDeps();
    await pressIfEnabled(true, false, deps);

    expect(deps.fetchEmailPreview).not.toHaveBeenCalled();
    expect(deps.fetchTextPreview).not.toHaveBeenCalled();
    expect(deps.composeEmail).not.toHaveBeenCalled();
    expect(deps.shareText).not.toHaveBeenCalled();
    expect(deps.setSharing).not.toHaveBeenCalled();
  });

  it("guard returns true while sharing (in-flight), so a second tap is ignored", async () => {
    const deps = makeDefaultDeps();
    await pressIfEnabled(false, true, deps);

    expect(deps.fetchEmailPreview).not.toHaveBeenCalled();
    expect(deps.fetchTextPreview).not.toHaveBeenCalled();
    expect(deps.composeEmail).not.toHaveBeenCalled();
    expect(deps.shareText).not.toHaveBeenCalled();
  });

  it("guard returns false once loading completes, so the handler fires", async () => {
    const deps = makeDefaultDeps();
    await pressIfEnabled(false, false, deps);

    // At least one of the fetch paths must have been called
    const fetchCalled =
      (deps.fetchEmailPreview as ReturnType<typeof vi.fn>).mock.calls.length > 0 ||
      (deps.fetchTextPreview as ReturnType<typeof vi.fn>).mock.calls.length > 0;
    expect(fetchCalled).toBe(true);
  });
});

// ─── 3. Happy path — MailComposer available ───────────────────────────────────

describe("runShareSnapshot — MailComposer path (mail available)", () => {
  let deps: ReturnType<typeof makeDefaultDeps>;

  beforeEach(async () => {
    deps = makeDefaultDeps({ checkMailAvailable: vi.fn().mockResolvedValue(true) });
    await runShareSnapshot(deps);
  });

  it("sets sharing = true at the start", () => {
    expect(deps.setSharing).toHaveBeenCalledWith(true);
  });

  it("calls getToken to obtain the auth token", () => {
    expect(deps.getToken).toHaveBeenCalledTimes(1);
  });

  it("calls fetchExecutiveEmailPreview with the token from getToken", () => {
    expect(deps.fetchEmailPreview).toHaveBeenCalledTimes(1);
    expect(deps.fetchEmailPreview).toHaveBeenCalledWith("tok_share");
  });

  it("opens the mail composer with the fetched subject and HTML body", () => {
    expect(deps.composeEmail).toHaveBeenCalledTimes(1);
    expect(deps.composeEmail).toHaveBeenCalledWith({
      subject: "Daily Report",
      body: "<p>Report</p>",
      isHtml: true,
    });
  });

  it("does NOT call fetchTextPreview on the MailComposer path", () => {
    expect(deps.fetchTextPreview).not.toHaveBeenCalled();
  });

  it("does NOT open the share sheet on the MailComposer path", () => {
    expect(deps.shareText).not.toHaveBeenCalled();
  });

  it("resets sharing = false in the finally block", () => {
    const calls = (deps.setSharing as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[calls.length - 1]).toEqual([false]);
  });

  it("does not invoke onError on the happy path", () => {
    expect(deps.onError).not.toHaveBeenCalled();
  });
});

// ─── 4. Happy path — MailComposer unavailable (Share fallback) ─────────────────

describe("runShareSnapshot — Share fallback path (mail unavailable)", () => {
  let deps: ReturnType<typeof makeDefaultDeps>;

  beforeEach(async () => {
    deps = makeDefaultDeps({ checkMailAvailable: vi.fn().mockResolvedValue(false) });
    await runShareSnapshot(deps);
  });

  it("calls fetchExecutiveTextPreview with the token from getToken", () => {
    expect(deps.fetchTextPreview).toHaveBeenCalledTimes(1);
    expect(deps.fetchTextPreview).toHaveBeenCalledWith("tok_share");
  });

  it("opens the share sheet with the fetched text and subject", () => {
    expect(deps.shareText).toHaveBeenCalledTimes(1);
    expect(deps.shareText).toHaveBeenCalledWith({
      message: "Report text",
      title: "Daily Report",
    });
  });

  it("does NOT call fetchEmailPreview on the Share fallback path", () => {
    expect(deps.fetchEmailPreview).not.toHaveBeenCalled();
  });

  it("does NOT open the mail composer on the Share fallback path", () => {
    expect(deps.composeEmail).not.toHaveBeenCalled();
  });

  it("resets sharing = false in the finally block", () => {
    const calls = (deps.setSharing as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[calls.length - 1]).toEqual([false]);
  });

  it("does not invoke onError on the happy path", () => {
    expect(deps.onError).not.toHaveBeenCalled();
  });
});

// ─── 5. Error path ────────────────────────────────────────────────────────────

describe("runShareSnapshot — error path", () => {
  it("calls onError when getToken throws", async () => {
    const authError = new Error("auth expired");
    const deps = makeDefaultDeps({
      getToken: vi.fn().mockRejectedValue(authError),
    });

    await runShareSnapshot(deps);

    expect(deps.onError).toHaveBeenCalledWith(authError);
    expect(deps.fetchEmailPreview).not.toHaveBeenCalled();
    expect(deps.fetchTextPreview).not.toHaveBeenCalled();
  });

  it("calls onError when checkMailAvailable throws", async () => {
    const mailError = new Error("MailComposer unavailable");
    const deps = makeDefaultDeps({
      checkMailAvailable: vi.fn().mockRejectedValue(mailError),
    });

    await runShareSnapshot(deps);

    expect(deps.onError).toHaveBeenCalledWith(mailError);
  });

  it("calls onError when fetchEmailPreview throws (MailComposer path)", async () => {
    const fetchError = new Error("Network request failed");
    const deps = makeDefaultDeps({
      checkMailAvailable: vi.fn().mockResolvedValue(true),
      fetchEmailPreview: vi.fn().mockRejectedValue(fetchError),
    });

    await runShareSnapshot(deps);

    expect(deps.onError).toHaveBeenCalledWith(fetchError);
    expect(deps.composeEmail).not.toHaveBeenCalled();
  });

  it("calls onError when fetchTextPreview throws (Share fallback path)", async () => {
    const fetchError = new Error("Server error");
    const deps = makeDefaultDeps({
      checkMailAvailable: vi.fn().mockResolvedValue(false),
      fetchTextPreview: vi.fn().mockRejectedValue(fetchError),
    });

    await runShareSnapshot(deps);

    expect(deps.onError).toHaveBeenCalledWith(fetchError);
    expect(deps.shareText).not.toHaveBeenCalled();
  });

  it("calls onError when composeEmail throws", async () => {
    const composeError = new Error("Mail composer failed");
    const deps = makeDefaultDeps({
      checkMailAvailable: vi.fn().mockResolvedValue(true),
      composeEmail: vi.fn().mockRejectedValue(composeError),
    });

    await runShareSnapshot(deps);

    expect(deps.onError).toHaveBeenCalledWith(composeError);
  });

  it("calls onError when shareText throws", async () => {
    const shareError = new Error("Share sheet dismissed");
    const deps = makeDefaultDeps({
      checkMailAvailable: vi.fn().mockResolvedValue(false),
      shareText: vi.fn().mockRejectedValue(shareError),
    });

    await runShareSnapshot(deps);

    expect(deps.onError).toHaveBeenCalledWith(shareError);
  });

  it("still resets sharing = false even when fetchEmailPreview throws", async () => {
    const deps = makeDefaultDeps({
      fetchEmailPreview: vi.fn().mockRejectedValue(new Error("timeout")),
    });

    await runShareSnapshot(deps);

    const calls = (deps.setSharing as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[calls.length - 1]).toEqual([false]);
  });

  it("still resets sharing = false even when fetchTextPreview throws", async () => {
    const deps = makeDefaultDeps({
      checkMailAvailable: vi.fn().mockResolvedValue(false),
      fetchTextPreview: vi.fn().mockRejectedValue(new Error("timeout")),
    });

    await runShareSnapshot(deps);

    const calls = (deps.setSharing as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls[calls.length - 1]).toEqual([false]);
  });
});
