import { describe, expect, it } from "vitest";
import {
  buildManualDestinationChecks,
  classifyPushDestinationError,
  evaluatePlatformConnectedCheck,
  evaluateTokenValidityCheck,
  summarizeConnections,
  validateManualDestination,
  type ConnectionLike,
  type ManualDestinationLike,
} from "./destinationValidation";
import { KickAutoProvisionUnavailableError } from "./oauthProviders";

describe("summarizeConnections", () => {
  const now = new Date("2026-06-20T00:00:00Z");

  it("counts connected, expired, and refresh-needed independently", () => {
    const conns: ConnectionLike[] = [
      { status: "connected", tokenExpiresAt: new Date("2026-06-21T00:00:00Z") }, // valid
      { status: "connected", tokenExpiresAt: new Date("2026-06-19T00:00:00Z") }, // expired by time
      { status: "expired", tokenExpiresAt: null }, // expired by status
      { status: "refresh_needed", tokenExpiresAt: new Date("2026-06-21T00:00:00Z") },
      { status: "connected", tokenExpiresAt: null }, // valid (no expiry)
    ];
    expect(summarizeConnections(conns, now)).toEqual({
      connectedCount: 2,
      expiredCount: 2,
      refreshNeededCount: 1,
    });
  });

  it("returns all-zero counts for no connections", () => {
    expect(summarizeConnections([], now)).toEqual({
      connectedCount: 0,
      expiredCount: 0,
      refreshNeededCount: 0,
    });
  });
});

describe("evaluatePlatformConnectedCheck", () => {
  it("passes when at least one platform is connected", () => {
    expect(evaluatePlatformConnectedCheck(2).status).toBe("pass");
  });
  it("fails when none are connected", () => {
    expect(evaluatePlatformConnectedCheck(0).status).toBe("fail");
  });
});

describe("evaluateTokenValidityCheck", () => {
  it("passes when nothing is expired or needs refresh", () => {
    expect(evaluateTokenValidityCheck(0, 0).status).toBe("pass");
  });
  it("warns when a token is expired", () => {
    expect(evaluateTokenValidityCheck(1, 0).status).toBe("warn");
  });
  it("warns when a token needs refresh", () => {
    expect(evaluateTokenValidityCheck(0, 1).status).toBe("warn");
  });
});

describe("validateManualDestination", () => {
  it("passes a well-formed tiktok destination with matching host", () => {
    const result = validateManualDestination({
      type: "tiktok",
      name: "My TikTok",
      rtmpUrl: "rtmps://live-push-rtmps.tiktok.com/game",
      streamKey: "key-123",
    });
    expect(result.status).toBe("pass");
  });

  it("fails when the stream key is empty", () => {
    const result = validateManualDestination({
      type: "tiktok",
      rtmpUrl: "rtmps://live-push-rtmps.tiktok.com/game",
      streamKey: "   ",
    });
    expect(result.status).toBe("fail");
    expect(result.detail).toMatch(/stream key/i);
  });

  it("fails when the RTMP URL is missing", () => {
    const result = validateManualDestination({ type: "tiktok", rtmpUrl: "", streamKey: "key" });
    expect(result.status).toBe("fail");
    expect(result.detail).toMatch(/RTMP URL/i);
  });

  it("fails when the RTMP URL is not an rtmp(s) scheme", () => {
    const result = validateManualDestination({
      type: "tiktok",
      rtmpUrl: "https://live-push-rtmps.tiktok.com/game",
      streamKey: "key",
    });
    expect(result.status).toBe("fail");
  });

  it("warns when the host doesn't match the expected ingest host", () => {
    const result = validateManualDestination({
      type: "tiktok",
      rtmpUrl: "rtmps://some-other-host.example.com/app",
      streamKey: "key",
    });
    expect(result.status).toBe("warn");
  });

  it("passes a custom_rtmp destination regardless of host (no hint)", () => {
    const result = validateManualDestination({
      type: "custom_rtmp",
      rtmpUrl: "rtmp://my.own.server/live",
      streamKey: "key",
    });
    expect(result.status).toBe("pass");
  });
});

describe("buildManualDestinationChecks", () => {
  it("evaluates each destination independently — one failure does not suppress others", () => {
    const destinations: ManualDestinationLike[] = [
      { type: "tiktok", name: "Good TikTok", rtmpUrl: "rtmps://x.tiktok.com/game", streamKey: "k1" },
      { type: "custom_rtmp", name: "Broken", rtmpUrl: "", streamKey: "" }, // fail
      { type: "custom_rtmp", name: "Good Custom", rtmpUrl: "rtmp://srv/live", streamKey: "k2" },
    ];
    const checks = buildManualDestinationChecks(destinations);
    expect(checks).toHaveLength(3);
    expect(checks[0]!.status).toBe("pass");
    expect(checks[1]!.status).toBe("fail");
    expect(checks[2]!.status).toBe("pass");
  });

  it("skips inactive destinations", () => {
    const destinations: ManualDestinationLike[] = [
      { type: "tiktok", rtmpUrl: "rtmps://x.tiktok.com/game", streamKey: "k1", isActive: false },
      { type: "custom_rtmp", rtmpUrl: "rtmp://srv/live", streamKey: "k2", isActive: true },
    ];
    const checks = buildManualDestinationChecks(destinations);
    expect(checks).toHaveLength(1);
    expect(checks[0]!.label).toContain("custom_rtmp");
  });

  it("returns an empty array when there are no destinations", () => {
    expect(buildManualDestinationChecks([])).toEqual([]);
  });
});

describe("classifyPushDestinationError", () => {
  it("flags a Kick auto-provision error as a manual RTMP fallback", () => {
    const result = classifyPushDestinationError(
      new KickAutoProvisionUnavailableError("add manually"),
    );
    expect(result.status).toBe("manual_fallback_required");
    expect(result.manualFallback).toBe(true);
    expect(result.message).toBe("add manually");
  });

  it("treats any other error as a hard failure", () => {
    const result = classifyPushDestinationError(new Error("network down"));
    expect(result.status).toBe("failed");
    expect(result.manualFallback).toBe(false);
    expect(result.message).toBe("network down");
  });

  it("handles non-Error throwables", () => {
    const result = classifyPushDestinationError("boom");
    expect(result.status).toBe("failed");
    expect(result.manualFallback).toBe(false);
    expect(result.message).toBe("boom");
  });
});
