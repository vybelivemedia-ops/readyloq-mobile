import { beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => ({
  initialize: vi.fn(async () => {}),
  startDictation: vi.fn(),
}));
vi.mock("../../lib/vision/speech-service", () => ({ speechService: fake }));
import { LocalWhisperProvider } from "../../lib/audio/providers/LocalWhisperProvider";

beforeEach(() => vi.clearAllMocks());

describe("local Whisper final transcription completion", () => {
  it("awaits both final transcription and its async command consumer", async () => {
    let finish!: () => void;
    const transcriptReady = new Promise<void>((resolve) => { finish = resolve; });
    let commit!: () => void;
    const saved = new Promise<void>((resolve) => { commit = resolve; });
    fake.startDictation.mockImplementation(async (callback) => async () => {
      await transcriptReady;
      await callback("take a photo");
    });
    const provider = new LocalWhisperProvider();
    const consumer = vi.fn(async () => { await saved; });
    await provider.initialize({});
    provider.onTranscription(consumer);
    await provider.start();
    let stopped = false;
    const stopping = provider.stop().then(() => { stopped = true; });
    expect(stopped).toBe(false);
    finish();
    await vi.waitFor(() => expect(consumer).toHaveBeenCalledTimes(1));
    expect(stopped).toBe(false);
    commit();
    await stopping;
    expect(stopped).toBe(true);
    expect(consumer).toHaveBeenCalledWith({ text: "take a photo", confidence: 0.85, isFinal: true });
  });

  it("suppresses the final transcript when cancelling rather than stopping", async () => {
    fake.startDictation.mockImplementation(async (callback) => async () => { await callback("take a photo"); });
    const provider = new LocalWhisperProvider();
    const consumer = vi.fn();
    provider.onTranscription(consumer);
    await provider.start();
    await provider.cancel();
    expect(consumer).not.toHaveBeenCalled();
  });

  it("does not deliver an old recording's transcript to a newly registered listener", async () => {
    const callbacks: Array<(text: string) => Promise<void>> = [];
    fake.startDictation.mockImplementation(async (callback) => {
      callbacks.push(callback);
      return async () => {};
    });
    const provider = new LocalWhisperProvider();
    provider.onTranscription(vi.fn());
    await provider.start();
    await provider.cancel();
    const newConsumer = vi.fn();
    provider.onTranscription(newConsumer);
    await provider.start();
    await callbacks[0]("take a photo");
    expect(newConsumer).not.toHaveBeenCalled();
    await callbacks[1]("take a photo");
    expect(newConsumer).toHaveBeenCalledTimes(1);
    await provider.cancel();
  });
});
