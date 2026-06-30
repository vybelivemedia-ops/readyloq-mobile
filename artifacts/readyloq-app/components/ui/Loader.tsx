import React from "react";
import { ActivityIndicator, Text, View } from "react-native";

import { useColors } from "@/hooks/useColors";

export function FullScreenLoader({ label }: { label?: string }) {
  const colors = useColors();
  return (
    <View
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: colors.background,
        gap: 12,
      }}
    >
      <ActivityIndicator size="large" color={colors.primary} />
      {label ? (
        <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_500Medium" }}>
          {label}
        </Text>
      ) : null}
    </View>
  );
}
