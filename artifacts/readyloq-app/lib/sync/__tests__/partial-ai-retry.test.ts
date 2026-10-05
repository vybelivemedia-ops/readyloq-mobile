import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, string>();

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (key: string) => store.get(key) ?? null,
    setItem: async (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: async (key: string) => {
      store.delete(key);
    },
    multiGet: async (keys: string[]) =>
      keys.map((key) => [key, store.get(key) ?? null] as [string, string | null]),
  },
}));

vi.mock("expo-crypto", () => ({ randomUUID: () => "partial-ai-retry" }));

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

const analyzeInspection = vi.fn();
const addInspectionMedia = vi.fn();

vi.mock("@/lib/api-client", () => ({
  createInspection: vi.fn().mockResolvedValue({ id: 42 }),
  updateInspection: vi.fn().mockResolvedValue({}),
  analyzeInspection: (...args: unknown[]) => analyzeInspection(...args),
  completeInspection: vi.fn().mockResolvedValue({ reportId: null }),
  addInspectionMedia: (...args: unknown[]) => addInspectionMedia(...args),
}));

vi.mock("@/lib/api-client/bait-stations", () => ({
  createBaitStation: vi.fn().mockResolvedValue({ id: 1 }),
  updateBaitStation: vi.fn().mockResolvedValue({}),
}));

vi.mock("@/lib/api-client/corrections", () => ({
  correctFinding: vi.fn().mockResolvedValue({}),
}));

const reserveUploadPath = vi.fn();
const doUpload = vi.fn();

vi.mock("@/lib/upload", () => ({
  reserveUploadPath: (...args: unknown[]) => reserveUploadPath(...args),
  doUpload: (...args: unknown[]) => doUpload(...args),
  probeStoragePath: vi.fn().mockResolvedValue(false),
}));

import {
  canonicalStoragePath,
  getLocalInspection,
  hasPendingWork,
  newLocalInspection,
  saveLocalInspection,
  setLocalInspectionOwner,
} from "../../local/inspection-store";
import { configureSyncEngine, syncNow } from "../engine";

setLocalInspectionOwner("partial-ai-test-owner");
configureSyncEngine({ getToken: async () => "test-token", ownerId: "partial-ai-test-owner" });

const successfulPath = "/api/storage/objects/companies/1/media/success.jpg";
const retryPath = "/api/storage/objects/companies/1/media/retry.jpg";
const successfulResponsePath = "/objects/companies/1/media/success.jpg";
const retryResponsePath = "/objects/companies/1/media/retry.jpg";

