import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from "@expo-google-fonts/inter";
import { ClerkProvider } from "@clerk/expo";
import { tokenCache } from "@clerk/expo/token-cache";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { setBaseUrl } from "@/lib/api-client";
import { setBaseUrl as setGeneratedApiBaseUrl } from "@workspace/api-client-react";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import React, { useEffect } from "react";
import { Text, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ErrorBoundary } from "@/components/ErrorBoundary";
import { DeviceRegistryProvider } from "@/lib/platform/DeviceRegistryContext";

// Native Text does not allow long-press selection by default. Apply the
// customer-facing default once at app startup so report details, findings, and
// other readable content can be copied without every screen having to opt in.
// A screen can still pass selectable={false} for text that should not select.
type TextWithDefaults = typeof Text & {
  defaultProps?: Partial<React.ComponentProps<typeof Text>>;
};

const textWithDefaults = Text as TextWithDefaults;
textWithDefaults.defaultProps = {
  ...textWithDefaults.defaultProps,
  selectable: true,
};

// Point the shared API client at the deployment domain (same backend the web
// app uses). This runs once at module load, before any query fires.
const domain = process.env.EXPO_PUBLIC_DOMAIN;
if (domain) {
  setBaseUrl(`https://${domain}`);
  setGeneratedApiBaseUrl(`https://${domain}`);
  console.log("[API] Base URL →", `https://${domain}`);
} else {
  console.error("[API] EXPO_PUBLIC_DOMAIN is not set — API calls will fail");
}

const publishableKey = process.env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY;
const proxyUrl = process.env.EXPO_PUBLIC_CLERK_PROXY_URL || undefined;

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
});

function RootLayoutNav() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(auth)" />
      <Stack.Screen name="(app)" />
    </Stack>
  );
}

export default function RootLayout() {
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

  if (!fontsLoaded && !fontError) return null;

  if (!publishableKey) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
          backgroundColor: "#101418",
        }}
      >
        <Text
          style={{
            color: "#ffffff",
            fontSize: 16,
            textAlign: "center",
            lineHeight: 24,
          }}
        >
          Configuration error: this build is missing its sign-in key
          (EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY).{"\n\n"}
          Rebuild the app with the env values defined in eas.json.
        </Text>
      </View>
    );
  }

  return (
    <ClerkProvider
      publishableKey={publishableKey}
      tokenCache={tokenCache}
      proxyUrl={proxyUrl}
    >
      <SafeAreaProvider>
        <ErrorBoundary>
          <DeviceRegistryProvider>
            <QueryClientProvider client={queryClient}>
              <GestureHandlerRootView style={{ flex: 1 }}>
                <KeyboardProvider>
                  <StatusBar style="light" />
                  <RootLayoutNav />
                </KeyboardProvider>
              </GestureHandlerRootView>
            </QueryClientProvider>
          </DeviceRegistryProvider>
        </ErrorBoundary>
      </SafeAreaProvider>
    </ClerkProvider>
  );
}
