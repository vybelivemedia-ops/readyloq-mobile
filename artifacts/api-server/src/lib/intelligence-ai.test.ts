import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PassThrough } from "stream";

const { createMock, getObjectEntityFileMock, legacyGetObjectEntityFileMock } = vi.hoisted(() => ({
  createMock: vi.fn(),
  getObjectEntityFileMock: vi.fn(),
  legacyGetObjectEntityFileMock: vi.fn(),
}));

vi.mock("@workspace/integrations-openai-ai-server", () => ({
  openai: {
    chat: {
      completions: {
        create: createMock,
      },
    },
  },
}));

vi.mock("./objectStorage", () => ({
  ObjectStorageService: class {
    async getObjectEntityFile() {
      return legacyGetObjectEntityFileMock();
    }
    getObjectEntityFileHandle() {
      return getObjectEntityFileMock();
    }
  },
}));

import {
  analyzePhoto,
  analyzePhotoFromBase64,
  analyzePhotoWithOutcome,
  regenerateFindingAfterTechnicianCorrection,
} from "./intelligence-ai";

const VALID_RESPONSE = {
  choices: [{
    message: {
      content: JSON.stringify({
        category: null,
        subcategory: null,
        confidence: 0.2,
        tags: ["clean"],
        possiblePest: null,
        pestCandidates: [],
        possibleLifeStage: null,
        possibleConduciveCondition: null,
        possibleHarborage: null,
        possibleMoistureIssue: null,
        possibleStructuralIssue: null,
        measurementEstimate: null,
        possibleEntryPoint: null,
        suggestedCorrectiveAction: null,
        rationale: "No activity visible.",
        zone: null,
      }),
    },
  }],
};

function readableFile(
  body: Buffer,
  headers: Record<string, string> = { "content-length": String(body.length), "content-type": "image/jpeg" },
) {
  const createReadStream = vi.fn(() => {
    const stream = new PassThrough();
    queueMicrotask(() => {
      stream.emit("response", { headers });
      stream.end(body);
    });
    return stream;
  });
  return { createReadStream };
}

