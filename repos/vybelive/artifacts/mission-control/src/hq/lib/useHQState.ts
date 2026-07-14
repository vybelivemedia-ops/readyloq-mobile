import { useMemo } from "react";
import {
  useGetMissionControlOverview,
  useGetMe,
  getGetMissionControlOverviewQueryKey,
  getGetMeQueryKey,
} from "@workspace/api-client-react";
import { DEPARTMENTS, getTimeOfDay } from "./departments";
import type {
  ExecRole,
  ExecStatus,
  HQActivity,
  HQExecutive,
  HQState,
  TaskFlowEvent,
} from "./hqTypes";

const VALID_ROLES = new Set(Object.keys(DEPARTMENTS));

function colorForRole(role: ExecRole, apiColor?: string | null): string {
  if (apiColor && apiColor.trim().length > 0) return apiColor;
  return DEPARTMENTS[role]?.color ?? "#22d3ee";
}

/**
 * Single source of truth that turns the live Mission Control API into the
 * normalized state the 3D headquarters renders. Polls so the world keeps
 * reacting to real backend activity even while the founder is idle.
 */
export function useHQState(): HQState {
  const { data: overview, isLoading } = useGetMissionControlOverview({
    query: {
      queryKey: getGetMissionControlOverviewQueryKey(),
      refetchInterval: 15000,
      refetchOnWindowFocus: true,
    },
  });
  const { data: me } = useGetMe({
    query: { queryKey: getGetMeQueryKey(), staleTime: 1000 * 60 * 5 },
  });

  return useMemo<HQState>(() => {
    const timeOfDay = getTimeOfDay();
    const founderName =
      (me as { displayName?: string; username?: string } | undefined)?.displayName?.split(" ")[0] ||
      (me as { username?: string } | undefined)?.username ||
      "Founder";

    if (!overview) {
      return {
        ready: false,
        loading: isLoading,
        founderName,
        executives: [],
        stats: {
          totalExecutives: 0,
          activeExecutives: 0,
          openTasks: 0,
          blockedTasks: 0,
          criticalTasks: 0,
          completedTasks: 0,
          handoffsToday: 0,
        },
        briefing: null,
        activity: [],
        flows: [],
        timeOfDay,
      };
    }

    const priorities = overview.priorities ?? [];
    const countBy = (id: string, pred: (p: (typeof priorities)[number]) => boolean) =>
      priorities.filter((p) => p.executiveId === id && pred(p)).length;

    const executives: HQExecutive[] = (overview.executives ?? [])
      .filter((e) => VALID_ROLES.has(e.role))
      .map((e) => {
        const role = e.role as ExecRole;
        return {
          id: e.id,
          role,
          name: e.name,
          title: e.title,
          tagline: e.tagline ?? "",
          accentColor: colorForRole(role, e.accentColor),
          avatarInitials: e.avatarInitials ?? e.name.slice(0, 2).toUpperCase(),
          specialties: e.specialties ?? [],
          status: (e.status as ExecStatus) ?? "idle",
          openCount: countBy(e.id, (p) => p.status !== "done"),
          criticalCount: countBy(e.id, (p) => p.priority === "critical"),
          blockedCount: countBy(e.id, (p) => p.status === "blocked"),
        };
      });

    const activity: HQActivity[] = (overview.activity ?? []).map((a) => ({
      id: a.id,
      type: a.type as HQActivity["type"],
      executiveId: a.executiveId ?? null,
      executiveName: a.executiveName ?? null,
      summary: a.summary,
      createdAt: a.createdAt as unknown as string,
    }));

    const roleById = new Map(executives.map((e) => [e.id, e.role]));

    // Derive energy packets from real activity. Handoffs travel exec->exec,
    // other activity travels between the relevant office and the hub.
    const flows: TaskFlowEvent[] = activity.slice(0, 10).map((a, i) => {
      const role = a.executiveId ? roleById.get(a.executiveId) ?? null : null;
      const color = role ? colorForRole(role) : "#22d3ee";
      if (a.type === "handoff") {
        return { id: a.id + ":" + i, fromRole: role, toRole: null, kind: "handoff", color };
      }
      if (a.type === "task_created" || a.type === "task_updated") {
        return { id: a.id + ":" + i, fromRole: null, toRole: role, kind: "task", color };
      }
      return { id: a.id + ":" + i, fromRole: role, toRole: null, kind: "message", color };
    });

    return {
      ready: true,
      loading: false,
      founderName,
      executives,
      stats: overview.stats,
      briefing: overview.briefing
        ? {
            headline: overview.briefing.headline,
            summary: overview.briefing.summary,
            focus: overview.briefing.focus ?? [],
            generatedAt: overview.briefing.generatedAt as unknown as string,
          }
        : null,
      activity,
      flows,
      timeOfDay,
    };
  }, [overview, me, isLoading]);
}
