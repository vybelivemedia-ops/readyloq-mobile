import { useAuth } from "@clerk/expo";
import { setAuthTokenGetter } from "@/lib/api-client";
import { Redirect, Stack } from "expo-router";
import React, { useEffect } from "react";

import { BetaPaused } from "@/components/BetaPaused";
import { Onboarding } from "@/components/Onboarding";
import { ErrorState } from "@/components/ui/ErrorState";
import { FullScreenLoader } from "@/components/ui/Loader";
import { useColors } from "@/hooks/useColors";
import { CurrentUserProvider, useCurrentUser } from "@/hooks/useCurrentUser";

export default function AppLayout() {
  const { isLoaded, isSignedIn, getToken } = useAuth();

  // Attach the Clerk bearer token to every generated API client request.
  useEffect(() => {
    setAuthTokenGetter(() => getToken());
  }, [getToken]);

  if (!isLoaded) return <FullScreenLoader />;
  if (!isSignedIn) return <Redirect href="/sign-in" />;

  return (
    <CurrentUserProvider>
      <Gate />
    </CurrentUserProvider>
  );
}

function Gate() {
  const colors = useColors();
  const { signOut } = useAuth();
  const { user, isLoading, error, refetch } = useCurrentUser();

  if (isLoading) return <FullScreenLoader label="Loading your workspace…" />;
  if (error || !user) {
    return (
      <ErrorState
        title="Couldn't load your account"
        message="Check your connection and try again."
        onRetry={refetch}
        onSignOut={() => signOut()}
      />
    );
  }

  if (user.role === "technician" && user.betaAccess === false) {
    return <BetaPaused />;
  }

  if (user.companyId == null) {
    return <Onboarding onDone={refetch} />;
  }

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen name="(tabs)" />
      <Stack.Screen
        name="new-inspection"
        options={{ presentation: "fullScreenModal", animation: "slide_from_bottom" }}
      />
      <Stack.Screen name="inspection/[id]" />
      <Stack.Screen name="report/[id]" />
      <Stack.Screen name="about" />
    </Stack>
  );
}
