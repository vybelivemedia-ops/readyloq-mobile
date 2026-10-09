import React from "react";
import { Text, View } from "react-native";
import * as Updates from "expo-updates";

import { useColors } from "@/hooks/useColors";

// JS-only acceptance marker, also visible without signing in. Never fetch or
// reload automatically here: a reload could interrupt an active inspection.
export function PreviewUpdateIdentity() {
  const colors = useColors();
  if (Updates.channel !== "preview") return null;

  return (
    <View style={{ gap: 4 }}>
      <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>
        Preview OTA check · 2026-10-09
      </Text>
      <Text selectable style={{ color: colors.mutedForeground, fontSize: 12 }}>
        Channel: {Updates.channel} · Runtime: {Updates.runtimeVersion ?? "unknown"}
      </Text>
      <Text selectable style={{ color: colors.mutedForeground, fontSize: 12 }}>
        {Updates.isEmbeddedLaunch ? "Embedded APK bundle" : "Downloaded update"}:{" "}
        {Updates.updateId ?? "unavailable"}
      </Text>
      {Updates.isEmergencyLaunch && (
        <Text style={{ color: colors.destructive, fontSize: 12 }}>
          Update fallback: {Updates.emergencyLaunchReason ?? "unknown"}
        </Text>
      )}
    </View>
  );
}
