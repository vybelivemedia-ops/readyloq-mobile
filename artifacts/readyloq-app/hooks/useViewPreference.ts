/**
 * useViewPreference
 *
 * Persists the owner's chosen dashboard layout across app restarts.
 *
 *   'solo'       — streamlined Solo Operator view (field execution KPIs only)
 *   'enterprise' — full Enterprise command centre (approval queues, team metrics,
 *                  training uploads, multi-tech comms strip)
 *
 * Default: 'auto' (respects the server-supplied `isSoloOperator` flag from the
 * briefing API).  Once the owner explicitly picks a mode it is stored locally
 * and takes precedence over the server value.
 *
 * All mounted instances of this hook share state via a module-level EventEmitter,
 * so changing the mode in one tab (e.g. Settings) is immediately reflected in
 * every other mounted consumer (e.g. Dashboard) without requiring a focus event
 * or a full re-render of the tab.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useState } from "react";

export type ViewMode = "solo" | "enterprise";

const STORAGE_KEY = "@readyloq/view_mode";

// Tiny inline emitter — avoids importing Node's `events` module which is not
// available in React Native's Metro bundler on EAS cloud builds.
type Listener = (mode: ViewMode | null) => void;
const listeners: Map<string, Set<Listener>> = new Map();
const emitter = {
  on(event: string, fn: Listener) {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event)!.add(fn);
  },
  off(event: string, fn: Listener) {
    listeners.get(event)?.delete(fn);
  },
  emit(event: string, mode: ViewMode | null) {
    listeners.get(event)?.forEach((fn) => fn(mode));
  },
};
const CHANGE_EVENT = "viewModeChanged";

export interface UseViewPreferenceResult {
  /** Persisted preference, or null while loading / never set. */
  viewMode: ViewMode | null;
  /** True once AsyncStorage has been read (prevents flash). */
  isLoaded: boolean;
  /** Persist a new preference immediately. */
  setMode: (mode: ViewMode) => Promise<void>;
  /** Clear the override — dashboard falls back to the server value. */
  clearMode: () => Promise<void>;
}

export function useViewPreference(): UseViewPreferenceResult {
  const [viewMode, setViewMode] = useState<ViewMode | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);

  // Read initial value from AsyncStorage on mount.
  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(STORAGE_KEY)
      .then((saved) => {
        if (!cancelled) {
          if (saved === "solo" || saved === "enterprise") setViewMode(saved);
          else setViewMode(null);
        }
      })
      .catch(() => {/* non-fatal */})
      .finally(() => {
        if (!cancelled) setIsLoaded(true);
      });
    return () => { cancelled = true; };
  }, []);

  // Subscribe to cross-instance updates from the module-level emitter.
  useEffect(() => {
    const handler = (mode: ViewMode | null) => {
      setViewMode(mode);
    };
    emitter.on(CHANGE_EVENT, handler);
    return () => {
      emitter.off(CHANGE_EVENT, handler);
    };
  }, []);

  const setMode = useCallback(async (mode: ViewMode) => {
    setViewMode(mode);
    emitter.emit(CHANGE_EVENT, mode);
    await AsyncStorage.setItem(STORAGE_KEY, mode).catch(() => {/* non-fatal */});
  }, []);

  const clearMode = useCallback(async () => {
    setViewMode(null);
    emitter.emit(CHANGE_EVENT, null);
    await AsyncStorage.removeItem(STORAGE_KEY).catch(() => {/* non-fatal */});
  }, []);

  return { viewMode, isLoaded, setMode, clearMode };
}

/**
 * Resolve the effective layout mode.
 *
 * Priority: user override → server flag → default (solo).
 */
export function resolveViewMode(
  override: ViewMode | null,
  serverIsSolo: boolean,
): ViewMode {
  if (override != null) return override;
  return serverIsSolo ? "solo" : "enterprise";
}
