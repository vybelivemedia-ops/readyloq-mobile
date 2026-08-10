/**
 * POST /api/transcribe
 *
 * Accepts a base64-encoded audio clip from the mobile app and transcribes it
 * via OpenAI Whisper. Used as a cloud fallback when the on-device Whisper
 * model is unavailable (storage full, download failure, etc.).
 *
 * Request body (JSON):
 *   { audio: string, mimeType: string }   // audio is base64-encoded WAV/M4A
 *
 * Response:
 *   { text: string, language?: string }
 */

import { Router } from "express";
import { openai } from "@workspace/integrations-openai-ai-server";
import { toFile } from "openai";
import { requireAuth } from "../middleware/require-auth";

const router = Router();

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
      model: "whisper-1",
      language: "en",
    });

    res.json({ text: response.text, language: "en" });
  } catch (err) {
    console.error("[transcribe] Whisper API error:", err);
    res.status(500).json({ error: "Transcription failed. Please try again." });
  }
});

export default router;
