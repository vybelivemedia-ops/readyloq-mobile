import React from "react";
import { useLocalSearchParams } from "expo-router";
import { AiTaskDetail } from "@/components/mission-control/ai";
export default function Screen() { const { id } = useLocalSearchParams<{ id: string }>(); return <AiTaskDetail id={Number(id)} />; }