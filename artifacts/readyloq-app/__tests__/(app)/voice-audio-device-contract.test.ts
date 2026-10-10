import { readFileSync } from "node:fs";
import { URL } from "node:url";
import ts from "typescript";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({
  platform: { OS: "android" },
  permission: vi.fn(),
  mode: vi.fn(),
  prepare: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
  deleted: vi.fn(),
  read: vi.fn(),
  init: vi.fn(),
  transcribe: vi.fn(),
  stopTranscription: vi.fn(),
  fetch: vi.fn(),
}));
vi.mock("react-native", () => ({ Platform: native.platform }));
vi.mock("expo-av", () => ({
  Audio: {
    requestPermissionsAsync: native.permission,
    setAudioModeAsync: native.mode,
    IOSOutputFormat: { LINEARPCM: "lpcm" },
    RecordingOptionsPresets: { HIGH_QUALITY: {
      android: { extension: ".m4a", outputFormat: 2, audioEncoder: 3, sampleRate: 44100, numberOfChannels: 2 },
      ios: { extension: ".m4a", outputFormat: "aac", sampleRate: 44100, numberOfChannels: 2 },
    } },
    Recording: class {
      private extension = ".m4a";
      async prepareToRecordAsync(options: { android: { extension: string }; ios: { extension: string } }) {
        this.extension = (native.platform.OS === "android" ? options.android : options.ios).extension;
        await native.prepare(options);
      }
      startAsync() { return native.start(); }
      stopAndUnloadAsync() { return native.stop(); }
      getURI() { return `file:///voice-clip${this.extension}`; }
    },
  },
}));
vi.mock("expo-file-system/legacy", () => ({
  documentDirectory: "file:///documents/",
  getInfoAsync: async () => ({ exists: true }),
  readAsStringAsync: native.read,
  deleteAsync: native.deleted,
  EncodingType: { Base64: "base64" },
}));
vi.mock("whisper.rn", () => ({ initWhisper: native.init }));
vi.mock("../../lib/api", () => ({ API_BASE: "https://api.example.test" }));

import { FallbackSpeechProvider } from "../../lib/audio/providers/FallbackSpeechProvider";
import { OpenAIWhisperProvider } from "../../lib/audio/providers/OpenAIWhisperProvider";
import { AudioSessionManager } from "../../lib/audio/AudioSessionManager";
import { VoiceCaptureSession } from "../../lib/audio/VoiceCaptureSession";
import { speechService } from "../../lib/vision/speech-service";

