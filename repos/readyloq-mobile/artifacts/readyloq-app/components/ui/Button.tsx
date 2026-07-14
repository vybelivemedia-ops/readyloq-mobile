import { Ionicons } from "@expo/vector-icons";
import React from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleProp,
  Text,
  View,
  ViewStyle,
} from "react-native";

import { useColors } from "@/hooks/useColors";

type Variant = "primary" | "secondary" | "outline" | "destructive" | "ghost";
type Size = "md" | "lg";

interface ButtonProps {
  title: string;
  onPress?: () => void;
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  disabled?: boolean;
  icon?: keyof typeof Ionicons.glyphMap;
  iconPosition?: "left" | "right";
  fullWidth?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function Button({
  title,
  onPress,
  variant = "primary",
  size = "md",
  loading = false,
  disabled = false,
  icon,
  iconPosition = "left",
  fullWidth = true,
  style,
}: ButtonProps) {
  const colors = useColors();
  const isDisabled = disabled || loading;

  const bg: Record<Variant, string> = {
    primary: colors.primary,
    secondary: colors.secondary,
    outline: "transparent",
    destructive: colors.destructive,
    ghost: "transparent",
  };
  const fg: Record<Variant, string> = {
    primary: colors.primaryForeground,
    secondary: colors.secondaryForeground,
    outline: colors.foreground,
    destructive: colors.destructiveForeground,
    ghost: colors.primary,
  };

  const height = size === "lg" ? 56 : 48;

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      style={({ pressed }) => [
        {
          height,
          borderRadius: colors.radius,
          backgroundColor: bg[variant],
          alignItems: "center",
          justifyContent: "center",
          flexDirection: "row",
          gap: 8,
          paddingHorizontal: 20,
          borderWidth: variant === "outline" ? 1 : 0,
          borderColor: colors.border,
          opacity: isDisabled ? 0.5 : pressed ? 0.85 : 1,
          alignSelf: fullWidth ? "stretch" : "flex-start",
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={fg[variant]} />
      ) : (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          {icon && iconPosition === "left" ? (
            <Ionicons name={icon} size={size === "lg" ? 22 : 18} color={fg[variant]} />
          ) : null}
          <Text
            style={{
              color: fg[variant],
              fontFamily: "Inter_600SemiBold",
              fontSize: size === "lg" ? 17 : 15,
            }}
          >
            {title}
          </Text>
          {icon && iconPosition === "right" ? (
            <Ionicons name={icon} size={size === "lg" ? 22 : 18} color={fg[variant]} />
          ) : null}
        </View>
      )}
    </Pressable>
  );
}
