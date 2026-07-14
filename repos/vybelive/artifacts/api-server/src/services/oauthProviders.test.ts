import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  buildAuthorizationUrl,
  exchangeCodeForTokens,
  fetchKickRtmpCredentials,
  fetchPlatformProfile,
  requiresPkce,
  KickAutoProvisionUnavailableError,
} from "./oauthProviders";

beforeAll(() => {
  // getProviderConfig reads these at call-time, so setting them here is enough.
  process.env["KICK_CLIENT_ID"] = "kick-test-client";
  process.env["KICK_CLIENT_SECRET"] = "kick-test-secret";
  process.env["TWITCH_CLIENT_ID"] = "twitch-test-client";
  process.env["TWITCH_CLIENT_SECRET"] = "twitch-test-secret";
});

afterEach(() => {
  vi.restoreAllMocks();
});

function mockFetchOnce(body: unknown, ok = true, status = 200) {
  const res = {
    ok,
    status,
    json: async () => body,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  } as Response;
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(res);
}

describe("requiresPkce", () => {
  it("requires PKCE for kick only", () => {
    expect(requiresPkce("kick")).toBe(true);
    expect(requiresPkce("twitch")).toBe(false);
    expect(requiresPkce("youtube")).toBe(false);
    expect(requiresPkce("facebook")).toBe(false);
    expect(requiresPkce("instagram")).toBe(false);
  });
});

describe("buildAuthorizationUrl", () => {
  it("includes the S256 code challenge and state for kick", () => {
    const url = buildAuthorizationUrl(
      "kick",
      "https://app.example.com/api/oauth/kick/callback",
      "state-nonce-123",
      "challenge-abc",
    );
    const parsed = new URL(url);
    expect(parsed.origin + parsed.pathname).toBe("https://id.kick.com/oauth/authorize");
    expect(parsed.searchParams.get("code_challenge")).toBe("challenge-abc");
    expect(parsed.searchParams.get("code_challenge_method")).toBe("S256");
    expect(parsed.searchParams.get("state")).toBe("state-nonce-123");
    expect(parsed.searchParams.get("response_type")).toBe("code");
    expect(parsed.searchParams.get("scope")).toContain("streamkey:read");
  });

  it("does NOT attach PKCE params for non-PKCE platforms (twitch)", () => {
    const url = buildAuthorizationUrl(
      "twitch",
      "https://app.example.com/api/oauth/twitch/callback",
      "state-nonce-xyz",
      "challenge-should-be-ignored",
    );
    const parsed = new URL(url);
    expect(parsed.searchParams.get("code_challenge")).toBeNull();
    expect(parsed.searchParams.get("code_challenge_method")).toBeNull();
    expect(parsed.searchParams.get("state")).toBe("state-nonce-xyz");
  });
});

describe("exchangeCodeForTokens", () => {
  it("sends code_verifier in the token request body for kick", async () => {
    const spy = mockFetchOnce({ access_token: "a", refresh_token: "r", expires_in: 3600, scope: "user:read" });
    await exchangeCodeForTokens("kick", "auth-code", "https://app.example.com/cb", "verifier-xyz");

    const [, init] = spy.mock.calls[0]!;
    const body = String((init as RequestInit).body);
    expect(body).toContain("code_verifier=verifier-xyz");
    expect(body).toContain("grant_type=authorization_code");
  });

  it("does NOT send code_verifier for non-PKCE platforms (twitch)", async () => {
    const spy = mockFetchOnce({ access_token: "a", refresh_token: "r", expires_in: 3600 });
    await exchangeCodeForTokens("twitch", "auth-code", "https://app.example.com/cb", "verifier-xyz");

    const [, init] = spy.mock.calls[0]!;
    const body = String((init as RequestInit).body);
    expect(body).not.toContain("code_verifier");
  });
});

describe("fetchKickRtmpCredentials", () => {
  it("returns rtmpUrl + streamKey when the API provides both", async () => {
    mockFetchOnce({
      data: {
        stream_key: "sk_live_kick_123",
        rtmp_url: "rtmps://abc.global-contribute.live-video.net:443/app",
      },
    });
    const creds = await fetchKickRtmpCredentials("token");
    expect(creds.streamKey).toBe("sk_live_kick_123");
    expect(creds.rtmpUrl).toBe("rtmps://abc.global-contribute.live-video.net:443/app");
  });

  it("throws KickAutoProvisionUnavailableError when the URL is missing (manual fallback)", async () => {
    mockFetchOnce({ data: { stream_key: "sk_live_kick_123" } });
    await expect(fetchKickRtmpCredentials("token")).rejects.toBeInstanceOf(
      KickAutoProvisionUnavailableError,
    );
  });

  it("throws KickAutoProvisionUnavailableError on a non-OK response (manual fallback)", async () => {
    mockFetchOnce("forbidden", false, 403);
    await expect(fetchKickRtmpCredentials("token")).rejects.toBeInstanceOf(
      KickAutoProvisionUnavailableError,
    );
  });
});

describe("fetchPlatformProfile (kick)", () => {
  it("parses snake_case user fields from the wrapped data array", async () => {
    mockFetchOnce({
      data: [{ user_id: "987", name: "VybeStreamer", profile_picture: "https://img/p.png" }],
    });
    const profile = await fetchPlatformProfile("kick", "token");
    expect(profile.platformUserId).toBe("987");
    expect(profile.accountName).toBe("VybeStreamer");
    expect(profile.profileImageUrl).toBe("https://img/p.png");
  });
});
