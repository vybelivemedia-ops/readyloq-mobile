type ClientErrorCategory = "upload" | "ai" | "report" | "auth";

/**
 * Best-effort, fire-and-forget client error reporter for the closed beta. Used
 * for failures that happen in the browser and never reach our API's own error
 * logging — most importantly the direct PUT to object storage, which bypasses
 * the API server entirely. Never throws and never blocks the user's flow; if the
 * report itself fails we simply drop it.
 */
export function reportClientError(
  category: ClientErrorCategory,
  message: string,
  extra?: { context?: Record<string, unknown>; inspectionId?: number; reportId?: number },
): void {
  try {
    void fetch("/api/beta/errors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        category,
        message: message.slice(0, 500),
        ...(extra?.context ? { context: extra.context } : {}),
        ...(extra?.inspectionId ? { inspectionId: extra.inspectionId } : {}),
        ...(extra?.reportId ? { reportId: extra.reportId } : {}),
      }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // best-effort: swallow everything so logging can never break capture
  }
}
