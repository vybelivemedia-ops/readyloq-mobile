import { describe, expect, it, vi } from "vitest";
import { assessQueuedPhoto } from "./photo-analysis-queue";
import type { analyzePhoto } from "./intelligence-ai";

describe("per-photo queue boundary", () => {
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