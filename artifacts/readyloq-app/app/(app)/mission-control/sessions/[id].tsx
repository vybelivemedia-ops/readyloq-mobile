import React from "react";
import { useLocalSearchParams } from "expo-router";
import { SessionDetail } from "@/components/mission-control/details";
export default function Screen() { const { id } = useLocalSearchParams<{ id: string }>(); return <SessionDetail id={Number(id)} />; }