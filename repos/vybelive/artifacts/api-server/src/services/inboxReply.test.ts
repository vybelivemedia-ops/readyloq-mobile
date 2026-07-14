import { describe, expect, it, vi } from "vitest";
import { processInboxReply, type InboxReplyDeps } from "./inboxReply";
import { PLATFORM_CAPABILITIES } from "./socialInsights";

/**
 * Build a set of injected dependencies with sensible connected/success defaults.
 * Individual tests override only the behaviour they exercise.
 */
function makeDeps(overrides: Partial<InboxReplyDeps> = {}): InboxReplyDeps {
  return {
    resolveFounderUser: vi.fn().mockResolvedValue({ id: "founder-1" }),
    getFounderToken: vi.fn().mockResolvedValue({
      accessToken: "yt-token",
      connection: {
        id: "conn-1",
        accountName: "VYBE",
        platformUserId: "UC123",
        profileImageUrl: null,
        status: "connected",
      },
    }),
    replyToYouTubeComment: vi.fn().mockResolvedValue({
      replyId: "reply-abc",
      text: "Thanks for watching!",
      publishedAt: "2026-07-06T00:00:00Z",
    }),
    replyToFacebookComment: vi.fn().mockResolvedValue({
      replyId: "fb-reply-1",
      text: "Thanks!",
      publishedAt: null,
    }),
    replyToInstagramComment: vi.fn().mockResolvedValue({
      replyId: "ig-reply-1",
      text: "Thanks!",
      publishedAt: null,
    }),
    logError: vi.fn(),
    ...overrides,
  };
}

const validBody = {
  platform: "youtube",
  itemId: "comment-1",
  text: "Thanks for watching!",
};

