/**
 * POST /api/transcribe
 *
 * Accepts a base64-encoded audio clip from the mobile app and transcribes it
 * via the managed OpenAI transcription API. Used when on-device Whisper
 * model is unavailable (storage full, download failure, etc.).
 *
 * Request body (JSON):
 *   { audio: string, mimeType: string }   // audio is base64-encoded WAV/M4A
 *
 * Response:
 *   { text: string, language?: string }
 */

import { Router, json } from "express";
import { logger } from "../lib/logger";
import { openai } from "@workspace/integrations-openai-ai-server";
import { toFile } from "openai";
import { requireAuth } from "../middleware/require-auth";

const router = Router();
// Base64 AAC exceeds Express's 100 KB default after only a few seconds.
// Mount BEFORE the global parser; other API request limits stay unchanged.
export const voiceTranscriptionBodyParser = json({ limit: "20mb" });

router.post("/transcribe", requireAuth, async (req, res) => {
  const { audio, mimeType } = req.body as {
    audio?: string;
    mimeType?: string;
  };

  if (!audio || typeof audio !== "string") {
    res.status(400).json({ error: "audio (base64) is required" });
    return;
  }

  const mime = mimeType ?? "audio/wav";
  const ext = mime.includes("mp4") || mime.includes("m4a") ? ".m4a" : ".wav";

  try {
    const buffer = Buffer.from(audio, "base64");
    const file = await toFile(buffer, `recording${ext}`, { type: mime });

    const response = await openai.audio.transcriptions.create({
      file,
      // whisper-1 is not supported by the managed connection used here.
      model: "gpt-4o-mini-transcribe",
      // Omit language: automatic detection must also permit code-switching.
      prompt: "Pest-control inspection. Transcribe verbatim in the languages spoken, including mixed-language speech such as Spanglish. Do not translate or rewrite notes, names, or addresses. Preserve pest and product terms: German cockroaches, cucarachas, ants, hormigas, rodents, bed bugs, Alpine WSG, Contrac Blox, Temprid FX, Advion Gel, bait station.",
    });

    // Do not invent a detected language (one clip may contain several).
    res.json({ text: response.text });
  } catch (err) {
    logger.error({ err }, "[transcribe] Whisper API error");
    res.status(500).json({ error: "Transcription failed. Please try again." });
  }
});

export default router;
