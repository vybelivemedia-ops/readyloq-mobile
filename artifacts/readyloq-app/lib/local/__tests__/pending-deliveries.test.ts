/**
 * Unit tests — queued delivery persistence & deduplication
 *
 * Covers three scenarios documented in the task spec:
 *
 *  1. parseRecord migrates old records that lack `pendingDeliveries` to [].
 *  2. enqueueDelivery never creates a second entry for the same methodId.
 *  3. A round-trip through saveLocalInspection → getLocalInspection preserves
 *     `pendingDeliveries` so a queued delivery survives a simulated cold start.
 *
 * React Native / Expo modules that require a native runtime are mocked with
 * lightweight in-memory equivalents so the suite runs in plain Node.js.
 */

import { describe, expect, it, vi } from "vitest";

// ── Module mocks (must be declared before any import that loads them) ─────────

// In-memory AsyncStorage (keyed by string).
const _store = new Map<string, string>();
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (key: string) => _store.get(key) ?? null,
    setItem: async (key: string, value: string) => { _store.set(key, value); },
    removeItem: async (key: string) => { _store.delete(key); },
    multiGet: async (keys: string[]) =>
      keys.map((k) => [k, _store.get(k) ?? null] as [string, string | null]),
  },
}));

// Minimal expo-crypto — randomUUID just needs to be unique.
let _uuidCounter = 0;
vi.mock("expo-crypto", () => ({
  randomUUID: () => `test-uuid-${++_uuidCounter}`,
}));

// expo-file-system/legacy — we never touch the filesystem in these tests.
vi.mock("expo-file-system/legacy", () => ({
  documentDirectory: "file:///documents/",
  makeDirectoryAsync: async () => undefined,
  copyAsync: async () => undefined,
  deleteAsync: async () => undefined,
}));

// The delivery registry is used only by hasPendingWork inside inspection-store.
// Return undefined so no method is treated as auto-retry eligible.
vi.mock("@/lib/delivery/registry", () => ({
  getDeliveryMethod: () => undefined,
}));

// ── Import the module under test AFTER the mocks are in place ─────────────────

import {
  enqueueDelivery,
  getLocalInspection,
  newLocalInspection,
  parseRecord,
  saveLocalInspection,
  setLocalInspectionOwner,
} from "../inspection-store";

