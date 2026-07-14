import { Image } from "expo-image";
import React from "react";
import { StyleSheet, Text, View, type ViewStyle } from "react-native";

import { useColors } from "@/hooks/useColors";

interface AvatarProps {
  uri?: string | null;
  name?: string;
  size?: number;
  style?: ViewStyle;
  showRing?: boolean;
  ringColor?: string;
  isLive?: boolean;
}

export function Avatar({
  uri,
  name = "",
  size = 40,
  style,
  showRing = false,
  ringColor,
  isLive = false,
}: AvatarProps) {
  const colors = useColors();
  const initials = getInitials(name);
  const ringSize = showRing || isLive ? 3 : 0;

  return (
    <View
      style={[
        {
          width: size + ringSize * 2,
          height: size + ringSize * 2,
          borderRadius: (size + ringSize * 2) / 2,
          borderWidth: ringSize,
          borderColor: isLive
            ? colors.live
            : ringColor ?? colors.primary,
          ...(isLive || showRing
            ? {
                shadowColor: isLive ? colors.live : colors.primary,
                shadowOffset: { width: 0, height: 0 },
                shadowOpacity: 0.7,
                shadowRadius: 6,
                elevation: 4,
              }
            : {}),
        },
        style,
      ]}
    >
      {uri ? (
        <Image
          source={{ uri }}
          style={{
            width: size,
            height: size,
            borderRadius: size / 2,
          }}
          contentFit="cover"
        />
      ) : (
        <View
          style={[
            styles.fallback,
            {
              width: size,
              height: size,
              borderRadius: size / 2,
              backgroundColor: colors.secondary,
            },
          ]}
        >
          <Text
            style={[
              styles.initials,
              {
                fontSize: size * 0.36,
                color: colors.primary,
              },
            ]}
          >
            {initials}
          </Text>
        </View>
      )}
    </View>
  );
}

function getInitials(name: string): string {
  const parts = name.trim().split(" ");
  if (parts.length === 0 || !parts[0]) return "?";
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (
    parts[0].charAt(0).toUpperCase() +
    parts[parts.length - 1].charAt(0).toUpperCase()
  );
}

const styles = StyleSheet.create({
  fallback: {
    alignItems: "center",
    justifyContent: "center",
  },
  initials: {
    fontFamily: "Inter_700Bold",
  },
});
