import { describe, expect, it, vi } from "vitest";
import { assessQueuedPhoto } from "./photo-analysis-queue";
import type { analyzePhoto } from "./intelligence-ai";

describe("per-photo queue boundary", () => {
  it("disables hidden provider retries so each retried request needs a new budget claim", async () => {
    const assess = vi.fn(async () =>
      ({ zone: "kitchen_sanitation", confidence: 0.8 }) as Awaited<ReturnType<typeof analyzePhoto>>,
    ) as unknown as typeof analyzePhoto;

    const outcome = await assessQueuedPhoto("one", null, Date.now() + 1_000, 100, assess);

    expect(outcome.status).toBe("completed");
    expect(assess).toHaveBeenCalledTimes(1);
    expect(assess).toHaveBeenCalledWith(
      "one",
      null,
      expect.objectContaining({ rateLimitRetries: 0 }),
    );
  });

  it("settles an unresponsive photo without blocking the other three", async () => {
    const assess = vi.fn(async (path: string) => {
      if (path === "stalled") return new Promise<null>(() => {});
      return { zone: "kitchen_sanitation", confidence: 0.8 } as Awaited<ReturnType<typeof analyzePhoto>>;
    }) as unknown as typeof analyzePhoto;
    const outcomes = await Promise.all(
      ["one", "stalled", "three", "four"].map((path) =>
        assessQueuedPhoto(path, null, Date.now() + 1_000, 10, assess),
      ),
    );
    expect(outcomes.map((outcome) => outcome.status)).toEqual([
      "completed", "deferred", "completed", "completed",
    ]);
    expect(assess).toHaveBeenCalledTimes(4);
  });
});