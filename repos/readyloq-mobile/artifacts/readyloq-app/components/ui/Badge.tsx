import React from "react";
import { Text, View } from "react-native";

import { useColors } from "@/hooks/useColors";

export type BadgeTone =
  | "default"
  | "primary"
  | "success"
  | "warning"
  | "danger"
  | "info";

export function Badge({
  label,
  tone = "default",
}: {
  label: string;
  tone?: BadgeTone;
}) {
  const colors = useColors();

  const map: Record<BadgeTone, { bg: string; fg: string }> = {
    default: { bg: colors.secondary, fg: colors.mutedForeground },
    primary: { bg: colors.accent, fg: colors.accentForeground },
    success: { bg: "rgba(63,185,80,0.16)", fg: colors.success },
    warning: { bg: "rgba(210,153,34,0.16)", fg: colors.warning },
    danger: { bg: "rgba(248,81,73,0.16)", fg: colors.destructive },
    info: { bg: "rgba(88,166,255,0.16)", fg: colors.info },
  };
  const c = map[tone];

  return (
    <View
      style={{
        backgroundColor: c.bg,
        paddingHorizontal: 10,
        paddingVertical: 4,
        borderRadius: 999,
        alignSelf: "flex-start",
      }}
    >
      <Text style={{ color: c.fg, fontSize: 12, fontFamily: "Inter_600SemiBold" }}>
        {label}
      </Text>
    </View>
  );
}
