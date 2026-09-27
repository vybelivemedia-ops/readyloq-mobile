import React from "react";
import { useLocalSearchParams } from "expo-router";
import { PropertyDetail } from "@/components/mission-control/properties";
export default function Screen() { const { id } = useLocalSearchParams<{ id: string }>(); return <PropertyDetail id={Number(id)} />; }