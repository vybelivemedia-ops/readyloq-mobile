import { useCallback, useEffect, useState } from "react";

import {
  getLocalInspection,
  listLocalInspections,
  subscribeLocalInspections,
  syncPhase,
  type LocalInspection,
  type LocalSyncPhase,
} from "@/lib/local/inspection-store";
import { getSyncingIds, subscribeSyncEngine } from "@/lib/sync/engine";

/**
 * Live view of all locally stored inspections plus their sync phase.
 * Re-renders on every store mutation and engine activity change, so sync
 * badges update in real time as the engine works.
 */
export function useLocalInspections() {
  const [records, setRecords] = useState<LocalInspection[]>([]);
  const [, setTick] = useState(0);

  const refresh = useCallback(() => {
    void listLocalInspections().then(setRecords);
  }, []);

  useEffect(() => {
    refresh();
    const unsubStore = subscribeLocalInspections(refresh);
    const unsubEngine = subscribeSyncEngine(() => {
      setTick((t) => t + 1);
      refresh();
    });
    return () => {
      unsubStore();
      unsubEngine();
    };
  }, [refresh]);

  const phaseOf = useCallback(
    (record: LocalInspection): LocalSyncPhase => syncPhase(record, getSyncingIds()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [records],
  );

  return { records, phaseOf, refresh };
}

/** Live view of a single local inspection record. */
export function useLocalInspection(localId: string | undefined) {
  const [record, setRecord] = useState<LocalInspection | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [, setTick] = useState(0);

  const refresh = useCallback(() => {
    if (!localId) {
      setRecord(null);
      setLoaded(true);
      return;
    }
    void getLocalInspection(localId).then((rec) => {
      setRecord(rec);
      setLoaded(true);
    });
  }, [localId]);

  useEffect(() => {
    refresh();
    const unsubStore = subscribeLocalInspections(refresh);
    const unsubEngine = subscribeSyncEngine(() => {
      setTick((t) => t + 1);
      refresh();
    });
    return () => {
      unsubStore();
      unsubEngine();
    };
  }, [refresh]);

  const phase: LocalSyncPhase | null = record ? syncPhase(record, getSyncingIds()) : null;

  return { record, phase, loaded, refresh };
}
