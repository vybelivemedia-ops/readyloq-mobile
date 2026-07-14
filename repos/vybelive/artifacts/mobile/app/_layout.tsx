import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from "@expo-google-fonts/inter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { setBaseUrl, setClientVersion } from "@workspace/api-client-react";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import React, { useEffect } from "react";
import { Platform } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";

import { buildInfo, buildShortSha } from "@/constants/buildInfo";
import { APP_VERSION, BUILD_NUMBER } from "@/constants/version";
import { useVersionCheck } from "@/hooks/useVersionCheck";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { AuthProvider } from "@/contexts/AuthContext";
import { MetaWearablesProvider } from "@/contexts/MetaWearablesContext";
import { StreamProvider } from "@/contexts/StreamContext";

SplashScreen.preventAutoHideAsync();

// Configure API base URL and build identity for Expo (outside proxy)
setBaseUrl(`https://${process.env.EXPO_PUBLIC_DOMAIN ?? "getvybe.live"}`);
setClientVersion({ version: APP_VERSION, build: BUILD_NUMBER, platform: Platform.OS });

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 1000 * 30,
    },
  },
});

function RootLayoutNav() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="stream/setup" options={{ presentation: "modal" }} />
      <Stack.Screen name="stream/pov" options={{ presentation: "fullScreenModal" }} />
      <Stack.Screen name="stream/recover" options={{ presentation: "fullScreenModal", gestureEnabled: false }} />
      <Stack.Screen name="settings" />
      <Stack.Screen name="recordings" options={{ headerShown: false }} />
      <Stack.Screen name="approvals" options={{ headerShown: false }} />
      <Stack.Screen name="analytics" options={{ headerShown: false }} />
      <Stack.Screen name="discover/browse" />
      <Stack.Screen name="creator/[id]/index" />
      <Stack.Screen name="creator/[id]/followers" />
      <Stack.Screen name="creator/[id]/following" />
      <Stack.Screen name="oauth-complete" options={{ headerShown: false }} />
      <Stack.Screen name="notifications" options={{ presentation: "modal", headerShown: false }} />
      <Stack.Screen name="legal/terms" options={{ presentation: "modal", headerShown: false }} />
      <Stack.Screen name="legal/privacy" options={{ presentation: "modal", headerShown: false }} />
    </Stack>
  );
}

export default function RootLayout() {
  useVersionCheck();

  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  useEffect(() => {
    console.info(
      `[build] v${APP_VERSION} (${BUILD_NUMBER}) · ${buildInfo.branch}@${buildShortSha} (${buildInfo.workingTreeStatus}, ${buildInfo.source}) built ${buildInfo.buildTimestamp}`,
    );
  }, []);

  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <MetaWearablesProvider>
            <StreamProvider>
              <GestureHandlerRootView style={{ flex: 1 }}>
                <KeyboardProvider>
                  <StatusBar style="light" />
                  <RootLayoutNav />
                </KeyboardProvider>
              </GestureHandlerRootView>
            </StreamProvider>
            </MetaWearablesProvider>
          </AuthProvider>
        </QueryClientProvider>
      </ErrorBoundary>
    </SafeAreaProvider>
  );
}