describe("analyzePhoto provider resilience", () => {
  beforeEach(() => {
    createMock.mockReset();
    getObjectEntityFileMock.mockReset();
    legacyGetObjectEntityFileMock.mockReset();
    getObjectEntityFileMock.mockReturnValue(readableFile(Buffer.from("jpeg")));
    vi.spyOn(Math, "random").mockReturnValue(0);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("backs off and retries provider 429 responses", async () => {
    vi.useFakeTimers();
    createMock
      .mockRejectedValueOnce({ status: 429 })
      .mockRejectedValueOnce({ response: { status: 429 } })
      .mockResolvedValueOnce(VALID_RESPONSE);

    const pending = analyzePhoto("/objects/companies/1/uploads/photo", null, {
      timeoutMs: 10_000,
      rateLimitRetries: 2,
    });
    await vi.advanceTimersByTimeAsync(750);
    await vi.advanceTimersByTimeAsync(1_500);

    expect(await pending).not.toBeNull();
    expect(createMock).toHaveBeenCalledTimes(3);
  });

  it("makes exactly one provider request when durable route budgeting disables retries", async () => {
    createMock.mockRejectedValue({ status: 429 });

    const outcome = await analyzePhotoWithOutcome(
      "/objects/companies/1/uploads/photo",
      null,
      { timeoutMs: 1_000, rateLimitRetries: 0 },
    );

    expect(outcome).toEqual({ status: "rate_limited", prediction: null });
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(createMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ maxRetries: 0 }),
    );
  });

  it("caps a requested retry count so a bad caller cannot create unbounded AI work", async () => {
    vi.useFakeTimers();
    createMock.mockRejectedValue({ status: 429 });

    const pending = analyzePhotoWithOutcome("/objects/companies/1/uploads/photo", null, {
      timeoutMs: 10_000,
      rateLimitRetries: 10_000,
    });
    await vi.advanceTimersByTimeAsync(2_250);

    expect(await pending).toEqual({ status: "rate_limited", prediction: null });
    expect(createMock).toHaveBeenCalledTimes(3);
  });

  it("honors Retry-After delay-seconds from provider response headers", async () => {
    vi.useFakeTimers();
    createMock
      .mockRejectedValueOnce({
        response: { status: 429, headers: { "retry-after": "3" } },
      })
      .mockResolvedValueOnce(VALID_RESPONSE);

    const pending = analyzePhoto("/objects/companies/1/uploads/photo", null, {
      timeoutMs: 10_000,
      rateLimitRetries: 1,
    });
    await vi.advanceTimersByTimeAsync(2_999);
    expect(createMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);

    expect(await pending).not.toBeNull();
    expect(createMock).toHaveBeenCalledTimes(2);
  });

  it("honors Retry-After HTTP-date values from provider headers", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-15T12:00:00.000Z"));
    createMock
      .mockRejectedValueOnce({
        status: 429,
        headers: new Headers({
          "Retry-After": "Tue, 15 Sep 2026 12:00:04 GMT",
        }),
      })
      .mockResolvedValueOnce(VALID_RESPONSE);

    const pending = analyzePhoto("/objects/companies/1/uploads/photo", null, {
      timeoutMs: 10_000,
      rateLimitRetries: 1,
    });
    await vi.advanceTimersByTimeAsync(3_999);
    expect(createMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);

    expect(await pending).not.toBeNull();
    expect(createMock).toHaveBeenCalledTimes(2);
  });

  it("uses exponential backoff when Retry-After is invalid", async () => {
    vi.useFakeTimers();
    createMock
      .mockRejectedValueOnce({
        status: 429,
        headers: { "Retry-After": "not-a-delay" },
      })
      .mockResolvedValueOnce(VALID_RESPONSE);

    const pending = analyzePhoto("/objects/companies/1/uploads/photo", null, {
      timeoutMs: 10_000,
      rateLimitRetries: 1,
    });
    await vi.advanceTimersByTimeAsync(749);
    expect(createMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);

    expect(await pending).not.toBeNull();
    expect(createMock).toHaveBeenCalledTimes(2);
  });

  it("caps Retry-After at the remaining whole-job deadline", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-15T12:00:00.000Z"));
    createMock.mockRejectedValue({
      status: 429,
      headers: { "retry-after": "60" },
    });

    const pending = analyzePhoto("/objects/companies/1/uploads/photo", null, {
      timeoutMs: 10_000,
      deadlineAt: Date.now() + 2_000,
      rateLimitRetries: 1,
    });
    await vi.advanceTimersByTimeAsync(1_999);
    expect(createMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);

    expect(await pending).toBeNull();
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it("returns a retryable null when the per-photo deadline expires", async () => {
    vi.useFakeTimers();
    createMock.mockImplementation(() => new Promise(() => {}));

    const pending = analyzePhoto("/objects/companies/1/uploads/photo", null, {
      timeoutMs: 1_000,
      rateLimitRetries: 0,
    });
    await vi.advanceTimersByTimeAsync(1_000);

    expect(await pending).toBeNull();
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it("rejects oversized Content-Length before content or provider", async () => {
    const file = readableFile(Buffer.from("jpeg"), {
      "content-length": String(20 * 1024 * 1024 + 1),
      "content-type": "image/jpeg",
    });
    getObjectEntityFileMock.mockReturnValue(file);

    const outcome = await analyzePhotoWithOutcome("/objects/companies/1/uploads/photo", null, {
      timeoutMs: 5_000,
      rateLimitRetries: 0,
    });

    expect(outcome).toEqual({ status: "failed", prediction: null });
    expect(file.createReadStream).toHaveBeenCalledTimes(1);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("rejects an oversized streamed body without calling the provider", async () => {
    const oversized = Buffer.alloc(20 * 1024 * 1024 + 1);
    getObjectEntityFileMock.mockReturnValue(readableFile(oversized, {}));

    const outcome = await analyzePhotoWithOutcome("/objects/companies/1/uploads/photo", null, {
      timeoutMs: 5_000,
      rateLimitRetries: 0,
    });

    expect(outcome).toEqual({ status: "failed", prediction: null });
    expect(createMock).not.toHaveBeenCalled();
  });

  it("does not use network-backed handle preparation before a stalled stream", async () => {
    vi.useFakeTimers();
    const stream = new PassThrough();
    const file = { createReadStream: vi.fn(() => stream) };
    getObjectEntityFileMock.mockReturnValue(file);
    legacyGetObjectEntityFileMock.mockImplementation(() => new Promise(() => {}));

    const pending = analyzePhotoWithOutcome("/objects/companies/1/uploads/photo", null, {
      timeoutMs: 1_000,
      rateLimitRetries: 0,
    });
    await vi.advanceTimersByTimeAsync(1_000);

    expect(await pending).toEqual({ status: "deferred", prediction: null });
    expect(legacyGetObjectEntityFileMock).not.toHaveBeenCalled();
    expect(stream.destroyed).toBe(true);
    expect(stream.listenerCount("data")).toBe(0);
    expect(stream.listenerCount("error")).toBe(0);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("cleans stream listeners after an actual oversized stream", async () => {
    const stream = new PassThrough();
    const file = { createReadStream: vi.fn(() => stream) };
    getObjectEntityFileMock.mockReturnValue(file);

    const pending = analyzePhotoWithOutcome("/objects/companies/1/uploads/photo", null, {
      timeoutMs: 5_000,
      rateLimitRetries: 0,
    });
    stream.emit("response", { headers: {} });
    stream.write(Buffer.alloc(20 * 1024 * 1024 + 1));
    expect(await pending).toEqual({ status: "failed", prediction: null });

    expect(stream.destroyed).toBe(true);
    expect(stream.listenerCount("data")).toBe(0);
    expect(stream.listenerCount("error")).toBe(0);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("destroys a stalled stream at the deadline and defers without calling the provider", async () => {
    vi.useFakeTimers();
    const stream = new PassThrough();
    getObjectEntityFileMock.mockReturnValue({ createReadStream: vi.fn(() => stream) });

    const pending = analyzePhotoWithOutcome("/objects/companies/1/uploads/photo", null, {
      timeoutMs: 1_000,
      rateLimitRetries: 0,
    });
    await vi.advanceTimersByTimeAsync(1_000);

    expect(await pending).toEqual({ status: "deferred", prediction: null });
    expect(stream.destroyed).toBe(true);
    expect(stream.listenerCount("data")).toBe(0);
    expect(stream.listenerCount("error")).toBe(0);
    expect(createMock).not.toHaveBeenCalled();
  });

  it("treats close without end as a failed read and cleans listeners", async () => {
    const stream = new PassThrough();
    getObjectEntityFileMock.mockReturnValue({ createReadStream: vi.fn(() => stream) });

    const pending = analyzePhotoWithOutcome("/objects/companies/1/uploads/photo", null, {
      timeoutMs: 5_000,
      rateLimitRetries: 0,
    });
    stream.emit("close");

    expect(await pending).toEqual({ status: "failed", prediction: null });
    expect(stream.listenerCount("data")).toBe(0);
    expect(stream.listenerCount("error")).toBe(0);
    expect(createMock).not.toHaveBeenCalled();
  });
});

const CORRECTION_INPUT = {
  category: "pest",
  description: "A pest was observed.",
  treatment: null,
  location: "Kitchen",
  correctedSpecies: "German cockroach",
};

const CORRECTION_RESPONSE = {
  choices: [{
    message: {
      content: JSON.stringify({
        description: "The technician verified a German cockroach in the kitchen.",
        treatment: "Follow the approved site IPM protocol.",
      }),
    },
  }],
};

describe.each([
  {
    name: "live-camera base64 analysis",
    run: (options: Parameters<typeof analyzePhotoFromBase64>[1]) =>
      analyzePhotoFromBase64("an-image", options),
    response: VALID_RESPONSE,
  },
  {
    name: "corrected-finding regeneration",
    run: (options: Parameters<typeof regenerateFindingAfterTechnicianCorrection>[1]) =>
      regenerateFindingAfterTechnicianCorrection(CORRECTION_INPUT, options),
    response: CORRECTION_RESPONSE,
  },
])("$name provider resilience", ({ run, response }) => {
  beforeEach(() => {
    createMock.mockReset();
    getObjectEntityFileMock.mockReset();
    legacyGetObjectEntityFileMock.mockReset();
    getObjectEntityFileMock.mockReturnValue(readableFile(Buffer.from("jpeg")));
    vi.spyOn(Math, "random").mockReturnValue(0);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-15T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("retries a throttled provider call successfully", async () => {
    createMock
      .mockRejectedValueOnce({ status: 429, headers: { "retry-after": "1" } })
      .mockResolvedValueOnce(response);

    const pending = run({
      timeoutMs: 5_000,
      rateLimitRetries: 1,
    });
    await vi.advanceTimersByTimeAsync(1_000);

    expect(await pending).not.toBeNull();
    expect(createMock).toHaveBeenCalledTimes(2);
    expect(createMock.mock.calls[0]?.[1]).toMatchObject({ maxRetries: 0 });
  });

  it("stops at the operation deadline instead of waiting the full Retry-After", async () => {
    createMock.mockRejectedValue({
      status: 429,
      headers: { "retry-after": "60" },
    });

    const pending = run({
      timeoutMs: 10_000,
      deadlineAt: Date.now() + 2_000,
      rateLimitRetries: 1,
    });
    await vi.advanceTimersByTimeAsync(1_999);
    expect(createMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);

    expect(await pending).toBeNull();
    expect(createMock).toHaveBeenCalledTimes(1);
  });
});