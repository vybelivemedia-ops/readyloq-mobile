/**
 * Voice-context frame buffer
 *
 * Maintains a rolling ~1 500 ms background snapshot of the camera so that
 * the FAIE (Field Audio Intelligence Engine) always has a recent spatial
 * context frame available, even when an on-demand takePictureAsync races a
 * 500 ms dispatch deadline.
 *
 * Designed for dependency injection so it can be tested without React or
 * React Native by swapping in mock camera / filesystem implementations.
 */

/** The interval between rolling background captures (ms). */
export const FRAME_BUFFER_INTERVAL_MS = 1_500;

/** The maximum time (ms) getFrame waits for a fresh on-demand capture. */
export const FRAME_BUFFER_DEADLINE_MS = 500;

export interface FrameBufferDeps {
  /**
   * Captures a single low-quality frame from the camera.
   * Should resolve with a local file URI on success, or null/undefined if the
   * camera is unavailable.  May reject — the buffer treats any rejection as a
   * "skip this tick" signal and keeps the last successful URI.
   */
  takePicture: () => Promise<string | null | undefined>;

  /**
   * Deletes a temp file by URI.  The buffer always calls this fire-and-forget:
   * rejections are swallowed so a storage fault never interrupts the session.
   */
  deleteFile: (uri: string, opts?: { idempotent?: boolean }) => Promise<void>;
}

export interface FrameBuffer {
  /**
   * Starts the rolling 1 500 ms background snapshot loop.
   * Idempotent — a second call while the interval is already running is a no-op.
   */
  start(): void;

  /**
   * Stops the rolling snapshot loop and fires a best-effort delete of the
   * currently buffered frame.  Safe to call when the buffer is already stopped.
   */
  stop(): void;

  /**
   * Returns the most up-to-date frame URI available:
   * 1. Tries a fresh on-demand takePicture() raced against a 500 ms deadline.
   * 2. If the fresh capture loses the race or fails, falls back to the last
   *    rolling-buffer URI.
   * 3. Returns null if no frame has ever been captured.
   *
   * Orphan-safe: when the deadline wins, the still-running capture's .then()
   * fires deleteTempFrameSilently() so the file is never abandoned.
   */
  getFrame(): Promise<string | null>;

  /**
   * Returns the URI currently tracked in the buffer.
   * Exposed for testing and diagnostics — not intended for production callers.
   */
  getLastUri(): string | null;
}

/**
 * Creates a new frame buffer instance with the given camera and filesystem
 * dependencies injected.
 */
export function createFrameBuffer(deps: FrameBufferDeps): FrameBuffer {
  const { takePicture, deleteFile } = deps;

  let lastFrameUri: string | null = null;
  let intervalHandle: ReturnType<typeof setInterval> | null = null;
  let active = false;

  /** Fire-and-forget delete — errors are intentionally swallowed. */
  function deleteSilently(uri: string): void {
    void deleteFile(uri, { idempotent: true }).catch(() => {
      // Best-effort only — a storage fault must never leave the buffer in an
      // inconsistent state or interrupt the FAIE session.
    });
  }

  function start(): void {
    if (intervalHandle !== null) return; // idempotent
    active = true;
    intervalHandle = setInterval(() => {
      void (async () => {
        try {
          const uri = await takePicture();
          if (uri) {
            if (!active) {
              // stop() fired while this capture was in flight — delete the new
              // file immediately so it never becomes an orphan.
              deleteSilently(uri);
              return;
            }
            // Delete the previous temp frame before storing the new one so at
            // most one voice-context frame file exists on disk at any time.
            if (lastFrameUri) {
              deleteSilently(lastFrameUri);
            }
            lastFrameUri = uri;
          }
        } catch {
          // Silently skip — keep the last successful frame URI in the buffer.
        }
      })();
    }, FRAME_BUFFER_INTERVAL_MS);
  }

  function stop(): void {
    // Mark inactive first so any in-flight captures self-delete when they resolve.
    active = false;
    if (intervalHandle !== null) {
      clearInterval(intervalHandle);
      intervalHandle = null;
    }
    if (lastFrameUri) {
      deleteSilently(lastFrameUri);
    }
    // Null the ref synchronously — regardless of whether the delete above succeeds.
    lastFrameUri = null;
  }

  async function getFrame(): Promise<string | null> {
    try {
      const deadline = new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), FRAME_BUFFER_DEADLINE_MS),
      );
      const capture = (async () => {
        const uri = await takePicture();
        return uri ?? null;
      })();
      const fresh = await Promise.race([capture, deadline]);
      if (fresh) {
        // Fresh capture won — replace the buffered frame.
        if (lastFrameUri && lastFrameUri !== fresh) {
          deleteSilently(lastFrameUri);
        }
        lastFrameUri = fresh;
        return fresh;
      }
      // Deadline won — attach cleanup to the still-running capture so its file
      // is deleted once it eventually resolves instead of becoming an orphan.
      void capture
        .then((uri) => {
          if (uri) deleteSilently(uri);
        })
        .catch(() => {});
    } catch {
      // Fall through to buffer fallback.
    }
    return lastFrameUri ?? null;
  }

  return { start, stop, getFrame, getLastUri: () => lastFrameUri };
}
