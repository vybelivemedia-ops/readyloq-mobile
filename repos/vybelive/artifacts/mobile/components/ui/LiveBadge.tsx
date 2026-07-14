import React, { useEffect, useRef } from "react";
import { Animated, StyleSheet, Text, View, type ViewStyle } from "react-native";

import { useColors } from "@/hooks/useColors";

interface LiveBadgeProps {
  style?: ViewStyle;
  size?: "sm" | "md" | "lg";
  viewers?: number;
  pulse?: boolean;
}

export function LiveBadge({
  style,
  size = "md",
  viewers,
  pulse = true,
}: LiveBadgeProps) {
  const colors = useColors();
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!pulse) return;
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 0.3,
          duration: 800,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 800,
          useNativeDriver: true,
        }),
      ])
    );
    animation.start();
    return () => animation.stop();
  }, [pulse, pulseAnim]);

  const heights: Record<string, number> = { sm: 20, md: 26, lg: 32 };
  const dotSizes: Record<string, number> = { sm: 5, md: 7, lg: 9 };
  const fontSizes: Record<string, number> = { sm: 9, md: 11, lg: 13 };

  return (
    <View
      style={[
        styles.container,
        {
          height: heights[size],
          borderRadius: heights[size] / 2,
          backgroundColor: colors.live,
          paddingHorizontal: size === "sm" ? 7 : 10,
          shadowColor: colors.live,
          shadowOffset: { width: 0, height: 0 },
          shadowOpacity: 0.6,
          shadowRadius: 8,
          elevation: 4,
        },
        style,
      ]}
    >
      <Animated.View
        style={[
          styles.dot,
          {
            width: dotSizes[size],
            height: dotSizes[size],
            borderRadius: dotSizes[size] / 2,
            backgroundColor: "#FFFFFF",
            opacity: pulseAnim,
          },
        ]}
      />
      <Text
        style={[
          styles.text,
          {
            fontSize: fontSizes[size],
          },
        ]}
      >
        LIVE
      </Text>
      {viewers !== undefined && (
        <Text
          style={[
            styles.viewers,
            {
              fontSize: fontSizes[size],
            },
          ]}
        >
          {" "}
          {formatViewers(viewers)}
        </Text>
      )}
    </View>
  );
}

function formatViewers(n: number): string {
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return n.toString();
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    alignSelf: "flex-start",
  },
  dot: {},
  text: {
    color: "#FFFFFF",
    fontFamily: "Inter_700Bold",
    letterSpacing: 0.8,
  },
  viewers: {
    color: "rgba(255,255,255,0.85)",
    fontFamily: "Inter_600SemiBold",
  },
});
