import { readFileSync } from "node:fs";
import { URL } from "node:url";
import ts from "typescript";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  records: new Map<string, string>(),
  files: new Set<string>(),
  sequence: 0,
  sanitize: vi.fn(),
}));
vi.mock("@react-native-async-storage/async-storage", () => ({
  default: {
    getItem: async (key: string) => fixture.records.get(key) ?? null,
    setItem: async (key: string, value: string) => { fixture.records.set(key, value); },
    removeItem: async (key: string) => { fixture.records.delete(key); },
    multiGet: async (keys: string[]) => keys.map((key) => [key, fixture.records.get(key) ?? null]),
  },
}));
vi.mock("expo-crypto", () => ({ randomUUID: () => `photo-id-${++fixture.sequence}` }));
vi.mock("expo-file-system/legacy", () => ({
  documentDirectory: "file:///documents/",
  makeDirectoryAsync: async () => {},
  deleteAsync: async (uri: string) => { fixture.files.delete(uri); },
}));
vi.mock("@/lib/privacy/image-sanitizer", () => ({ createSanitizedPhotoCopy: fixture.sanitize }));
vi.mock("@/lib/delivery/registry", () => ({ getDeliveryMethod: () => undefined }));

import * as FileSystem from "expo-file-system/legacy";
import {
  newLocalInspection, saveLocalInspection, getLocalInspection,
  updateLocalInspection, persistPhoto, setLocalInspectionScope, hasPendingWork,
} from "../../lib/local/inspection-store";
import { createInspectionIngestQueue } from "../../lib/local/inspection-ingest-queue";
import { AudioSessionManager } from "../../lib/audio/AudioSessionManager";
import { VoiceCaptureSession } from "../../lib/audio/VoiceCaptureSession";
import type { SpeechProvider } from "../../lib/audio/providers/SpeechProvider";
import type { SpeechTranscriptionResult } from "../../lib/audio/types/audio.types";
import { createFrameBuffer } from "../../lib/voice-context/frame-buffer";

// Execute the actual screen capture/ingestion functions without loading the
// Expo screen or replacing its persistence algorithm with a test imitation.
const source = readFileSync(new URL("../../app/(app)/new-inspection.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("new-inspection.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function initializer(name: string): string {
  let text: string | undefined;
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name && node.initializer) {
      text = node.initializer.getText(ast);
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  if (!text) throw new Error(`Missing production function: ${name}`);
  return text;
}
const dependencies = [
  "recordRef", "intakeClosedRef", "setPhotos", "setPendingIngestCount", "persistPhoto",
  "assessEvidence", "updateLocalInspection", "consumeLastMeasurementReading", "removeLocationMetadata",
  "ingestAllUploadedPhotos", "clerkUser", "getToken", "setQualityNotice", "setWsError", "deferredPixelItemsRef",
  "deferredPixelTimerRef", "InteractionManager", "analyzeEvidencePixels", "setError", "FileSystem",
  "ingestQueueRef", "cameraRef", "captureLockedRef", "capturing", "importing", "Haptics", "setCapturing",
  "cameraCaptureQueueRef", "cameraProvider",
];
const code = ts.transpileModule(
  `const { ${dependencies.join(",")} } = deps;
   const ingestEvidence = ${initializer("ingestEvidence")};
   const takePhoto = ${initializer("takePhoto")};
   return { takePhoto, ingestEvidence };`,
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } },
).outputText;
const createCapture = new Function("deps", code) as (deps: Record<string, unknown>) => {
  takePhoto: (allowed?: () => boolean) => Promise<boolean>;
  ingestEvidence: (items: Array<Record<string, unknown>>) => Promise<boolean>;
};

