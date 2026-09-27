import { Stack } from "expo-router";
import React from "react";
import { ScopeProvider } from "@/components/mission-control/scope";

export default function MissionControlLayout() {
  return <ScopeProvider><Stack screenOptions={{ headerShown: false }} /></ScopeProvider>;
}