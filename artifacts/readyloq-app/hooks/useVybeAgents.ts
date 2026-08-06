/**
 * useVybeAgents
 *
 * Fetches live agent status from the VYBE platform API and merges it with the
 * static VYBE_AGENTS roster from @platform/agent-registry.
 *
 * Graceful degradation: if the remote sync fails (network error, 404, etc.) the
 * hook returns the static roster with each agent at its defaultStatus.  No error
 * is surfaced to the UI — the agents panel still renders; it just shows default
 * statuses instead of live ones.
 *
 * Refresh interval: 60 seconds (configurable via the interval parameter).
 */

import { useCallback, useEffect, useRef, useState } from "react";

import {
  type AgentRegistryEntry,
  PLATFORM_AGENTS_API_URL,
  type PlatformAgentSyncResponse,
  VYBE_AGENTS,
  createAgentRegistry,
} from "@platform/agent-registry";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface UseVybeAgentsResult {
  agents: AgentRegistryEntry[];
  loading: boolean;
  lastSyncedAt: string | null;
  /** true if the last remote sync attempt failed; agents still show from cache. */
  syncFailed: boolean;
  /** Manually trigger a refresh (e.g. on pull-to-refresh). */
  refresh: () => void;
}

// ─── Hook ─────────────────────────────────────────────────────────────────────

/**
 * @param intervalMs  How often to re-sync live status. Default: 60 000 ms.
 *                    Pass 0 to disable automatic polling (manual refresh only).
 */
export function useVybeAgents(intervalMs = 60_000): UseVybeAgentsResult {
  // Stable registry instance — never recreated across re-renders.
  const registryRef = useRef(createAgentRegistry(VYBE_AGENTS));

  const [agents, setAgents] = useState<AgentRegistryEntry[]>(() =>
    registryRef.current.list(),
  );
  const [loading, setLoading] = useState(true);
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null);
  const [syncFailed, setSyncFailed] = useState(false);

  const sync = useCallback(async () => {
    try {
      const res = await fetch(PLATFORM_AGENTS_API_URL, {
        method: "GET",
        headers: { Accept: "application/json" },
        // 10-second timeout via AbortController
        signal: AbortSignal.timeout(10_000),
      });

      if (!res.ok) {
        // Non-2xx — treat as sync failure, keep current statuses.
        setSyncFailed(true);
        return;
      }

      const data = (await res.json()) as PlatformAgentSyncResponse;
      registryRef.current.applyRemoteSync(data.agents);
      setLastSyncedAt(data.syncedAt);
      setSyncFailed(false);
    } catch {
      // Network error, timeout, or parse failure — degrade gracefully.
      setSyncFailed(true);
    } finally {
      setAgents(registryRef.current.list());
      setLoading(false);
    }
  }, []);

  // Initial sync + polling
  useEffect(() => {
    sync();
    if (intervalMs <= 0) return;

    const id = setInterval(sync, intervalMs);
    return () => clearInterval(id);
  }, [sync, intervalMs]);

  return { agents, loading, lastSyncedAt, syncFailed, refresh: sync };
}
