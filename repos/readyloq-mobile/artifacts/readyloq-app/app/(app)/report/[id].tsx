import { useLocalSearchParams } from "expo-router";
import React from "react";

import { ReportDetail } from "@/components/ReportDetail";

export default function ReportDetailScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  return <ReportDetail id={Number(params.id)} />;
}
