/**
 * aiGeneration — AI-powered transcript and metadata generation for clips.
 *
 * Uses Replit's OpenAI integration proxy for:
 *   - Whisper v1: audio transcription of each clip's audio track
 *   - GPT-4o-mini: per-platform captions, hashtags, and clip titles
 *
 * Required env vars (provisioned by Replit AI Integration → OpenAI):
 *   AI_INTEGRATIONS_OPENAI_BASE_URL  — proxy base URL
 *   AI_INTEGRATIONS_OPENAI_API_KEY   — proxy API key
 *
 * If either var is missing, every function throws AINotConfiguredError.
 * No mock data or silent fallback — the blocker surfaces to the caller.
 */

import { readFileSync } from "fs";
import { basename } from "path";

export class AINotConfiguredError extends Error {
  constructor() {
    super(
      "AI generation is not configured — AI_INTEGRATIONS_OPENAI_BASE_URL or " +
        "AI_INTEGRATIONS_OPENAI_API_KEY is missing. " +
        "Provision the OpenAI integration in Replit (Integrations → OpenAI) to enable transcription and AI captions."
    );
    this.name = "AINotConfiguredError";
    Object.setPrototypeOf(this, AINotConfiguredError.prototype);
  }
}

function getAICredentials(): { baseUrl: string; apiKey: string } {
  const baseUrl = process.env["AI_INTEGRATIONS_OPENAI_BASE_URL"];
  const apiKey = process.env["AI_INTEGRATIONS_OPENAI_API_KEY"];
  if (!baseUrl || !apiKey) throw new AINotConfiguredError();
  return { baseUrl, apiKey };
}

interface OpenAIMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface OpenAIChoice {
  message: { role: string; content: string | null };
}

interface OpenAIResponse {
  choices: OpenAIChoice[];
}

async function callOpenAI(messages: OpenAIMessage[], maxTokens = 800): Promise<string> {
  const { baseUrl, apiKey } = getAICredentials();
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      max_completion_tokens: maxTokens,
      messages,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI chat API error ${res.status}: ${err}`);
  }
  const data = (await res.json()) as OpenAIResponse;
  return data.choices[0]?.message?.content ?? "";
}

/**
 * Transcribe a clip's audio track using Whisper v1.
 *
 * audioFilePath must be a local .mp3 file (extracted from the clip by FFmpeg).
 * Returns the full transcript text, or null if the file is silent/empty.
 *
 * Throws AINotConfiguredError if the integration is not provisioned.
 * Throws on API errors — callers should catch and treat as non-fatal.
 */
export async function transcribeAudio(audioFilePath: string): Promise<string | null> {
  const { baseUrl, apiKey } = getAICredentials();

  // Read the audio file and construct multipart/form-data with native Web APIs
  const audioBuffer = readFileSync(audioFilePath);
  const blob = new Blob([audioBuffer], { type: "audio/mpeg" });

  const formData = new FormData();
  formData.append("file", blob, basename(audioFilePath));
  formData.append("model", "whisper-1");
  formData.append("response_format", "text");
  formData.append("language", "en");

  const res = await fetch(`${baseUrl}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: formData,
    signal: AbortSignal.timeout(120_000), // Whisper can be slow for longer clips
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Whisper API error ${res.status}: ${err}`);
  }

  const transcript = (await res.text()).trim();
  return transcript.length > 0 ? transcript : null;
}

export interface ClipMetadata {
  title: string;
  hashtags: string[];
  captionTiktok: string;
  captionYoutube: string;
  captionInstagram: string;
  captionFacebook: string;
}

/**
 * Generate a clip title, hashtags, and per-platform captions.
 *
 * When `transcript` is provided (from Whisper), the model generates captions that
 * reference the actual spoken content of the clip rather than guessing from the stream title.
 * This produces significantly more accurate and engaging captions.
 *
 * clipIndex is 1-based (1st clip, 2nd clip, etc.) for variation across clips from the same stream.
 */
export async function generateClipMetadata(
  streamTitle: string,
  streamDescription: string | null,
  durationSeconds: number,
  clipIndex: number,
  transcript: string | null = null
): Promise<ClipMetadata> {
  const contextLines = [
    `Stream title: ${streamTitle}`,
    streamDescription ? `Stream description: ${streamDescription}` : null,
    `Clip duration: ${durationSeconds}s`,
    `Clip position: #${clipIndex} from this stream`,
    transcript
      ? `Clip transcript (what was said/heard): "${transcript.slice(0, 800)}"`
      : null,
  ].filter(Boolean) as string[];

  const context = contextLines.join("\n");

  const systemPrompt = `You are a social media content expert for a POV livestreaming platform called VYBE LIVE.
Generate engaging, platform-appropriate content for short-form vertical clips.
When a transcript is provided, use the actual spoken content to make captions accurate and specific.
Respond ONLY with a valid JSON object — no markdown fences, no extra text, no comments.`;

  const userPrompt = `Generate metadata for this clip:
${context}

Return exactly this JSON structure:
{
  "title": "A punchy, specific clip title based on actual content (max 60 chars)",
  "hashtags": ["8", "to", "12", "relevant", "hashtags", "without", "hash", "symbol"],
  "captionTiktok": "TikTok caption with emojis, hooks, trending language (max 150 chars)",
  "captionYoutube": "YouTube Shorts caption, descriptive and search-friendly (max 100 chars)",
  "captionInstagram": "Instagram Reels caption with emojis and call-to-action (max 200 chars)",
  "captionFacebook": "Facebook Reels caption, conversational and engaging (max 200 chars)"
}`;

  const raw = await callOpenAI(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    700
  );

  // Strip any accidental markdown fences before parsing
  const cleaned = raw.trim().replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");

  let parsed: ClipMetadata;
  try {
    parsed = JSON.parse(cleaned) as ClipMetadata;
  } catch {
    throw new Error(`AI returned invalid JSON: ${raw.slice(0, 300)}`);
  }

  if (!parsed.title || !Array.isArray(parsed.hashtags)) {
    throw new Error(`AI response missing required fields: ${raw.slice(0, 300)}`);
  }

  return parsed;
}

/** Returns true if the AI integration is configured. */
export function isAIConfigured(): boolean {
  return !!(
    process.env["AI_INTEGRATIONS_OPENAI_BASE_URL"] &&
    process.env["AI_INTEGRATIONS_OPENAI_API_KEY"]
  );
}
