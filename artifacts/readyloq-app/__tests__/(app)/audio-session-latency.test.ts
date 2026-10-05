import { describe, expect, it, vi } from "vitest";

import { AudioSessionManager } from "../../lib/audio/AudioSessionManager";
import type { SpeechProvider } from "../../lib/audio/providers/SpeechProvider";
import type { SpeechTranscriptionResult } from "../../lib/audio/types/audio.types";

function createProvider() {
  let onTranscription: ((result: SpeechTranscriptionResult) => void) | undefined;
  const provider: SpeechProvider = {
    initialize: vi.fn().mockResolvedValue(undefined),
    start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined),
    cancel: vi.fn().mockResolvedValue(undefined),
    onTranscription: vi.fn((callback) => {
      onTranscription = callback;
    }),
    getConfidence: vi.fn(() => 1),
  };
  return {
    provider,
    emit(result: SpeechTranscriptionResult) {
      if (!onTranscription) throw new Error("Session has not started");
      onTranscription(result);
    },
  };
}

describe("AudioSessionManager frame attachment latency", () => {
  it("dispatches the parsed command before a slow context frame resolves", async () => {
    const { provider, emit } = createProvider();
    const manager = new AudioSessionManager(provider);
    const updates: Array<{
      contextOnly?: boolean;
      imageUri?: string;
    }> = [];
    let resolveFrame!: (uri: string) => void;

    await manager.startSession(
      (update) => {
        updates.push({
          contextOnly: update.contextOnly,
          imageUri: update.event.imageUri,
        });
      },
      {
        getFrame: () =>
          new Promise<string>((resolve) => {
            resolveFrame = resolve;
          }),
      },
    );

    emit({ text: "found ants in kitchen", confidence: 0.99, isFinal: true });
    expect(updates).toEqual([{ contextOnly: undefined, imageUri: undefined }]);

    resolveFrame("file:///tmp/voice-context.jpg");
    await Promise.resolve();
    await Promise.resolve();
    expect(updates).toEqual([
      { contextOnly: undefined, imageUri: undefined },
      { contextOnly: true, imageUri: "file:///tmp/voice-context.jpg" },
    ]);
  });

  it("drops a delayed frame follow-up after the session is cancelled", async () => {
    const { provider, emit } = createProvider();
    const manager = new AudioSessionManager(provider);
    const updates: Array<{ contextOnly?: boolean }> = [];
    let resolveFrame!: (uri: string) => void;

    await manager.startSession(
      (update) => updates.push({ contextOnly: update.contextOnly }),
      {
        getFrame: () =>
          new Promise<string>((resolve) => {
            resolveFrame = resolve;
          }),
      },
    );
    emit({ text: "take a photo", confidence: 0.99, isFinal: true });
    await manager.cancelSession();
    resolveFrame("file:///tmp/stale.jpg");
    await Promise.resolve();
    await Promise.resolve();

    expect(updates).toEqual([{ contextOnly: undefined }]);
  });

  it("ignores a transcription callback from a cancelled session", async () => {
    const first = createProvider();
    const manager = new AudioSessionManager(first.provider);
    const updates: string[] = [];

    await manager.startSession((update) => updates.push(update.event.action));
    await manager.cancelSession();
    first.emit({ text: "take a photo", confidence: 0.99, isFinal: true });
    await Promise.resolve();

    expect(updates).toEqual([]);
  });

  it("does not cancel a newer session when an older start resolves late", async () => {
    let releaseFirstInitialize!: () => void;
    const firstInitialize = new Promise<void>((resolve) => {
      releaseFirstInitialize = resolve;
    });
    const { provider, emit } = createProvider();
    vi.mocked(provider.initialize)
      .mockReturnValueOnce(firstInitialize)
      .mockResolvedValueOnce(undefined);
    const manager = new AudioSessionManager(provider);
    const firstUpdates: string[] = [];
    const secondUpdates: string[] = [];

    const firstStart = manager.startSession((update) => {
      firstUpdates.push(update.event.action);
    });
    const secondStart = manager.startSession((update) => {
      secondUpdates.push(update.event.action);
    });
    await secondStart;
    releaseFirstInitialize();
    await firstStart;

    expect(provider.cancel).not.toHaveBeenCalled();
    expect(provider.start).toHaveBeenCalledTimes(1);
    emit({ text: "take a photo", confidence: 0.99, isFinal: true });
    await Promise.resolve();
    expect(firstUpdates).toEqual([]);
    expect(secondUpdates).toHaveLength(1);
  });
});