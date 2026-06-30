import { useAuth } from "@clerk/expo";
import { Ionicons } from "@expo/vector-icons";
import React from "react";
import { Text, View } from "react-native";

import { Logo } from "@/components/brand/Logo";
import { Button } from "@/components/ui/Button";
import { Screen } from "@/components/ui/Screen";
import { useColors } from "@/hooks/useColors";

export function BetaPaused() {
  const colors = useColors();
  const { signOut } = useAuth();

  return (
    <Screen edges={["top", "bottom"]} padded>
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 18 }}>
        <Logo size={30} />
        <View
          style={{
            width: 84,
            height: 84,
            borderRadius: 42,
            backgroundColor: colors.card,
            borderWidth: 1,
            borderColor: colors.border,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Ionicons name="hourglass-outline" size={38} color={colors.warning} />
        </View>
        <Text
          style={{
            color: colors.foreground,
            fontFamily: "Inter_700Bold",
            fontSize: 22,
            textAlign: "center",
          }}
        >
          Beta access paused
        </Text>
        <Text
          style={{
            color: colors.mutedForeground,
            fontFamily: "Inter_400Regular",
            fontSize: 15,
            textAlign: "center",
            lineHeight: 22,
            paddingHorizontal: 8,
          }}
        >
          Your technician account is active, but field access is currently paused for your company.
          Ask your manager to re-enable beta access, then sign back in.
        </Text>
        <View style={{ alignSelf: "stretch", marginTop: 8 }}>
          <Button title="Sign out" variant="outline" onPress={() => signOut()} />
        </View>
      </View>
    </Screen>
  );
}
