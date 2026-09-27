import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  getSchedule,
  reassignInspection,
  getRouteCalendar,
  getRouteOutlook,
  lookupDailyRig,
  getTeamRouteReadiness,
} from '@workspace/api-client-react';
import { apiUrl } from '../config';

// ─── Generated, type-checked API client ─────────────────────────────────────
//
// This file used to hand-roll every `fetch()` call. It now delegates the
// actual HTTP work to @workspace/api-client-react's Orval-generated
// functions (typed against lib/api-spec/openapi.yaml), while keeping this
// module's own hand-curated types/hooks as the public surface that the rest
// of the portal imports from `@/hooks/use-schedule`.
//
// Why keep local wrapper hooks instead of using the generated `useGetSchedule`
// / `useReassignInspection` / etc. hooks directly:
//   - Query keys here (`['schedule', start, end]`, `['route-calendar', ...]`)
//     must stay stable so `useReassignInspection`'s and `useCreateInspection`'s
//     `invalidateQueries({ queryKey: ['schedule'] })` calls keep matching by
//     prefix — the generated hooks key off the raw URL instead.
//   - A handful of behaviors (404 → null/`{setUp:false}` coercion, the
//     `err.error` server-message shape surfaced to forms, `tzOffsetMinutes`
//     injection from the browser's own clock, and — importantly —
//     `credentials: 'include'` on every call so the session cookie still
//     rides along when `VITE_API_URL` points at a separate API origin, the
//     way the old hand-written fetches always did) predate codegen and are
//     preserved exactly so existing callers don't need to change.
// The generated functions still buy us compile-time verification that this
// file's request/response shapes match the OpenAPI spec.
//
// This is the intentional convention for readyloq-portal going forward:
// schedule-related data fetching goes through the generated client's
// functions, wrapped in local hooks when the wrapper needs to add behavior
// the generated hook doesn't provide out of the box.

/** Extracts the server's `{ error: "..." }` message from a thrown ApiError,
 *  falling back to a generic message. Preserves the pre-codegen error shape
 *  (`err.error ?? fallback`) that callers (e.g. the create-inspection form)
 *  already display to users. */
function apiErrorMessage(e: unknown, fallback: string): string {
  if (e && typeof e === 'object' && 'data' in e) {
    const data = (e as { data?: unknown }).data;
    if (data && typeof data === 'object' && typeof (data as { error?: unknown }).error === 'string') {
      return (data as { error: string }).error;
    }
  }
  if (e instanceof Error) return e.message;
  return fallback;
}

/** True when a thrown ApiError carries a 404 status. */
function isNotFound(e: unknown): boolean {
  return !!e && typeof e === 'object' && (e as { status?: unknown }).status === 404;
}

export interface ScheduleEntry {
  id: number;
  siteAddress: string;
  clientName: string | null;
  /** Unit / apartment number for multi-family properties. */
  unitNumber: string | null;
  technicianName: string;
  technicianId: string | null;
  status: string;
  severity: string | null;
  pestTypes: string[];
  scheduledDate: string | null;
  calendarDate: string; // YYYY-MM-DD
  createdAt: string;
  completedAt: string | null;
}

export interface ReassignPayload {
  scheduledDate?: string | null;
  technicianName?: string;
  technicianId?: string | null;
}

export interface CreateInspectionPayload {
  siteAddress: string;
  clientName?: string;
  technicianName: string;
  technicianId?: string | null;
  scheduledDate?: string | null;
  pestTypes?: string[];
  notes?: string;
  /** Unit / apartment number for multi-family properties. */
  unitNumber?: string | null;
}

export function useSchedule(start: string, end: string) {
  return useQuery<ScheduleEntry[]>({
    queryKey: ['schedule', start, end],
    queryFn: async () =>
      (await getSchedule({ start, end }, { credentials: 'include' })) as unknown as ScheduleEntry[],
    enabled: Boolean(start && end),
    staleTime: 15_000,
    refetchInterval: 30_000, // real-time status updates for dispatchers
  });
}

export function useReassignInspection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, payload }: { id: number; payload: ReassignPayload }) => {
      try {
        return (await reassignInspection(id, payload, { credentials: 'include' })) as unknown as ScheduleEntry;
      } catch (e: unknown) {
        throw new Error(apiErrorMessage(e, 'Failed to update'));
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['schedule'] });
    },
  });
}

// ─── Integrated Route Calendar ──────────────────────────────────────────────

export type RouteOutlookStatus = 'ok' | 'due-soon' | 'overdue';

export interface RouteOutlookProduct {
  productId: number;
  productName: string;
  targetPest: string;
  lastAppliedAt: string;
  daysSinceApplication: number;
  retreatmentIntervalDays: number | null;
  nextEligibleReapplicationDate: string | null;
  eligibleNow: boolean;
  outlookStatus: RouteOutlookStatus;
  applicationsLast90Days: number;
}

export interface RouteOutlookDetail {
  address: string;
  calendarDate: string;
  products: RouteOutlookProduct[];
}

