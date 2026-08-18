/**
 * Stamped measurement metadata — sync round-trip tests.
 *
 * Pins three invariants to guard against the defect described in task #612:
 *
 *   1. captureMetadata.laserMeasurement.metadata.warnings survives JSON
 *      serialisation through parseRecord — no keys are dropped or overwritten.
 *
 *   2. updateLocalInspection merge-update preserves captureMetadata on an
 *      existing photo (does not replace it with an empty/fresh object when the
 *      sync engine writes storagePath or mediaRowId on the same record).
 *
 *   3. The sync engine passes photo.captureMetadata — including non-standard
 *      keys and nested warnings arrays — verbatim to addInspectionMedia.
 *      Clipping warnings that should appear in the server's audit trail cannot
 *      be silently dropped between the local record and the POST /media call.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// ── Module mocks (declared before any import that triggers them) ──────────────

const _store = new Map<string, string>();

vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem:    async (k: string) => _store.get(k) ?? null,
    setItem:    async (k: string, v: string) => { _store.set(k, v); },
    removeItem: async (k: string) => { _store.delete(k); },
    multiGet:   async (keys: string[]) =>
      keys.map((k) => [k, _store.get(k) ?? null] as [string, string | null]),
  },
}));

let _uuid = 0;
vi.mock("expo-crypto", () => ({ randomUUID: () => `uuid-${++_uuid}` }));

vi.mock("expo-file-system/legacy", () => ({
  documentDirectory: "file:///documents/",
  makeDirectoryAsync: async () => undefined,
  copyAsync:          async () => undefined,
  deleteAsync:        async () => undefined,
}));

vi.mock("@/lib/delivery/registry", () => ({
  getDeliveryMethod: () => undefined,
}));

// react-native — imported by engine.ts at module scope
vi.mock("react-native", () => ({
  AppState: { addEventListener: vi.fn(() => ({ remove: vi.fn() })) },
}));

// API clients — spy on addInspectionMedia; others are no-op stubs
const addInspectionMediaSpy = vi.fn();

vi.mock("@/lib/api-client", () => ({
  createInspection:   vi.fn().mockResolvedValue({ id: 42 }),
  updateInspection:   vi.fn().mockResolvedValue({}),
  analyzeInspection:  vi.fn().mockResolvedValue({}),
  completeInspection: vi.fn().mockResolvedValue({ reportId: null }),
  addInspectionMedia: (...args: unknown[]) => addInspectionMediaSpy(...args),
}));

vi.mock("@/lib/api-client/bait-stations", () => ({
  createBaitStation: vi.fn().mockResolvedValue({ id: 1 }),
  updateBaitStation: vi.fn().mockResolvedValue({}),
}));

vi.mock("@/lib/api-client/corrections", () => ({
  correctFinding: vi.fn().mockResolvedValue({}),
}));

// Upload utilities — not exercised in these tests (storagePath is pre-set),
// but imported by engine.ts so they must resolve.
vi.mock("@/lib/upload", () => ({
  reserveUploadPath: vi.fn().mockResolvedValue({
    uploadURL:   "https://storage.example.com/upload",
    storagePath: "/api/storage/companies/1/media/photo.jpg",
  }),
  doUpload:         vi.fn().mockResolvedValue(undefined),
  probeStoragePath: vi.fn().mockResolvedValue(false),
}));

// ── Imports after mocks ───────────────────────────────────────────────────────

import {
  newLocalInspection,
  saveLocalInspection,
  getLocalInspection,
  updateLocalInspection,
  parseRecord,
  type LocalPhoto,
} from "../inspection-store";

import { configureSyncEngine, syncNow } from "../../sync/engine";

// ── Engine configuration (idempotent; runs once at module level) ──────────────
// configureSyncEngine sets state.configured = true on first call and is a
// no-op on subsequent calls, so it is safe to call here before any test.
configureSyncEngine({ getToken: async () => "test-token" });

// ── Shared test data ──────────────────────────────────────────────────────────

const WARNINGS = [
  "reference box too small to anchor measurement",
  "reference object too far from camera — depth estimate unreliable",
];

/**
 * laserMeasurement sub-object — matches the exact shape written by
 * new-inspection.tsx when consumeLastMeasurementReading() returns a reading.
 * Warnings live at laserMeasurement.metadata.warnings (from MeasurementReading.metadata).
 */