beforeEach(() => {
  store.clear();
  setLocalInspectionOwner("partial-ai-test-owner");
  analyzeInspection.mockReset();
  addInspectionMedia.mockClear();
  reserveUploadPath.mockClear();
  doUpload.mockClear();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("partial AI analysis retry", () => {
  it("retries a persisted failed photo after restart without re-uploading evidence", async () => {
    const inspection = newLocalInspection({
      siteAddress: "1 Retry Road",
      clientName: "Retry Client",
      technicianName: "Test Technician",
      propertyType: "commercial",
      pestTypes: [],
      notes: "",
    });
    inspection.serverId = 42;
    inspection.photos = [
      {
        localUri: "file:///documents/success.jpg",
        capturedAt: "2026-09-15T10:00:00.000Z",
        storagePath: successfulPath,
        mediaRowId: 101,
      },
      {
        localUri: "file:///documents/retry.jpg",
        capturedAt: "2026-09-15T10:01:00.000Z",
        storagePath: retryPath,
        mediaRowId: 102,
      },
    ];
    await saveLocalInspection(inspection);

    analyzeInspection
      .mockResolvedValueOnce({ analyzedImagePaths: [successfulResponsePath] })
      .mockResolvedValueOnce({
        analyzedImagePaths: [successfulResponsePath, retryResponsePath],
      });

    await syncNow(inspection.localId);

    const partial = await getLocalInspection(inspection.localId);
    expect(partial?.analyzedCount).toBe(1);
    expect(partial?.analyzedPhotoPaths).toEqual([successfulPath]);
    expect(partial && hasPendingWork(partial)).toBe(true);
    expect(analyzeInspection).toHaveBeenCalledTimes(1);
    expect(analyzeInspection.mock.calls[0]?.[0]).toMatchObject({
      images: [{ imageUrl: successfulPath }, { imageUrl: retryPath }],
    });

    // Simulate an app restart: AsyncStorage survives, but the store and sync
    // engine modules (including their in-memory lifecycle state) are reloaded.
    vi.resetModules();
    const freshStore = await import("../../local/inspection-store");
    const freshEngine = await import("../engine");
    freshEngine.configureSyncEngine({
      getToken: async () => "test-token",
      ownerId: "partial-ai-test-owner",
    });

    const reloaded = await freshStore.getLocalInspection(inspection.localId);
    expect(reloaded?.analyzedCount).toBe(1);
    expect(reloaded?.analyzedPhotoPaths).toEqual([successfulPath]);
    expect(reloaded && freshStore.hasPendingWork(reloaded)).toBe(true);

    // Restart must preserve the pending analysis cooldown.
    await vi.advanceTimersByTimeAsync(30_000);
    await freshEngine.syncNow(inspection.localId);

    const settled = await freshStore.getLocalInspection(inspection.localId);
    expect(settled?.analyzedCount).toBe(2);
    expect(settled?.analyzedPhotoPaths).toEqual([successfulPath, retryPath]);
    expect(settled && freshStore.hasPendingWork(settled)).toBe(false);
    expect(analyzeInspection).toHaveBeenCalledTimes(2);
    expect(reserveUploadPath).not.toHaveBeenCalled();
    expect(doUpload).not.toHaveBeenCalled();
    expect(addInspectionMedia).not.toHaveBeenCalled();
  });

  it("keeps the correct pending paths when photos change after a partial retry", async () => {
    const inspection = newLocalInspection({
      siteAddress: "2 Edited Road",
      clientName: "Edited Client",
      technicianName: "Test Technician",
      propertyType: "commercial",
      pestTypes: [],
      notes: "",
    });
    inspection.serverId = 42;
    inspection.photos = [
      {
        localUri: "file:///documents/success.jpg",
        capturedAt: "2026-09-15T10:00:00.000Z",
        storagePath: successfulPath,
        mediaRowId: 101,
      },
      {
        localUri: "file:///documents/retry.jpg",
        capturedAt: "2026-09-15T10:01:00.000Z",
        storagePath: retryPath,
        mediaRowId: 102,
      },
    ];
    await saveLocalInspection(inspection);
    analyzeInspection.mockResolvedValueOnce({
      analyzedImagePaths: [successfulResponsePath],
    });

    await syncNow(inspection.localId);

    const addedPath = "/api/storage/objects/companies/1/media/added.jpg";
    const addedResponsePath = "/objects/companies/1/media/added.jpg";
    const edited = await getLocalInspection(inspection.localId);
    expect(edited).not.toBeNull();
    edited!.photos = [
      {
        localUri: "file:///documents/added.jpg",
        capturedAt: "2026-09-15T10:02:00.000Z",
        storagePath: addedPath,
        mediaRowId: 103,
      },
      edited!.photos[0],
    ];
    await saveLocalInspection(edited!);

    analyzeInspection.mockResolvedValueOnce({
      analyzedImagePaths: [addedResponsePath],
    });
    await vi.advanceTimersByTimeAsync(30_000);
    await syncNow(inspection.localId);

    expect(analyzeInspection.mock.calls[1]?.[0]).toMatchObject({
      images: [{ imageUrl: addedPath }],
    });
    const settled = await getLocalInspection(inspection.localId);
    expect(settled?.analyzedPhotoPaths).toEqual([successfulPath, addedPath]);
    expect(settled?.analyzedCount).toBe(2);
    expect(settled && hasPendingWork(settled)).toBe(false);
  });

  it("migrates count-only records conservatively to path acknowledgement", () => {
    const legacy = newLocalInspection({
      siteAddress: "3 Legacy Road",
      clientName: "Legacy Client",
      technicianName: "Test Technician",
      propertyType: "commercial",
      pestTypes: [],
      notes: "",
    });
    legacy.serverId = 42;
    legacy.analyzedCount = 1;
    legacy.photos = [
      {
        localUri: "file:///documents/success.jpg",
        capturedAt: "2026-09-15T10:00:00.000Z",
        storagePath: successfulPath,
        mediaRowId: 101,
      },
    ];
    const raw = JSON.parse(JSON.stringify(legacy)) as Record<string, unknown>;
    delete raw.analyzedPhotoPaths;

    return import("../../local/inspection-store").then(({ parseRecord }) => {
      const migrated = parseRecord(JSON.stringify(raw));
      expect(migrated?.analyzedPhotoPaths).toEqual([]);
      expect(migrated && hasPendingWork(migrated)).toBe(true);
    });
  });

  it("matches mobile storage URLs to canonical analysis response paths", () => {
    expect(canonicalStoragePath(successfulPath)).toBe(successfulResponsePath);
    expect(canonicalStoragePath(successfulResponsePath)).toBe(
      successfulResponsePath,
    );
  });
});