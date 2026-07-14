import { Feather } from "@expo/vector-icons";
import React from "react";
import { StyleSheet, Text, View, type ViewStyle } from "react-native";

import { useColors } from "@/hooks/useColors";

interface MetricCardProps {
  label: string;
  value: string | number;
  subValue?: string;
  icon?: keyof typeof Feather.glyphMap;
  trend?: "up" | "down" | "neutral";
  trendValue?: string;
  accentColor?: string;
  style?: ViewStyle;
}

export function MetricCard({
  label,
  value,
  subValue,
  icon,
  trend,
  trendValue,
  accentColor,
  style,
}: MetricCardProps) {
  const colors = useColors();
  const accent = accentColor ?? colors.primary;

  const trendColor =
    trend === "up"
      ? colors.neonGreen
      : trend === "down"
      ? colors.live
      : colors.mutedForeground;

  const trendIcon =
    trend === "up"
      ? "trending-up"
      : trend === "down"
      ? "trending-down"
      : "minus";

  return (
    <View
      style={[
        styles.card,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          borderLeftColor: accent,
        },
        style,
      ]}
    >
      <View style={styles.header}>
        {icon && (
          <View
            style={[
              styles.iconContainer,
              { backgroundColor: `${accent}20` },
            ]}
          >
            <Feather name={icon} size={14} color={accent} />
          </View>
        )}
        <Text style={[styles.label, { color: colors.mutedForeground }]}>
          {label}
        </Text>
      </View>

      <Text style={[styles.value, { color: colors.foreground }]}>
        {value}
      </Text>

      {(subValue || trendValue) && (
        <View style={styles.footer}>
          {trendValue && (
            <View style={styles.trend}>
              <Feather name={trendIcon} size={11} color={trendColor} />
              <Text style={[styles.trendText, { color: trendColor }]}>
                {trendValue}
              </Text>
            </View>
          )}
          {subValue && (
            <Text style={[styles.subValue, { color: colors.mutedForeground }]}>
              {subValue}
            </Text>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 14,
    padding: 16,
    borderWidth: 1,
    borderLeftWidth: 3,
    gap: 8,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  iconContainer: {
    width: 26,
    height: 26,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  label: {
    fontSize: 12,
    fontFamily: "Inter_500Medium",
    letterSpacing: 0.3,
    flex: 1,
  },
  value: {
    fontSize: 26,
    fontFamily: "Inter_700Bold",
    letterSpacing: -0.5,
  },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  trend: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
  },
  trendText: {
    fontSize: 11,
    fontFamily: "Inter_600SemiBold",
  },
  subValue: {
    fontSize: 11,
    fontFamily: "Inter_400Regular",
  },
});