const LASER_MEASUREMENT = {
  kind:       "distance",
  value:      3.42,
  unit:       "m",
  capturedAt: "2026-08-17T12:00:00.000Z",
  deviceId:   "laser-burst-001",
  metadata:   { warnings: WARNINGS, confidence: 0.61 },
};

/**
 * Returns a LocalPhoto whose captureMetadata mirrors the structure produced by
 * new-inspection.tsx (lines 1348-1373): top-level image dimensions plus a
 * `laserMeasurement` key holding the stamped MeasurementReading fields.
 */
function photoWithMeasurement(overrides: Partial<LocalPhoto> = {}): LocalPhoto {
  return {
    localUri:    "file:///documents/inspections/test/photos/stamped.jpg",
    capturedAt:  "2026-08-17T12:00:00.000Z",
    captureMetadata: {
      // image-level metadata written unconditionally by new-inspection.tsx
      width:    1920,
      height:   1080,
      fileSize: 204800,
      // laser reading attached when consumeLastMeasurementReading() is fresh
      laserMeasurement: LASER_MEASUREMENT,
    },
    ...overrides,
  };
}

function makeInspection() {
  return newLocalInspection({
    siteAddress:    "99 Measurement Blvd",
    clientName:     "Test Corp",
    technicianName: "Tech",
    propertyType:   "commercial",
    pestTypes:      [],
    notes:          "",
  });
}

// ── Setup / teardown ──────────────────────────────────────────────────────────

