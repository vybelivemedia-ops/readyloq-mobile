import { afterEach, describe, expect, it, vi } from "vitest";
import { AudioSessionManager } from "../../lib/audio/AudioSessionManager";
import { VoiceCaptureSession, type VoiceCapturePhase } from "../../lib/audio/VoiceCaptureSession";
import type { SpeechProvider } from "../../lib/audio/providers/SpeechProvider";
import type { SpeechTranscriptionResult } from "../../lib/audio/types/audio.types";
import { createFrameBuffer } from "../../lib/voice-context/frame-buffer";

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function setup() {
  let listener: (result: SpeechTranscriptionResult) => void = () => {};
  const provider: SpeechProvider = {
    initialize: vi.fn(async () => {}),
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => {}),
    cancel: vi.fn(async () => {}),
    onTranscription: vi.fn((callback) => { listener = callback; }),
    getConfidence: () => 0.85,
  };
  const frames = {
    start: vi.fn(), stop: vi.fn(), getFrame: vi.fn(async () => "file:///context.jpg"),
    getLastUri: () => "file:///context.jpg",
  };
  const phases: VoiceCapturePhase[] = [];
  const manager = new AudioSessionManager(provider);
  const session = new VoiceCaptureSession(manager, frames, (phase) => phases.push(phase));
  return { provider, frames, phases, manager, session, emit: (text: string) => listener({ text, confidence: 0.85, isFinal: true }) };
}

afterEach(() => vi.useRealTimers());

describe("voice capture recording lifecycle", () => {
  it("captures only once for repeated final photo commands in the same recording", async () => {
    const { session, emit, provider } = setup();
    const photos = vi.fn();
    await session.start(({ event, contextOnly }) => {
      if (!contextOnly && event.capturePhoto) photos();
    }, {});
    emit("take a photo");
    emit("take a photo");
    emit("snap");
    await session.stop();
    expect(photos).toHaveBeenCalledTimes(1);
    vi.mocked(provider.stop).mockImplementation(async () => { emit("take a photo"); });
    await session.start(({ event }) => { if (event.capturePhoto) photos(); }, {});
    await session.stop();
    expect(photos).toHaveBeenCalledTimes(2);
  });

  it("installs the transcript listener before native start can emit a final callback", async () => {
    const { session, emit, provider } = setup();
    vi.mocked(provider.start).mockImplementation(async () => { emit("take a photo"); });
    const consumer = vi.fn();
    await session.start(consumer, {});
    expect(consumer).toHaveBeenCalledTimes(1);
    expect(consumer.mock.calls[0][0].event.capturePhoto).toBe(true);
    await session.cancel();
  });
  it("stays recording after start resolves, until explicit stop", async () => {
    const { session, provider, frames, phases } = setup();
    await session.start(() => {}, {});
    expect(session.phase).toBe("recording");
    expect(phases).toEqual(["starting", "recording"]);
    expect(provider.stop).not.toHaveBeenCalled();
    expect(frames.stop).not.toHaveBeenCalled();
    await session.stop();
    expect(phases).toEqual(["starting", "recording", "processing", "idle"]);
    expect(provider.stop).toHaveBeenCalledTimes(1);
    expect(frames.stop).toHaveBeenCalledTimes(1);
  });

  it("does not take temporary photos while the microphone is initializing", async () => {
    const { provider, frames, session } = setup();
    const ready = deferred();
    vi.mocked(provider.initialize).mockReturnValue(ready.promise);
    const start = session.start(() => {}, {});
    expect(session.phase).toBe("starting");
    expect(frames.start).not.toHaveBeenCalled();
    ready.resolve();
    await start;
    expect(frames.start).toHaveBeenCalledTimes(1);
    await session.cancel();
  });

  it("accepts the asynchronous final transcript during stop and waits for evidence commit", async () => {
    const { provider, session, emit, frames } = setup();
    const transcript = deferred();
    const committed = deferred();
    const commands: boolean[] = [];
    vi.mocked(provider.stop).mockImplementation(async () => {
      await transcript.promise;
      // Emulate a provider which does not await its listener.
      emit("take a photo");
    });
    await session.start(async ({ event, contextOnly }) => {
      if (contextOnly) return;
      commands.push(Boolean(event.capturePhoto));
      await committed.promise;
    }, { getFrame: frames.getFrame });
    let finished = false;
    const stop = session.stop().then(() => { finished = true; });
    expect(session.phase).toBe("processing");
    transcript.resolve();
    await vi.waitFor(() => expect(commands).toEqual([true]));
    expect(finished).toBe(false);
    expect(frames.stop).not.toHaveBeenCalled();
    committed.resolve();
    await stop;
    expect(finished).toBe(true);
    expect(session.phase).toBe("idle");
    emit("take a photo");
    await Promise.resolve();
    expect(commands).toEqual([true]);
  });

  it("does not start duplicate recordings or stop twice on rapid taps", async () => {
    const { provider, session } = setup();
    const ready = deferred();
    vi.mocked(provider.initialize).mockReturnValue(ready.promise);
    const first = session.start(() => {}, {});
    await session.start(() => {}, {});
    ready.resolve();
    await first;
    await Promise.all([session.stop(), session.stop()]);
    expect(provider.start).toHaveBeenCalledTimes(1);
    expect(provider.stop).toHaveBeenCalledTimes(1);
  });

  it("ignores final transcription after cancellation during stop", async () => {
    const { session, provider, emit } = setup();
    const done = deferred();
    vi.mocked(provider.stop).mockImplementation(async () => { await done.promise; emit("take a photo"); });
    const consumer = vi.fn();
    await session.start(consumer, {});
    const stopping = session.stop();
    const cancelling = session.cancel();
    done.resolve();
    await cancelling;
    await stopping;
    expect(consumer).not.toHaveBeenCalled();
    expect(session.phase).toBe("idle");
  });

  it("cleans up after a failed command without reporting a successful save", async () => {
    const { provider, session, emit, frames } = setup();
    vi.mocked(provider.stop).mockImplementation(async () => { emit("take a photo"); });
    await session.start(async () => { throw new Error("disk full"); }, {});
    await expect(session.stop()).rejects.toThrow("disk full");
    expect(session.phase).toBe("idle");
    expect(frames.stop).toHaveBeenCalledTimes(1);
  });

  it("does not publish context or commands after cancellation during initialization", async () => {
    const { provider, session, frames } = setup();
    const ready = deferred();
    vi.mocked(provider.initialize).mockReturnValue(ready.promise);
    const start = session.start(vi.fn(), {});
    await session.cancel();
    ready.resolve();
    await start;
    expect(frames.start).not.toHaveBeenCalled();
    expect(provider.start).not.toHaveBeenCalled();
    expect(session.phase).toBe("idle");
  });

  it("waits for cancelled native startup to release before starting another recording", async () => {
    const { provider, session, frames } = setup();
    const nativeReady = deferred();
    vi.mocked(provider.start).mockReturnValueOnce(nativeReady.promise).mockResolvedValue(undefined);
    const starting = session.start(() => {}, {});
    await vi.waitFor(() => expect(provider.start).toHaveBeenCalledTimes(1));
    const cancelling = session.cancel();
    const restarting = session.start(() => {}, {});
    expect(provider.start).toHaveBeenCalledTimes(1);
    nativeReady.resolve();
    await Promise.all([starting, cancelling, restarting]);
    expect(provider.start).toHaveBeenCalledTimes(2);
    expect(frames.start).toHaveBeenCalledTimes(1);
    expect(session.phase).toBe("recording");
    await session.cancel();
  });
});