export interface RouteCalendarStop {
  id: number;
  siteAddress: string;
  clientName: string | null;
  unitNumber: string | null;
  technicianName: string;
  technicianId: string | null;
  status: string;
  severity: string | null;
  pestTypes: string[];
  calendarDate: string;
  readiness: { dailyRigSetUp: boolean | null };
  outlook: { overdueCount: number; dueSoonCount: number; okCount: number; hasOutlookData: boolean };
}

export interface RouteCalendarDay {
  date: string;
  stops: RouteCalendarStop[];
}

// `start`/`end` must be this browser's own LOCAL calendar dates (matching
// technicianDailyRigsTable.rigDate, which the mobile daily-rig client also
// writes using local device date). We send the browser's UTC offset so the
// server buckets/labels every stop's calendarDate in the same local frame
// instead of UTC, keeping it consistent with Route Readiness.
export function useRouteCalendar(start: string, end: string) {
  return useQuery<RouteCalendarDay[]>({
    queryKey: ['route-calendar', start, end],
    queryFn: async () => {
      const tzOffsetMinutes = new Date().getTimezoneOffset();
      return (await getRouteCalendar(
        { start, end, tzOffsetMinutes },
        { credentials: 'include' },
      )) as unknown as RouteCalendarDay[];
    },
    enabled: Boolean(start && end),
    staleTime: 30_000,
  });
}

export function useRouteOutlook(inspectionId: number | null) {
  return useQuery<RouteOutlookDetail>({
    queryKey: ['route-outlook', inspectionId],
    queryFn: async () => {
      const tzOffsetMinutes = new Date().getTimezoneOffset();
      return (await getRouteOutlook(
        inspectionId!,
        { tzOffsetMinutes },
        { credentials: 'include' },
      )) as unknown as RouteOutlookDetail;
    },
    enabled: inspectionId != null,
  });
}

export interface DailyRigLookupAssignment {
  productId: number;
  targetPest: string;
  notes?: string;
  product: { id: number; name: string } | null;
}

export interface DailyRigLookupResult {
  setUp: boolean;
  assignments?: DailyRigLookupAssignment[];
}

export function useDailyRigLookup(technicianId: string | null, date: string | null) {
  return useQuery<DailyRigLookupResult>({
    queryKey: ['daily-rig-lookup', technicianId, date],
    queryFn: async () => {
      try {
        return (await lookupDailyRig(
          { technicianId: technicianId!, date: date! },
          { credentials: 'include' },
        )) as unknown as DailyRigLookupResult;
      } catch (e: unknown) {
        if (isNotFound(e)) return { setUp: false };
        throw e;
      }
    },
    enabled: Boolean(technicianId && date),
  });
}

// ── Today's Route Readiness (proactive, TODAY-scoped) ──────────────────────
//
// Compares each technician's scheduled stops today against their truck's
// on-hand quantities for the products on today's rig. Distinct from Truck
// Stock Health (see use-warehouse.ts's useTeamStockHealth), which is a
// longer-range trending projection independent of today's schedule, and
// from the existing reactive restockThreshold alert (unchanged).

export type RouteReadinessProductStatus = 'ready' | 'short' | 'insufficient-data';
export type RouteReadinessOverallStatus = 'ready' | 'short' | 'not-set-up';

export interface RouteReadinessProduct {
  productId: number;
  productName: string;
  targetPest: string;
  unit: string;
  quantityOnHand: number;
  avgUsagePerStop: number | null;
  expectedUsageToday: number | null;
  status: RouteReadinessProductStatus;
}

export interface TechnicianRouteReadiness {
  technicianId: string;
  date: string;
  stopCount: number;
  rigSetUp: boolean;
  overallStatus: RouteReadinessOverallStatus;
  products: RouteReadinessProduct[];
}

export function useTeamRouteReadiness(date: string) {
  return useQuery<TechnicianRouteReadiness[]>({
    queryKey: ['team-route-readiness', date],
    queryFn: async () => {
      const tzOffsetMinutes = new Date().getTimezoneOffset();
      return (await getTeamRouteReadiness(
        { date, tzOffsetMinutes },
        { credentials: 'include' },
      )) as unknown as TechnicianRouteReadiness[];
    },
    enabled: Boolean(date),
    staleTime: 30_000,
  });
}

// NOTE: intentionally NOT using the generated `createInspection` client here.
// lib/api-spec/openapi.yaml's `InspectionInput` schema is missing
// `scheduledDate` (a pre-existing spec gap, unrelated to this migration) even
// though POST /api/inspections accepts and persists it — the generated,
// type-checked function would silently drop the field. Keeping this
// hand-written fetcher avoids either dropping `scheduledDate` on create or
// papering over a real spec/implementation mismatch with a type cast.
export function useCreateInspection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: CreateInspectionPayload) => {
      const res = await fetch(apiUrl('/inspections'), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? 'Failed to create inspection');
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['schedule'] });
    },
  });
}
