import { useCallback, useEffect, useRef, useState } from "react";
import { createVideoSource } from "@/sources";
import type {
  IVideoSource,
  VideoSourceConfig,
  VideoSourceState,
  VideoSourceType,
} from "@/types/videoSource";
import { VideoSourceError } from "@/types/videoSource";

export interface UseVideoSourceResult {
  /** The current IVideoSource instance. Stable ref as long as type is unchanged. */
  source: IVideoSource;
  /** Reactive copy of source.state — triggers re-renders on every change. */
  sourceState: VideoSourceState;
  /** Connect to the source. Rejects with VideoSourceError on failure. */
  connect: (config?: VideoSourceConfig) => Promise<void>;
  /** Disconnect and release hardware resources. */
  disconnect: () => Promise<void>;
  /** Last VideoSourceError from connect(); cleared on the next connect() call. */
  connectError: VideoSourceError | null;
}

/**
 * Manages the full lifecycle of the active video source.
 *
 * - Creates a new IVideoSource instance when sourceType changes.
 * - Disconnects the previous source on type change and on unmount.
 * - Subscribes to state changes and surfaces them reactively.
 * - Wraps connect() / disconnect() in stable useCallback refs.
 *
 * Usage in pov.tsx:
 *   const { source, sourceState, connect, connectError } = useVideoSource(deviceType);
 *   useEffect(() => { connect({ rtmpIngestUrl, streamKey }) }, []);
 */
export function useVideoSource(sourceType: VideoSourceType): UseVideoSourceResult {
  const sourceRef = useRef<IVideoSource>(createVideoSource(sourceType));
  const prevTypeRef = useRef<VideoSourceType>(sourceType);

  // Recreate the source when the type changes (between screens/sessions).
  if (prevTypeRef.current !== sourceType) {
    prevTypeRef.current = sourceType;
    sourceRef.current.disconnect().catch(() => undefined);
    sourceRef.current = createVideoSource(sourceType);
  }

  const [sourceState, setSourceState] = useState<VideoSourceState>(
    () => sourceRef.current.state
  );
  const [connectError, setConnectError] = useState<VideoSourceError | null>(null);

  // Subscribe to state changes whenever the source instance changes.
  useEffect(() => {
    // Sync immediately in case state changed before this effect ran.
    setSourceState(sourceRef.current.state);
    const unsub = sourceRef.current.onStateChange(setSourceState);
    return unsub;
  }, [sourceType]);

  // Disconnect on unmount.
  useEffect(() => {
    return () => {
      sourceRef.current.disconnect().catch(() => undefined);
    };
  }, []);

  const connect = useCallback(
    async (config?: VideoSourceConfig) => {
      setConnectError(null);
      try {
        await sourceRef.current.connect(config);
      } catch (err) {
        const vsErr =
          err instanceof VideoSourceError
            ? err
            : new VideoSourceError(
                "CONNECTION_FAILED",
                err instanceof Error ? err.message : String(err)
              );
        setConnectError(vsErr);
        throw vsErr;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sourceType]
  );

  const disconnect = useCallback(async () => {
    setConnectError(null);
    await sourceRef.current.disconnect();
  }, [sourceType]); // eslint-disable-line react-hooks/exhaustive-deps

  return { source: sourceRef.current, sourceState, connect, disconnect, connectError };
}