describe("temporary voice context cleanup", () => {
  it("replaces/deletes rolling frames, retains context until the consumer finishes, and never saves every frame", async () => {
    vi.useFakeTimers();
    const takePicture = vi.fn()
      .mockResolvedValueOnce("file:///context-1.jpg")
      .mockResolvedValueOnce("file:///context-2.jpg");
    const deleteFile = vi.fn(async () => {});
    const frames = createFrameBuffer({ takePicture, deleteFile });
    const { provider, emit } = setup();
    const consumerDone = deferred();
    vi.mocked(provider.stop).mockImplementation(async () => { emit("found ants in kitchen"); });
    const session = new VoiceCaptureSession(new AudioSessionManager(provider), frames, () => {});
    await session.start(async ({ contextOnly }) => {
      if (!contextOnly) await consumerDone.promise;
      // Context-only updates are deliberately not inspection evidence.
    }, { getFrame: () => frames.getFrame() });
    await vi.advanceTimersByTimeAsync(3000);
    expect(takePicture).toHaveBeenCalledTimes(2);
    expect(deleteFile).toHaveBeenCalledWith("file:///context-1.jpg", { idempotent: true });
    const stop = session.stop();
    await Promise.resolve();
    expect(deleteFile).not.toHaveBeenCalledWith("file:///context-2.jpg", { idempotent: true });
    await vi.advanceTimersByTimeAsync(6000);
    expect(takePicture).toHaveBeenCalledTimes(2);
    consumerDone.resolve();
    await stop;
    expect(deleteFile).toHaveBeenCalledWith("file:///context-2.jpg", { idempotent: true });
    await vi.advanceTimersByTimeAsync(5000);
    expect(takePicture).toHaveBeenCalledTimes(2);
  });
});
