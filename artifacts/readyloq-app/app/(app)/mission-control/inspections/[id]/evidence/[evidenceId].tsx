import React from "react";
import { useLocalSearchParams } from "expo-router";
import { EvidenceDetail } from "@/components/mission-control/operations";

export default function Screen() {
  const { id, evidenceId } = useLocalSearchParams<{ id: string; evidenceId: string }>();
  return <EvidenceDetail inspectionId={Number(id)} evidenceId={Number(evidenceId)} />;
}