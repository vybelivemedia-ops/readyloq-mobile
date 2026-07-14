import { describe, it, expect } from "vitest";

import {
  deriveRecordingStatus,
  buildRecordingSummary,
  recordingThumbnailObjectPath,
  type StreamRow,
} from "./recordingSummary";

/**
 * Build a full StreamRow with sensitive operational fields populated so the
 * privacy tests can prove they never leak through the archive projection.
 */
function makeStreamRow(overrides: Partial<StreamRow> = {}): StreamRow {
  const base = {
    id: "stream-1",
    userId: "user-1",
    title: "My Stream",
    description: "A description",
    status: "ended",
    // ── Sensitive operational fields that must NEVER reach the archive list ──
    streamKey: "SECRET-STREAM-KEY",
    rtmpIngestUrl: "rtmp://ingest.example.com/live",
    cloudRecordingResourceId: null,
    cloudRecordingSid: null,
    recordingUrl: null,
    recordingError: null,
    // ── Archive-relevant fields ─────────────────────────────────────────────
    thumbnailUrl: null,
    durationSeconds: 120,
    clipsCount: 2,
    peakViewers: 10,
    avgViewers: 5,
    totalViews: 100,
    startedAt: new Date("2026-01-01T10:00:00Z"),
    endedAt: new Date("2026-01-01T11:00:00Z"),
    createdAt: new Date("2026-01-01T09:00:00Z"),
    updatedAt: new Date("2026-01-01T11:00:00Z"),
  } as unknown as StreamRow;
  return { ...base, ...overrides } as StreamRow;
}

describe("deriveRecordingStatus", () => {
  it("returns archived when a recordingUrl is present", () => {
    expect(
      deriveRecordingStatus({
        recordingUrl: "recordings/s1/rec.mp4",
        recordingError: null,
        cloudRecordingResourceId: null,
        cloudRecordingSid: null,
      }),
    ).toBe("archived");
  });

  it("prefers archived over a stale error when both are set", () => {
    expect(
      deriveRecordingStatus({
        recordingUrl: "recordings/s1/rec.mp4",
        recordingError: "some earlier warning",
        cloudRecordingResourceId: "res",
        cloudRecordingSid: "sid",
      }),
    ).toBe("archived");
  });

  it("returns failed when finalization errored and no url exists", () => {
    expect(
      deriveRecordingStatus({
        recordingUrl: null,
        recordingError: "Recording failed to finalize.",
        cloudRecordingResourceId: "res",
        cloudRecordingSid: "sid",
      }),
    ).toBe("failed");
  });

  it("returns pending when a cloud session exists but no url/error yet", () => {
    expect(
      deriveRecordingStatus({
        recordingUrl: null,
        recordingError: null,
        cloudRecordingResourceId: "res",
        cloudRecordingSid: "sid",
      }),
    ).toBe("pending");
  });

  it("requires BOTH cloud session ids for pending (not just one)", () => {
    expect(
      deriveRecordingStatus({
        recordingUrl: null,
        recordingError: null,
        cloudRecordingResourceId: "res",
        cloudRecordingSid: null,
      }),
    ).toBe("unavailable");
  });

  it("returns unavailable when nothing was captured", () => {
    expect(
      deriveRecordingStatus({
        recordingUrl: null,
        recordingError: null,
        cloudRecordingResourceId: null,
        cloudRecordingSid: null,
      }),
    ).toBe("unavailable");
  });
});

describe("buildRecordingSummary — privacy", () => {
  const ALLOWED_KEYS = [
    "streamId",
    "title",
    "description",
    "status",
    "recordingError",
    "durationSeconds",
    "hasRecording",
    "clipsCount",
    "thumbnailUrl",
    "endedAt",
    "createdAt",
  ].sort();

  it("exposes ONLY the documented archive fields", () => {
    const summary = buildRecordingSummary(makeStreamRow());
    expect(Object.keys(summary).sort()).toEqual(ALLOWED_KEYS);
  });

  it("never leaks stream keys, RTMP ingest URLs, raw recording paths, or Agora ids", () => {
    const summary = buildRecordingSummary(
      makeStreamRow({
        recordingUrl: "recordings/stream-1/rec.mp4",
        cloudRecordingResourceId: "res-123",
        cloudRecordingSid: "sid-456",
      }),
    );
    const serialized = JSON.stringify(summary);
    expect(serialized).not.toContain("SECRET-STREAM-KEY");
    expect(serialized).not.toContain("rtmp://");
    expect(serialized).not.toContain("recordings/stream-1/rec.mp4");
    expect(serialized).not.toContain("res-123");
    expect(serialized).not.toContain("sid-456");
    expect("streamKey" in summary).toBe(false);
    expect("rtmpIngestUrl" in summary).toBe(false);
    expect("recordingUrl" in summary).toBe(false);
  });
});

describe("buildRecordingSummary — projection", () => {
  it("maps archived recordings and hides recordingError", () => {
    const summary = buildRecordingSummary(
      makeStreamRow({
        recordingUrl: "recordings/stream-1/rec.mp4",
        recordingError: "stale",
        thumbnailUrl: "https://cdn.example.com/recordings/stream-1/thumb.jpg",
      }),
    );
    expect(summary.status).toBe("archived");
    expect(summary.hasRecording).toBe(true);
    expect(summary.recordingError).toBeNull();
    expect(summary.thumbnailUrl).toBe("https://cdn.example.com/recordings/stream-1/thumb.jpg");
    expect(summary.durationSeconds).toBe(120);
    expect(summary.endedAt).toBe("2026-01-01T11:00:00.000Z");
  });

  it("surfaces recordingError only when status is failed", () => {
    const summary = buildRecordingSummary(
      makeStreamRow({ recordingUrl: null, recordingError: "Recording failed to finalize." }),
    );
    expect(summary.status).toBe("failed");
    expect(summary.hasRecording).toBe(false);
    expect(summary.recordingError).toBe("Recording failed to finalize.");
  });

  it("defaults a missing duration to 0", () => {
    const summary = buildRecordingSummary(
      makeStreamRow({ durationSeconds: null as unknown as number }),
    );
    expect(summary.durationSeconds).toBe(0);
  });
});

describe("recordingThumbnailObjectPath — deletion consistency", () => {
  it("is deterministic and stream-scoped so upload and delete target the same object", () => {
    expect(recordingThumbnailObjectPath("stream-abc")).toBe("recordings/stream-abc/thumb.jpg");
    // Same input must always yield the same key — otherwise deletion orphans it.
    expect(recordingThumbnailObjectPath("stream-abc")).toBe(
      recordingThumbnailObjectPath("stream-abc"),
    );
    expect(recordingThumbnailObjectPath("stream-x")).not.toBe(
      recordingThumbnailObjectPath("stream-y"),
    );
  });
});
