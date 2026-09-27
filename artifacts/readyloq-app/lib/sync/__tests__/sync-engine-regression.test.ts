import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  storage: new Map<string, string>(),
  createInspection: vi.fn(),
  updateInspection: vi.fn(),
  analyzeInspection: vi.fn(),
  completeInspection: vi.fn(),
  addInspectionMedia: vi.fn(),
  reserveUploadPath: vi.fn(),
  doUpload: vi.fn(),
  probeStoragePath: vi.fn(),
}));

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (key: string) => mocks.storage.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      mocks.storage.set(key, value);
    },
    removeItem: async (key: string) => {
      mocks.storage.delete(key);
    },
    multiGet: async (keys: string[]) =>
      keys.map((key) => [key, mocks.storage.get(key) ?? null] as [string, string | null]),
  },
}));

vi.mock("expo-crypto", () => ({ randomUUID: () => "sync-regression-id" }));

vi.mock("expo-file-system/legacy", () => ({
  documentDirectory: "file:///documents/",
  makeDirectoryAsync: vi.fn(),
  copyAsync: vi.fn(),
  deleteAsync: vi.fn(),
}));

vi.mock("react-native", () => ({
  AppState: { addEventListener: vi.fn(() => ({ remove: vi.fn() })) },
}));

vi.mock("@/lib/delivery/registry", () => ({
  getDeliveryMethod: () => undefined,
}));

vi.mock("@/lib/api-client", () => ({
  createInspection: (...args: unknown[]) => mocks.createInspection(...args),
  updateInspection: (...args: unknown[]) => mocks.updateInspection(...args),
  analyzeInspection: (...args: unknown[]) => mocks.analyzeInspection(...args),
  completeInspection: (...args: unknown[]) => mocks.completeInspection(...args),
  addInspectionMedia: (...args: unknown[]) => mocks.addInspectionMedia(...args),
}));

vi.mock("@/lib/api-client/bait-stations", () => ({
  createBaitStation: vi.fn().mockResolvedValue({ id: 1 }),
  updateBaitStation: vi.fn().mockResolvedValue({}),
}));

vi.mock("@/lib/api-client/corrections", () => ({
  correctFinding: vi.fn().mockResolvedValue({}),
}));

vi.mock("@/lib/upload", () => ({
  reserveUploadPath: (...args: unknown[]) => mocks.reserveUploadPath(...args),
  doUpload: (...args: unknown[]) => mocks.doUpload(...args),
  probeStoragePath: (...args: unknown[]) => mocks.probeStoragePath(...args),
}));

const FIXED_NOW = new Date("2026-04-17T12:00:00.000Z").getTime();
const retryError = (
  status: number,
  headers: Record<string, string> = {},
): Error & { status: number; headers: { get: (name: string) => string | null } } => {
  const error = new Error(`HTTP ${status}`) as Error & {
    status: number;
    headers: { get: (name: string) => string | null };
  };
  error.status = status;
  error.headers = {
    get: (name) => headers[name] ?? headers[name.toLowerCase()] ?? null,
  };
  return error;
};

let store: typeof import("../../local/inspection-store");
let engine: typeof import("../engine");

beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(FIXED_NOW);
  mocks.storage.clear();
  mocks.createInspection.mockReset().mockResolvedValue({ id: 42 });
  mocks.updateInspection.mockReset().mockResolvedValue({});
  mocks.analyzeInspection.mockReset().mockResolvedValue({ analyzedImagePaths: [] });
  mocks.completeInspection.mockReset().mockResolvedValue({ reportId: null });
  mocks.addInspectionMedia.mockReset().mockResolvedValue({ id: 101 });
  mocks.reserveUploadPath.mockReset().mockImplementation(async (_token, _name, _uri) => ({
    uploadURL: "https://storage.test/upload",
    storagePath: "/api/storage/objects/test/photo.jpg",
  }));
  mocks.doUpload.mockReset().mockResolvedValue(undefined);
  mocks.probeStoragePath.mockReset().mockResolvedValue(false);
  vi.spyOn(Math, "random").mockReturnValue(0);
  store = await import("../../local/inspection-store");
  engine = await import("../engine");
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

