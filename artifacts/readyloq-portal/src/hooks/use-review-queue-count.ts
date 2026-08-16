import { useListIntelligenceRecords, getListIntelligenceRecordsQueryKey } from '@workspace/api-client-react';

const PARAMS = { status: 'confirmed', page: 1, limit: 1 } as const;

/**
 * Returns the count of intelligence records awaiting manager review
 * (status='confirmed').  Refreshes every 60 seconds so the badge stays
 * reasonably current without hammering the API.
 */
export function useReviewQueueCount(): number {
  const { data } = useListIntelligenceRecords(
    PARAMS,
    {
      query: {
        queryKey: getListIntelligenceRecordsQueryKey(PARAMS),
        refetchInterval: 60_000,
        staleTime: 30_000,
      },
    },
  );
  return data?.total ?? 0;
}
