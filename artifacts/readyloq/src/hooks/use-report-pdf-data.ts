import { useGetReport, useGetInspection, useGetBranding, useGetPropertyFeed } from "@workspace/api-client-react";
import { normalizeAddressKey } from "@/lib/normalize-address-key";

export function useReportPdfData(reportId: number | null) {
  const { data: report, isLoading: rl } = useGetReport(reportId ?? 0);

  const { data: inspection, isLoading: il } = useGetInspection(
    report?.inspectionId ?? 0,
  );

  const { data: branding, isLoading: bl } = useGetBranding();

  const addressKey = report?.siteAddress ? normalizeAddressKey(report.siteAddress) : "";
  const { data: propertyFeed } = useGetPropertyFeed(addressKey);

  const isLoading = rl || il || bl;
  const isReady = !isLoading && !!report && !!inspection && !!branding;

  return { report, inspection, branding, propertyFeed, isLoading, isReady };
}
