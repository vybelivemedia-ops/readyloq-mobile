import { Feather } from "@expo/vector-icons";
import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { useColors } from "@/hooks/useColors";
import type { StreamHealth } from "@/contexts/StreamContext";

const HEALTH_COLORS: Record<StreamHealth, string> = {
  excellent: "#39FF14",
  good: "#FFD700",
  poor: "#FF8C00",
  critical: "#FF3B6C",
};

const PLATFORM_COLORS: Record<string, string> = {
  youtube: "#FF0000",
  twitch: "#9146FF",
  kick: "#53FC18",
  facebook: "#1877F2",
  instagram: "#E1306C",
  tiktok: "#00F2EA",
  custom_rtmp: "#AAAAAA",
};

interface HealthBarProps {
  health: StreamHealth;
  bitrate: number;
  droppedFrames: number;
  signalStrength: number;
  platforms: string[];
  platformHealth: Record<string, "live" | "reconnecting" | "failed">;
}

function SignalBars({ strength }: { strength: number }) {
  return (
    <View style={styles.signalBars}>
      {[1, 2, 3, 4].map((level) => (
        <View
          key={level}
          style={[
            styles.signalBar,
            {
              height: 4 + level * 2,
              backgroundColor: level <= strength ? "#39FF14" : "rgba(255,255,255,0.2)",
            },
          ]}
        />
      ))}
    </View>
  );
}

export function HealthBar({
  health,
  bitrate,
  droppedFrames,
  signalStrength,
  platforms,
  platformHealth,
}: HealthBarProps) {
  const healthColor = HEALTH_COLORS[health];
  const bitrateStr =
    bitrate >= 1000
      ? `${(bitrate / 1000).toFixed(1)} Mbps`
      : `${bitrate} kbps`;

  return (
    <View style={styles.container}>
      {/* Health dot + bitrate */}
      <View style={styles.left}>
        <View style={[styles.healthDot, { backgroundColor: healthColor, shadowColor: healthColor }]} />
        <Text style={[styles.bitrateText, { color: healthColor }]}>{bitrateStr}</Text>
        {droppedFrames > 5 && (
          <View style={styles.dropWarning}>
            <Feather name="alert-triangle" size={9} color="#FF8C00" />
            <Text style={styles.dropText}>{droppedFrames}f</Text>
          </View>
        )}
      </View>

      {/* Signal bars */}
      <SignalBars strength={signalStrength} />

      {/* Per-platform status */}
      <View style={styles.platformDots}>
        {platforms.slice(0, 5).map((p) => {
          const ph = platformHealth[p] ?? "live";
          const dotColor =
            ph === "live"
              ? PLATFORM_COLORS[p] ?? "#FFF"
              : ph === "reconnecting"
              ? "#FF8C00"
              : "#FF3B6C";
          return (
            <View key={p} style={styles.platformDotWrap}>
              <View style={[styles.platformDot, { backgroundColor: dotColor }]} />
              {ph === "reconnecting" && (
                <View style={[styles.platformDotPulse, { borderColor: dotColor }]} />
              )}
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: "rgba(0,0,0,0.55)",
    borderRadius: 20,
  },
  left: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  healthDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.8,
    shadowRadius: 4,
  },
  bitrateText: {
    fontSize: 11,
    fontFamily: "Inter_700Bold",
    letterSpacing: 0.3,
  },
  dropWarning: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    backgroundColor: "rgba(255,140,0,0.2)",
    paddingHorizontal: 5,
    paddingVertical: 2,
    borderRadius: 6,
  },
  dropText: {
    fontSize: 9,
    fontFamily: "Inter_700Bold",
    color: "#FF8C00",
  },
  signalBars: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 2,
  },
  signalBar: {
    width: 3,
    borderRadius: 1.5,
  },
  platformDots: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
  },
  platformDotWrap: {
    position: "relative",
    width: 10,
    height: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  platformDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  platformDotPulse: {
    position: "absolute",
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 1,
    opacity: 0.5,
  },
});
