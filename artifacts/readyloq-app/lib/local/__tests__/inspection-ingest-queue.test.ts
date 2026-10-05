import { describe, expect, it } from "vitest";

import { createInspectionIngestQueue } from "../inspection-ingest-queue";

describe("createInspectionIngestQueue", () => {
  it("runs rapid photo persistence jobs one at a time in capture order", async () => {
    const queue = createInspectionIngestQueue();
    const events: string[] = [];
    let releaseFirst!: () => void;

    const first = queue.enqueue(async () => {
      events.push("first:start");
      await new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
      events.push("first:end");
      return "first";
    });
    const second = queue.enqueue(async () => {
      events.push("second:start");
      events.push("second:end");
      return "second";
    });

    await Promise.resolve();
    expect(events).toEqual(["first:start"]);
    releaseFirst();
    await expect(Promise.all([first, second])).resolves.toEqual(["first", "second"]);
    expect(events).toEqual(["first:start", "first:end", "second:start", "second:end"]);
  });

  it("continues with the next photo after an earlier persistence failure", async () => {
    const queue = createInspectionIngestQueue();
    const events: string[] = [];

    const failed = queue.enqueue(async () => {
      events.push("failed");
      throw new Error("disk write failed");
    });
    const recovered = queue.enqueue(async () => {
      events.push("recovered");
      return true;
    });

    await expect(failed).rejects.toThrow("disk write failed");
    await expect(recovered).resolves.toBe(true);
    await expect(queue.drain()).resolves.toBeUndefined();
    expect(events).toEqual(["failed", "recovered"]);
  });

  it("drain waits for a job enqueued while the previous tail is settling", async () => {
    const queue = createInspectionIngestQueue();
    let releaseFirst!: () => void;
    let releaseSecond!: () => void;

    void queue.enqueue(
      () =>
        new Promise<void>((resolve) => {
          releaseFirst = resolve;
        }),
    );
    await Promise.resolve();
    const drained = queue.drain();
    void queue.enqueue(
      () =>
        new Promise<void>((resolve) => {
          releaseSecond = resolve;
        }),
    );

    let didDrain = false;
    void drained.then(() => {
      didDrain = true;
    });
    releaseFirst();
    while (!releaseSecond) {
      await Promise.resolve();
    }
    expect(didDrain).toBe(false);
    releaseSecond();
    await drained;
    expect(didDrain).toBe(true);
  });
});