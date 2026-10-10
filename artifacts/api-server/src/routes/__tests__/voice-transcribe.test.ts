import express, { type RequestHandler } from "express";
import type { Server } from "node:http";
import { readFileSync } from "node:fs";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";

const ai = vi.hoisted(() => ({ create: vi.fn(), file: vi.fn() }));
vi.mock("@workspace/integrations-openai-ai-server", () => ({
  openai: { audio: { transcriptions: { create: ai.create } } },
}));
vi.mock("openai", () => ({ toFile: ai.file }));
vi.mock("../../middleware/require-auth", () => ({
  requireAuth: ((req, res, next) => {
    if (req.headers.authorization !== "Bearer test-only-user") {
      res.status(401).json({ error: "Unauthorized" }); return;
    }
    next();
  }) satisfies RequestHandler,
}));
vi.mock("../../lib/logger", () => ({ logger: { error: vi.fn() } }));

import router, { voiceTranscriptionBodyParser } from "../transcribe";

let server: Server | undefined;
let origin: string;
beforeEach(async () => {
  vi.clearAllMocks();
  ai.file.mockResolvedValue({ upload: "test-file" });
  ai.create.mockResolvedValue({ text: "take a photo" });
  const app = express();
  app.use("/api/transcribe", voiceTranscriptionBodyParser);
  app.use(express.json());
  app.use("/api", router);
  app.post("/ordinary", (_req, res) => { res.json({ ok: true }); });
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => { server!.once("listening", resolve); });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Missing test port");
  origin = `http://127.0.0.1:${address.port}`;
});
afterEach(async () => {
  server?.closeAllConnections();
  await new Promise<void>((resolve) => { server?.close(() => resolve()); });
});

describe("voice-only cloud transcription endpoint", () => {
  it("mounts the generous voice parser before the unchanged global parser in production", () => {
    const app = readFileSync(new URL("../../app.ts", import.meta.url), "utf8");
    expect(app.indexOf('app.use("/api/transcribe", voiceTranscriptionBodyParser)'))
      .toBeLessThan(app.indexOf("app.use(express.json())"));
  });

  it("accepts a realistic AAC clip above 100 KB and uses the supported speech model", async () => {
    const audio = Buffer.alloc(128_000, 1).toString("base64");
    const response = await fetch(`${origin}/api/transcribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer test-only-user" },
      body: JSON.stringify({ audio, mimeType: "audio/mp4" }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ text: "take a photo" });
    expect(ai.file).toHaveBeenCalledWith(expect.any(Buffer), "recording.m4a", { type: "audio/mp4" });
    expect(ai.create).toHaveBeenCalledWith({
      file: { upload: "test-file" }, model: "gpt-4o-mini-transcribe",
      prompt: expect.stringContaining("mixed-language speech"),
    });
    const ordinary = await fetch(`${origin}/ordinary`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ audio }),
    });
    expect(ordinary.status).toBe(413);
  });

  it("does not force one language or translate a code-switched transcript", async () => {
    ai.create.mockResolvedValue({ text: "Toma una photo aquí, hay ants en la cocina." });
    const response = await fetch(`${origin}/api/transcribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer test-only-user" },
      body: JSON.stringify({ audio: "dGVzdA==", mimeType: "audio/mp4" }),
    });
    expect(await response.json()).toEqual({ text: "Toma una photo aquí, hay ants en la cocina." });
    expect(ai.create.mock.calls[0][0]).not.toHaveProperty("language");
    expect(ai.create.mock.calls[0][0].prompt).toContain("Do not translate");
  });

  it("still rejects unauthenticated audio without calling the provider", async () => {
    const response = await fetch(`${origin}/api/transcribe`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ audio: "test" }),
    });
    expect(response.status).toBe(401);
    expect(ai.create).not.toHaveBeenCalled();
  });

  it("returns an explicit error when transcription fails", async () => {
    ai.create.mockRejectedValue(new Error("provider unavailable"));
    const response = await fetch(`${origin}/api/transcribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer test-only-user" },
      body: JSON.stringify({ audio: "dGVzdA==", mimeType: "audio/mp4" }),
    });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Transcription failed. Please try again." });
  });
});
