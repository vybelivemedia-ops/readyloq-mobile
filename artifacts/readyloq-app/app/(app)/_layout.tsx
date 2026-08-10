import { useAuth, useUser } from "@clerk/expo";
import { setAuthTokenGetter } from "@/lib/api-client";
import { useQueryClient } from "@tanstack/react-query";
import { Redirect, Stack, useRouter } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import { Alert, Platform, Text, View } from "react-native";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { registerPushToken } from "@/lib/api";

// ── Foreground notification handler ────────────────────────────────────────────
// Without this, Expo does not present incoming notifications while the app is
// foregrounded. Set it at module scope so it is registered before any push
// arrives, regardless of which screen the user is on.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

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
import { useSignOut } from "@/hooks/useSignOut";
import { configureSyncEngine } from "@/lib/sync/engine";
import { speechService } from "@/lib/vision";
import { createCompany } from "@/lib/api";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";

/** Returns true when the thrown value looks like a network/connectivity failure. */
function isNetworkError(e: unknown): boolean {
  if (e instanceof TypeError) return true;
  const msg = e instanceof Error ? e.message.toLowerCase() : "";
  return (
    msg.includes("network") ||
    msg.includes("fetch") ||
    msg.includes("offline") ||
    msg.includes("econnrefused") ||
    msg.includes("timeout") ||
    msg.includes("socket")
  );
}

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
  const signOut = useSignOut();
  const { user, isLoading, error, refetch } = useCurrentUser();
  const { getToken } = useAuth();
  const { user: clerkUser } = useUser();
  const promptedResume = useRef(false);
  const { isConnected, isInternetReachable } = useNetworkStatus();
  const online = isConnected && isInternetReachable !== false;

  // ── Auto-create company on first login ──────────────────────────────────
  // When a new user has no company yet, silently derive a company name from
  // their Clerk profile and create it. Blocks rendering with a loading screen
  // so the user never sees the manual Onboarding form unless the auto-create
  // fails (in which case the form is shown as a graceful fallback).
  const [autoCreating, setAutoCreating] = useState(false);
  const [autoCreateFailed, setAutoCreateFailed] = useState(false);
  // When the failure was caused by a network error we can retry automatically.
  const [autoCreateNetworkError, setAutoCreateNetworkError] = useState(false);
  const autoCreateAttempted = useRef(false);

  // Core auto-create logic, extracted so it can be called both on mount and
  // on reconnection.
  const runAutoCreate = (derivedName: string) => {
    autoCreateAttempted.current = true;
    setAutoCreating(true);
    void (async () => {
      try {
        const token = await getToken();
        await createCompany(token, derivedName);
        setAutoCreateFailed(false);
        setAutoCreateNetworkError(false);
        await refetch();
      } catch (e) {
        setAutoCreateFailed(true);
        setAutoCreateNetworkError(isNetworkError(e));
      } finally {
        setAutoCreating(false);
      }
    })();
  };

  // Derive the company name from the Clerk profile once.
  const derivedNameRef = useRef<string>("");

  useEffect(() => {
    if (!user || user.companyId != null) return;
    if (autoCreateAttempted.current || autoCreateFailed) return;
    if (!clerkUser) return;

    const nameParts = [clerkUser.firstName, clerkUser.lastName].filter(Boolean);
    const derived =
      nameParts.length > 0
        ? `${nameParts.join(" ")} Pest Control`
        : (() => {
            const email = clerkUser.primaryEmailAddress?.emailAddress ?? "";
            const prefix = email.split("@")[0] ?? "";
            return prefix ? `${prefix} Pest Control` : "";
          })();

    if (!derived) {
      // No usable name — fall through to the manual Onboarding form.
      setAutoCreateFailed(true);
      return;
    }

    derivedNameRef.current = derived;
    runAutoCreate(derived);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, clerkUser, autoCreateFailed]);

  // ── Retry on reconnection (profile load + auto-create) ──────────────────
  // Fires once on every offline→online transition. Handles two blocked paths:
  //
  //   1. Profile load failed (error set, no user) — call refetch() so Gate
  //      can exit the error state without requiring the user to tap Retry.
  //      Once the profile returns with companyId === null the auto-create
  //      effect fires naturally.
  //
  //   2. Auto-create failed with a network error after the profile loaded —
  //      retry runAutoCreate directly.
  const prevOnlineRef = useRef(online);
  useEffect(() => {
    const wasOffline = !prevOnlineRef.current;
    prevOnlineRef.current = online;

    if (!online) return;
    if (!wasOffline) return; // only fire on the offline→online transition

    // Case 1: profile fetch failed while offline.
    if ((error || !user) && !isLoading) {
      refetch();
      return;
    }

    // Case 2: profile loaded but auto-create failed due to a network error.
    if (autoCreateNetworkError && derivedNameRef.current && !autoCreating) {
      autoCreateAttempted.current = false;
      runAutoCreate(derivedNameRef.current);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online]);

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

  // ── Push token registration (owners only) ───────────────────────────────────
  // Request permission and register the Expo push token so the server can
  // deliver critical-risk inspection alerts. Runs once after the workspace
  // is fully ready and the user is an owner. Silently no-ops on failure —
  // notifications are a best-effort feature and must never block the UI.
  useEffect(() => {
    if (!ready || user?.role !== "owner") return;
    if (!Device.isDevice) return; // push not available on simulators

    void (async () => {
      try {
        // Set up a notification channel for Android (required for Android 8+).
        if (Platform.OS === "android") {
          await Notifications.setNotificationChannelAsync("critical-alerts", {
            name: "Critical Risk Alerts",
            importance: Notifications.AndroidImportance.MAX,
            vibrationPattern: [0, 250, 250, 250],
            lightColor: "#ef4444",
          });
        }

        // expo-notifications v57 types omit `granted` from the top-level
        // NotificationPermissionsStatus but it IS present at runtime (inherited
        // from PermissionResponse in expo). Cast through unknown to satisfy TS.
        type GrantedResult = { granted: boolean };
        const existingPerm = (await Notifications.getPermissionsAsync()) as unknown as GrantedResult;
        if (!existingPerm.granted) {
          const requested = (await Notifications.requestPermissionsAsync()) as unknown as GrantedResult;
          if (!requested.granted) return; // user denied — silently skip
        }

        const tokenData = await Notifications.getExpoPushTokenAsync({
          projectId: "7927cf86-2cbd-4c14-9bd5-d43f2beabec8",
        });
        const token = await getToken();
        await registerPushToken(token, tokenData.data);
      } catch (e: unknown) {
        console.warn("[PushToken] Registration failed:", e);
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, user?.role]);

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
    // Brand-new user (no local cache) who launched while offline: the profile
    // fetch failed because there is no network, not because of a server error.
    // Show a friendly waiting screen; the reconnect effect above will call
    // refetch() automatically once connectivity returns.
    if (!online) {
      return (
        <View
          style={{
            flex: 1,
            alignItems: "center",
            justifyContent: "center",
            padding: 32,
            gap: 12,
            backgroundColor: colors.background,
          }}
        >
          <Text
            style={{
              color: colors.foreground,
              fontFamily: "Inter_700Bold",
              fontSize: 18,
              textAlign: "center",
            }}
          >
            You're offline
          </Text>
          <Text
            style={{
              color: colors.mutedForeground,
              fontFamily: "Inter_400Regular",
              fontSize: 15,
              textAlign: "center",
              lineHeight: 22,
            }}
          >
            Your workspace will load automatically once you're connected.
          </Text>
        </View>
      );
    }
    // Online but the fetch still failed — server error or other non-network
    // issue. Let the user retry manually.
    return (
      <ErrorState
        title="Couldn't load your account"
        message="Check your connection and try again."
        onRetry={refetch}
        onSignOut={() => { void signOut(); }}
      />
    );
  }

  if (user.role === "technician" && user.betaAccess === false) {
    return <BetaPaused />;
  }

  if (user.companyId == null) {
    if (autoCreating) return <FullScreenLoader label="Setting up your workspace…" />;
    // Auto-create failed or user has no derivable name — show the manual form.
    // Pass along whether we're offline and whether the failure was network-related
    // so Onboarding can show the right message and disable submit when appropriate.
    return (
      <Onboarding
        onDone={refetch}
        isOffline={!online}
        showOfflineBanner={autoCreateNetworkError && !online}
      />
    );
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
      <Stack.Screen name="settings" />
      <Stack.Screen name="admin" />
      <Stack.Screen name="billing" options={{ presentation: "modal" }} />
      <Stack.Screen name="dataset" />
      <Stack.Screen name="executive-dashboard" />
      <Stack.Screen name="executive-risk-inspections" />
      <Stack.Screen name="reports-detail" />
    </Stack>
  );
}
