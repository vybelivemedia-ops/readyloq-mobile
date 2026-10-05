import React from "react";
import { useLocalSearchParams } from "expo-router";
import { TechnicianDetail } from "@/components/mission-control/details";
export default function Screen() { const { id } = useLocalSearchParams<{ id: string }>(); return <TechnicianDetail id={id ?? ""} />; }