beforeEach(() => {
  vi.useFakeTimers();
  fixture.records.clear();
  fixture.files.clear();
  fixture.sequence = 0;
  fixture.sanitize.mockReset().mockImplementation(async (_source: string, destination: string) => {
    fixture.files.add(destination);
    return destination;
  });
  setLocalInspectionScope("voice-technician", 17);
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function harness(transcript = "take a photo") {
  const record = newLocalInspection({
    siteAddress: "123 Main Street", clientName: "Client", technicianName: "Technician",
    propertyType: "Residential", pestTypes: [], notes: "",
  });
  await saveLocalInspection(record);
  let photos: Array<{ uri: string }> = [];
  const recordRef = { current: record };
  const cameraProvider = { capture: vi.fn(async () => {
    fixture.files.add("file:///camera/voice-photo.jpg");
    return [{
    uri: "file:///camera/voice-photo.jpg", source: "native_camera",
    capturedAt: "2026-10-09T12:00:00Z", width: 1200, height: 800,
  }]; }) };
  const cameraQueue = createInspectionIngestQueue();
  const error = vi.fn();
  const capture = createCapture({
    recordRef, cameraProvider, intakeClosedRef: { current: false }, cameraRef: { current: {} },
    captureLockedRef: { current: false }, capturing: false, importing: false,
    cameraCaptureQueueRef: { current: cameraQueue },
    ingestQueueRef: { current: createInspectionIngestQueue() }, persistPhoto, updateLocalInspection,
    setPhotos: (update: (prev: typeof photos) => typeof photos) => { photos = update(photos); },
    setPendingIngestCount: vi.fn(), setCapturing: vi.fn(), setError: error,
    assessEvidence: () => ({ acceptable: true, reasons: [], score: 1 }),
    consumeLastMeasurementReading: () => null, removeLocationMetadata: (value: unknown) => value,
    ingestAllUploadedPhotos: vi.fn(async () => {}), clerkUser: { id: "voice-technician" },
    getToken: vi.fn(async () => "test-auth-token"),
    setQualityNotice: vi.fn(), setWsError: vi.fn(), deferredPixelItemsRef: { current: [] },
    deferredPixelTimerRef: { current: null }, InteractionManager: { runAfterInteractions: vi.fn() },
    analyzeEvidencePixels: vi.fn(), FileSystem,
    Haptics: { impactAsync: vi.fn(async () => {}), ImpactFeedbackStyle: { Medium: "medium" } },
  });
  let listener: (result: SpeechTranscriptionResult) => void = () => {};
  const provider: SpeechProvider = {
    initialize: async () => {}, start: async () => {}, cancel: async () => {},
    stop: async () => { listener({ text: transcript, confidence: 0.85, isFinal: true }); },
    onTranscription: (callback) => { listener = callback; }, getConfidence: () => 0.85,
  };
  return { ...capture, cameraQueue, record, recordRef, cameraProvider, error, provider, getPhotos: () => photos };
}

describe("spoken photo -> existing durable evidence pipeline", () => {
  it.each([
    "El cliente dijo que the wall is wet.",
    "Le mur est humide.",
    "الجدار رطب",
    "दीवार गीली है",
  ])("keeps free-form multilingual notes rather than replacing them with inspected: %s", (rawText) => {
    const format = new Function(ts.transpileModule(
      `return (${initializer("formatEvent")});`,
      { compilerOptions: { target: ts.ScriptTarget.ES2022 } },
    ).outputText)();
    expect(format({ action: "inspected", confidence: 0.85, rawText })).toBe(rawText);
    expect(format({ action: "applied", product: "Alpine WSG", room: "Kitchen", rawText }))
      .toBe("applied Alpine WSG in Kitchen");
  });
  it.each([
    "take a photo",
    "Toma una photo de ants en la cocina",
    "Prends une photo des fourmis",
    "拍一张照片，厨房有蚂蚁",
    "التقط صورة النمل",
  ])("saves exactly one commanded photo durably for sync/reporting: %s", async (transcript) => {
    const h = await harness(transcript);
    const frames = { start: vi.fn(), stop: vi.fn(), getFrame: async () => "file:///context.jpg", getLastUri: () => null };
    const session = new VoiceCaptureSession(new AudioSessionManager(h.provider), frames, () => {});
    const outcomes: boolean[] = [];
    await session.start(async ({ event, contextOnly }) => {
      if (!contextOnly && event.capturePhoto) outcomes.push(await h.takePhoto());
    }, { getFrame: frames.getFrame });
    expect(h.cameraProvider.capture).not.toHaveBeenCalled();
    await session.stop();
    const persisted = await getLocalInspection(h.record.localId);
    expect(outcomes).toEqual([true]);
    expect(h.cameraProvider.capture).toHaveBeenCalledTimes(1);
    expect(persisted?.photos).toHaveLength(1);
    const photo = persisted!.photos[0];
    expect(photo.localUri).toContain(`/inspections/${h.record.localId}/photos/`);
    expect(fixture.files.has(photo.localUri)).toBe(true);
    expect(photo.capturedAt).toBe("2026-10-09T12:00:00Z");
    expect(photo.privacySanitized).toBe(true);
    expect(hasPendingWork(persisted!)).toBe(true);
    expect(h.getPhotos()[0].uri).toBe(photo.localUri);
    expect(persisted!.photos.some((p) => p.localUri === "file:///context.jpg")).toBe(false);
  });

  it("waits for durable persistence rather than resolving at the optimistic thumbnail", async () => {
    const h = await harness();
    let commit!: () => void;
    const gate = new Promise<void>((resolve) => { commit = resolve; });
    fixture.sanitize.mockImplementationOnce(async (_uri: string, destination: string) => {
      await gate;
      fixture.files.add(destination);
      return destination;
    });
    const saving = h.takePhoto();
    await vi.advanceTimersByTimeAsync(0);
    expect(h.getPhotos()).toHaveLength(1);
    expect((await getLocalInspection(h.record.localId))?.photos).toHaveLength(0);
    commit();
    await expect(saving).resolves.toBe(true);
    expect((await getLocalInspection(h.record.localId))?.photos).toHaveLength(1);
  });

  it("returns not-saved and removes the optimistic thumbnail when persistence fails", async () => {
    const h = await harness();
    vi.spyOn(console, "error").mockImplementation(() => {});
    fixture.sanitize.mockRejectedValueOnce(new Error("disk full"));
    await expect(h.takePhoto()).resolves.toBe(false);
    expect(h.getPhotos()).toEqual([]);
    expect((await getLocalInspection(h.record.localId))?.photos).toEqual([]);
    expect(h.error).toHaveBeenCalledWith("disk full");
  });

  it("does not save rolling background frames; deletes them when recording stops", async () => {
    const h = await harness();
    h.provider.stop = async () => {};
    let count = 0;
    const temporary = vi.fn(async () => {
      const uri = `file:///context-${++count}.jpg`;
      fixture.files.add(uri);
      return uri;
    });
    const frames = createFrameBuffer({ takePicture: temporary, deleteFile: FileSystem.deleteAsync });
    const session = new VoiceCaptureSession(new AudioSessionManager(h.provider), frames, () => {});
    await session.start(async ({ event, contextOnly }) => {
      if (!contextOnly && event.capturePhoto) await h.takePhoto();
    }, { getFrame: () => frames.getFrame() });
    await vi.advanceTimersByTimeAsync(4500);
    expect(temporary).toHaveBeenCalledTimes(3);
    expect(h.cameraProvider.capture).not.toHaveBeenCalled();
    expect((await getLocalInspection(h.record.localId))?.photos).toEqual([]);
    await session.stop();
    expect(fixture.files.size).toBe(0);
  });

  it("keeps the UI branches connected to the awaited durable shutter and distinguishes temporary context", () => {
    expect(initializer("handleFaiePress").match(/await saveVoicePhoto\(\)/g)).toHaveLength(2);
    expect(initializer("saveVoicePhoto")).toContain("await takePhotoRef.current(allowed)");
    expect(initializer("takePhoto")).toContain("return ingestEvidence(items)");
    expect(source).toContain("takePhotoRef.current = takePhoto");
    expect(source).toContain("Temporary context · not saved");
    expect(source).toContain("Photo saved to inspection");
  });

  it("never fires a voice shutter cancelled while queued behind another capture", async () => {
    const h = await harness();
    let release!: () => void;
    const blocking = h.cameraQueue.enqueue(() => new Promise<void>((resolve) => { release = resolve; }));
    await vi.advanceTimersByTimeAsync(0);
    let active = true;
    const voice = h.takePhoto(() => active);
    active = false;
    release();
    await blocking;
    await expect(voice).resolves.toBe(false);
    expect(h.cameraProvider.capture).not.toHaveBeenCalled();
    expect((await getLocalInspection(h.record.localId))?.photos).toEqual([]);
  });

  it("discards a cancelled voice image returned by an already-running native shutter", async () => {
    const h = await harness();
    let returnImage!: () => void;
    const imageReady = new Promise<void>((resolve) => { returnImage = resolve; });
    const capture = h.cameraProvider.capture.getMockImplementation()!;
    h.cameraProvider.capture.mockImplementationOnce(async () => { await imageReady; return capture(); });
    let active = true;
    const voice = h.takePhoto(() => active);
    await vi.advanceTimersByTimeAsync(0);
    active = false;
    returnImage();
    await expect(voice).resolves.toBe(false);
    expect(fixture.files.has("file:///camera/voice-photo.jpg")).toBe(false);
    expect((await getLocalInspection(h.record.localId))?.photos).toEqual([]);
  });
});
