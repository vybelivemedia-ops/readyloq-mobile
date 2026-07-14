import { useLocalSearchParams } from "expo-router";
import React from "react";

import { InspectionDetail } from "@/components/InspectionDetail";

export default function InspectionDetailScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  return <InspectionDetail id={Number(params.id)} />;
}
