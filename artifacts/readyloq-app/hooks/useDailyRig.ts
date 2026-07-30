/**
 * useDailyRig — hook for the technician's daily rig (products loaded on truck).
 *
 * Reads from the local AsyncStorage-backed store, which is the primary
 * source of truth during an offline day.  Background-syncs to the server
 * whenever the rig changes and a network connection is available.
 *
 * Returns:
 *  isSetupToday   — true when a rig has been saved for today's date
 *  rigProductIds  — ordered list of product IDs selected for today
 *  rigCount       — convenience alias for rigProductIds.length
 *  saveRig        — call with a new ID list to replace the current rig;
 *                   persists locally immediately, syncs in the background
 *  clearRig       — wipe the rig for today (useful for testing / reset flow)
 *  showSetupModal — boolean state to control the DailyRigSetupModal
 *  openSetupModal — open the DailyRigSetupModal
 *  closeSetupModal — close it (also called by DailyRigSetupModal on confirm/cancel)
 */

import { useCallback, useEffect, useState } from "react";
import {
  clearDailyRig,
  getTodayRig,
  markDailyRigSynced,
  saveDailyRig,
  subscribeDailyRig,
} from "@/lib/local/daily-rig-store";
import { upsertDailyRig } from "@/lib/api-client/daily-rig";
import { useNetworkStatus } from "./useNetworkStatus";

export function useDailyRig() {
  const { isConnected } = useNetworkStatus();
  const [rigProductIds, setRigProductIds] = useState<number[]>([]);
  const [isSetupToday, setIsSetupToday] = useState(false);
  const [showSetupModal, setShowSetupModal] = useState(false);

  // ── Initial load + change subscription ─────────────────────────────────────
  const reloadRig = useCallback(async () => {
    const stored = await getTodayRig();
    setRigProductIds(stored?.productIds ?? []);
    setIsSetupToday(stored !== null);
  }, []);

  useEffect(() => {
    void reloadRig();
    const unsubscribe = subscribeDailyRig(() => void reloadRig());
    return unsubscribe;
  }, [reloadRig]);

  // ── Background server sync ──────────────────────────────────────────────────
  const syncToServer = useCallback(async (productIds: number[]) => {
    try {
      await upsertDailyRig(productIds);
      await markDailyRigSynced(new Date().toISOString());
    } catch {
      // Sync failure is silent — the local record is authoritative; the server
      // will receive the rig the next time syncPendingRig fires successfully.
    }
  }, []);

  // ── Reconnect / startup reconciliation ────────────────────────────────────
  // When connectivity returns (or on mount if already online), check whether
  // today's local rig is still pending server sync and replay the upsert.
  // `lastSyncedAt === null` is the dirty flag written by saveDailyRig() and
  // cleared by markDailyRigSynced() only after a successful server response.
  useEffect(() => {
    if (!isConnected) return;

    void (async () => {
      const stored = await getTodayRig();
      if (!stored || stored.lastSyncedAt !== null) return; // nothing pending
      await syncToServer(stored.productIds);
    })();
  }, [isConnected, syncToServer]);

  // ── Public API ──────────────────────────────────────────────────────────────

  const saveRig = useCallback(
    async (productIds: number[]) => {
      await saveDailyRig(productIds);
      // Fire-and-forget background sync.
      void syncToServer(productIds);
    },
    [syncToServer],
  );

  const clearRig = useCallback(async () => {
    await clearDailyRig();
  }, []);

  const openSetupModal = useCallback(() => setShowSetupModal(true), []);
  const closeSetupModal = useCallback(() => setShowSetupModal(false), []);

  return {
    isSetupToday,
    rigProductIds,
    rigCount: rigProductIds.length,
    saveRig,
    clearRig,
    showSetupModal,
    openSetupModal,
    closeSetupModal,
  };
}