describe("processInboxReply — honest-error contract", () => {
  it("rejects an empty body with 400 (invalid input) and never calls downstream deps", async () => {
    const deps = makeDeps();
    const out = await processInboxReply({}, deps);
    expect(out.status).toBe(400);
    expect(out.body["error"]).toBe("Invalid reply request");
    expect(out.body["details"]).toBeDefined();
    expect(deps.resolveFounderUser).not.toHaveBeenCalled();
    expect(deps.replyToYouTubeComment).not.toHaveBeenCalled();
  });

  it("rejects a whitespace-only reply with 400", async () => {
    const deps = makeDeps();
    const out = await processInboxReply(
      { platform: "youtube", itemId: "comment-1", text: "   " },
      deps,
    );
    expect(out.status).toBe(400);
    expect(out.body["error"]).toBe("Reply text cannot be empty.");
    expect(deps.replyToYouTubeComment).not.toHaveBeenCalled();
  });

  it("rejects an unknown platform with 400", async () => {
    const deps = makeDeps();
    const out = await processInboxReply(
      { platform: "myspace", itemId: "c1", text: "hi" },
      deps,
    );
    expect(out.status).toBe(400);
    expect(String(out.body["error"])).toContain("myspace");
    expect(deps.resolveFounderUser).not.toHaveBeenCalled();
  });

  it("returns 422 for an unsupported platform (twitch cannot reply)", async () => {
    const deps = makeDeps();
    const out = await processInboxReply(
      { platform: "twitch", itemId: "c1", text: "hi" },
      deps,
    );
    expect(out.status).toBe(422);
    expect(String(out.body["error"])).toMatch(/not supported yet/i);
    // Capability gate short-circuits before any founder/token/network work.
    expect(deps.resolveFounderUser).not.toHaveBeenCalled();
    expect(deps.getFounderToken).not.toHaveBeenCalled();
  });

  it("returns 422 when no founder account can be resolved", async () => {
    const deps = makeDeps({ resolveFounderUser: vi.fn().mockResolvedValue(null) });
    const out = await processInboxReply(validBody, deps);
    expect(out.status).toBe(422);
    expect(String(out.body["error"])).toMatch(/no founder account/i);
    expect(deps.getFounderToken).not.toHaveBeenCalled();
  });

  it("returns 422 when the founder's YouTube account is not connected", async () => {
    const deps = makeDeps({
      getFounderToken: vi.fn().mockResolvedValue({
        available: false,
        reason: "not_connected",
        message: "YouTube is not connected.",
      }),
    });
    const out = await processInboxReply(validBody, deps);
    expect(out.status).toBe(422);
    expect(out.body["error"]).toBe("YouTube is not connected.");
    expect(out.body["reason"]).toBe("not_connected");
    expect(deps.replyToYouTubeComment).not.toHaveBeenCalled();
  });

  it("returns 502 when the YouTube API call fails", async () => {
    const deps = makeDeps({
      replyToYouTubeComment: vi
        .fn()
        .mockRejectedValue(new Error("YouTube API comments.insert 403: forbidden")),
    });
    const out = await processInboxReply(validBody, deps);
    expect(out.status).toBe(502);
    expect(String(out.body["error"])).toMatch(/failed to post reply to youtube/i);
    expect(deps.logError).toHaveBeenCalledOnce();
  });

  it("returns ok:true with the created reply on success", async () => {
    const deps = makeDeps();
    const out = await processInboxReply(validBody, deps);
    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({
      ok: true,
      platform: "youtube",
      itemId: "comment-1",
      replyId: "reply-abc",
      text: "Thanks for watching!",
      publishedAt: "2026-07-06T00:00:00Z",
    });
    expect(deps.replyToYouTubeComment).toHaveBeenCalledWith(
      "yt-token",
      "comment-1",
      "Thanks for watching!",
    );
    expect(deps.logError).not.toHaveBeenCalled();
  });

  it("trims surrounding whitespace before sending the reply text", async () => {
    const deps = makeDeps();
    await processInboxReply(
      { platform: "youtube", itemId: "comment-1", text: "  hello  " },
      deps,
    );
    expect(deps.replyToYouTubeComment).toHaveBeenCalledWith(
      "yt-token",
      "comment-1",
      "hello",
    );
  });

  it("dispatches a facebook reply to the facebook handler and returns ok:true", async () => {
    const deps = makeDeps();
    const out = await processInboxReply(
      { platform: "facebook", itemId: "page1::c9", text: "  Thanks!  " },
      deps,
    );
    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({
      ok: true,
      platform: "facebook",
      itemId: "page1::c9",
      replyId: "fb-reply-1",
    });
    expect(deps.replyToFacebookComment).toHaveBeenCalledWith("yt-token", "page1::c9", "Thanks!");
    expect(deps.replyToYouTubeComment).not.toHaveBeenCalled();
  });

  it("dispatches an instagram reply to the instagram handler and returns ok:true", async () => {
    const deps = makeDeps();
    const out = await processInboxReply(
      { platform: "instagram", itemId: "ig-c-1", text: "Thanks!" },
      deps,
    );
    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({
      ok: true,
      platform: "instagram",
      itemId: "ig-c-1",
      replyId: "ig-reply-1",
    });
    expect(deps.replyToInstagramComment).toHaveBeenCalledWith("yt-token", "ig-c-1", "Thanks!");
  });

  it("returns 502 when a meta reply API call fails", async () => {
    const deps = makeDeps({
      replyToFacebookComment: vi
        .fn()
        .mockRejectedValue(new Error("Graph POST 200/comments 403: forbidden")),
    });
    const out = await processInboxReply(
      { platform: "facebook", itemId: "page1::c9", text: "hi" },
      deps,
    );
    expect(out.status).toBe(502);
    expect(String(out.body["error"])).toMatch(/failed to post reply to facebook/i);
    expect(deps.logError).toHaveBeenCalledOnce();
  });
});

describe("PLATFORM_CAPABILITIES — reply capability gate", () => {
  it("only allows replies on YouTube", () => {
    const replyable = Object.values(PLATFORM_CAPABILITIES)
      .filter((c) => c.replySupported)
      .map((c) => c.id);
    expect(replyable).toEqual(["youtube", "facebook", "instagram"]);
  });

  it("keeps facebook and instagram reply + inbox enabled together", () => {
    expect(PLATFORM_CAPABILITIES.facebook.inboxSupported).toBe(true);
    expect(PLATFORM_CAPABILITIES.facebook.replySupported).toBe(true);
    expect(PLATFORM_CAPABILITIES.instagram.inboxSupported).toBe(true);
    expect(PLATFORM_CAPABILITIES.instagram.replySupported).toBe(true);
  });

  it("never flags a platform as reply-capable without an inbox to reply to", () => {
    for (const cap of Object.values(PLATFORM_CAPABILITIES)) {
      if (cap.replySupported) expect(cap.inboxSupported).toBe(true);
    }
  });
});
