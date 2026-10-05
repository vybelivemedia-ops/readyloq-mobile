import React from "react";
import { useLocalSearchParams } from "expo-router";
import { CompanyDetail } from "@/components/mission-control/details";
export default function Screen() { const { id } = useLocalSearchParams<{ id: string }>(); return <CompanyDetail id={Number(id)} />; }