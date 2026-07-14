import { describe, expect, it, vi } from "vitest";
import type { SocialScheduledPostRow } from "@workspace/db";
import {
  isTransientFailure,
  runDueScheduledPosts,
  ScheduledPublishError,
  type ScheduledPostStore,
} from "./scheduledPostPublisher";

/**
 * Deterministic "now" so due-filtering and backoff assertions are stable.
 * Default rows are scheduled one day in the past (i.e. due) relative to this.
 */
const NOW = () => new Date("2026-07-06T00:00:00Z");

function makeRow(over: Partial<SocialScheduledPostRow> = {}): SocialScheduledPostRow {
  const t = new Date("2026-07-06T00:00:00Z");
  return {
    id: "p1",
    userId: "u1",
    platform: "facebook",
    oauthConnectionId: null,
    clipId: null,
    title: "",
    content: "hello world",
    mediaUrl: null,
    hashtags: [],
    scheduledAt: new Date("2026-07-05T00:00:00Z"),
    status: "scheduled",
    requiresApproval: false,
    approvedAt: null,
    publishedAt: null,
    externalPostId: null,
    errorMessage: null,
    retryCount: 0,
    createdBy: "founder",
    createdAt: t,
    updatedAt: t,
    ...over,
  };
}

/**
 * In-memory store that mirrors the production DB semantics exactly:
 * `selectDue` filters on the same predicate as the SQL WHERE, and `claim`
 * is an atomic check-and-set (no await between read and write) so it models
 * the conditional-UPDATE that guards against double-publishing.
 */
function memStore(rows: SocialScheduledPostRow[]): {
  store: ScheduledPostStore;
  map: Map<string, SocialScheduledPostRow>;
} {
  const map = new Map<string, SocialScheduledPostRow>(rows.map((r) => [r.id, { ...r }]));
  const store: ScheduledPostStore = {
    async selectDue(now, limit) {
      return [...map.values()]
        .filter(
          (r) =>
            r.status === "scheduled" &&
            r.scheduledAt.getTime() <= now.getTime() &&
            (r.requiresApproval === false || r.approvedAt != null),
        )
        .sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime())
        .slice(0, limit)
        .map((r) => ({ ...r }));
    },
    async claim(id) {
      const r = map.get(id);
      if (!r || r.status !== "scheduled") return false;
      r.status = "publishing";
      r.errorMessage = null;
      return true;
    },
    async markPublished(id, externalPostId, now) {
      const r = map.get(id);
      if (!r) return;
      r.status = "published";
      r.publishedAt = now;
      r.externalPostId = externalPostId;
      r.errorMessage = null;
    },
    async markFailed(id, errorMessage, retryCount) {
      const r = map.get(id);
      if (!r) return;
      r.status = "failed";
      r.errorMessage = errorMessage.slice(0, 2000);
      r.retryCount = retryCount;
    },
    async requeue(id, nextScheduledAt, retryCount, errorMessage) {
      const r = map.get(id);
      if (!r) return;
      r.status = "scheduled";
      r.scheduledAt = nextScheduledAt;
      r.retryCount = retryCount;
      r.errorMessage = errorMessage.slice(0, 2000);
    },
  };
  return { store, map };
}

