/**
 * Integration tests — signature PATCH body reaches the server after sync.
 *
 * Guards against the silent-loss defect: if a field rename or serialisation
 * bug strips technicianSignature, ownerSignature, ownerNotAvailable, or
 * signedAt from the PATCH body, a compliant record captured offline would
 * disappear from the portal with no error visible to anyone.
 *
 * Each test simulates a local inspection that was captured offline and then
 * calls syncNow() against a mock updateInspection spy.  The spy captures the
 * exact arguments passed to the PATCH so we can assert all four signature
 * fields arrive with the correct values.
 *
 * Scenario coverage
 * ─────────────────
 *  1. All four fields (tech sig + owner sig + ownerNotAvailable + signedAt)
 *     reach the server on the first sync attempt.
 *  2. ownerNotAvailable=true with ownerSigConsent (owner could not sign):
 *     body contains ownerNotAvailable=true, ownerSignature=null, and
 *     resignatureConsent=true.
 *  3. Owner sig never captured (null, no consent flag): ownerSignature is
 *     omitted from the body entirely so the server's existing value is not
 *     touched by a different device.
 *  4. signedAt=null: the signedAt key is omitted from the body (server keeps
 *     whatever it already has).
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// ── Module mocks — must appear before any import that triggers them ────────────

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
vi.mock("expo-image-manipulator", () => ({
  SaveFormat: { JPEG: "jpeg" }, manipulateAsync: vi.fn(),
}));
vi.mock("expo-crypto", () => ({ randomUUID: () => `uuid-${++_uuid}` }));

vi.mock("expo-file-system/legacy", () => ({
  documentDirectory:  "file:///documents/",
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

// API client — spy on updateInspection; others are no-op stubs
const updateInspectionSpy = vi.fn();

vi.mock("@/lib/api-client", () => ({
  createInspection:   vi.fn().mockResolvedValue({ id: 42 }),
  updateInspection:   (...args: unknown[]) => updateInspectionSpy(...args),
  analyzeInspection:  vi.fn().mockResolvedValue({}),
  completeInspection: vi.fn().mockResolvedValue({ reportId: null }),
  addInspectionMedia: vi.fn().mockResolvedValue({ id: 99 }),
}));

vi.mock("@/lib/api-client/bait-stations", () => ({
  createBaitStation: vi.fn().mockResolvedValue({ id: 1 }),
  updateBaitStation: vi.fn().mockResolvedValue({}),
}));

vi.mock("@/lib/api-client/corrections", () => ({
  correctFinding: vi.fn().mockResolvedValue({}),
}));

// Upload utilities — not exercised here (no photos), but engine.ts imports them
vi.mock("@/lib/upload", () => ({
  reserveUploadPath: vi.fn().mockResolvedValue({
    uploadURL:   "https://storage.example.com/upload",
    storagePath: "/api/storage/companies/1/media/photo.jpg",
    uploadIntentId: 1,
    expectedSize: 123,
  }),
  doUpload:         vi.fn().mockResolvedValue(undefined),
  probeStoragePath: vi.fn().mockResolvedValue(false),
}));

// ── Imports after mocks ────────────────────────────────────────────────────────

import {
  newLocalInspection,
  saveLocalInspection,
  setLocalInspectionOwner,
} from "../../local/inspection-store";

import { configureSyncEngine, syncNow } from "../engine";

// ── Engine configuration — idempotent; safe to call once at module level ───────
setLocalInspectionOwner("signature-patch-test-owner");
configureSyncEngine({
  getToken: async () => "test-token",
  ownerId: "signature-patch-test-owner",
});

// ── Helpers ────────────────────────────────────────────────────────────────────

const TECH_SIG    = "<svg><path d='M10 20 L90 20'/></svg>";
const OWNER_SIG   = "<svg><path d='M20 50 L80 50'/></svg>";
const SIGNED_AT   = "2026-08-20T14:30:00.000Z";
const SERVER_ID   = 42;

/**
 * Creates a local inspection that is already registered on the server
 * (serverId set) with no photos so the engine skips upload / register /
 * analyse steps and goes straight to the field-sync PATCH.
 *
 * signaturesSynced=false makes hasPendingWork() return true so syncNow()
 * actually processes the record.
 */
function makeSignedInspection(
  overrides: Partial<ReturnType<typeof newLocalInspection>> = {},
) {
  const base = newLocalInspection({
    siteAddress:    "1 Signature Lane",
    clientName:     "Sig Corp",
    technicianName: "Test Tech",
    propertyType:   "commercial",
    pestTypes:      [],
    notes:          "",
  });
  return {
    ...base,
    serverId:          SERVER_ID,
    signaturesSynced:  false as const,
    // Ensure no photos so upload steps are skipped.
    photos:            [] as typeof base.photos,
    ...overrides,
  };
}

// ── Setup / teardown ──────────────────────────────────────────────────────────

