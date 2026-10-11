import { afterEach, describe, expect, it, vi } from "vitest";
import { analyzeGeminiPhoto, readPhotoBase64, checkGeminiDemoServer, GEMINI_DEMO_BUILD } from "./gemini-demo";

// Current-response fixtures carry the same public transport markers as the API.
class Response extends globalThis.Response {
  constructor(body?: BodyInit | null, init: ResponseInit = {}) {
    const headers = new Headers({
      "X-ReadyLoq-Demo-Build": "demo-compat-3",
      "X-ReadyLoq-Demo-Parser": "3",
    });
    new Headers(init.headers).forEach((value, key) => headers.set(key, value));
    super(body, { ...init, headers });
  }
}

afterEach(() => vi.unstubAllGlobals());
const input = { imageBase64: "YWJj", mimeType: "image/png" as const };
const result = () => ({
  model: "gemini-2.5-flash", demoOnly: true, reviewRequired: true,
  observations: [], hypotheses: [],
  confidence: { level: "low", explanation: "Not enough visual detail." },
  cannotDetermine: ["Source of the material."],
  nextChecks: ["Take a clearer photo with a scale."],
  reportReadyFinding: "AI-assisted draft. Technician review required.",
});

describe("Gemini demo client boundary", () => {
  it("uses the shared backend artifact, not the old portal proxy, and sends no record identifiers", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(result())));
    vi.stubGlobal("fetch", fetcher);
    expect(await analyzeGeminiPhoto(input)).toMatchObject({ demoOnly: true, reviewRequired: true });
    expect(fetcher.mock.calls[0][0]).toBe("/api/gemini-inspection-demo/analyze");
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual(input);
    expect(fetcher.mock.calls[0][1].headers["X-ReadyLoq-Demo-Client"]).toBe(GEMINI_DEMO_BUILD);
  });
  it("passes cancellation through without swallowing it", async () => {
    const controller = new AbortController();
    const error = new DOMException("Cancelled", "AbortError");
    const fetcher = vi.fn().mockRejectedValue(error);
    vi.stubGlobal("fetch", fetcher);
    await expect(analyzeGeminiPhoto(input, controller.signal)).rejects.toBe(error);
    expect(fetcher.mock.calls[0][1].signal).toBe(controller.signal);
  });
  it.each([429, 502, 503, 504])("shows server errors for HTTP %s instead of creating a finding", async status => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "Please retry." }), { status })));
    await expect(analyzeGeminiPhoto(input)).rejects.toThrow("Please retry.");
  });
  it("handles a non-JSON proxy error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("Bad gateway", { status: 502 })));
    await expect(analyzeGeminiPhoto(input)).rejects.toThrow("temporarily unavailable");
  });
  it("identifies the reported old generic error from an older demo server", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new globalThis.Response(JSON.stringify({
      code: "INVALID_ASSESSMENT",
      error: "Gemini returned an incomplete or unsupported assessment. No finding was saved; please try again.",
    }), { status: 502 })));
    await expect(analyzeGeminiPhoto(input)).rejects.toThrow("older demo validator");
  });
  it.each([
    ["EMPTY_ASSESSMENT", "Gemini completed the request but returned no assessment text."],
    ["PROVIDER_ERROR", "Gemini could not analyze this photo."],
    ["INVALID_ASSESSMENT", "Gemini returned JSON, but response validation failed at confidence.level."],
  ])("preserves distinct current-server diagnostics: %s", async (code, error) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ code, error }), {
      status: 502,
    })));
    await expect(analyzeGeminiPhoto(input)).rejects.toThrow(error);
  });
  it.each([{}, { ...result(), reviewRequired: false }, { ...result(), observations: null },
    { ...result(), confidence: { level: "76%", explanation: "Score" } }])(
    "rejects malformed or non-review-only success responses", async body => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(body))));
      await expect(analyzeGeminiPhoto(input)).rejects.toThrow("invalid result");
    });

  it("rejects a hypothesis referencing a missing visual clue", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      ...result(), hypotheses: [{ finding: "Possible residue", evidenceIndices: [0], uncertainty: "Not established." }],
    }))));
    await expect(analyzeGeminiPhoto(input)).rejects.toThrow("invalid result");
  });
  it("rejects a result from the older partial-rendering server even if its DTO looks valid", async () => {
    const partial = {
      ...result(), observations: ["Dark insect bodies on a sticky surface."],
      confidence: { level: "low", explanation: "Review-limited model response: identification confidence is not established." },
      cannotDetermine: ["The model did not provide usable photo limitations."],
      nextChecks: ["Ask a technician to provide missing assessment details."],
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(partial), {
      headers: { "X-ReadyLoq-Demo-Build": "demo-compat-2", "X-ReadyLoq-Demo-Parser": "2" },
    })));
    await expect(analyzeGeminiPhoto(input)).rejects.toThrow("Stale or mismatched");
  });

  it("checks version metadata without sending a photo or calling the analysis POST", async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetcher);
    expect(await checkGeminiDemoServer()).toMatchObject({ ready: true, build: GEMINI_DEMO_BUILD, parser: "3" });
    expect(fetcher.mock.calls[0][1]).toMatchObject({ method: "HEAD", cache: "no-store" });
    expect(fetcher.mock.calls[0][1]).not.toHaveProperty("body");
  });
  it.each([
    { status: 204, headers: { "X-ReadyLoq-Demo-Build": "demo-compat-2" }, message: "Stale or mismatched" },
    { status: 204, headers: { "X-ReadyLoq-Demo-Parser": "2" }, message: "Stale or mismatched" },
    { status: 404, headers: {}, message: "HTTP 404" },
    { status: 502, headers: {}, message: "HTTP 502" },
  ])("diagnoses version mismatch or API availability separately: $status", async ({ status, headers, message }) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(null, { status, headers })));
    const info = await checkGeminiDemoServer();
    expect(info.ready).toBe(false);
    expect(info.message).toContain(message);
  });
  it("detects an unversioned older endpoint without falsely claiming Gemini rejected a photo", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new globalThis.Response(null, { status: 204 })));
    expect(await checkGeminiDemoServer()).toMatchObject({ ready: false, build: "missing", parser: "missing" });
  });
  it("reports a rejected client handshake, even when server response markers are current", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: "DEMO_VERSION_MISMATCH" }), { status: 409 })));
    await expect(analyzeGeminiPhoto(input)).rejects.toThrow("version handshake");
  });

  it("cancels a photo read and removes callbacks before a replaced photo can be submitted", async () => {
    let reader: any;
    class Reader {
      result = "data:image/png;base64,YWJj";
      onload: any;
      onerror: any;
      onabort: any;
      abort = vi.fn(() => this.onabort?.());
      readAsDataURL() {}
      constructor() { reader = this; }
    }
    vi.stubGlobal("FileReader", Reader);
    const controller = new AbortController();
    const promise = readPhotoBase64({} as File, controller.signal);
    const rejection = expect(promise).rejects.toMatchObject({ name: "AbortError" });
    controller.abort();
    await rejection;
    expect(reader.abort).toHaveBeenCalledOnce();
    expect(reader.onload).toBeNull();
    expect(reader.onerror).toBeNull();
    expect(reader.onabort).toBeNull();
  });

  it("reads a selected photo without leaving stale callbacks", async () => {
    let reader: any;
    class Reader {
      result = "data:image/png;base64,YWJj";
      onload: any;
      onerror: any;
      onabort: any;
      readAsDataURL() {}
      constructor() { reader = this; }
    }
    vi.stubGlobal("FileReader", Reader);
    const promise = readPhotoBase64({} as File, new AbortController().signal);
    reader.onload();
    expect(await promise).toBe("YWJj");
    expect(reader.onload).toBeNull();
  });
});
