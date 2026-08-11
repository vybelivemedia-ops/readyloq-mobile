import React, { useEffect, useRef } from "react";
import { Animated, Text } from "react-native";

import { useColors } from "@/hooks/useColors";

interface OfflineBannerProps {
  isOffline: boolean;
  message: string;
}

/**
 * Animated offline banner that fades in when the device loses connectivity
 * and fades out when it's restored. Always rendered so the fade-out animation
 * plays before the component is visually gone. The native driver is used for
 * opacity only — layout properties are intentionally excluded to avoid the
 * "animated node driven by native driver cannot be used in a component that
 * animates layout" runtime error.
 */
export function OfflineBanner({ isOffline, message }: OfflineBannerProps) {
  const colors = useColors();
  const opacity = useRef(new Animated.Value(isOffline ? 1 : 0)).current;

  useEffect(() => {
    Animated.timing(opacity, {
      toValue: isOffline ? 1 : 0,
      duration: 250,
      useNativeDriver: true,
    }).start();
  }, [isOffline, opacity]);

  return (
    <Animated.View
      style={{
        opacity,
        backgroundColor: colors.destructive,
        borderRadius: 8,
        padding: 12,
      }}
      pointerEvents={isOffline ? "auto" : "none"}
    >
      <Text
        style={{
          color: "#fff",
          fontFamily: "Inter_400Regular",
          fontSize: 14,
          textAlign: "center",
        }}
      >
        {message}
      </Text>
    </Animated.View>
  );
}