beforeEach(() => {
  _store.clear();
  setLocalInspectionOwner("signature-patch-test-owner");
  _uuid = 0;
  updateInspectionSpy.mockClear();
  updateInspectionSpy.mockResolvedValue({});
  // Fake timers prevent debounce / retry timers from interfering with assertions.
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

// ─────────────────────────────────────────────────────────────────────────────
// 1. All four signature fields reach the server
// ─────────────────────────────────────────────────────────────────────────────

describe("signature PATCH body — all four fields reach the server", () => {
  it("sends technicianSignature, ownerSignature, ownerNotAvailable, and signedAt", async () => {
    const insp = makeSignedInspection({
      technicianSignature: TECH_SIG,
      ownerSignature:      OWNER_SIG,
      ownerNotAvailable:   false,
      signedAt:            SIGNED_AT,
    });
    await saveLocalInspection(insp);

    await syncNow(insp.localId);

    expect(updateInspectionSpy).toHaveBeenCalledOnce();

    const [id, body] = updateInspectionSpy.mock.calls[0] as [
      number,
      Record<string, unknown>,
    ];

    expect(id).toBe(SERVER_ID);
    expect(body.technicianSignature).toBe(TECH_SIG);
    expect(body.ownerSignature).toBe(OWNER_SIG);
    expect(body.ownerNotAvailable).toBe(false);
    expect(body.signedAt).toBe(SIGNED_AT);
  });

  it("preserves the exact SVG string without any truncation or re-encoding", async () => {
    const longSvg = `<svg xmlns="http://www.w3.org/2000/svg"><path d="${"M10 20 L90 20 ".repeat(100)}"/></svg>`;
    const insp = makeSignedInspection({
      technicianSignature: longSvg,
      ownerSignature:      OWNER_SIG,
      ownerNotAvailable:   false,
      signedAt:            SIGNED_AT,
    });
    await saveLocalInspection(insp);

    await syncNow(insp.localId);

    const [, body] = updateInspectionSpy.mock.calls[0] as [
      number,
      Record<string, unknown>,
    ];

    expect(body.technicianSignature).toBe(longSvg);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Owner not available — null sig + consent
// ─────────────────────────────────────────────────────────────────────────────

describe("signature PATCH body — ownerNotAvailable with consent", () => {
  it("sends ownerNotAvailable=true, ownerSignature=null, and resignatureConsent=true", async () => {
    const insp = makeSignedInspection({
      technicianSignature: TECH_SIG,
      ownerSignature:      null,
      ownerSigConsent:     true,  // explicit consent to send null
      ownerNotAvailable:   true,
      signedAt:            SIGNED_AT,
    });
    await saveLocalInspection(insp);

    await syncNow(insp.localId);

    expect(updateInspectionSpy).toHaveBeenCalledOnce();

    const [id, body] = updateInspectionSpy.mock.calls[0] as [
      number,
      Record<string, unknown>,
    ];

    expect(id).toBe(SERVER_ID);
    expect(body.ownerNotAvailable).toBe(true);
    // Explicit null must appear in the body (not omitted) because the server
    // needs to clear its stored value.
    expect(body).toHaveProperty("ownerSignature");
    expect(body.ownerSignature).toBeNull();
    // resignatureConsent=true bypasses the server's accidental-clear guard.
    expect(body.resignatureConsent).toBe(true);
    expect(body.technicianSignature).toBe(TECH_SIG);
    expect(body.signedAt).toBe(SIGNED_AT);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. Owner sig never captured — ownerSignature omitted from body
// ─────────────────────────────────────────────────────────────────────────────

describe("signature PATCH body — owner sig never captured", () => {
  it("omits ownerSignature from the body when it is null and ownerSigConsent is false", async () => {
    // null + no consent flag = "never captured"; the server's value (from
    // another device) must not be accidentally overwritten.
    const insp = makeSignedInspection({
      technicianSignature: TECH_SIG,
      ownerSignature:      null,
      ownerSigConsent:     false,
      ownerNotAvailable:   false,
      signedAt:            SIGNED_AT,
    });
    await saveLocalInspection(insp);

    await syncNow(insp.localId);

    expect(updateInspectionSpy).toHaveBeenCalledOnce();

    const [, body] = updateInspectionSpy.mock.calls[0] as [
      number,
      Record<string, unknown>,
    ];

    // ownerSignature must NOT appear in the body at all.
    expect(body).not.toHaveProperty("ownerSignature");
    // The rest of the signature state is still sent.
    expect(body.technicianSignature).toBe(TECH_SIG);
    expect(body.ownerNotAvailable).toBe(false);
    expect(body.signedAt).toBe(SIGNED_AT);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. signedAt=null — key omitted from body
// ─────────────────────────────────────────────────────────────────────────────

describe("signature PATCH body — signedAt omitted when null", () => {
  it("omits signedAt from the body when the field is null", async () => {
    const insp = makeSignedInspection({
      technicianSignature: TECH_SIG,
      ownerSignature:      OWNER_SIG,
      ownerNotAvailable:   false,
      signedAt:            null,
    });
    await saveLocalInspection(insp);

    await syncNow(insp.localId);

    expect(updateInspectionSpy).toHaveBeenCalledOnce();

    const [, body] = updateInspectionSpy.mock.calls[0] as [
      number,
      Record<string, unknown>,
    ];

    expect(body).not.toHaveProperty("signedAt");
    // Other signature fields are still included.
    expect(body.technicianSignature).toBe(TECH_SIG);
    expect(body.ownerSignature).toBe(OWNER_SIG);
    expect(body.ownerNotAvailable).toBe(false);
  });
});
