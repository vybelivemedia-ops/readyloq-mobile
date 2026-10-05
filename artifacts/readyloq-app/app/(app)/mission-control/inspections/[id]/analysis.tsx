import React from "react";
import { useLocalSearchParams } from "expo-router";
import { InspectionAnalysis } from "@/components/mission-control/operations";

export default function Screen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <InspectionAnalysis inspectionId={Number(id)} />;
}