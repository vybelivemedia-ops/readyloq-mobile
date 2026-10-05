/**
 * Unit tests — signature dirty-tracking, race-condition guard, and null-clear consent
 *
 * Covers the three correctness concerns the code reviewer flagged:
 *
 *  1. hasPendingWork() returns true when signaturesSynced is false and false
 *     when it is true — so the scheduler queues / skips the record correctly.
 *
 *  2. Race-condition guard: if sigRev changes while a PATCH is in-flight, the
 *     sync engine must NOT clear signaturesSynced after the round-trip.
 *
 *  3. Null-clear consent flags: techSigClear and ownerSigConsent survive a
 *     round-trip and are cleared only on a successful, uncontested sync.
 *
 *  4. parseRecord migration: old records (no sigRev / consent fields) hydrate
 *     with safe defaults (sigRev=0, flags false, signaturesSynced=true).
 *
 * All React Native / Expo modules are stubbed so the suite runs in plain
 * Node.js exactly like the sibling update-local-inspection.test.ts.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

// ── Module mocks ──────────────────────────────────────────────────────────────

const _store = new Map<string, string>();

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem:    async (key: string) => _store.get(key) ?? null,
    setItem:    async (key: string, value: string) => { _store.set(key, value); },
    removeItem: async (key: string) => { _store.delete(key); },
    multiGet:   async (keys: string[]) =>
      keys.map((k) => [k, _store.get(k) ?? null] as [string, string | null]),
  },
}));

vi.mock("expo-crypto", () => ({
  randomUUID: (() => { let n = 0; return () => `uuid-${++n}`; })(),
}));

vi.mock("expo-file-system/legacy", () => ({
  documentDirectory:    "file:///docs/",
  makeDirectoryAsync:   async () => undefined,
  copyAsync:            async () => undefined,
  deleteAsync:          async () => undefined,
}));

vi.mock("@/lib/delivery/registry", () => ({
  getDeliveryMethod: () => undefined,
}));

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import {
  newLocalInspection,
  saveLocalInspection,
  updateLocalInspection,
  getLocalInspection,
  hasPendingWork,
  parseRecord,
  setLocalInspectionOwner,
} from "../../local/inspection-store";
import type { LocalInspection } from "../../local/inspection-store";

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeInspection(overrides: Partial<Parameters<typeof newLocalInspection>[0]> = {}) {
  return newLocalInspection({
    siteAddress:    "1 Sync Test Lane",
    clientName:     "Sync Corp",
    technicianName: "Jay Tech",
    propertyType:   "commercial",
    pestTypes:      [],
    notes:          "",
    ...overrides,
  });
}

beforeEach(() => {
  _store.clear();
  setLocalInspectionOwner("signature-sync-test-owner");
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. hasPendingWork — signaturesSynced gate
// ─────────────────────────────────────────────────────────────────────────────

describe("hasPendingWork — signaturesSynced", () => {
  it("returns false for a fully-synced completed inspection with no signatures", () => {
    const insp = makeInspection();
    // Simulate a record that has already been fully synced.
    const synced: LocalInspection = {
      ...insp,
      serverId: 42,
      completed: true,
      serverCompleted: true,
      signaturesSynced: true,
    };
    expect(hasPendingWork(synced)).toBe(false);
  });

  it("returns true when signaturesSynced is false, even if serverCompleted is true", () => {
    const insp = makeInspection();
    const unsyncedSig: LocalInspection = {
      ...insp,
      serverId: 42,
      completed: true,
      serverCompleted: true,
      technicianSignature: "<svg/>",
      signaturesSynced: false,
    };
    expect(hasPendingWork(unsyncedSig)).toBe(true);
  });

  it("returns true for explicit owner-clear (null sig + ownerSigConsent) flagged as unsynced", () => {
    const insp = makeInspection();
    const ownerCleared: LocalInspection = {
      ...insp,
      serverId: 42,
      completed: true,
      serverCompleted: true,
      ownerSignature: null,
      ownerSigConsent: true,
      signaturesSynced: false,
    };
    expect(hasPendingWork(ownerCleared)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Unit number dirty tracking
// ─────────────────────────────────────────────────────────────────────────────

describe("hasPendingWork — unitNumberSynced", () => {
  it("retains a schedule-provided unit number when creating a local record", () => {
    const scheduledUnit = makeInspection({ unitNumber: "4B" });

    expect(scheduledUnit.unitNumber).toBe("4B");
    expect(scheduledUnit.unitNumberSynced).toBe(true);
  });

  it("queues a completed inspection when a unit number needs syncing", () => {
    const insp = makeInspection();
    const unsyncedUnit: LocalInspection = {
      ...insp,
      serverId: 42,
      completed: true,
      serverCompleted: true,
      unitNumber: "4B",
      unitNumberSynced: false,
    };

    expect(hasPendingWork(unsyncedUnit)).toBe(true);
  });

  it("does not queue a completed inspection when its unit number is already synced", () => {
    const insp = makeInspection();
    const syncedUnit: LocalInspection = {
      ...insp,
      serverId: 42,
      completed: true,
      serverCompleted: true,
      unitNumber: "4B",
      unitNumberSynced: true,
    };

    expect(hasPendingWork(syncedUnit)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. sigRev race-condition guard via updateLocalInspection
// ─────────────────────────────────────────────────────────────────────────────

describe("sigRev — race-condition guard semantics", () => {
  it("sigRev starts at 0 on a new inspection", () => {
    const insp = makeInspection();
    expect(insp.sigRev).toBe(0);
  });

  it("sigRev increments on each signature mutation", async () => {
    const insp = makeInspection();
    await saveLocalInspection(insp);

    // First mutation (tech sig captured)
    await updateLocalInspection(insp.localId, (r) => {
      r.technicianSignature = "<svg>tech</svg>";
      r.sigRev = (r.sigRev ?? 0) + 1;
      r.signaturesSynced = false;
    });

    let loaded = await getLocalInspection(insp.localId);
    expect(loaded!.sigRev).toBe(1);

    // Second mutation (owner sig captured)
    await updateLocalInspection(insp.localId, (r) => {
      r.ownerSignature = "<svg>owner</svg>";
      r.sigRev = (r.sigRev ?? 0) + 1;
      r.signaturesSynced = false;
    });

    loaded = await getLocalInspection(insp.localId);
    expect(loaded!.sigRev).toBe(2);
  });

  it("simulates sync acknowledgment: clears signaturesSynced only when sigRev matches", async () => {
    const insp = makeInspection();
    await saveLocalInspection(insp);

    // Simulate InspectionSignaturePanel capturing a signature.
    await updateLocalInspection(insp.localId, (r) => {
      r.technicianSignature = "<svg>tech</svg>";
      r.sigRev = (r.sigRev ?? 0) + 1;
      r.signaturesSynced = false;
    });

    const beforePatch = await getLocalInspection(insp.localId);
    const sigRevAtSync = beforePatch!.sigRev; // = 1

    // Simulate user signing again WHILE the PATCH is in-flight.
    await updateLocalInspection(insp.localId, (r) => {
      r.ownerSignature = "<svg>owner</svg>";
      r.sigRev = (r.sigRev ?? 0) + 1; // now 2
      r.signaturesSynced = false;
    });

    // Simulate sync engine merge callback — only clears if sigRev still matches.
    await updateLocalInspection(insp.localId, (r) => {
      if ((r.sigRev ?? 0) === sigRevAtSync) {
        // sigRev is 2 ≠ 1, so this branch should NOT run.
        r.signaturesSynced = true;
        r.techSigClear = false;
        r.ownerSigConsent = false;
      }
    });

    const after = await getLocalInspection(insp.localId);
    // sigRev changed during in-flight — signaturesSynced must remain false.
    expect(after!.signaturesSynced).toBe(false);
    expect(after!.sigRev).toBe(2);
  });

  it("simulates sync acknowledgment: clears signaturesSynced when sigRev still matches", async () => {
    const insp = makeInspection();
    await saveLocalInspection(insp);

    await updateLocalInspection(insp.localId, (r) => {
      r.technicianSignature = "<svg>tech</svg>";
      r.sigRev = (r.sigRev ?? 0) + 1;
      r.signaturesSynced = false;
    });

    const beforePatch = await getLocalInspection(insp.localId);
    const sigRevAtSync = beforePatch!.sigRev; // = 1

    // No concurrent mutation — PATCH completes without interference.
    await updateLocalInspection(insp.localId, (r) => {
      if ((r.sigRev ?? 0) === sigRevAtSync) {
        r.signaturesSynced = true;
        r.techSigClear = false;
        r.ownerSigConsent = false;
      }
    });

    const after = await getLocalInspection(insp.localId);
    expect(after!.signaturesSynced).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Null-clear consent flags
// ─────────────────────────────────────────────────────────────────────────────

describe("null-clear consent flags", () => {
  it("techSigClear starts false on new records", () => {
    expect(makeInspection().techSigClear).toBe(false);
  });

  it("ownerSigConsent starts false on new records", () => {
    expect(makeInspection().ownerSigConsent).toBe(false);
  });

  it("techSigClear is set when technician clears their signature", async () => {
    const insp = makeInspection();
    await saveLocalInspection({ ...insp, technicianSignature: "<svg>tech</svg>" });

    // Simulate clearSignature("technician") from InspectionSignaturePanel.
    await updateLocalInspection(insp.localId, (r) => {
      r.technicianSignature = null;
      r.techSigClear = true;
      r.sigRev = (r.sigRev ?? 0) + 1;
      r.signaturesSynced = false;
    });

    const loaded = await getLocalInspection(insp.localId);
    expect(loaded!.techSigClear).toBe(true);
    expect(loaded!.technicianSignature).toBeNull();
    expect(loaded!.signaturesSynced).toBe(false);
  });

  it("ownerSigConsent is set when owner signature is cleared (re-sign flow)", async () => {
    const insp = makeInspection();
    await saveLocalInspection({ ...insp, ownerSignature: "<svg>owner</svg>" });

    // Simulate clearSignature("owner") from InspectionSignaturePanel.
    await updateLocalInspection(insp.localId, (r) => {
      r.ownerSignature = null;
      r.ownerSigConsent = true;
      r.sigRev = (r.sigRev ?? 0) + 1;
      r.signaturesSynced = false;
    });

    const loaded = await getLocalInspection(insp.localId);
    expect(loaded!.ownerSigConsent).toBe(true);
    expect(loaded!.ownerSignature).toBeNull();
  });

  it("ownerSigConsent is set when owner is marked not-available (their sig is nulled)", async () => {
    const insp = makeInspection();
    await saveLocalInspection({ ...insp, ownerSignature: "<svg>owner</svg>" });

    // Simulate markOwnerNotAvailable() from InspectionSignaturePanel.
    await updateLocalInspection(insp.localId, (r) => {
      r.ownerNotAvailable = true;
      r.ownerSignature = null;
      r.ownerSigConsent = true;
      r.sigRev = (r.sigRev ?? 0) + 1;
      r.signaturesSynced = false;
    });

    const loaded = await getLocalInspection(insp.localId);
    expect(loaded!.ownerSigConsent).toBe(true);
    expect(loaded!.ownerNotAvailable).toBe(true);
  });

  it("consent flags are cleared after a successful, uncontested sync", async () => {
    const insp = makeInspection();
    await saveLocalInspection({ ...insp, ownerSignature: "<svg>owner</svg>" });

    await updateLocalInspection(insp.localId, (r) => {
      r.ownerSignature = null;
      r.ownerSigConsent = true;
      r.sigRev = (r.sigRev ?? 0) + 1;
      r.signaturesSynced = false;
    });

    const beforeSync = await getLocalInspection(insp.localId);
    const sigRevAtSync = beforeSync!.sigRev;

    // Simulate sync engine acknowledgment (uncontested — sigRev unchanged).
    await updateLocalInspection(insp.localId, (r) => {
      if ((r.sigRev ?? 0) === sigRevAtSync) {
        r.signaturesSynced = true;
        r.techSigClear = false;
        r.ownerSigConsent = false;
      }
    });

    const after = await getLocalInspection(insp.localId);
    expect(after!.signaturesSynced).toBe(true);
    expect(after!.ownerSigConsent).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. parseRecord migration — old records hydrate with safe defaults
// ─────────────────────────────────────────────────────────────────────────────

describe("parseRecord — migration defaults for old records", () => {
  it("defaults sync flags and unit number safely for old records", () => {
    const oldRecord = JSON.stringify({
      schemaVersion: 1,
      localId: "old-rec-id",
      serverId: 99,
      createdAt: "2024-01-01T00:00:00.000Z",
      updatedAt: "2024-01-01T00:00:00.000Z",
      siteAddress: "Old Address",
      clientName: null,
      technicianName: "Old Tech",
      propertyType: "residential",
      pestTypes: [],
      notes: "",
      photos: [],
      baitStations: [],
      completed: true,
      completedAt: "2024-01-02T00:00:00.000Z",
      serverCompleted: true,
      analyzedCount: 0,
      reportId: null,
      syncError: null,
      syncAttempts: 0,
      lastSyncSuccess: "2024-01-02T00:00:00.000Z",
      allFindingsReviewed: true,
      pendingCorrections: [],
      lastDeliveredAt: null,
      pendingDeliveries: [],
      technicianSignature: "<svg>old-sig</svg>",
      ownerSignature: null,
      ownerNotAvailable: false,
      signedAt: "2024-01-02T00:00:00.000Z",
      // sigRev, consent fields, signature/unit sync flags, and unit number
      // intentionally absent to simulate a pre-unit-tagging record.
    });

    const rec = parseRecord(oldRecord);
    expect(rec).not.toBeNull();
    expect(rec!.sigRev).toBe(0);
    expect(rec!.techSigClear).toBe(false);
    expect(rec!.ownerSigConsent).toBe(false);
    // Old completed record: signaturesSynced defaults true (no spurious re-sync).
    expect(rec!.signaturesSynced).toBe(true);
    expect(rec!.unitNumber).toBeNull();
    expect(rec!.unitNumberSynced).toBe(true);
  });
});
