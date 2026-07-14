import { Stack } from "expo-router";

export default function AuthLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, animation: "fade" }}>
      <Stack.Screen name="welcome" />
      <Stack.Screen name="login" options={{ animation: "slide_from_right" }} />
      <Stack.Screen name="register" options={{ animation: "slide_from_right" }} />
      <Stack.Screen name="onboarding" options={{ animation: "slide_from_right" }} />
      <Stack.Screen name="forgot-password" options={{ animation: "slide_from_right" }} />
      <Stack.Screen name="reset-password" options={{ animation: "slide_from_right" }} />
    </Stack>
  );
}
