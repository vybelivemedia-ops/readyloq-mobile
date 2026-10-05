import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  secureStore: new Map<string, string>(),
  task: null as ((event: unknown) => Promise<unknown>) | null,
  runBackgroundSync: vi.fn(),
}));

vi.mock("expo-secure-store", () => ({
  setItemAsync: async (key: string, value: string) => {
    mocks.secureStore.set(key, value);
  },
  getItemAsync: async (key: string) => mocks.secureStore.get(key) ?? null,
  deleteItemAsync: async (key: string) => {
    mocks.secureStore.delete(key);
  },
}));

vi.mock("expo-task-manager", () => ({
  defineTask: (_name: string, task: (event: unknown) => Promise<unknown>) => {
    mocks.task = task;
  },
  isTaskRegisteredAsync: vi.fn().mockResolvedValue(false),
}));

vi.mock("expo-background-fetch", () => ({
  BackgroundFetchResult: { NoData: "no-data", NewData: "new-data", Failed: "failed" },
  registerTaskAsync: vi.fn(),
  unregisterTaskAsync: vi.fn(),
}));

vi.mock("@/lib/sync/engine", () => ({
  runBackgroundSync: (...args: unknown[]) => mocks.runBackgroundSync(...args),
}));

import {
  BACKGROUND_SYNC_TASK,
  cacheTokenForBackground,
  clearCachedBackgroundToken,
} from "../background-task";

beforeEach(() => {
  mocks.secureStore.clear();
  mocks.runBackgroundSync.mockReset().mockResolvedValue(true);
});

describe("background sync credential company binding", () => {
  it("caches and passes owner plus active company to the background engine", async () => {
    await cacheTokenForBackground("tenant-token", "same-clerk-user", 71);
    const stored = JSON.parse(mocks.secureStore.get("readyloq_bg_token") ?? "{}");
    expect(stored).toEqual({
      token: "tenant-token",
      ownerId: "same-clerk-user",
      companyId: 71,
    });

    await expect(mocks.task?.({ taskName: BACKGROUND_SYNC_TASK })).resolves.toBe("new-data");
    expect(mocks.runBackgroundSync).toHaveBeenCalledWith(
      expect.any(Function),
      "same-clerk-user",
      71,
    );
  });

  it("preserves an explicit null company scope for Super Admin", async () => {
    await cacheTokenForBackground("platform-token", "super-admin-user", null);
    await mocks.task?.({});
    expect(mocks.runBackgroundSync).toHaveBeenCalledWith(
      expect.any(Function),
      "super-admin-user",
      null,
    );
  });

  it("fails closed for old/unscoped cached credentials and clears only credentials", async () => {
    mocks.secureStore.set("readyloq_bg_token", JSON.stringify({
      token: "old-token",
      ownerId: "same-clerk-user",
    }));
    await expect(mocks.task?.({})).resolves.toBe("no-data");
    expect(mocks.runBackgroundSync).not.toHaveBeenCalled();

    await clearCachedBackgroundToken();
    expect(mocks.secureStore.has("readyloq_bg_token")).toBe(false);
  });
});