setLocalInspectionOwner("pending-delivery-test-owner");

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function makePendingEntry(methodId = "email") {
  return {
    methodId,
    label: methodId === "email" ? "Email" : methodId,
    queuedAt: new Date().toISOString(),
    context: {
      subject: "Inspection report",
      body: "Please find attached.",
      customerSummaryUrl: null,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. parseRecord — schema migration
// ─────────────────────────────────────────────────────────────────────────────

describe("parseRecord — schema migration", () => {
  it("defaults pendingDeliveries to [] when the field is absent (old record)", () => {
    // Simulate an old serialised record written before pendingDeliveries existed.
    const oldRecord = {
      schemaVersion: 1,
      localId: "old-local-id",
      serverId: null,
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z",
      siteAddress: "123 Main St",
      clientName: "Acme Corp",
      technicianName: "Jane Doe",
      propertyType: "commercial",
      pestTypes: [],
      notes: "",
      photos: [],
      baitStations: [],
      completed: false,
      completedAt: null,
      serverCompleted: false,
      analyzedCount: 0,
      reportId: null,
      syncError: null,
      syncAttempts: 0,
      lastSyncSuccess: null,
      allFindingsReviewed: false,
      pendingCorrections: [],
      lastDeliveredAt: null,
      // ← pendingDeliveries intentionally omitted (old format)
    };

    const result = parseRecord(JSON.stringify(oldRecord));

    expect(result).not.toBeNull();
    expect(result!.pendingDeliveries).toEqual([]);
  });

  it("preserves pendingDeliveries when already present", () => {
    const entry = makePendingEntry("share");
    const record = {
      schemaVersion: 1,
      localId: "existing-id",
      serverId: null,
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z",
      siteAddress: "456 Oak Ave",
      clientName: "",
      technicianName: "Bob",
      propertyType: "residential",
      pestTypes: [],
      notes: "",
      photos: [],
      baitStations: [],
      completed: true,
      completedAt: "2024-01-01T01:00:00.000Z",
      serverCompleted: true,
      analyzedCount: 0,
      reportId: 42,
      syncError: null,
      syncAttempts: 0,
      lastSyncSuccess: null,
      allFindingsReviewed: true,
      pendingCorrections: [],
      lastDeliveredAt: null,
      pendingDeliveries: [entry],
    };

    const result = parseRecord(JSON.stringify(record));

    expect(result).not.toBeNull();
    expect(result!.pendingDeliveries).toHaveLength(1);
    expect(result!.pendingDeliveries[0].methodId).toBe("share");
  });

  it("returns null for invalid JSON", () => {
    expect(parseRecord("not-json")).toBeNull();
  });

  it("returns null for a record with wrong schemaVersion", () => {
    expect(parseRecord(JSON.stringify({ schemaVersion: 2, localId: "x" }))).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. enqueueDelivery — deduplication guard
// ─────────────────────────────────────────────────────────────────────────────

describe("enqueueDelivery — deduplication", () => {
  it("adds an entry when the queue is empty", () => {
    const result = enqueueDelivery([], makePendingEntry("email"));
    expect(result).toHaveLength(1);
    expect(result[0].methodId).toBe("email");
  });

  it("does NOT add a second entry when the same methodId is already queued", () => {
    const first = makePendingEntry("email");
    const alreadyQueued = [first];

    // Simulate the technician tapping Send a second time while still offline.
    const result = enqueueDelivery(alreadyQueued, makePendingEntry("email"));

    expect(result).toHaveLength(1);
    // The original entry is preserved unchanged.
    expect(result[0]).toBe(first);
  });

  it("adds a different channel even when one channel is already queued", () => {
    const existing = [makePendingEntry("email")];
    const result = enqueueDelivery(existing, makePendingEntry("share"));

    expect(result).toHaveLength(2);
    expect(result.map((d) => d.methodId)).toEqual(["email", "share"]);
  });

  it("is pure — does not mutate the original array", () => {
    const original = [makePendingEntry("email")];
    const frozen = Object.freeze([...original]);
    // Should return a new array without throwing.
    const result = enqueueDelivery(frozen as typeof original, makePendingEntry("share"));
    expect(result).not.toBe(frozen);
    expect(result).toHaveLength(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Persistence round-trip (cold-start simulation)
// ─────────────────────────────────────────────────────────────────────────────

describe("pendingDeliveries persistence — survives cold start", () => {
  it("restores a queued delivery after save + reload from AsyncStorage", async () => {
    // Step 1 — create and save a fresh inspection.
    const inspection = newLocalInspection({
      siteAddress: "789 Elm St",
      clientName: "Beta LLC",
      technicianName: "Alice",
      propertyType: "residential",
      pestTypes: ["rodent"],
      notes: "",
    });

    // Step 2 — add a pending delivery (simulates the UI enqueueing on failure).
    inspection.pendingDeliveries = enqueueDelivery(
      inspection.pendingDeliveries,
      makePendingEntry("email"),
    );
    await saveLocalInspection(inspection);

    // Step 3 — read back (simulates a cold start reloading from AsyncStorage).
    const reloaded = await getLocalInspection(inspection.localId);

    expect(reloaded).not.toBeNull();
    expect(reloaded!.pendingDeliveries).toHaveLength(1);
    expect(reloaded!.pendingDeliveries[0].methodId).toBe("email");
    expect(reloaded!.pendingDeliveries[0].context.subject).toBe("Inspection report");
  });

  it("does not duplicate the entry if queueing the same channel twice between saves", async () => {
    const inspection = newLocalInspection({
      siteAddress: "1 Maple Rd",
      clientName: "Gamma Inc",
      technicianName: "Carlos",
      propertyType: "commercial",
      pestTypes: [],
      notes: "",
    });

    // First failed send.
    inspection.pendingDeliveries = enqueueDelivery(
      inspection.pendingDeliveries,
      makePendingEntry("email"),
    );
    await saveLocalInspection(inspection);

    // Second tap while offline — reload, attempt to enqueue again, save.
    const mid = await getLocalInspection(inspection.localId);
    expect(mid).not.toBeNull();
    mid!.pendingDeliveries = enqueueDelivery(mid!.pendingDeliveries, makePendingEntry("email"));
    await saveLocalInspection(mid!);

    // Final read — must still have exactly one entry.
    const final = await getLocalInspection(inspection.localId);
    expect(final).not.toBeNull();
    expect(final!.pendingDeliveries).toHaveLength(1);
  });
});
