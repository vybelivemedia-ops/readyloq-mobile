import { LinearGradient } from "expo-linear-gradient";
import * as Haptics from "expo-haptics";
import React from "react";
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  type ViewStyle,
} from "react-native";

import { useColors } from "@/hooks/useColors";

interface GlowButtonProps {
  title: string;
  onPress: () => void;
  variant?: "primary" | "live" | "secondary" | "danger" | "ghost";
  size?: "sm" | "md" | "lg";
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  style?: ViewStyle;
  icon?: React.ReactNode;
}

export function GlowButton({
  title,
  onPress,
  variant = "primary",
  size = "md",
  loading = false,
  disabled = false,
  fullWidth = false,
  style,
  icon,
}: GlowButtonProps) {
  const colors = useColors();

  const handlePress = () => {
    if (disabled || loading) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    onPress();
  };

  const gradients: Record<string, [string, string]> = {
    primary: ["#9B7FFF", "#5B3FFF"],
    live: ["#FF6B8A", "#FF1144"],
    secondary: [colors.secondary, colors.secondary],
    danger: ["#FF6060", "#CC2020"],
    ghost: ["transparent", "transparent"],
  };

  const glowColor: Record<string, string> = {
    primary: colors.purpleGlow,
    live: colors.liveGlow,
    secondary: "transparent",
    danger: "rgba(255, 60, 60, 0.2)",
    ghost: "transparent",
  };

  const heights: Record<string, number> = { sm: 40, md: 52, lg: 62 };
  const fontSizes: Record<string, number> = { sm: 13, md: 15, lg: 17 };

  const isGhost = variant === "ghost";

  return (
    <View
      style={[
        fullWidth ? styles.fullWidth : null,
        {
          shadowColor: glowColor[variant],
          shadowOffset: { width: 0, height: 0 },
          shadowOpacity: disabled ? 0 : 1,
          shadowRadius: variant === "live" ? 16 : 12,
          elevation: disabled ? 0 : 6,
        },
        style,
      ]}
    >
      <TouchableOpacity
        onPress={handlePress}
        activeOpacity={0.8}
        disabled={disabled || loading}
        style={fullWidth ? styles.fullWidth : null}
      >
        <LinearGradient
          colors={
            disabled
              ? [colors.muted, colors.muted]
              : (gradients[variant] as [string, string])
          }
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[
            styles.button,
            {
              height: heights[size],
              borderRadius: heights[size] / 2,
              opacity: disabled ? 0.5 : 1,
              borderWidth: isGhost ? 1 : 0,
              borderColor: isGhost ? colors.border : "transparent",
            },
            fullWidth && styles.fullWidth,
          ]}
        >
          {loading ? (
            <ActivityIndicator color="#FFF" size="small" />
          ) : (
            <View style={styles.content}>
              {icon && <View style={styles.icon}>{icon}</View>}
              <Text
                style={[
                  styles.text,
                  {
                    fontSize: fontSizes[size],
                    color:
                      variant === "ghost"
                        ? colors.foreground
                        : "#FFFFFF",
                  },
                ]}
              >
                {title}
              </Text>
            </View>
          )}
        </LinearGradient>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 28,
  },
  fullWidth: {
    width: "100%",
  },
  content: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  text: {
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.3,
  },
  icon: {
    alignItems: "center",
    justifyContent: "center",
  },
});
