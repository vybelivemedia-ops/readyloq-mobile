/**
 * useDailyRoute — hook for the technician's daily route chemical assignments.
 *
 * The route is a list of product→pest pairings that the technician sets up
 * each morning (e.g. Suspend SC → German Cockroaches, Termidor NY → Ants).
 *
 * Architecture:
 *  - AsyncStorage is the primary source of truth (works offline).
 *  - On mount and on reconnect, any pending (unsynced) route is upserted to
 *    the server — the `lastSyncedAt === null` dirty flag controls this.
 *  - The server's GET response enriches assignments with full Product objects
 *    (including labelRules) needed by the FAIE equipment verifier.
 *
 * Returns:
 *  isSetupToday             — true when assignments exist for today
 *  assignments              — local-only assignment list (product IDs + pest)
 *  assignmentsWithProducts  — server-enriched list with full Product data
 *  assignmentCount          — convenience alias for assignments.length
 *  saveRoute                — persist new assignments (local + background sync)
 *  clearRoute               — wipe today's assignments
 *  showSetupModal / openSetupModal / closeSetupModal — modal visibility
 */

import { useCallback, useEffect, useState } from "react";
import {
  clearRoute as storeClearRoute,
  getTodayRoute,
  markRouteSynced,
  saveRoute as storeSaveRoute,
  subscribeDailyRoute,
} from "@/lib/local/daily-route-store";
import {
  getDailyRoute,
  upsertDailyRoute,
  type RouteAssignment,
  type RouteAssignmentWithProduct,
} from "@/lib/api-client/daily-route";
import { useNetworkStatus } from "./useNetworkStatus";

export function useDailyRoute() {
  const { isConnected } = useNetworkStatus();

  const [assignments, setAssignments] = useState<RouteAssignment[]>([]);
  const [assignmentsWithProducts, setAssignmentsWithProducts] = useState<
    RouteAssignmentWithProduct[]
  >([]);
  const [isSetupToday, setIsSetupToday] = useState(false);
  const [showSetupModal, setShowSetupModal] = useState(false);

  // ── Initial load + change subscription ─────────────────────────────────────
  const reloadRoute = useCallback(async () => {
    const stored = await getTodayRoute();
    setAssignments(stored?.assignments ?? []);
    setIsSetupToday(stored !== null && stored.assignments.length > 0);
  }, []);

  useEffect(() => {
    void reloadRoute();
    const unsubscribe = subscribeDailyRoute(() => void reloadRoute());
    return unsubscribe;
  }, [reloadRoute]);

  // ── Server fetch for enriched product data ─────────────────────────────────
  // Fetch full product+labelRules data from server so EquipmentVerifier can
  // check label compliance without a separate product catalogue load.
  const fetchEnrichedAssignments = useCallback(async () => {
    if (!isConnected) return;
    try {
      const route = await getDailyRoute();
      if (route) {
        setAssignmentsWithProducts(route.assignments);
      }
    } catch {
      // Server fetch failure is silent — local data still drives the UI.
    }
  }, [isConnected]);

  useEffect(() => {
    void fetchEnrichedAssignments();
  }, [fetchEnrichedAssignments]);

  // ── Background server sync (reconnect reconciliation) ──────────────────────
  const syncToServer = useCallback(
    async (currentAssignments: RouteAssignment[]) => {
      try {
        await upsertDailyRoute(currentAssignments);
        await markRouteSynced(new Date().toISOString());
        // Re-fetch enriched data after a successful sync.
        void fetchEnrichedAssignments();
      } catch {
        // Silent — will retry when connectivity returns again.
      }
    },
    [fetchEnrichedAssignments],
  );

  // On reconnect, replay any pending local write.
  useEffect(() => {
    if (!isConnected) return;
    void (async () => {
      const stored = await getTodayRoute();
      if (!stored || stored.lastSyncedAt !== null) return; // nothing pending
      await syncToServer(stored.assignments);
    })();
  }, [isConnected, syncToServer]);

  // ── Public API ──────────────────────────────────────────────────────────────

  const saveRoute = useCallback(
    async (newAssignments: RouteAssignment[]) => {
      await storeSaveRoute(newAssignments);
      // Optimistically update enriched list with null products until server responds.
      setAssignmentsWithProducts(
        newAssignments.map((a) => ({ ...a, product: null })),
      );
      if (isConnected) {
        void syncToServer(newAssignments);
      }
    },
    [isConnected, syncToServer],
  );

  const clearRoute = useCallback(async () => {
    await storeClearRoute();
    setAssignmentsWithProducts([]);
  }, []);

  const openSetupModal = useCallback(() => setShowSetupModal(true), []);
  const closeSetupModal = useCallback(() => setShowSetupModal(false), []);

  return {
    isSetupToday,
    assignments,
    assignmentsWithProducts,
    assignmentCount: assignments.length,
    saveRoute,
    clearRoute,
    showSetupModal,
    openSetupModal,
    closeSetupModal,
  };
}
