/**
 * Typed, parameterized reports API client.
 *
 * The generated `listReports` function takes no arguments and always fetches
 * every report for the company. This module wraps the same endpoint with an
 * optional `ReportQueryParams` bag so callers can push filtering to the server
 * and drive React Query cache keys from the active filter state.
 */

import { customFetch } from "./custom-fetch";
import type { Report } from "./generated/api.schemas";
import type { UseQueryOptions } from "@tanstack/react-query";

export interface ReportQueryParams {
  /** Comma-joined severities e.g. ["high", "critical"] */
  severity?: string[];
  /** Comma-joined statuses e.g. ["pending", "draft"] */
  status?: string[];
  /** Restrict to reports created within the last N days. */
  sinceDays?: number;
  /** When true, only return reports with at least one exclusion opportunity. */
  opportunities?: boolean;
}

function buildUrl(params: ReportQueryParams): string {
  const qs = new URLSearchParams();
  if (params.severity?.length) qs.set("severity", params.severity.join(","));
  if (params.status?.length)   qs.set("status",   params.status.join(","));
  if (params.sinceDays != null) qs.set("since_days", String(params.sinceDays));
  if (params.opportunities)    qs.set("opportunities", "true");
  const q = qs.toString();
  return q ? `/api/reports?${q}` : "/api/reports";
}

export async function fetchReports(
  params: ReportQueryParams = {},
  options?: RequestInit,
): Promise<Report[]> {
  return customFetch<Report[]>(buildUrl(params), { ...options, method: "GET" });
}

/** Stable React Query key — changes when any param changes, triggering a refetch. */
export function fetchReportsQueryKey(params: ReportQueryParams = {}) {
  return [
    "/api/reports",
    params.severity?.slice().sort().join(",") ?? "",
    params.status?.slice().sort().join(",")   ?? "",
    params.sinceDays ?? "",
    params.opportunities ?? false,
  ] as const;
}

export function fetchReportsQueryOptions(
  params: ReportQueryParams = {},
  queryOptions?: Partial<UseQueryOptions<Report[], unknown>>,
): UseQueryOptions<Report[], unknown> & { queryKey: readonly unknown[] } {
  return {
    queryKey: fetchReportsQueryKey(params),
    queryFn: ({ signal }: { signal?: AbortSignal }) =>
      fetchReports(params, { signal } as RequestInit),
    ...queryOptions,
  };
}
