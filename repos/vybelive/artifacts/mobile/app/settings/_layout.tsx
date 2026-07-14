import { Stack } from "expo-router";
import { useColors } from "@/hooks/useColors";

export default function SettingsLayout() {
  const colors = useColors();
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen name="index" />
      <Stack.Screen name="connected-accounts" />
      <Stack.Screen name="platforms" />
      <Stack.Screen name="recognition" />
      <Stack.Screen name="subscription" />
      <Stack.Screen name="about" />
      <Stack.Screen name="meta-glasses" />
      <Stack.Screen name="delete-account" />
    </Stack>
  );
}
