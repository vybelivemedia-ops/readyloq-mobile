import { NativeEventEmitter, NativeModules, Platform } from "react-native";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createMetaCaptureDelivery } from "@/lib/meta-glasses/capture-delivery";
import {
  deriveMetaWearablesState,
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

  const refresh = useCallback(async () => {
    if (!nativeModule) return;
    try {
      const next = await nativeModule.getStatus();
      setStatus(next);
      setActionError(null);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Unable to check Meta glasses.");
    }
  }, [nativeModule]);

  useEffect(() => {
    void refresh();
    if (!nativeModule) return;
    const emitter = new NativeEventEmitter(nativeModule as never);
    const statusSubscription = emitter.addListener(STATUS_EVENT, (next: MetaWearablesNativeStatus) => {
      setStatus(next);
      setActionError(null);
    });
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
    const captureSubscription = ownsCaptures ? emitter.addListener(CAPTURE_EVENT, (capture: unknown) => {
      void deliver(capture).catch((error) => {
        if (mounted) setActionError(error instanceof Error ? error.message : "Meta glasses evidence could not be saved.");
      });
    }) : null;
    return () => {
      mounted = false;
      statusSubscription.remove();
      captureSubscription?.remove();
      if (ownsCaptures) void nativeModule.stopSession().catch(() => undefined);
    };
  }, [nativeModule, ownsCaptures, refresh]);

  const run = useCallback(
    async (operation: keyof Pick<
      MetaWearablesNativeModule,
      "startRegistration" | "requestCameraPermission" | "startSession" | "stopSession" | "capturePhoto"
    >) => {
      if (!nativeModule) return;
      try {
        const next = await nativeModule[operation]();
        if (operation !== "capturePhoto") setStatus(next as MetaWearablesNativeStatus);
        setActionError(null);
      } catch (error) {
        setActionError(error instanceof Error ? error.message : "Meta glasses action failed.");
      }
    },
    [nativeModule],
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