import React from "react";
import { useLocalSearchParams } from "expo-router";
import { InspectionDetail } from "@/components/mission-control/details";
export default function Screen() { const { id } = useLocalSearchParams<{ id: string }>(); return <InspectionDetail id={Number(id)} />; }