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
  uploadKeyCounter: 0,
  createBaitStation: vi.fn(),
  updateBaitStation: vi.fn(),
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

vi.mock("expo-crypto", () => ({
  randomUUID: () => `sync-regression-id-${++mocks.uploadKeyCounter}`,
}));

vi.mock("expo-image-manipulator", () => ({
  SaveFormat: { JPEG: "jpeg" },
  manipulateAsync: vi.fn(),
}));

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
  createBaitStation: (...args: unknown[]) => mocks.createBaitStation(...args),
  updateBaitStation: (...args: unknown[]) => mocks.updateBaitStation(...args),
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
  mocks.uploadKeyCounter = 0;
  mocks.createInspection.mockReset().mockResolvedValue({ id: 42 });
  mocks.updateInspection.mockReset().mockResolvedValue({});
  mocks.analyzeInspection.mockReset().mockResolvedValue({ analyzedImagePaths: [] });
  mocks.completeInspection.mockReset().mockResolvedValue({ reportId: null });
  mocks.addInspectionMedia.mockReset().mockResolvedValue({ id: 101 });
  mocks.reserveUploadPath.mockReset().mockImplementation(async (_token, _name, _uri) => ({
    uploadURL: "https://storage.test/upload",
    storagePath: "/api/storage/objects/test/photo.jpg",
    uploadIntentId: 1,
    expectedSize: 123,
  }));
  mocks.doUpload.mockReset().mockResolvedValue(undefined);
  mocks.probeStoragePath.mockReset().mockResolvedValue(false);
  mocks.createBaitStation.mockReset().mockResolvedValue({ id: 500 });
  mocks.updateBaitStation.mockReset().mockResolvedValue({});
  // Every fixture belongs to an explicit authenticated test identity.
  const { setLocalInspectionOwner } = await import("../../local/inspection-store");
  setLocalInspectionOwner("sync-test-owner");
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
  it("keeps DAT source metadata and capture time through durable storage and ordinary sync", async () => {
    const { metaCaptureToEvidence } = await import("../../meta-glasses/capture-delivery");
    const evidence = metaCaptureToEvidence({
      uri: "file:///cache/meta-wearables/real.jpg",
      capturedAt: "2026-04-17T11:59:00.000Z",
      source: "meta_wearables_dat",
      mimeType: "image/jpeg",
    });
    const inspection = await makeInspection();
    // Intake already acknowledged its durable copy; this test owns the
    // persisted-record/offline-sync boundary, not native filesystem capture.
    const durableUri = `file:///documents/${inspection.localId}/photos/meta_dat.jpg`;
    await store.updateLocalInspection(inspection.localId, (r) => {
      r.photos.push({
        localUri: durableUri,
        capturedAt: evidence.capturedAt,
        captureSource: evidence.source,
        captureMetadata: evidence.metadata,
        privacySanitized: true,
      });
    });
    // This persisted record is the offline queue; the normal engine uploads it
    // when connectivity returns, without a DAT-specific endpoint.
    const queued = await store.getLocalInspection(inspection.localId);
    expect(queued?.photos[0].captureMetadata).toEqual(evidence.metadata);
    await engine.runBackgroundSync(async () => "test-token");
    expect(mocks.doUpload).toHaveBeenCalled();
    expect(mocks.addInspectionMedia).toHaveBeenCalledWith(42, expect.objectContaining({
      capturedAt: evidence.capturedAt,
      captureSource: "smart_glasses",
      captureMetadata: evidence.metadata,
    }));
    const synced = await store.getLocalInspection(inspection.localId);
    expect(synced?.photos[0].storagePath).toBeDefined();
    expect(synced?.photos[0].mediaRowId).toBe(101);
  });
  it("automatically uploads five photos, analyzes them, then completes and acknowledges the report", async () => {
    const inspection = await makeInspection();
    inspection.completed = true;
    inspection.photos = Array.from({ length: 5 }, (_, index) => ({
      localUri: `file:///documents/photo-${index}.jpg`,
      capturedAt: "2026-04-17T11:00:00.000Z",
      privacySanitized: true,
    }));
    await store.saveLocalInspection(inspection);
    const serverIssuedPaths: string[] = [];
    const reservationByClientKey = new Map<string, {
      uploadURL: string;
      storagePath: string;
      uploadIntentId: number;
      expectedSize: number;
    }>();
    mocks.reserveUploadPath.mockImplementation(async (...args: unknown[]) => {
      const clientKey = String(args[2]);
      const existing = reservationByClientKey.get(clientKey);
      if (existing) return existing;
      const index = reservationByClientKey.size;
      const path = `/api/storage/objects/companies/14/uploads/server-photo-${index}`;
      serverIssuedPaths.push(path);
      const reservation = {
        uploadURL: `https://storage.test/upload/${index}`,
        storagePath: path,
        uploadIntentId: 700 + index,
        expectedSize: 123,
      };
      reservationByClientKey.set(clientKey, reservation);
      return reservation;
    });
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
    expect(reservationByClientKey.size).toBe(5);
    expect(mocks.reserveUploadPath).toHaveBeenCalledTimes(10);
    for (let index = 0; index < 5; index++) {
      expect(mocks.reserveUploadPath.mock.calls[index * 2]?.[2]).toBe(
        mocks.reserveUploadPath.mock.calls[index * 2 + 1]?.[2],
      );
    }
    expect(mocks.addInspectionMedia).toHaveBeenCalledTimes(5);
    expect(mocks.analyzeInspection).toHaveBeenCalledWith(expect.objectContaining({
      draft: true,
      images: expect.arrayContaining([
        expect.objectContaining({ imageUrl: serverIssuedPaths[0] }),
      ]),
    }));
    expect(mocks.analyzeInspection.mock.calls[0][0].images).toHaveLength(5);
    const registeredMedia = mocks.addInspectionMedia.mock.calls.map(([, body]) => body);
    expect(registeredMedia.map((body) => body.url)).toEqual(serverIssuedPaths);
    expect(registeredMedia.map((body) => body.uploadIntentId)).toEqual([
      700, 701, 702, 703, 704,
    ]);
    expect(registeredMedia.every((body) =>
      /^\/api\/storage\/objects\/companies\/14\/uploads\/server-photo-\d+$/.test(body.url),
    )).toBe(true);
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
    store.setLocalInspectionOwner("sync-test-owner");
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

  it("retains offline evidence when an old upload contract is rejected with 426", async () => {
    const inspection = await makeInspection();
    inspection.photos = [{
      localUri: "file:///documents/legacy-client-photo.jpg",
      capturedAt: "2026-04-17T11:00:00.000Z",
      privacySanitized: true,
    }];
    await store.saveLocalInspection(inspection);
    mocks.reserveUploadPath.mockRejectedValueOnce(
      Object.assign(new Error("Client upgrade required"), { status: 426 }),
    );

    await engine.runBackgroundSync(async () => "test-token");

    const retained = await store.getLocalInspection(inspection.localId);
    expect(retained?.photos[0]?.localUri).toBe("file:///documents/legacy-client-photo.jpg");
    expect(retained?.photos[0]?.storagePath).toBeUndefined();
    expect(retained?.photos[0]?.pendingStoragePath).toBeUndefined();
    expect(mocks.doUpload).not.toHaveBeenCalled();
    expect(mocks.addInspectionMedia).not.toHaveBeenCalled();
    expect(retained && store.hasPendingWork(retained)).toBe(true);
  });

  it("keeps an upload checkpoint after partial upload failure and retries it", async () => {
    const inspection = await makeInspection();
    inspection.photos = [{
      localUri: "file:///documents/photo.jpg",
      capturedAt: "2026-04-17T11:00:00.000Z",
      privacySanitized: true,
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
    expect(partial?.photos[0]?.uploadIntentId).toBe(1);
    expect(partial?.photos[0]?.uploadIntentKey).toEqual(expect.any(String));
    expect(partial?.syncAttempts).toBe(1);

    await vi.advanceTimersByTimeAsync(7_500);
    await engine.runBackgroundSync(async () => "test-token");

    const completed = await store.getLocalInspection(inspection.localId);
    expect(mocks.probeStoragePath).not.toHaveBeenCalled();
    expect(mocks.doUpload).toHaveBeenCalledTimes(2);
    expect(mocks.addInspectionMedia).toHaveBeenCalledTimes(1);
    expect(mocks.addInspectionMedia.mock.calls[0]?.[1]).toMatchObject({
      uploadIntentId: 1,
    });
    expect(mocks.reserveUploadPath.mock.calls[0]?.[2]).toBe(
      mocks.reserveUploadPath.mock.calls[1]?.[2],
    );
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

  it("persists failed bait-station work and retries it after backoff", async () => {
    const inspection = await makeInspection();
    inspection.baitStations = [{
      id: "station-local-1",
      label: "North wall",
      status: "active",
      synced: false,
    }];
    await store.saveLocalInspection(inspection);
    mocks.createBaitStation
      .mockRejectedValueOnce(new Error("station endpoint unavailable"))
      .mockResolvedValueOnce({ id: 501 });

    await engine.runBackgroundSync(async () => "test-token");
    const failed = await store.getLocalInspection(inspection.localId);
    expect(failed?.baitStations[0]?.synced).toBe(false);
    expect(failed?.syncAttempts).toBe(1);
    expect(failed && store.hasPendingWork(failed)).toBe(true);

    await vi.advanceTimersByTimeAsync(7_500);
    await engine.runBackgroundSync(async () => "test-token");

    const retried = await store.getLocalInspection(inspection.localId);
    expect(retried?.baitStations[0]?.serverId).toBe(501);
    expect(retried?.baitStations[0]?.synced).toBe(true);
    expect(retried && store.hasPendingWork(retried)).toBe(false);
  });

  it("replays the persisted create payload after crash/edit and then PATCHes the latest edit", async () => {
    const inspection = await makeInspection();
    inspection.baitStations = [{
      id: "station-local-crash-key",
      label: "South wall",
      status: "active",
      synced: false,
    }];
    await store.saveLocalInspection(inspection);
    const observedKeys: string[] = [];
    const observedPayloads: Array<{ label: string; status: string }> = [];
    let serverCommitted = false;
    mocks.createBaitStation.mockImplementation(async (_inspectionId: number, body: {
      clientKey: string;
      label: string;
      status: string;
    }) => {
      observedKeys.push(body.clientKey);
      observedPayloads.push({ label: body.label, status: body.status });
      if (!serverCommitted) {
        // Model a server commit followed by a lost HTTP response.
        serverCommitted = true;
        throw new Error("response lost after server commit");
      }
      return { id: 602 };
    });

    await engine.runBackgroundSync(async () => "test-token");
    const afterLostResponse = await store.getLocalInspection(inspection.localId);
    expect(afterLostResponse?.baitStations[0]?.serverId).toBeUndefined();
    expect(afterLostResponse?.baitStations[0]?.clientKey).toBe("station-local-crash-key");
    expect(afterLostResponse?.baitStations[0]?.createPayload).toMatchObject({
      label: "South wall",
      status: "active",
    });

    await store.updateLocalInspection(inspection.localId, (record) => {
      const station = record.baitStations[0]!;
      station.status = "damaged";
      station.notes = "Housing cracked";
    });
    expect((await store.getLocalInspection(inspection.localId))?.baitStations[0]?.synced).toBe(false);

    await vi.advanceTimersByTimeAsync(7_500);
    await engine.runBackgroundSync(async () => "test-token");

    const synced = await store.getLocalInspection(inspection.localId);
    expect(observedKeys).toEqual(["station-local-crash-key", "station-local-crash-key"]);
    expect(observedPayloads).toEqual([
      { label: "South wall", status: "active" },
      { label: "South wall", status: "active" },
    ]);
    expect(synced?.baitStations[0]?.serverId).toBe(602);
    expect(synced?.baitStations[0]?.status).toBe("damaged");
    expect(synced?.baitStations[0]?.synced).toBe(false);

    await vi.advanceTimersByTimeAsync(30_000);
    await engine.runBackgroundSync(async () => "test-token");
    expect(mocks.updateBaitStation).toHaveBeenCalledWith(42, 602, expect.objectContaining({
      status: "damaged",
      notes: "Housing cracked",
    }));
    expect((await store.getLocalInspection(inspection.localId))?.baitStations[0]?.synced).toBe(true);
  });

  it("does not acknowledge a station edited while create is in flight", async () => {
    const inspection = await makeInspection();
    inspection.baitStations = [{
      id: "station-concurrent-edit",
      label: "East wall",
      status: "active",
      synced: false,
    }];
    await store.saveLocalInspection(inspection);

    let releaseCreate!: (value: { id: number }) => void;
    let notifyStarted!: () => void;
    const requestStarted = new Promise<void>((resolve) => { notifyStarted = resolve; });
    mocks.createBaitStation.mockImplementationOnce(() => {
      notifyStarted();
      return new Promise((resolve) => { releaseCreate = resolve; });
    });

    const sync = engine.runBackgroundSync(async () => "test-token");
    await requestStarted;
    await store.updateLocalInspection(inspection.localId, (record) => {
      record.baitStations[0]!.status = "missing";
    });
    releaseCreate({ id: 603 });
    await sync;

    const station = (await store.getLocalInspection(inspection.localId))?.baitStations[0];
    expect(station?.serverId).toBe(603);
    expect(station?.status).toBe("missing");
    expect(station?.synced).toBe(false);
  });

  it("does not checkpoint an in-flight response into a newly active account", async () => {
    const inspection = await makeInspection();
    let finishCreate!: (value: { id: number }) => void;
    mocks.createInspection.mockImplementationOnce(
      () => new Promise((resolve) => { finishCreate = resolve; }),
    );
    engine.configureSyncEngine({
      getToken: async () => "test-token",
      ownerId: "sync-test-owner",
    });

    const firstAccountSync = engine.runBackgroundSync(async () => "test-token");
    await vi.waitFor(() => expect(mocks.createInspection).toHaveBeenCalledTimes(1));
    engine.configureSyncEngine({
      getToken: async () => "other-account-token",
      ownerId: "other-clerk-user",
    });
    finishCreate({ id: 77 });
    await expect(firstAccountSync).resolves.toBe(true);

    store.setLocalInspectionOwner("sync-test-owner");
    const stillPending = await store.getLocalInspection(inspection.localId);
    expect(stillPending?.serverId).toBeNull();
    expect(stillPending?.syncAttempts).toBe(0);
  });

  it("rejects a stale background token for a different active account", async () => {
    const inspection = await makeInspection();
    engine.configureSyncEngine({
      getToken: async () => "test-token",
      ownerId: "sync-test-owner",
    });

    await expect(
      engine.runBackgroundSync(async () => "stale-token", "other-clerk-user"),
    ).resolves.toBe(false);
    expect(mocks.createInspection).not.toHaveBeenCalled();
    expect((await store.getLocalInspection(inspection.localId))?.serverId).toBeNull();
  });

  it("cancels sync on a company switch under the same Clerk subject", async () => {
    store.setLocalInspectionScope("same-clerk-user", 71);
    const inspection = store.newLocalInspection({
      siteAddress: "1 Sync Road",
      clientName: "Regression Client",
      technicianName: "Test Technician",
      propertyType: "commercial",
      pestTypes: [],
      notes: "",
    });
    await store.saveLocalInspection(inspection);
    engine.configureSyncEngine({
      getToken: async () => "company-71-token",
      ownerId: "same-clerk-user",
      companyId: 71,
    });
    let finishCreate!: (value: { id: number }) => void;
    mocks.createInspection.mockImplementationOnce(
      () => new Promise((resolve) => { finishCreate = resolve; }),
    );

    const companyASync = engine.runBackgroundSync(
      async () => "company-71-token",
      "same-clerk-user",
      71,
    );
    await vi.waitFor(() => expect(mocks.createInspection).toHaveBeenCalledTimes(1));
    engine.configureSyncEngine({
      getToken: async () => "company-92-token",
      ownerId: "same-clerk-user",
      companyId: 92,
    });
    finishCreate({ id: 88 });
    await expect(companyASync).resolves.toBe(true);

    store.setLocalInspectionScope("same-clerk-user", 71);
    expect((await store.getLocalInspection(inspection.localId))?.serverId).toBeNull();
    store.setLocalInspectionScope("same-clerk-user", 92);
    expect(await store.listLocalInspections()).toEqual([]);
  });

  it("rejects a same-user background credential cached for another company", async () => {
    store.setLocalInspectionScope("same-clerk-user", 71);
    engine.configureSyncEngine({
      getToken: async () => "company-71-token",
      ownerId: "same-clerk-user",
      companyId: 71,
    });
    await expect(
      engine.runBackgroundSync(
        async () => "stale-company-token",
        "same-clerk-user",
        92,
      ),
    ).resolves.toBe(false);
    expect(mocks.createInspection).not.toHaveBeenCalled();
  });
});