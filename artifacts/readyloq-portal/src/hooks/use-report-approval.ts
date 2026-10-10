import { useMutation, useQueryClient } from '@tanstack/react-query';
import { getListReportsQueryKey, listReports } from '@workspace/api-client-react';
import { apiUrl } from '../config';

type Report = Awaited<ReturnType<typeof listReports>>[number];

export function useApproveReport() {
  const queryClient = useQueryClient();

  return useMutation<Report, Error, number>({
    mutationFn: async (id) => {
      // The portal uses Clerk's same-origin session cookie. Its generated API
      // client only adds a bearer token when setAuthTokenGetter is configured;
      // no such getter is registered by this web app.
      const res = await fetch(apiUrl(`/reports/${id}/approve`), {
        method: 'POST',
        credentials: 'include',
      });

      if (!res.ok) {
        let serverMessage: string | undefined;
        try {
          const body: unknown = await res.json();
          if (body && typeof body === 'object' && 'error' in body && typeof body.error === 'string') {
            serverMessage = body.error;
          }
        } catch {
          // Keep the status-specific fallback when the response has no JSON body.
        }
        if (res.status === 401) throw new Error('Your session has expired. Sign in again to approve this report.');
        if (res.status === 403) throw new Error('You do not have permission to approve reports.');
        if (res.status === 409) {
          throw new Error(serverMessage ?? 'This report can no longer be approved. Refresh the list to see its current status.');
        }
        throw new Error(serverMessage ?? `Could not approve report (${res.status}). Please try again.`);
      }

      return res.json() as Promise<Report>;
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: getListReportsQueryKey() });
    },
  });
}