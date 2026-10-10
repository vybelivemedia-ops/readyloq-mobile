/**
 * Voice-context frame buffer
 *
 * Maintains a rolling ~1 500 ms background snapshot of the camera so that
 * the FAIE (Field Audio Intelligence Engine) always has a recent spatial
 * context frame available without competing with the technician's shutter.
 *
 * Designed for dependency injection so it can be tested without React or
 * React Native by swapping in mock camera / filesystem implementations.
 */

/** The interval between rolling background captures (ms). */
export const FRAME_BUFFER_INTERVAL_MS = 1_500;

/** The maximum time (ms) getFrame waits for an already-running rolling capture. */
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

  /** Stop snapshots but retain the selected context until final dispatch. */
  pause?(): void;

  /**
   * Stops the rolling snapshot loop and fires a best-effort delete of the
   * currently buffered frame.  Safe to call when the buffer is already stopped.
   */
  stop(): void;

  /**
   * Returns the most up-to-date frame URI available:
   * 1. Returns the latest buffered URI immediately when one exists.
   * 2. Otherwise waits up to 500 ms for an already-running rolling capture.
   * 3. Returns null if no rolling capture has completed.
   *
   * It never starts an on-demand camera request. Voice dispatch must not compete
   * with the shutter or turn a slow camera into a backlog of native requests.
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
  let captureInFlight: Promise<string | null> | null = null;
  let captureInFlightGeneration = 0;
  let generation = 0;
  let active = false;

  /** Fire-and-forget delete — errors are intentionally swallowed. */
  function deleteSilently(uri: string): void {
    void deleteFile(uri, { idempotent: true }).catch(() => {
      // Best-effort only — a storage fault must never leave the buffer in an
      // inconsistent state or interrupt the FAIE session.
    });
  }

  function captureSingleFlight(currentGeneration: number): Promise<string | null> {
    if (captureInFlight) return captureInFlight;
    captureInFlightGeneration = currentGeneration;
    const capture = takePicture()
      .then(
        (uri) => {
          if (captureInFlight === capture) captureInFlight = null;
          return uri ?? null;
        },
        (error) => {
          if (captureInFlight === capture) captureInFlight = null;
          throw error;
        },
      );
    captureInFlight = capture;
    return capture;
  }

  async function captureRollingFrame(currentGeneration: number): Promise<void> {
    // Slow camera requests must never stack across interval ticks.
    if (captureInFlight) return;
    try {
      const uri = await captureSingleFlight(currentGeneration);
      if (!uri) return;
      if (!active || generation !== currentGeneration) {
        // stop() fired while this capture was in flight — delete the new
        // file immediately so it never becomes an orphan.
        deleteSilently(uri);
        return;
      }
      if (lastFrameUri && lastFrameUri !== uri) {
        deleteSilently(lastFrameUri);
      }
      lastFrameUri = uri;
    } catch {
      // Silently skip — keep the last successful frame URI in the buffer.
    }
  }

  function start(): void {
    if (intervalHandle !== null) return; // idempotent
    active = true;
    const currentGeneration = ++generation;
    intervalHandle = setInterval(() => {
      void captureRollingFrame(currentGeneration);
    }, FRAME_BUFFER_INTERVAL_MS);
  }

  function pause(): void {
    // In-flight output is obsolete and self-deletes; keep the cached frame
    // available until the final transcript's consumer has finished.
    generation += 1;
    if (intervalHandle !== null) {
      clearInterval(intervalHandle);
      intervalHandle = null;
    }
  }

  function stop(): void {
    // Mark inactive first so any in-flight captures self-delete when they resolve.
    active = false;
    generation += 1;
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
    // The normal path is synchronous-from-buffer (one resolved Promise turn).
    if (lastFrameUri) return lastFrameUri;

    // Do not start a new capture for a voice event. If the rolling loop already
    // owns the camera, briefly wait for that same single-flight request.
    const runningCapture = captureInFlight;
    if (!runningCapture || captureInFlightGeneration !== generation) return null;
    try {
      const deadline = new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), FRAME_BUFFER_DEADLINE_MS),
      );
      const fresh = await Promise.race([runningCapture, deadline]);
      return fresh ?? lastFrameUri ?? null;
    } catch {
      // Fall through to buffer fallback.
    }
    return lastFrameUri ?? null;
  }

  return { start, pause, stop, getFrame, getLastUri: () => lastFrameUri };
}
