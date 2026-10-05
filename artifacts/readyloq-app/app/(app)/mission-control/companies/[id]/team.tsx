import React from "react";
import { useLocalSearchParams } from "expo-router";
import { CompanyTeam } from "@/components/mission-control/team";

export default function Screen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <CompanyTeam id={Number(id)} />;
}