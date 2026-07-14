import { Feather } from "@expo/vector-icons";
import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { LiveBadge } from "@/components/ui/LiveBadge";
import { useColors } from "@/hooks/useColors";

interface LiveStatsProps {
  viewerCount: number;
  duration: number;
  platformCount: number;
}

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  }
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

export function LiveStats({ viewerCount, duration, platformCount }: LiveStatsProps) {
  const colors = useColors();

  return (
    <View style={styles.container}>
      <LiveBadge viewers={viewerCount} size="md" />

      <View style={[styles.pill, { backgroundColor: colors.overlay }]}>
        <Feather name="clock" size={11} color={colors.foreground} />
        <Text style={[styles.pillText, { color: colors.foreground }]}>
          {formatDuration(duration)}
        </Text>
      </View>

      <View style={[styles.pill, { backgroundColor: colors.overlay }]}>
        <Feather name="share-2" size={11} color={colors.cyan} />
        <Text style={[styles.pillText, { color: colors.cyan }]}>
          {platformCount} platforms
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
  },
  pillText: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
  },
});
