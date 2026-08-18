import { useListIntelligenceRecords, getListIntelligenceRecordsQueryKey } from '@workspace/api-client-react';

const PARAMS = { status: 'confirmed', page: 1, limit: 1 } as const;

/**
 * Canonical query key for the badge count query.  Exported so the review
 * page can invalidate it explicitly after an approve/reject action.
 */
export const REVIEW_QUEUE_COUNT_QUERY_KEY = getListIntelligenceRecordsQueryKey(PARAMS);

/**
 * Returns the count of intelligence records awaiting manager review
 * (status='confirmed').  Refreshes every 60 seconds so the badge stays
 * reasonably current without hammering the API.
 *
 * staleTime is intentionally 0 so that an explicit invalidateQueries call
 * from the review page triggers an immediate refetch rather than serving a
 * cached value from within the stale window.
 */
export function useReviewQueueCount(): number {
  const { data } = useListIntelligenceRecords(
    PARAMS,
    {
      query: {
        queryKey: REVIEW_QUEUE_COUNT_QUERY_KEY,
        refetchInterval: 60_000,
        staleTime: 0,
      },
    },
  );
  return data?.total ?? 0;
}
