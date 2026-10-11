import type { GeminiDemoAssessment, GeminiDemoPhotoInput } from "@workspace/api-client-react";
import { z } from "zod";

export type { GeminiDemoAssessment, GeminiDemoPhotoInput };
export const GEMINI_DEMO_BUILD = "demo-compat-3";
export const GEMINI_DEMO_PARSER = "3";
export type DemoServerInfo = { build: string; parser: string; ready: boolean; message: string };

function serverInfo(response: Response): DemoServerInfo {
  const marker = (name: string) => {
    const value = response.headers.get(name) ?? "";
    return /^[a-zA-Z0-9._-]{1,64}$/.test(value) ? value : "missing";
  };
  const build = marker("X-ReadyLoq-Demo-Build");
  const parser = marker("X-ReadyLoq-Demo-Parser");
  const matches = build === GEMINI_DEMO_BUILD && parser === GEMINI_DEMO_PARSER;
  const message = response.status === 409
    ? `The server rejected this demo client's version handshake (HTTP 409). Client ${GEMINI_DEMO_BUILD}/${GEMINI_DEMO_PARSER}; server ${build}/${parser}. Reload the current workspace preview; no analysis was run.`
    : !response.ok
    ? `Demo API unavailable (HTTP ${response.status}). ${build === "missing" ? "This host may be missing the updated demo endpoint." : "Check that this host has the demo enabled."} This is not a photo-validation failure.`
    : matches ? "Client and server demo versions match."
    : `Stale or mismatched demo: client ${GEMINI_DEMO_BUILD}/${GEMINI_DEMO_PARSER}; server ${build}/${parser}. Reload the current workspace preview.`;
  return { build, parser, ready: response.ok && matches, message };
}

export async function checkGeminiDemoServer(signal?: AbortSignal): Promise<DemoServerInfo> {
  return serverInfo(await fetch("/api/gemini-inspection-demo/analyze", {
    method: "HEAD", cache: "no-store", signal,
  }));
}

// Runtime boundary for the public demo. Keep compatible with the generated
// OpenAPI type, without adding a dependency to the portal.
const assessment = z.object({
  model: z.literal("gemini-2.5-flash"),
  demoOnly: z.literal(true),
  reviewRequired: z.literal(true),
  observations: z.array(z.string().min(1).max(500)).max(8),
  hypotheses: z.array(z.object({
    finding: z.string().min(1).max(500),
    evidenceIndices: z.array(z.number().int().nonnegative()).min(1).max(8),
    uncertainty: z.string().min(1).max(500),
  })).max(3),
  confidence: z.object({
    level: z.enum(["low", "moderate", "high"]),
    explanation: z.string().min(1).max(500),
  }),
  cannotDetermine: z.array(z.string().min(1).max(500)).min(1).max(6),
  nextChecks: z.array(z.string().min(1).max(500)).min(1).max(6),
  reportReadyFinding: z.string().min(1),
}).refine(value => value.hypotheses.every(h =>
  h.evidenceIndices.every(i => i < value.observations.length)));

export function readPhotoBase64(file: File, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException("Cancelled", "AbortError"));
    const reader = new FileReader();
    const cleanup = () => {
      signal.removeEventListener("abort", abort);
      reader.onload = reader.onerror = reader.onabort = null;
    };
    const abort = () => {
      reader.abort();
      cleanup();
      reject(new DOMException("Cancelled", "AbortError"));
    };
    reader.onload = () => {
      const value = String(reader.result).split(",")[1];
      cleanup();
      if (!value) reject(new Error("Could not read the selected file."));
      else resolve(value);
    };
    reader.onerror = () => {
      cleanup();
      reject(new Error("Could not read the selected file."));
    };
    reader.onabort = () => {
      cleanup();
      reject(new DOMException("Cancelled", "AbortError"));
    };
    signal.addEventListener("abort", abort, { once: true });
    reader.readAsDataURL(file);
  });
}

// The backend is the registered /api artifact, not the portal's legacy Vite
// proxy. This stateless demo never sends a tenant, inspection or storage ID.
export async function analyzeGeminiPhoto(input: GeminiDemoPhotoInput, signal?: AbortSignal): Promise<GeminiDemoAssessment> {
  const response = await fetch("/api/gemini-inspection-demo/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-ReadyLoq-Demo-Client": GEMINI_DEMO_BUILD },
    body: JSON.stringify(input),
    signal,
  });
  const body = await response.json().catch(() => null);
  const info = serverInfo(response);
  if (response.ok && !info.ready) throw new Error(info.message);
  if (response.status === 409) throw new Error(info.message);
  if (!response.ok) {
    const message = typeof body?.error === "string" ? body.error : "The demo is temporarily unavailable. Please try again.";
    const legacyMessage = "Gemini returned an incomplete or unsupported assessment. No finding was saved; please try again.";
    if (message === legacyMessage && (info.build !== GEMINI_DEMO_BUILD || info.parser !== GEMINI_DEMO_PARSER)) {
      throw new Error("This request reached an older demo validator. Open the current workspace preview to use the updated parser. No assessment was created.");
    }
    throw new Error(message);
  }
  const parsed = assessment.safeParse(body);
  if (!parsed.success) {
    throw new Error("The demo returned an invalid result.");
  }
  return parsed.data;
}