beforeEach(() => {
  vi.clearAllMocks();
  native.platform.OS = "android";
  native.permission.mockResolvedValue({ status: "granted" });
  native.mode.mockResolvedValue(undefined);
  native.prepare.mockResolvedValue(undefined);
  native.start.mockResolvedValue(undefined);
  native.stop.mockResolvedValue(undefined);
  native.deleted.mockResolvedValue(undefined);
  native.read.mockResolvedValue("AAAAHGZ0eXBNNEE="); // MP4 container fixture
  native.fetch.mockResolvedValue({ ok: true, json: async () => ({ text: "take a photo" }) });
  native.stopTranscription.mockResolvedValue(undefined);
  native.transcribe.mockImplementation(() => ({
    promise: Promise.resolve({ result: "take a photo", segments: [{ text: "take a photo" }] }),
    stop: native.stopTranscription,
  }));
  native.init.mockResolvedValue({ transcribe: native.transcribe });
  vi.stubGlobal("fetch", native.fetch);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const token = async () => "test-only-auth";
const frames = () => ({ start: vi.fn(), pause: vi.fn(), stop: vi.fn(), getFrame: async () => null, getLastUri: () => null });

describe("actual Android voice provider contract", () => {
  it("can start and keep recording offline without calling a cloud service", async () => {
    native.fetch.mockRejectedValue(new Error("offline"));
    const session = new VoiceCaptureSession(new AudioSessionManager(new FallbackSpeechProvider()), frames(), () => {});
    await session.start(vi.fn(), { getToken: token });
    expect(session.phase).toBe("recording");
    expect(native.fetch).not.toHaveBeenCalled();
    await session.cancel();
    expect(native.deleted).toHaveBeenCalled();
  });
  it("uses the supported cloud recorder and dispatches one photo only after explicit Stop", async () => {
    const provider = new FallbackSpeechProvider();
    const session = new VoiceCaptureSession(new AudioSessionManager(provider), frames(), () => {});
    const photos = vi.fn();
    await session.start(({ event, contextOnly }) => {
      if (!contextOnly && event.capturePhoto) photos();
    }, { getToken: token });
    expect(session.phase).toBe("recording");
    expect(provider.isUsingFallback).toBe(true);
    expect(native.init).not.toHaveBeenCalled();
    expect(native.prepare.mock.calls[0][0].android).toMatchObject({
      extension: ".m4a", outputFormat: 2, audioEncoder: 3,
    });
    expect(native.fetch).not.toHaveBeenCalled();
    expect(photos).not.toHaveBeenCalled();
    await session.stop();
    expect(photos).toHaveBeenCalledTimes(1);
    expect(native.fetch).toHaveBeenCalledWith("https://api.example.test/api/transcribe", expect.objectContaining({
      headers: { "Content-Type": "application/json", Authorization: "Bearer test-only-auth" },
      body: JSON.stringify({ audio: "AAAAHGZ0eXBNNEE=", mimeType: "audio/mp4" }),
    }));
    expect(native.deleted).toHaveBeenCalledWith("file:///voice-clip.m4a", { idempotent: true });
    expect(native.mode).toHaveBeenLastCalledWith({ allowsRecordingIOS: false });
    expect(session.phase).toBe("idle");
  });

  it("surfaces server failures and still releases audio and its temporary clip", async () => {
    native.fetch.mockResolvedValue({ ok: false, status: 500 });
    const provider = new OpenAIWhisperProvider();
    const session = new VoiceCaptureSession(new AudioSessionManager(provider), frames(), () => {});
    const consumer = vi.fn();
    await session.start(consumer, { getToken: token });
    await expect(session.stop()).rejects.toThrow("Transcription failed (500)");
    expect(consumer).not.toHaveBeenCalled();
    expect(native.deleted).toHaveBeenCalledWith("file:///voice-clip.m4a", { idempotent: true });
    expect(session.phase).toBe("idle");
  });

  it("releases a partially prepared recorder if native recording startup fails", async () => {
    native.start.mockRejectedValueOnce(new Error("native recorder failed"));
    const provider = new OpenAIWhisperProvider();
    await provider.initialize({ getToken: token });
    await expect(provider.start()).rejects.toThrow("native recorder failed");
    expect(native.stop).toHaveBeenCalled();
    expect(native.deleted).toHaveBeenCalled();
    expect(native.mode).toHaveBeenLastCalledWith({ allowsRecordingIOS: false });
  });

  it("rejects missing microphone permission without creating a recording", async () => {
    native.permission.mockResolvedValue({ status: "denied" });
    const session = new VoiceCaptureSession(new AudioSessionManager(new FallbackSpeechProvider()), frames(), () => {});
    await expect(session.start(vi.fn(), { getToken: token })).rejects.toThrow("permission");
    expect(native.prepare).not.toHaveBeenCalled();
    expect(session.phase).toBe("idle");
  });

  it("requires authentication rather than silently discarding an unauthorized transcription", async () => {
    const provider = new OpenAIWhisperProvider();
    await provider.initialize({ getToken: async () => null });
    await provider.start();
    provider.onTranscription(vi.fn());
    await expect(provider.stop()).rejects.toThrow("Sign in again");
    expect(native.fetch).not.toHaveBeenCalled();
    expect(native.deleted).toHaveBeenCalled();
  });

  it("bounds stalled network work and cleans up on timeout", async () => {
    vi.useFakeTimers();
    native.fetch.mockImplementation(() => new Promise(() => {}));
    const provider = new OpenAIWhisperProvider();
    await provider.initialize({ getToken: token });
    await provider.start();
    provider.onTranscription(vi.fn());
    const stopping = provider.stop();
    const failure = expect(stopping).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(30_000);
    await failure;
    expect(native.deleted).toHaveBeenCalled();
  });

  it("cancels a live recording without uploading or dispatching a command", async () => {
    const session = new VoiceCaptureSession(new AudioSessionManager(new FallbackSpeechProvider()), frames(), () => {});
    const consumer = vi.fn();
    await session.start(consumer, { getToken: token });
    await session.cancel();
    expect(native.stop).toHaveBeenCalledTimes(1);
    expect(native.fetch).not.toHaveBeenCalled();
    expect(consumer).not.toHaveBeenCalled();
    expect(native.deleted).toHaveBeenCalled();
  });

  it("consumes a late token failure after synchronous cancellation, without an unhandled rejection", async () => {
    const provider = new OpenAIWhisperProvider();
    let rejectToken!: (error: Error) => void;
    await provider.initialize({ getToken: () => {
      void provider.cancel();
      return new Promise<string | null>((_resolve, reject) => { rejectToken = reject; });
    } });
    await provider.start();
    const consumer = vi.fn();
    provider.onTranscription(consumer);
    await provider.stop();
    rejectToken(new Error("late token error"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(consumer).not.toHaveBeenCalled();
    expect(native.fetch).not.toHaveBeenCalled();
  });
});

describe("actual local Whisper recording and cleanup", () => {
  it("shares initialization rather than letting a second caller proceed before the model is ready", async () => {
    let ready!: (context: unknown) => void;
    native.init.mockReturnValueOnce(new Promise((resolve) => { ready = resolve; }));
    const first = speechService.initialize();
    const second = speechService.initialize();
    expect(second).toBe(first);
    await vi.waitFor(() => expect(native.init).toHaveBeenCalledTimes(1));
    ready({ transcribe: native.transcribe });
    await first;
    expect(speechService.isReady).toBe(true);
  });

  it("records real PCM on iOS and awaits final transcript handling", async () => {
    native.platform.OS = "ios";
    await speechService.initialize();
    const text: string[] = [];
    const stop = await speechService.startDictation(async (transcript) => { text.push(transcript); }, { throwOnError: true });
    expect(native.prepare.mock.calls[0][0].ios).toMatchObject({ extension: ".wav", outputFormat: "lpcm" });
    expect(native.transcribe).not.toHaveBeenCalled();
    const first = stop();
    expect(stop()).toBe(first);
    await first;
    expect(text).toEqual(["…", "take a photo"]);
    expect(native.transcribe.mock.calls[0][1]).toMatchObject({
      language: "auto", translate: false,
      initialPrompt: expect.stringContaining("code-switching"),
    });
    expect(native.stop).toHaveBeenCalledTimes(1);
    expect(native.deleted).toHaveBeenCalledWith("file:///voice-clip.wav", { idempotent: true });
  });

  it("does not run local transcription when cancellation is requested", async () => {
    native.platform.OS = "ios";
    await speechService.initialize();
    const consumer = vi.fn();
    const stop = await speechService.startDictation(consumer, { throwOnError: true });
    await stop({ cancel: true });
    expect(native.transcribe).not.toHaveBeenCalled();
    expect(consumer).not.toHaveBeenCalled();
    expect(native.deleted).toHaveBeenCalled();
  });

  it("propagates local decoder errors to FAIE while always deleting the clip", async () => {
    native.platform.OS = "ios";
    vi.spyOn(console, "error").mockImplementation(() => {});
    await speechService.initialize();
    native.transcribe.mockImplementation(() => { throw new Error("invalid audio"); });
    const stop = await speechService.startDictation(vi.fn(), { throwOnError: true });
    await expect(stop()).rejects.toThrow("invalid audio");
    expect(native.deleted).toHaveBeenCalled();
    expect(native.mode).toHaveBeenLastCalledWith({ allowsRecordingIOS: false });
  });
});

describe("inspection background handling", () => {
  it("runs the screen's actual AppState callback to abort pending transcription and reject a late photo command", async () => {
    const source = readFileSync(new URL("../../app/(app)/new-inspection.tsx", import.meta.url), "utf8");
    const ast = ts.createSourceFile("screen.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let effect = "";
    function visit(node: ts.Node) {
      if (ts.isCallExpression(node) && node.expression.getText(ast) === "useEffect"
        && node.arguments[0]?.getText(ast).includes('AppState.addEventListener("change"')) {
        effect = node.arguments[0].getText(ast);
      }
      ts.forEachChild(node, visit);
    }
    visit(ast);
    expect(effect).not.toBe("");
    let deliver!: (response: unknown) => void;
    native.fetch.mockReturnValue(new Promise((resolve) => { deliver = resolve; }));
    const session = new VoiceCaptureSession(new AudioSessionManager(new FallbackSpeechProvider()), frames(), () => {});
    const consumer = vi.fn();
    await session.start(consumer, { getToken: token });
    const stopping = session.stop();
    await vi.waitFor(() => expect(native.fetch).toHaveBeenCalled());
    let callback!: (state: string) => void;
    const status = vi.fn();
    const install = new Function("deps", ts.transpileModule(`
      const { step, AppState, faieSessionRef, faieStatusTimerRef, setFaiePendingConfirm,
        setLastEventHadFrame, setFaieStatus, requestPermission } = deps;
      return (${effect})();`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText);
    const cleanup = install({
      step: "capture", AppState: { addEventListener: (_event: string, listener: typeof callback) => {
        callback = listener; return { remove: vi.fn() };
      } },
      faieSessionRef: { current: session }, faieStatusTimerRef: { current: null },
      setFaiePendingConfirm: vi.fn(), setLastEventHadFrame: vi.fn(), setFaieStatus: status,
      requestPermission: async () => {},
    });
    callback("background");
    await stopping;
    expect(native.fetch.mock.calls[0][1].signal.aborted).toBe(true);
    deliver({ ok: true, json: async () => ({ text: "take a photo" }) });
    await Promise.resolve();
    expect(consumer).not.toHaveBeenCalled();
    expect(session.phase).toBe("idle");
    expect(status).toHaveBeenCalledWith(expect.stringContaining("cancelled in background"));
    callback("active");
    expect(session.phase).toBe("idle"); // No automatic restart.
    cleanup();

    // A permission prompt may make iOS temporarily inactive during startup.
    // Do not turn its successful permission result into a cancelled recording.
    const starting = { phase: "starting", cancel: vi.fn(async () => {}) };
    const permissionCleanup = install({
      step: "capture", AppState: { addEventListener: (_event: string, listener: typeof callback) => {
        callback = listener; return { remove: vi.fn() };
      } },
      faieSessionRef: { current: starting }, faieStatusTimerRef: { current: null },
      setFaiePendingConfirm: vi.fn(), setLastEventHadFrame: vi.fn(), setFaieStatus: vi.fn(),
      requestPermission: async () => {},
    });
    callback("inactive");
    expect(starting.cancel).not.toHaveBeenCalled();
    callback("background");
    expect(starting.cancel).toHaveBeenCalledTimes(1);
    permissionCleanup();
  });
});
