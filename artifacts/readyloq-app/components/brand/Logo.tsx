import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Text, View } from "react-native";

import { useColors } from "@/hooks/useColors";

export function Logo({ size = 28 }: { size?: number }) {
  const colors = useColors();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
      <View
        style={{
          width: size + 12,
          height: size + 12,
          borderRadius: (size + 12) / 4,
          backgroundColor: colors.accent,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Ionicons name="shield-checkmark" size={size - 2} color={colors.primary} />
      </View>
      <Text style={{ fontFamily: "Inter_700Bold", fontSize: size }}>
        <Text style={{ color: colors.foreground }}>Ready</Text>
        <Text style={{ color: colors.primary }}>Loq</Text>
      </Text>
    </View>
  );
}
