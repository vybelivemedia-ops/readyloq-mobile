import { NativeEventEmitter, NativeModules, Platform } from "react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createMetaCaptureDelivery } from "@/lib/meta-glasses/capture-delivery";
import {
  deriveMetaWearablesState,
  isMetaWearablesNativeStatus,
  type MetaWearablesCapture,
  type MetaWearablesNativeStatus,
} from "@/lib/meta-glasses/native-session-state";

const MODULE_NAME = "ReadyLoqMetaWearables";
const STATUS_EVENT = "ReadyLoqMetaWearablesStatus";
const CAPTURE_EVENT = "ReadyLoqMetaWearablesCapture";

interface MetaWearablesNativeModule {
  getStatus(): Promise<MetaWearablesNativeStatus>;
  startRegistration(): Promise<MetaWearablesNativeStatus>;
  requestCameraPermission(): Promise<MetaWearablesNativeStatus>;
  startSession(): Promise<MetaWearablesNativeStatus>;
  stopSession(): Promise<MetaWearablesNativeStatus>;
  capturePhoto(): Promise<MetaWearablesCapture>;
  removeCapture(uri: string): Promise<void>;
}

function getNativeModule(): MetaWearablesNativeModule | null {
  if (Platform.OS !== "android") return null;
  return (NativeModules[MODULE_NAME] as MetaWearablesNativeModule | undefined) ?? null;
}

export interface UseMetaWearablesSessionOptions {
  /** Receives only validated real file captures from the Android DAT module. */
  onCapture?: (capture: MetaWearablesCapture) => Promise<void> | void;
}

/**
 * React bridge for Meta's Android Device Access Toolkit. Expo Go is treated as
 * an explicitly unsupported runtime instead of being silently routed through
 * ReadyLoq's separate custom BLE protocol.
 */
export function useMetaWearablesSession(options: UseMetaWearablesSessionOptions = {}) {
  const nativeModule = useMemo(getNativeModule, []);
  const [status, setStatus] = useState<MetaWearablesNativeStatus | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const captureConsumer = useRef(options.onCapture);
  captureConsumer.current = options.onCapture;
  const ownsCaptures = Boolean(options.onCapture);
  const eventsReady = useRef(false);
  const lifecycle = useRef({ mounted: false, generation: 0 });
  const isCurrent = useCallback((generation: number) =>
    lifecycle.current.mounted && generation === lifecycle.current.generation, []);
  const acceptStatus = useCallback((next: unknown, generation: number) => {
    if (!isCurrent(generation)) return;
    if (!isMetaWearablesNativeStatus(next)) {
      setActionError("Meta glasses returned an invalid status. Retry the connection.");
      return;
    }
    setStatus(next);
    if (eventsReady.current) setActionError(null);
  }, [isCurrent]);

  const refresh = useCallback(async () => {
    if (!nativeModule) return;
    const generation = lifecycle.current.generation;
    try {
      const next = await nativeModule.getStatus();
      acceptStatus(next, generation);
    } catch (error) {
      if (isCurrent(generation)) {
        setActionError(error instanceof Error ? error.message : "Unable to check Meta glasses.");
      }
    }
  }, [nativeModule, acceptStatus, isCurrent]);

  useEffect(() => {
    lifecycle.current.mounted = true;
    eventsReady.current = false;
    const generation = ++lifecycle.current.generation;
    void refresh();
    if (!nativeModule) return () => { lifecycle.current.mounted = false; };
    let statusSubscription: { remove(): void } | undefined;
    let captureSubscription: { remove(): void } | undefined;
    // Only an inspection owns a capture event. Connections displays status but
    // must never race the durable evidence consumer by deleting its cache file.
    let mounted = true;
    const deliver = createMetaCaptureDelivery(
      (capture) => {
        const consumer = captureConsumer.current;
        if (!mounted || !consumer) throw new Error("No active inspection owns this Meta capture.");
        return consumer(capture);
      },
      (uri) => nativeModule.removeCapture(uri),
    );
    try {
      const emitter = new NativeEventEmitter(nativeModule as never);
      statusSubscription = emitter.addListener(STATUS_EVENT, (next: unknown) => {
        acceptStatus(next, generation);
      });
      if (ownsCaptures) captureSubscription = emitter.addListener(CAPTURE_EVENT, (capture: unknown) => {
        void deliver(capture).catch((error) => {
          if (isCurrent(generation)) setActionError(error instanceof Error ? error.message : "Meta glasses evidence could not be saved.");
        });
      });
      eventsReady.current = true;
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Unable to listen to Meta glasses.");
    }
    return () => {
      mounted = false;
      lifecycle.current.mounted = false;
      eventsReady.current = false;
      lifecycle.current.generation++;
      for (const subscription of [statusSubscription, captureSubscription]) {
        try { subscription?.remove(); } catch { /* Bridge may already be invalidated. */ }
      }
      if (ownsCaptures) void Promise.resolve().then(() => nativeModule.stopSession()).catch(() => undefined);
    };
  }, [nativeModule, ownsCaptures, refresh, acceptStatus, isCurrent]);

  const run = useCallback(
    async (operation: keyof Pick<
      MetaWearablesNativeModule,
      "startRegistration" | "requestCameraPermission" | "startSession" | "stopSession" | "capturePhoto"
    >) => {
      if (!nativeModule) return;
      const generation = lifecycle.current.generation;
      try {
        const next = await nativeModule[operation]();
        if (operation !== "capturePhoto") acceptStatus(next, generation);
        else if (isCurrent(generation) && eventsReady.current) setActionError(null);
      } catch (error) {
        if (isCurrent(generation)) {
          setActionError(error instanceof Error ? error.message : "Meta glasses action failed.");
        }
      }
    },
    [nativeModule, acceptStatus, isCurrent],
  );

  const state = deriveMetaWearablesState(
    actionError ? { ...status, error: actionError } : status,
    nativeModule !== null,
    Platform.OS,
  );

  return {
    ...state,
    nativeModulePresent: nativeModule !== null,
    refresh,
    startRegistration: () => run("startRegistration"),
    requestCameraPermission: () => run("requestCameraPermission"),
    startSession: () => run("startSession"),
    stopSession: () => run("stopSession"),
    capturePhoto: () => run("capturePhoto"),
  };
}