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
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useState } from "react";

export type ViewMode = "solo" | "enterprise";

const STORAGE_KEY = "@readyloq/view_mode";

export interface UseViewPreferenceResult {
  /** Persisted preference, or null while loading / never set. */
  viewMode: ViewMode | null;
  /** True once AsyncStorage has been read (prevents flash). */
  isLoaded: boolean;
  /** Persist a new preference immediately. */
  setMode: (mode: ViewMode) => Promise<void>;
  /** Clear the override — dashboard falls back to the server value. */
  clearMode: () => Promise<void>;
  /** Re-read from AsyncStorage (call from useFocusEffect to pick up changes made on other screens). */
  reload: () => Promise<void>;
}

export function useViewPreference(): UseViewPreferenceResult {
  const [viewMode, setViewMode] = useState<ViewMode | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);

  const readFromStorage = useCallback(async () => {
    try {
      const saved = await AsyncStorage.getItem(STORAGE_KEY);
      if (saved === "solo" || saved === "enterprise") setViewMode(saved);
      else setViewMode(null);
    } catch {
      /* non-fatal */
    }
  }, []);

  useEffect(() => {
    readFromStorage().finally(() => setIsLoaded(true));
  }, [readFromStorage]);

  const setMode = useCallback(async (mode: ViewMode) => {
    setViewMode(mode);
    await AsyncStorage.setItem(STORAGE_KEY, mode).catch(() => {/* non-fatal */});
  }, []);

  const clearMode = useCallback(async () => {
    setViewMode(null);
    await AsyncStorage.removeItem(STORAGE_KEY).catch(() => {/* non-fatal */});
  }, []);

  const reload = useCallback(async () => {
    await readFromStorage();
  }, [readFromStorage]);

  return { viewMode, isLoaded, setMode, clearMode, reload };
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
