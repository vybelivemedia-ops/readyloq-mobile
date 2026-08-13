import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiUrl } from '../config';

export interface ScheduleEntry {
  id: number;
  siteAddress: string;
  clientName: string | null;
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

export function useSchedule(start: string, end: string) {
  return useQuery<ScheduleEntry[]>({
    queryKey: ['schedule', start, end],
    queryFn: async () => {
      const res = await fetch(apiUrl(`/schedule?start=${start}&end=${end}`), {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to fetch schedule');
      return res.json();
    },
    enabled: Boolean(start && end),
    staleTime: 30_000,
  });
}

export function useReassignInspection() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, payload }: { id: number; payload: ReassignPayload }) => {
      const res = await fetch(apiUrl(`/schedule/${id}`), {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? 'Failed to update');
      }
      return res.json() as Promise<ScheduleEntry>;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['schedule'] });
    },
  });
}
