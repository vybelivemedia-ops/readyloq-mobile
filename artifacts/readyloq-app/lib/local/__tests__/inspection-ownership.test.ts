import { beforeEach, describe, expect, it, vi } from "vitest";
// Isolate the native codec, not the ownership or evidence-store implementation.
vi.mock("expo-image-manipulator", () => ({
  SaveFormat: { JPEG: "jpeg" }, manipulateAsync: vi.fn(),
}));

const storage = new Map<string, string>();
let uuidCounter = 0;

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (key: string) => storage.get(key) ?? null,
    setItem: async (key: string, value: string) => { storage.set(key, value); },
    removeItem: async (key: string) => { storage.delete(key); },
    multiGet: async (keys: string[]) =>
      keys.map((key) => [key, storage.get(key) ?? null] as [string, string | null]),
  },
}));

vi.mock("expo-crypto", () => ({ randomUUID: () => `ownership-test-${++uuidCounter}` }));
vi.mock("expo-file-system/legacy", () => ({
  documentDirectory: "file:///documents/",
  makeDirectoryAsync: vi.fn(),
  copyAsync: vi.fn(),
  deleteAsync: vi.fn(),
}));
vi.mock("@/lib/delivery/registry", () => ({ getDeliveryMethod: () => undefined }));

import {
  deleteLocalInspection,
  getLocalInspection,
  listLocalInspections,
  newLocalInspection,
  saveLocalInspection,
  setLocalInspectionOwner,
  setLocalInspectionScope,
} from "../inspection-store";

function makeInspection() {
  return newLocalInspection({
    siteAddress: "1 Private Road",
    clientName: "Private Client",
    technicianName: "Technician",
    propertyType: "commercial",
    pestTypes: [],
    notes: "",
  });
}

beforeEach(() => {
  storage.clear();
  uuidCounter = 0;
  setLocalInspectionOwner(null);
});

describe("offline inspection ownership isolation", () => {
  it("hides another account's records after switch/logout without deleting them", async () => {
    setLocalInspectionOwner("clerk-user-a");
    const recordA = makeInspection();
    await saveLocalInspection(recordA);

    setLocalInspectionOwner(null);
    expect(await listLocalInspections()).toEqual([]);
    expect(await getLocalInspection(recordA.localId)).toBeNull();
    await deleteLocalInspection(recordA.localId);

    setLocalInspectionOwner("clerk-user-b");
    expect(await listLocalInspections()).toEqual([]);
    expect(await getLocalInspection(recordA.localId)).toBeNull();
    const recordB = makeInspection();
    await saveLocalInspection(recordB);

    setLocalInspectionOwner("clerk-user-a");
    expect((await listLocalInspections()).map((record) => record.localId)).toEqual([
      recordA.localId,
    ]);
    expect(await getLocalInspection(recordB.localId)).toBeNull();
  });

  it("fails closed for unowned legacy records and refuses to claim them", async () => {
    const legacy = makeInspection();
    const legacyRaw = JSON.stringify({
      ...legacy,
      ownerUserId: undefined,
      companyId: undefined,
    });
    const recordKey = `readyloq.local-inspection.v1.${legacy.localId}`;
    storage.set(recordKey, legacyRaw);
    storage.set("readyloq.local-inspections.index.v1", JSON.stringify([legacy.localId]));

    setLocalInspectionOwner("new-user");
    expect(await getLocalInspection(legacy.localId)).toBeNull();
    expect(await listLocalInspections()).toEqual([]);
    await expect(saveLocalInspection(legacy)).rejects.toThrow(/another or unknown account/);
    expect(storage.get(recordKey)).toBe(legacyRaw);
  });

  it("does not permit a stale record object to overwrite after an account switch", async () => {
    setLocalInspectionOwner("clerk-user-a");
    const recordA = makeInspection();
    await saveLocalInspection(recordA);
    setLocalInspectionOwner("clerk-user-b");
    recordA.notes = "stale mutation";

    await expect(saveLocalInspection(recordA)).rejects.toThrow(/another or unknown account/);
    setLocalInspectionOwner("clerk-user-a");
    expect((await getLocalInspection(recordA.localId))?.notes).toBe("");
  });

  it("isolates two companies for the same Clerk subject, including null-company scope", async () => {
    setLocalInspectionScope("same-clerk-user", 71);
    const companyARecord = makeInspection();
    await saveLocalInspection(companyARecord);

    setLocalInspectionScope("same-clerk-user", 92);
    expect(await listLocalInspections()).toEqual([]);
    expect(await getLocalInspection(companyARecord.localId)).toBeNull();
    companyARecord.notes = "stale tenant write";
    await expect(saveLocalInspection(companyARecord)).rejects.toThrow(/account\/company/);

    const companyBRecord = makeInspection();
    await saveLocalInspection(companyBRecord);
    expect(companyBRecord.companyId).toBe(92);

    setLocalInspectionScope("same-clerk-user", null);
    expect(await listLocalInspections()).toEqual([]);
    const platformRecord = makeInspection();
    await saveLocalInspection(platformRecord);
    expect(platformRecord.companyId).toBeNull();

    setLocalInspectionScope("same-clerk-user", 71);
    expect((await listLocalInspections()).map((record) => record.localId)).toEqual([
      companyARecord.localId,
    ]);
  });

  it("does not claim a same-owner legacy record missing company scope", async () => {
    setLocalInspectionScope("same-clerk-user", 71);
    const legacy = makeInspection();
    const raw = JSON.stringify({ ...legacy, companyId: undefined });
    const key = `readyloq.local-inspection.v1.${legacy.localId}`;
    storage.set(key, raw);
    storage.set("readyloq.local-inspections.index.v1", JSON.stringify([legacy.localId]));

    expect(await getLocalInspection(legacy.localId)).toBeNull();
    expect(await listLocalInspections()).toEqual([]);
    await expect(saveLocalInspection(legacy)).rejects.toThrow(/another or unknown account\/company/);
    expect(storage.get(key)).toBe(raw);
  });
});