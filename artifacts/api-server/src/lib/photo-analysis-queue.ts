import { analyzePhoto } from "./intelligence-ai";
import type { PhotoAnalysisOutcome } from "./intelligence-ai";

/**
 * The provider enforces its own abortable storage and model deadline. This
 * additional boundary ensures an unexpectedly non-settling adapter cannot
 * hold up the other photo outcomes or prevent the result row from being saved.
 */
export async function assessQueuedPhoto(
  storagePath: string,
  technicianNote: string | null,
  deadlineAt: number,
  photoTimeoutMs: number,
  assess: typeof analyzePhoto = analyzePhoto,
): Promise<PhotoAnalysisOutcome> {
  const remainingMs = Math.min(photoTimeoutMs, deadlineAt - Date.now());
  if (remainingMs <= 0) return { status: "deferred", prediction: null };

  let timeout: ReturnType<typeof setTimeout> | undefined;
  let callbackStatus: PhotoAnalysisOutcome["status"] = "failed";
  try {
    const prediction = await Promise.race<Awaited<ReturnType<typeof analyzePhoto>>>([
      assess(storagePath, technicianNote, {
        timeoutMs: remainingMs,
        deadlineAt,
        rateLimitRetries: 2,
        onOutcome: (status) => { callbackStatus = status; },
      }),
      new Promise<null>((resolve) => {
        timeout = setTimeout(() => {
          callbackStatus = "deferred";
          resolve(null);
        }, remainingMs + 100);
      }),
    ]);
    return prediction
      ? { status: "completed", prediction }
      : { status: callbackStatus, prediction: null };
  } catch {
    return { status: "failed", prediction: null };
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}