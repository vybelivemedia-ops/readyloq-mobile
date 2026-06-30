import React from "react";
import {
  StyleProp,
  Text,
  TextInput,
  TextInputProps,
  View,
  ViewStyle,
} from "react-native";

import { useColors } from "@/hooks/useColors";

interface TextFieldProps extends TextInputProps {
  label?: string;
  error?: string;
  containerStyle?: StyleProp<ViewStyle>;
}

export function TextField({
  label,
  error,
  containerStyle,
  style,
  multiline,
  ...props
}: TextFieldProps) {
  const colors = useColors();
  return (
    <View style={[{ gap: 6 }, containerStyle]}>
      {label ? (
        <Text
          style={{
            color: colors.foreground,
            fontFamily: "Inter_500Medium",
            fontSize: 14,
          }}
        >
          {label}
        </Text>
      ) : null}
      <TextInput
        placeholderTextColor={colors.mutedForeground}
        style={[
          {
            backgroundColor: colors.muted,
            borderWidth: 1,
            borderColor: error ? colors.destructive : colors.border,
            borderRadius: colors.radius,
            paddingHorizontal: 14,
            paddingVertical: multiline ? 12 : 14,
            color: colors.foreground,
            fontFamily: "Inter_400Regular",
            fontSize: 16,
            minHeight: multiline ? 96 : undefined,
            textAlignVertical: multiline ? "top" : "center",
          },
          style,
        ]}
        multiline={multiline}
        {...props}
      />
      {error ? (
        <Text style={{ color: colors.destructive, fontSize: 13, fontFamily: "Inter_400Regular" }}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}
