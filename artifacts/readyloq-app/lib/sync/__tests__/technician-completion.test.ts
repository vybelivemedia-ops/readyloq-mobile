import { describe, expect, it, vi } from "vitest";

import { completeTechnicianWorkflow } from "@/lib/inspection/technician-completion";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("completeTechnicianWorkflow", () => {
  it("drains ingestion and persists locally before navigating and starting background AI", async () => {
    const order: string[] = [];

    await completeTechnicianWorkflow({
      drainPendingIngestion: async () => {
        order.push("drained");
      },
      persistLocalCompletion: async () => {
        order.push("persisted");
        return "local-1";
      },
      navigateToSummary: (localId) => {
        order.push(`navigated:${localId}`);
      },
      continueSyncInBackground: (localId) => {
        order.push(`background:${localId}`);
      },
    });

    expect(order).toEqual([
      "drained",
      "persisted",
      "navigated:local-1",
      "background:local-1",
    ]);
  });

  it("navigates while the existing AI/sync request remains unresolved", async () => {
    const unresolvedAi = deferred<void>();
    const navigateToSummary = vi.fn();
    const continueSyncInBackground = vi.fn(() => {
      void unresolvedAi.promise;
    });

    await completeTechnicianWorkflow({
      drainPendingIngestion: async () => {},
      persistLocalCompletion: async () => "local-unresolved",
      navigateToSummary,
      continueSyncInBackground,
    });

    expect(navigateToSummary).toHaveBeenCalledWith("local-unresolved");
    expect(continueSyncInBackground).toHaveBeenCalledWith("local-unresolved");
  });

  it.each([
    ["HTTP 429", Object.assign(new Error("Too many requests"), { status: 429 })],
    ["AI failure", new Error("AI analysis failed")],
    ["offline", new Error("Network request failed")],
  ])("keeps completion successful when background sync later reports %s", async (_label, error) => {
    const navigateToSummary = vi.fn();
    const queueRetry = vi.fn();

    await completeTechnicianWorkflow({
      drainPendingIngestion: async () => {},
      persistLocalCompletion: async () => "local-deferred",
      navigateToSummary,
      continueSyncInBackground: () => {
        void Promise.reject(error).catch(() => queueRetry());
      },
    });
    await Promise.resolve();

    expect(navigateToSummary).toHaveBeenCalledWith("local-deferred");
    expect(queueRetry).toHaveBeenCalledOnce();
  });

  it("does not navigate or start sync until the durable local write succeeds", async () => {
    const persist = deferred<string>();
    const navigateToSummary = vi.fn();
    const continueSyncInBackground = vi.fn();

    const completion = completeTechnicianWorkflow({
      drainPendingIngestion: async () => {},
      persistLocalCompletion: () => persist.promise,
      navigateToSummary,
      continueSyncInBackground,
    });

    await Promise.resolve();
    expect(navigateToSummary).not.toHaveBeenCalled();
    expect(continueSyncInBackground).not.toHaveBeenCalled();

    persist.resolve("local-checkpointed");
    await completion;
    expect(navigateToSummary).toHaveBeenCalledWith("local-checkpointed");
    expect(continueSyncInBackground).toHaveBeenCalledWith("local-checkpointed");
  });
});