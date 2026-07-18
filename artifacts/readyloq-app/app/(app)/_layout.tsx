import { useAuth } from "@clerk/expo";
import { setAuthTokenGetter } from "@/lib/api-client";
import { useQueryClient } from "@tanstack/react-query";
import { Redirect, Stack, useRouter } from "expo-router";
import React, { useEffect, useRef } from "react";
import { Alert } from "react-native";

import { BetaPaused } from "@/components/BetaPaused";
import { Onboarding } from "@/components/Onboarding";
import { ErrorState } from "@/components/ui/ErrorState";
import { FullScreenLoader } from "@/components/ui/Loader";
import { useColors } from "@/hooks/useColors";
import { CurrentUserProvider, useCurrentUser } from "@/hooks/useCurrentUser";
import {
  deleteLocalInspection,
  listLocalInspections,
} from "@/lib/local/inspection-store";
import { configureSyncEngine } from "@/lib/sync/engine";
import { speechService } from "@/lib/vision";

export default function AppLayout() {
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const queryClient = useQueryClient();

  // Attach the Clerk bearer token to every generated API client request.
  useEffect(() => {
    setAuthTokenGetter(() => getToken());
  }, [getToken]);

  // Start the offline-first sync engine once authenticated. It pushes any
  // pending local inspections (from this or previous app sessions) and keeps
  // server queries fresh after each successful sync.
  useEffect(() => {
    if (!isSignedIn) return;
    configureSyncEngine({
      getToken: () => getToken(),
      onSynced: () => {
        void queryClient.invalidateQueries();
      },
    });
  }, [isSignedIn, getToken, queryClient]);

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
  const router = useRouter();
  const { signOut } = useAuth();
  const { user, isLoading, error, refetch } = useCurrentUser();
  const promptedResume = useRef(false);

  // Resume prompt: if the app was killed mid-inspection, the draft survives
  // in local storage. Offer to pick up exactly where the technician left off.
  const ready = !isLoading && !error && !!user && user.companyId != null;

  // Warm up the speech model as soon as the workspace loads — well before any
  // inspection starts. The ~75 MB ggml-tiny model is downloaded once and cached
  // on device. Fires silently in the background; never blocks the UI.
  useEffect(() => {
    if (!ready) return;
    speechService.initialize().catch((e: unknown) => {
      console.warn("[SpeechService] Background warm-up failed:", e);
    });
  }, [ready]);

  useEffect(() => {
    if (!ready || promptedResume.current) return;
    promptedResume.current = true;
    void (async () => {
      const records = await listLocalInspections();
      const draft = records.find((r) => !r.completed);
      if (!draft) return;
      const label = draft.siteAddress.trim() || "Untitled inspection";
      Alert.alert(
        "Resume inspection?",
        `You have an unfinished inspection at "${label}" with ${draft.photos.length} photo${
          draft.photos.length === 1 ? "" : "s"
        }.`,
        [
          {
            text: "Discard",
            style: "destructive",
            onPress: () => {
              Alert.alert(
                "Discard inspection?",
                "Photos and details for this draft will be permanently deleted from this device.",
                [
                  { text: "Keep it", style: "cancel" },
                  {
                    text: "Discard",
                    style: "destructive",
                    onPress: () => void deleteLocalInspection(draft.localId),
                  },
                ],
              );
            },
          },
          { text: "Later", style: "cancel" },
          {
            text: "Resume",
            onPress: () =>
              router.push(`/new-inspection?resume=${draft.localId}` as never),
          },
        ],
      );
    })();
  }, [ready, router]);

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
      <Stack.Screen name="inspection-summary/[localId]" />
      <Stack.Screen name="inspection/[id]" />
      <Stack.Screen name="report/[id]" />
      <Stack.Screen name="about" />
    </Stack>
  );
}
