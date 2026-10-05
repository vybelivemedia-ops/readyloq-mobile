import React from "react";
import { useLocalSearchParams } from "expo-router";
import { IncidentDetail } from "@/components/mission-control/details";
export default function Screen() { const { id } = useLocalSearchParams<{ id: string }>(); return <IncidentDetail id={Number(id)} />; }