beforeEach(() => {
  _store.clear();
  _uuid = 0;
  addInspectionMediaSpy.mockClear();
  addInspectionMediaSpy.mockResolvedValue({ id: 99 });
  // Fake timers prevent debounce/retry timers from firing during assertions.
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. JSON serialisation round-trip
// ─────────────────────────────────────────────────────────────────────────────

describe("captureMetadata JSON serialisation round-trip (parseRecord)", () => {
  it("captureMetadata.laserMeasurement.metadata.warnings survives JSON.stringify → parseRecord", () => {
    const insp = makeInspection();
    insp.photos = [photoWithMeasurement()];

    const parsed = parseRecord(JSON.stringify(insp));

    expect(parsed).not.toBeNull();
    expect(parsed!.photos).toHaveLength(1);

    const photo = parsed!.photos[0];
    expect(photo.captureMetadata).toBeDefined();

    const laser = photo.captureMetadata!.laserMeasurement as typeof LASER_MEASUREMENT;
    expect(laser).toBeDefined();
    expect(laser.metadata).toBeDefined();
    expect(laser.metadata.warnings).toEqual(WARNINGS);
  });

  it("image-level keys and laserMeasurement are both preserved (width, height, confidence)", () => {
    const insp = makeInspection();
    insp.photos = [photoWithMeasurement()];

    const parsed = parseRecord(JSON.stringify(insp));
    const meta = parsed!.photos[0].captureMetadata!;

    // Top-level image metadata written unconditionally must survive.
    expect(meta.width).toBe(1920);
    expect(meta.height).toBe(1080);
    expect(meta.fileSize).toBe(204800);

    // Nested confidence inside laserMeasurement.metadata must survive.
    const laser = meta.laserMeasurement as typeof LASER_MEASUREMENT;
    expect(laser.metadata.confidence).toBe(0.61);
    expect(laser.value).toBe(3.42);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. updateLocalInspection — captureMetadata is not overwritten on merge
// ─────────────────────────────────────────────────────────────────────────────

describe("updateLocalInspection — captureMetadata is not overwritten on merge", () => {
  it("preserves captureMetadata when storagePath is promoted on the same photo (checkpoint C)", async () => {
    const insp = makeInspection();
    insp.photos = [photoWithMeasurement()];
    await saveLocalInspection(insp);

    const uri = insp.photos[0].localUri;

    // Simulate sync engine checkpoint C: pendingStoragePath → storagePath.
    await updateLocalInspection(insp.localId, (r) => {
      const p = r.photos.find((ph) => ph.localUri === uri);
      if (p) {
        p.storagePath = "/api/storage/companies/1/media/stamped.jpg";
        p.uploading = false;
        p.pendingStoragePath = undefined;
      }
    });

    const reloaded = await getLocalInspection(insp.localId);
    expect(reloaded).not.toBeNull();

    const photo = reloaded!.photos[0];
    expect(photo.storagePath).toBe("/api/storage/companies/1/media/stamped.jpg");

    // captureMetadata must be untouched.
    const laser = photo.captureMetadata!.laserMeasurement as typeof LASER_MEASUREMENT;
    expect(laser.metadata.warnings).toEqual(WARNINGS);
  });

  it("preserves captureMetadata when mediaRowId is written in a concurrent merge-update", async () => {
    const insp = makeInspection();
    insp.photos = [photoWithMeasurement()];
    await saveLocalInspection(insp);

    const uri = insp.photos[0].localUri;

    // Two concurrent updates — serial queue must apply both without clearing
    // captureMetadata (which neither mutation touches).
    const p1 = updateLocalInspection(insp.localId, (r) => {
      const p = r.photos.find((ph) => ph.localUri === uri);
      if (p) p.storagePath = "/api/storage/companies/1/media/stamped.jpg";
    });
    const p2 = updateLocalInspection(insp.localId, (r) => {
      const p = r.photos.find((ph) => ph.localUri === uri);
      if (p) p.mediaRowId = 99;
    });
    await Promise.all([p1, p2]);

    const final = await getLocalInspection(insp.localId);
    const photo = final!.photos[0];

    expect(photo.storagePath).toBe("/api/storage/companies/1/media/stamped.jpg");
    expect(photo.mediaRowId).toBe(99);

    // captureMetadata must survive both concurrent writes.
    const laser = photo.captureMetadata!.laserMeasurement as typeof LASER_MEASUREMENT;
    expect(laser.metadata.warnings).toEqual(WARNINGS);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Sync engine — addInspectionMedia receives captureMetadata intact
// ─────────────────────────────────────────────────────────────────────────────

describe("sync engine — captureMetadata passes through to addInspectionMedia", () => {
  it("calls addInspectionMedia with captureMetadata.laserMeasurement.metadata.warnings intact", async () => {
    const insp = makeInspection();
    // storagePath pre-set → engine skips the upload step and goes directly to
    // the POST /media registration step where captureMetadata is forwarded.
    insp.photos = [photoWithMeasurement({
      storagePath: "/api/storage/companies/1/media/stamped.jpg",
    })];
    // serverId pre-set → engine skips the createInspection step.
    insp.serverId = 42;
    await saveLocalInspection(insp);

    await syncNow(insp.localId);

    expect(addInspectionMediaSpy).toHaveBeenCalledOnce();

    const [, payload] = addInspectionMediaSpy.mock.calls[0] as [
      number,
      { captureMetadata?: Record<string, unknown> },
    ];

    expect(payload.captureMetadata).toBeDefined();
    const laser = payload.captureMetadata!.laserMeasurement as typeof LASER_MEASUREMENT;
    expect(laser).toBeDefined();
    expect(laser.metadata.warnings).toEqual(WARNINGS);
  });

  it("does not strip image-level or laserMeasurement keys when building the addInspectionMedia payload", async () => {
    const insp = makeInspection();
    insp.photos = [photoWithMeasurement({
      storagePath: "/api/storage/companies/1/media/stamped2.jpg",
    })];
    insp.serverId = 42;
    await saveLocalInspection(insp);

    await syncNow(insp.localId);

    const [, payload] = addInspectionMediaSpy.mock.calls[0] as [
      number,
      { captureMetadata?: Record<string, unknown> },
    ];

    const meta = payload.captureMetadata!;
    // Top-level image keys written unconditionally must reach the server.
    expect(meta.width).toBe(1920);
    expect(meta.height).toBe(1080);
    // laserMeasurement fields must be intact.
    const laser = meta.laserMeasurement as typeof LASER_MEASUREMENT;
    expect(laser.value).toBe(3.42);
    expect(laser.metadata.confidence).toBe(0.61);
  });
});
