import React from "react";
import { useLocalSearchParams } from "expo-router";
import { InspectionEvidenceList } from "@/components/mission-control/operations";

export default function Screen() {
  const { id, mediaType, analysisStatus } = useLocalSearchParams<{ id: string; mediaType?: string; analysisStatus?: string }>();
  return <InspectionEvidenceList inspectionId={Number(id)} linkedMediaType={mediaType} linkedAnalysisStatus={analysisStatus} />;
}