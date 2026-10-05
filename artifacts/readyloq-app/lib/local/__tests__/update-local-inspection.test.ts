/**
 * Unit tests — updateLocalInspection serial queue
 *
 * Covers the concurrent-writer scenario documented in the task spec:
 *
 *   Two sync passes overlap: the first writes notes, the second writes
 *   technicianSignature. Both mutations are enqueued before the first resolves.
 *   The serial chain must ensure neither mutation clobbers the other, so the
 *   final record contains BOTH the updated notes AND the signature.
 *
 * React Native / Expo modules that require a native runtime are mocked with
 * lightweight in-memory equivalents so the suite runs in plain Node.js.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";

// ── Module mocks (must be declared before any import that loads them) ─────────

// In-memory AsyncStorage with a controlled read-delay so we can observe the
// real race: the second updateLocalInspection call is made BEFORE the first
// AsyncStorage.getItem resolves.
let _readDelay = 0; // ms to hold the getItem promise open
const _store = new Map<string, string>();

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (key: string) => {
      if (_readDelay > 0) {
        await new Promise((r) => setTimeout(r, _readDelay));
      }
      return _store.get(key) ?? null;
    },
    setItem: async (key: string, value: string) => {
      _store.set(key, value);
    },
    removeItem: async (key: string) => {
      _store.delete(key);
    },
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
  newLocalInspection,
  saveLocalInspection,
  updateLocalInspection,
  getLocalInspection,
  setLocalInspectionOwner,
  hasPendingWork,
} from "../inspection-store";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeInspection(overrides: Partial<Parameters<typeof newLocalInspection>[0]> = {}) {
  return newLocalInspection({
    siteAddress: "123 Main St",
    clientName: "Acme Corp",
    technicianName: "Jane Doe",
    propertyType: "commercial",
    pestTypes: [],
    notes: "",
    ...overrides,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Setup — reset shared state between tests
// ─────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  _store.clear();
  _readDelay = 0;
  _uuidCounter = 0;
  setLocalInspectionOwner("local-store-test-owner");
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. Basic correctness — sequential mutations
// ─────────────────────────────────────────────────────────────────────────────

describe("updateLocalInspection — sequential mutations", () => {
  it("applies a single mutation and persists the change", async () => {
    const insp = makeInspection();
    await saveLocalInspection(insp);

    const result = await updateLocalInspection(insp.localId, (r) => {
      r.notes = "treated kitchen";
    });

    expect(result).not.toBeNull();
    expect(result!.notes).toBe("treated kitchen");

    // Persisted to storage
    const reloaded = await getLocalInspection(insp.localId);
    expect(reloaded!.notes).toBe("treated kitchen");
  });

  it("applies two sequential mutations without losing either field", async () => {
    const insp = makeInspection();
    await saveLocalInspection(insp);

    await updateLocalInspection(insp.localId, (r) => {
      r.notes = "applied bait";
    });
    await updateLocalInspection(insp.localId, (r) => {
      r.technicianSignature = "<svg>sig</svg>";
    });

    const final = await getLocalInspection(insp.localId);
    expect(final!.notes).toBe("applied bait");
    expect(final!.technicianSignature).toBe("<svg>sig</svg>");
  });

  it("marks changed bait-station data pending for durable retry", async () => {
    const insp = makeInspection();
    insp.serverId = 42;
    insp.baitStations = [{
      id: "station-1",
      label: "North wall",
      status: "active",
      serverId: 501,
      synced: true,
    }];
    await saveLocalInspection(insp);

    const updated = await updateLocalInspection(insp.localId, (record) => {
      record.baitStations[0]!.status = "damaged";
    });

    expect(updated?.baitStations[0]?.synced).toBe(false);
    expect(updated && hasPendingWork(updated)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Core race — overlapping sync passes
//
//   Pass 1 (notes):      enqueued first, starts reading AsyncStorage
//   Pass 2 (signature):  enqueued BEFORE pass 1 resolves
//
// Without the serial chain, pass 2 would read the record before pass 1 writes
// it, and the later save would overwrite the notes with the old (empty) value.
// ─────────────────────────────────────────────────────────────────────────────

describe("updateLocalInspection — overlapping sync passes (real race)", () => {
  it("preserves BOTH notes and technicianSignature when mutations are enqueued concurrently", async () => {
    const insp = makeInspection({ notes: "" });
    await saveLocalInspection(insp);

    // Introduce a read delay so the race is real: pass 2 is enqueued while
    // pass 1 is still waiting for AsyncStorage.getItem to resolve.
    _readDelay = 20; // ms

    // Enqueue both mutations without awaiting — this is the race scenario.
    const pass1 = updateLocalInspection(insp.localId, (r) => {
      r.notes = "found rodent activity near sink";
    });

    // Pass 2 is enqueued while pass 1's getItem is still in-flight.
    const pass2 = updateLocalInspection(insp.localId, (r) => {
      r.technicianSignature = "<svg>tech-signature-data</svg>";
      r.signedAt = "2026-08-16T10:00:00.000Z";
    });

    const [result1, result2] = await Promise.all([pass1, pass2]);

    // Both passes must return non-null results.
    expect(result1).not.toBeNull();
    expect(result2).not.toBeNull();

    // The final record in storage must contain BOTH mutations.
    const final = await getLocalInspection(insp.localId);
    expect(final).not.toBeNull();
    expect(final!.notes).toBe("found rodent activity near sink");
    expect(final!.technicianSignature).toBe("<svg>tech-signature-data</svg>");
    expect(final!.signedAt).toBe("2026-08-16T10:00:00.000Z");
  });

  it("does not lose signature when three mutations race (notes, signature, ownerNotAvailable)", async () => {
    const insp = makeInspection();
    await saveLocalInspection(insp);

    _readDelay = 10;

    // Three concurrent mutations representing three sync sub-steps racing.
    const p1 = updateLocalInspection(insp.localId, (r) => {
      r.notes = "commercial kitchen, heavy activity";
    });
    const p2 = updateLocalInspection(insp.localId, (r) => {
      r.technicianSignature = "<svg>tech</svg>";
    });
    const p3 = updateLocalInspection(insp.localId, (r) => {
      r.ownerNotAvailable = true;
    });

    await Promise.all([p1, p2, p3]);

    const final = await getLocalInspection(insp.localId);
    expect(final!.notes).toBe("commercial kitchen, heavy activity");
    expect(final!.technicianSignature).toBe("<svg>tech</svg>");
    expect(final!.ownerNotAvailable).toBe(true);
  });

  it("second pass reads the record written by the first pass, not the pre-mutation snapshot", async () => {
    const insp = makeInspection({ notes: "original" });
    await saveLocalInspection(insp);

    _readDelay = 15;

    // Pass 1 sets notes. Pass 2 reads AFTER pass 1 writes (serial chain
    // guarantees this) and appends to the value written by pass 1.
    const pass1 = updateLocalInspection(insp.localId, (r) => {
      r.notes = "updated by pass 1";
    });
    const pass2 = updateLocalInspection(insp.localId, (r) => {
      // This mutate callback always sees the record written by the previous
      // queued task, not the stale snapshot from before pass 1 ran.
      r.technicianSignature = "<svg>captured offline</svg>";
    });

    await Promise.all([pass1, pass2]);

    const final = await getLocalInspection(insp.localId);
    // Notes from pass 1 must survive the write by pass 2.
    expect(final!.notes).toBe("updated by pass 1");
    expect(final!.technicianSignature).toBe("<svg>captured offline</svg>");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Non-existent record — graceful null return
// ─────────────────────────────────────────────────────────────────────────────

describe("updateLocalInspection — missing record", () => {
  it("returns null when the record does not exist", async () => {
    const result = await updateLocalInspection("does-not-exist", (r) => {
      r.notes = "should not matter";
    });

    expect(result).toBeNull();
  });

  it("does not break the queue when a missing-record call is interleaved with a valid one", async () => {
    const insp = makeInspection();
    await saveLocalInspection(insp);

    _readDelay = 10;

    const missing = updateLocalInspection("ghost-id", (r) => {
      r.notes = "never written";
    });
    const valid = updateLocalInspection(insp.localId, (r) => {
      r.technicianSignature = "<svg>real</svg>";
    });

    const [missResult, validResult] = await Promise.all([missing, valid]);

    expect(missResult).toBeNull();
    expect(validResult).not.toBeNull();
    expect(validResult!.technicianSignature).toBe("<svg>real</svg>");

    // The valid record must be correctly stored.
    const final = await getLocalInspection(insp.localId);
    expect(final!.technicianSignature).toBe("<svg>real</svg>");
  });
});