async function makeInspection() {
  const record = store.newLocalInspection({
    siteAddress: "1 Sync Road",
    clientName: "Regression Client",
    technicianName: "Test Technician",
    propertyType: "commercial",
    pestTypes: [],
    notes: "",
  });
  await store.saveLocalInspection(record);
  return record;
}

describe("sync engine regression flows", () => {
  it("automatically uploads five photos, analyzes them, then completes and acknowledges the report", async () => {
    const inspection = await makeInspection();
    inspection.completed = true;
    inspection.photos = Array.from({ length: 5 }, (_, index) => ({
      localUri: `file:///documents/photo-${index}.jpg`,
      capturedAt: "2026-04-17T11:00:00.000Z",
    }));
    await store.saveLocalInspection(inspection);
    mocks.reserveUploadPath.mockImplementation(async (_token, _name, uri: string) => ({
      uploadURL: "https://storage.test/upload",
      storagePath: `/api/storage/objects/test/${uri.split("/").pop()}`,
    }));
    mocks.addInspectionMedia.mockImplementation(async () => ({
      id: mocks.addInspectionMedia.mock.calls.length,
    }));
    mocks.analyzeInspection.mockImplementation(async ({ images }: {
      images: Array<{ imageUrl: string }>;
    }) => ({
      analyzedImagePaths: images.map((image) => image.imageUrl.replace("/api/storage", "")),
    }));
    mocks.completeInspection.mockResolvedValue({ reportId: 77 });

    await engine.runBackgroundSync(async () => "test-token");

    const synced = await store.getLocalInspection(inspection.localId);
    expect(mocks.doUpload).toHaveBeenCalledTimes(5);
    expect(mocks.addInspectionMedia).toHaveBeenCalledTimes(5);
    expect(mocks.analyzeInspection).toHaveBeenCalledWith(expect.objectContaining({
      draft: true,
      images: expect.arrayContaining([
        expect.objectContaining({ imageUrl: expect.stringContaining("photo-0.jpg") }),
      ]),
    }));
    expect(mocks.analyzeInspection.mock.calls[0][0].images).toHaveLength(5);
    expect(mocks.completeInspection).toHaveBeenCalledWith(42);
    expect(mocks.completeInspection.mock.invocationCallOrder[0])
      .toBeGreaterThan(mocks.analyzeInspection.mock.invocationCallOrder[0]);
    expect(synced?.analyzedPhotoPaths).toHaveLength(5);
    expect(synced?.serverCompleted).toBe(true);
    expect(synced?.reportId).toBe(77);
    expect(synced && store.hasPendingWork(synced)).toBe(false);
  });

  it("successfully syncs a pending inspection and acknowledges it", async () => {
    const inspection = await makeInspection();

    expect(await engine.runBackgroundSync(async () => "test-token")).toBe(true);

    const synced = await store.getLocalInspection(inspection.localId);
    expect(mocks.createInspection).toHaveBeenCalledWith(
      expect.objectContaining({ clientKey: inspection.localId }),
    );
    expect(mocks.updateInspection).toHaveBeenCalledWith(42, expect.any(Object));
    expect(synced?.serverId).toBe(42);
    expect(synced?.syncAttempts).toBe(0);
    expect(synced?.syncError).toBeNull();
    expect(synced && store.hasPendingWork(synced)).toBe(false);
  });

  it("persists a 429 error and its first backoff deadline", async () => {
    const inspection = await makeInspection();
    mocks.createInspection.mockRejectedValueOnce(retryError(429));

    expect(await engine.runBackgroundSync(async () => "test-token")).toBe(true);

    const failed = await store.getLocalInspection(inspection.localId);
    expect(failed?.syncAttempts).toBe(1);
    expect(failed?.nextSyncAt).toBe(new Date(FIXED_NOW + 45_000).toISOString());
    expect(failed?.syncError).toContain("429");
  });

  it("increases the retry deadline after repeated 429 responses", async () => {
    const inspection = await makeInspection();
    mocks.createInspection
      .mockRejectedValueOnce(retryError(429))
      .mockRejectedValueOnce(retryError(429));

    await engine.runBackgroundSync(async () => "test-token");
    await vi.advanceTimersByTimeAsync(45_000);
    await engine.runBackgroundSync(async () => "test-token");

    const failed = await store.getLocalInspection(inspection.localId);
    expect(failed?.syncAttempts).toBe(2);
    expect(failed?.nextSyncAt).toBe(new Date(FIXED_NOW + 45_000 + 90_000).toISOString());
    expect(mocks.createInspection).toHaveBeenCalledTimes(2);
  });

  it("honors Retry-After when it exceeds the normal 429 backoff", async () => {
    const inspection = await makeInspection();
    mocks.createInspection.mockRejectedValueOnce(
      retryError(429, { "Retry-After": "180" }),
    );

    await engine.runBackgroundSync(async () => "test-token");

    const failed = await store.getLocalInspection(inspection.localId);
    expect(failed?.nextSyncAt).toBe(new Date(FIXED_NOW + 180_000).toISOString());
  });

  it("uses HTTP-date Retry-After and RateLimit-Reset deadlines", async () => {
    const { retryDelayMs } = await import("../retry-policy");
    expect(retryDelayMs(
      retryError(429, { "Retry-After": new Date(FIXED_NOW + 240_000).toUTCString() }),
      1, FIXED_NOW, () => 0,
    )).toBe(240_000);
    expect(retryDelayMs(
      retryError(429, { "RateLimit-Reset": "300" }),
      1, FIXED_NOW, () => 0,
    )).toBe(300_000);
  });

  it("uses the ordinary network-error backoff", async () => {
    const inspection = await makeInspection();
    mocks.createInspection.mockRejectedValueOnce(new Error("Network request failed"));

    await engine.runBackgroundSync(async () => "test-token");

    const failed = await store.getLocalInspection(inspection.localId);
    expect(failed?.syncAttempts).toBe(1);
    expect(failed?.nextSyncAt).toBe(new Date(FIXED_NOW + 7_500).toISOString());
    expect(failed?.syncError).toBe("Network request failed");
  });

  it("rejects a concurrent duplicate sync trigger while a pass is running", async () => {
    const inspection = await makeInspection();
    let finishCreate!: (value: { id: number }) => void;
    mocks.createInspection.mockImplementationOnce(
      () => new Promise((resolve) => { finishCreate = resolve; }),
    );

    const first = engine.runBackgroundSync(async () => "test-token");
    await vi.waitFor(() => expect(mocks.createInspection).toHaveBeenCalledTimes(1));
    await expect(engine.runBackgroundSync(async () => "test-token")).resolves.toBe(false);
    finishCreate({ id: 42 });

    await expect(first).resolves.toBe(true);
    expect(mocks.createInspection).toHaveBeenCalledTimes(1);
    const synced = await store.getLocalInspection(inspection.localId);
    expect(synced && store.hasPendingWork(synced)).toBe(false);
  });

  it("does not let store, foreground, and manual triggers bypass a 429 deadline", async () => {
    const inspection = await makeInspection();
    mocks.createInspection.mockRejectedValueOnce(retryError(429));
    engine.configureSyncEngine({ getToken: async () => "test-token" });
    await engine.syncNow(inspection.localId);
    expect(mocks.createInspection).toHaveBeenCalledTimes(1);
    // A checkpoint notification and foreground wakeup both schedule a pass,
    // but neither is allowed to send before the persisted deadline.
    await store.updateLocalInspection(inspection.localId, (r) => { r.notes = "updated"; });
    engine.requestSync(0);
    await vi.advanceTimersByTimeAsync(10_000);
    await engine.syncNow(inspection.localId);
    expect(mocks.createInspection).toHaveBeenCalledTimes(1);
    expect((await store.getLocalInspection(inspection.localId))?.syncAttempts).toBe(1);
  });

  it("retains pending work across an app-module restart and resumes after its deadline", async () => {
    const inspection = await makeInspection();
    mocks.createInspection.mockRejectedValueOnce(new Error("offline"));

    await engine.runBackgroundSync(async () => "test-token");
    const pending = await store.getLocalInspection(inspection.localId);
    expect(pending?.nextSyncAt).toBe(new Date(FIXED_NOW + 7_500).toISOString());

    // AsyncStorage is durable while in-memory store/engine state is re-created.
    vi.resetModules();
    store = await import("../../local/inspection-store");
    engine = await import("../engine");
    await vi.advanceTimersByTimeAsync(7_500);
    expect(await engine.runBackgroundSync(async () => "test-token")).toBe(true);

    const resumed = await store.getLocalInspection(inspection.localId);
    expect(resumed?.serverId).toBe(42);
    expect(resumed && store.hasPendingWork(resumed)).toBe(false);
    expect(mocks.createInspection).toHaveBeenCalledTimes(2);
  });

  it("does not send an already-synced inspection again", async () => {
    const inspection = await makeInspection();
    inspection.serverId = 42;
    await store.saveLocalInspection(inspection);

    expect(await engine.runBackgroundSync(async () => "test-token")).toBe(false);
    expect(mocks.createInspection).not.toHaveBeenCalled();
    expect(mocks.updateInspection).not.toHaveBeenCalled();
  });

  it("keeps an upload checkpoint after partial upload failure and retries it", async () => {
    const inspection = await makeInspection();
    inspection.photos = [{
      localUri: "file:///documents/photo.jpg",
      capturedAt: "2026-04-17T11:00:00.000Z",
    }];
    await store.saveLocalInspection(inspection);
    mocks.analyzeInspection.mockResolvedValue({
      analyzedImagePaths: ["/objects/test/photo.jpg"],
    });
    mocks.doUpload
      .mockRejectedValueOnce(new Error("storage unavailable"))
      .mockResolvedValueOnce(undefined);

    await engine.runBackgroundSync(async () => "test-token");

    const partial = await store.getLocalInspection(inspection.localId);
    expect(partial?.serverId).toBe(42);
    expect(partial?.photos[0]?.pendingStoragePath).toBe("/api/storage/objects/test/photo.jpg");
    expect(partial?.photos[0]?.uploading).toBe(false);
    expect(partial?.photos[0]?.storagePath).toBeUndefined();
    expect(partial?.syncAttempts).toBe(1);

    await vi.advanceTimersByTimeAsync(7_500);
    await engine.runBackgroundSync(async () => "test-token");

    const completed = await store.getLocalInspection(inspection.localId);
    expect(mocks.probeStoragePath).toHaveBeenCalledWith(
      "/api/storage/objects/test/photo.jpg",
      "test-token",
    );
    expect(mocks.doUpload).toHaveBeenCalledTimes(2);
    expect(mocks.addInspectionMedia).toHaveBeenCalledTimes(1);
    expect(completed?.photos[0]?.storagePath).toBe("/api/storage/objects/test/photo.jpg");
    expect(completed?.photos[0]?.mediaRowId).toBe(101);
    expect(completed && store.hasPendingWork(completed)).toBe(false);
  });

  it("eventually retries a transient network failure successfully", async () => {
    const inspection = await makeInspection();
    mocks.createInspection.mockRejectedValueOnce(new Error("temporary offline"));

    await engine.runBackgroundSync(async () => "test-token");
    expect((await store.getLocalInspection(inspection.localId))?.syncAttempts).toBe(1);

    await vi.advanceTimersByTimeAsync(7_500);
    expect(await engine.runBackgroundSync(async () => "test-token")).toBe(true);

    const synced = await store.getLocalInspection(inspection.localId);
    expect(synced?.syncAttempts).toBe(0);
    expect(synced?.syncError).toBeNull();
    expect(synced && store.hasPendingWork(synced)).toBe(false);
    expect(mocks.createInspection).toHaveBeenCalledTimes(2);
  });
});