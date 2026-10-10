import { useQuery } from '@tanstack/react-query';
import { apiUrl } from '../config';

export interface FrameDropStat {
  deviceId: string | null;
  reason: string | null;
  dropCount: number;
}

export interface FrameDropStatsResponse {
  stats: FrameDropStat[];
  queriedAt: number;
}

export function useFrameDropStats() {
  return useQuery<FrameDropStatsResponse>({
    queryKey: ['meta-glasses', 'frame-drop-stats'],
    queryFn: async () => {
      const res = await fetch(apiUrl('/meta-glasses/frame-drop-stats'), {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Failed to fetch frame-drop stats');
      return res.json();
    },
    staleTime: 60_000, // refresh at most once per minute
  });
}
