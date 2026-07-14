import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Text, View } from "react-native";

import { useColors } from "@/hooks/useColors";
import { Button } from "./Button";

interface ErrorStateProps {
  title?: string;
  message?: string;
  onRetry?: () => void;
  onSignOut?: () => void;
}

export function ErrorState({
  title = "Something went wrong",
  message = "Please try again.",
  onRetry,
  onSignOut,
}: ErrorStateProps) {
  const colors = useColors();
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: colors.background,
        alignItems: "center",
        justifyContent: "center",
        padding: 32,
        gap: 14,
      }}
    >
      <Ionicons name="cloud-offline-outline" size={48} color={colors.mutedForeground} />
      <Text
        style={{
          color: colors.foreground,
          fontFamily: "Inter_600SemiBold",
          fontSize: 18,
          textAlign: "center",
        }}
      >
        {title}
      </Text>
      <Text
        style={{
          color: colors.mutedForeground,
          fontFamily: "Inter_400Regular",
          fontSize: 14,
          textAlign: "center",
          lineHeight: 20,
        }}
      >
        {message}
      </Text>
      <View style={{ alignSelf: "stretch", gap: 10, marginTop: 8 }}>
        {onRetry ? <Button title="Try again" icon="refresh" onPress={onRetry} /> : null}
        {onSignOut ? <Button title="Sign out" variant="ghost" onPress={onSignOut} /> : null}
      </View>
    </View>
  );
}