describe("runDueScheduledPosts — publishing contract", () => {
  it("only publishes due, approved, `scheduled` rows and never touches the rest", async () => {
    const rows = [
      makeRow({ id: "A", status: "scheduled", requiresApproval: false }),
      makeRow({ id: "B", status: "scheduled", scheduledAt: new Date("2027-01-01T00:00:00Z") }), // future
      makeRow({ id: "C", status: "pending_approval" }),
      makeRow({ id: "D", status: "scheduled", requiresApproval: true, approvedAt: null }),
      makeRow({
        id: "E",
        status: "scheduled",
        requiresApproval: true,
        approvedAt: new Date("2026-07-04T00:00:00Z"),
      }),
      makeRow({ id: "F", status: "published", externalPostId: "already" }),
    ];
    const { store, map } = memStore(rows);
    const publish = vi.fn(async (r: SocialScheduledPostRow) => ({ externalPostId: `ext-${r.id}` }));

    const res = await runDueScheduledPosts({ store, publish, now: NOW });

    // Only A (no approval) and E (approved) are eligible.
    expect(publish).toHaveBeenCalledTimes(2);
    expect(publish.mock.calls.map((c) => c[0].id).sort()).toEqual(["A", "E"]);
    expect(res).toMatchObject({ claimed: 2, published: 2, failed: 0, retried: 0 });

    expect(map.get("A")!.status).toBe("published");
    expect(map.get("E")!.status).toBe("published");
    // Untouched rows keep their state.
    expect(map.get("B")!.status).toBe("scheduled");
    expect(map.get("C")!.status).toBe("pending_approval");
    expect(map.get("D")!.status).toBe("scheduled");
    expect(map.get("F")!.status).toBe("published");
  });

  it("never publishes an approval-required row that was never approved", async () => {
    const { store, map } = memStore([
      makeRow({ id: "A", status: "scheduled", requiresApproval: true, approvedAt: null }),
    ]);
    const publish = vi.fn(async () => ({ externalPostId: "ext" }));

    const res = await runDueScheduledPosts({ store, publish, now: NOW });

    expect(publish).not.toHaveBeenCalled();
    expect(res.published).toBe(0);
    expect(map.get("A")!.status).toBe("scheduled");
  });

  it("records a real success as `published` with an externalPostId and publishedAt", async () => {
    const { store, map } = memStore([makeRow({ id: "A" })]);
    const publish = vi.fn(async () => ({ externalPostId: "yt-xyz" }));

    await runDueScheduledPosts({ store, publish, now: NOW });

    const a = map.get("A")!;
    expect(a.status).toBe("published");
    expect(a.externalPostId).toBe("yt-xyz");
    expect(a.publishedAt).toEqual(NOW());
    expect(a.errorMessage).toBeNull();
  });

  it("the CAS claim prevents two concurrent workers from double-publishing the same row", async () => {
    const { store, map } = memStore([makeRow({ id: "A" })]);
    const publish = vi.fn(async (r: SocialScheduledPostRow) => {
      await new Promise((res) => setTimeout(res, 0));
      return { externalPostId: `ext-${r.id}` };
    });

    const [r1, r2] = await Promise.all([
      runDueScheduledPosts({ store, publish, now: NOW }),
      runDueScheduledPosts({ store, publish, now: NOW }),
    ]);

    expect(publish).toHaveBeenCalledTimes(1);
    expect(r1.published + r2.published).toBe(1);
    expect(r1.claimed + r2.claimed).toBe(1);
    expect(map.get("A")!.status).toBe("published");
  });
});

describe("runDueScheduledPosts — failure & auto-retry", () => {
  it("marks a permanent failure `failed` immediately with the honest error (no retry)", async () => {
    const { store, map } = memStore([makeRow({ id: "A", retryCount: 0 })]);
    const publish = vi
      .fn()
      .mockRejectedValue(new ScheduledPublishError("Instagram is not connected.", { transient: false }));

    const res = await runDueScheduledPosts({ store, publish, now: NOW });

    expect(res).toMatchObject({ published: 0, failed: 1, retried: 0 });
    const a = map.get("A")!;
    expect(a.status).toBe("failed");
    expect(a.errorMessage).toContain("not connected");
    expect(a.retryCount).toBe(0);
  });

  it("requeues a transient failure to `scheduled` with backoff and an incremented retryCount", async () => {
    const { store, map } = memStore([makeRow({ id: "A", retryCount: 0 })]);
    const publish = vi.fn().mockRejectedValue(new Error("network blip")); // non-ScheduledPublishError ⇒ transient

    const res = await runDueScheduledPosts({ store, publish, now: NOW });

    expect(res).toMatchObject({ published: 0, failed: 0, retried: 1 });
    const a = map.get("A")!;
    expect(a.status).toBe("scheduled");
    expect(a.retryCount).toBe(1);
    expect(a.scheduledAt.getTime()).toBeGreaterThan(NOW().getTime());
    expect(a.errorMessage).toContain("network blip");
  });

  it("treats a 5xx/429-flagged platform error as transient and requeues it", async () => {
    const { store, map } = memStore([makeRow({ id: "A", retryCount: 1 })]);
    const publish = vi
      .fn()
      .mockRejectedValue(new ScheduledPublishError("Graph API 503: unavailable", { transient: true }));

    const res = await runDueScheduledPosts({ store, publish, now: NOW });

    expect(res.retried).toBe(1);
    expect(map.get("A")!.status).toBe("scheduled");
    expect(map.get("A")!.retryCount).toBe(2);
  });

  it("stops retrying once the retry cap is reached and marks the row `failed`", async () => {
    const { store, map } = memStore([makeRow({ id: "A", retryCount: 3 })]);
    const publish = vi.fn().mockRejectedValue(new Error("still down"));

    const res = await runDueScheduledPosts({ store, publish, now: NOW });

    expect(res).toMatchObject({ failed: 1, retried: 0 });
    expect(map.get("A")!.status).toBe("failed");
  });
});

describe("isTransientFailure — classification", () => {
  it("treats explicit business-rule failures as permanent", () => {
    expect(isTransientFailure(new ScheduledPublishError("not connected"))).toBe(false);
    expect(isTransientFailure(new ScheduledPublishError("bad request", { transient: false }))).toBe(false);
  });

  it("treats 429/5xx-flagged errors as transient", () => {
    expect(isTransientFailure(new ScheduledPublishError("Graph API 500", { transient: true }))).toBe(true);
  });

  it("treats raw network / unexpected throws as transient", () => {
    expect(isTransientFailure(new Error("fetch failed"))).toBe(true);
    expect(isTransientFailure("weird string throw")).toBe(true);
  });
});
