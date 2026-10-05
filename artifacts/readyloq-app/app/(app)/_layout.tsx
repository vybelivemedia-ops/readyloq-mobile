import { useAuth, useUser } from "@clerk/expo";
import {
  getGetMissionControlMeQueryKey,
  setAuthTokenGetter as setGeneratedAuthTokenGetter,
  useGetMissionControlMe,
} from "@workspace/api-client-react";
import { setAuthTokenGetter } from "@/lib/api-client";
import { useQueryClient } from "@tanstack/react-query";
import { Redirect, Stack, usePathname, useRouter } from "expo-router";
import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Alert, AppState, Platform, Text, View } from "react-native";
import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import { registerPushToken } from "@/lib/api";

// ── Foreground notification handler ────────────────────────────────────────────
// Without this, Expo does not present incoming notifications while the app is
// foregrounded. Set it at module scope so it is registered before any push
// arrives, regardless of which screen the user is on.
// shouldShowAlert is deprecated in expo-notifications v0.32.x (SDK 54) —
// use shouldShowBanner and shouldShowList instead.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

import { BetaPaused } from "@/components/BetaPaused";
import { Onboarding } from "@/components/Onboarding";
import { ErrorState } from "@/components/ui/ErrorState";
import { FullScreenLoader } from "@/components/ui/Loader";
import { useColors } from "@/hooks/useColors";
import { CurrentUserProvider, useCurrentUser } from "@/hooks/useCurrentUser";
import {
  decideNativeRoute,
  missionControlAccessForGate,
} from "@/lib/gate/mission-control-routing";
import {
  deleteLocalInspection,
  listLocalInspections,
} from "@/lib/local/inspection-store";
import { useSignOut } from "@/hooks/useSignOut";
import { configureSyncEngine, deactivateSyncEngine } from "@/lib/sync/engine";
import {
  cacheTokenForBackground,
  clearCachedBackgroundToken,
  registerBackgroundSync,
  unregisterBackgroundSync,
} from "@/lib/sync/background-task";
// Side-effect import — ensures TaskManager.defineTask runs at module init so
// the OS can replay the task after relaunching the app in the background.
import "@/lib/sync/background-task";
import { speechService } from "@/lib/vision";
import { createCompany } from "@/lib/api";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";
import {
  isNetworkError,
  shouldRetryAutoCreate,
  shouldShowOfflineBanner,
} from "@/lib/gate/offline-flow";

export default function AppLayout() {
  const { isLoaded, isSignedIn, userId, getToken } = useAuth();
  const queryClient = useQueryClient();
  const previousUserId = useRef<string | null | undefined>(undefined);

  // Attach the Clerk bearer token to every generated API client request.
  useEffect(() => {
    setAuthTokenGetter(() => getToken());
    setGeneratedAuthTokenGetter(() => getToken());
  }, [getToken]);

  // The platform directory is cross-company data. Evict it whenever Clerk
  // signs out or switches identities, including sign-out paths outside our
  // centralized hook.
  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn || previousUserId.current !== userId) {
      queryClient.removeQueries({
        predicate: (query) =>
          query.queryKey.some(
            (part) =>
              typeof part === "string" &&
              part.startsWith("/api/mission-control/"),
          ),
      });
    }
    previousUserId.current = isSignedIn ? userId : null;
  }, [isLoaded, isSignedIn, userId, queryClient]);

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
  const queryClient = useQueryClient();
  const [activeLocalScopeKey, setActiveLocalScopeKey] = useState<string | null>(null);
  const signOut = useSignOut();
  const { user, isLoading, isServerVerified, error, refetch } = useCurrentUser();
  const { getToken, isSignedIn, userId } = useAuth();
  const { user: clerkUser } = useUser();
  const pathname = usePathname();
  const companyScopeReady =
    !!isSignedIn &&
    !!userId &&
    isServerVerified &&
    !isLoading &&
    !error &&
    !!user &&
    user.clerkUserId === userId;
  const targetLocalScopeKey = companyScopeReady && user && userId
    ? `${userId}:company:${user.companyId === null ? "none" : user.companyId}`
    : null;

  // The server profile's companyId is the active tenant source (Clerk subject
  // alone is insufficient for users who move between companies). A null
  // companyId is an explicit scope, including Super Admin's platform context.
  useLayoutEffect(() => {
    if (!companyScopeReady || !userId || !user) {
      deactivateSyncEngine();
      void unregisterBackgroundSync();
      void clearCachedBackgroundToken();
      return;
    }

    const companyId = user.companyId;
    const scopeKey = `${userId}:company:${companyId === null ? "none" : companyId}`;
    let effectIsCurrent = true;
    const getTokenWithCache = async () => {
      const token = await getToken();
      if (token && effectIsCurrent) {
        await cacheTokenForBackground(token, userId, companyId);
      }
      return token;
    };

    configureSyncEngine({
      getToken: getTokenWithCache,
      ownerId: userId,
      companyId,
      onSynced: () => {
        void queryClient.invalidateQueries();
      },
    });
    setActiveLocalScopeKey(scopeKey);
    // Seed the owner+company-bound credential even if the pending inspection
    // has no photos (the sync engine otherwise may not request this token).
    void getTokenWithCache().catch((e: unknown) => {
      console.warn("[BackgroundSync] token cache refresh failed:", e);
    });
    void registerBackgroundSync();

    return () => {
      effectIsCurrent = false;
      setActiveLocalScopeKey(null);
      deactivateSyncEngine();
      void unregisterBackgroundSync();
      void clearCachedBackgroundToken();
    };
  }, [
    companyScopeReady,
    user?.clerkUserId,
    user?.companyId,
    userId,
    getToken,
    queryClient,
  ]);
  const missionControl = useGetMissionControlMe({
    query: {
      // Include the active Clerk subject so cached authorization from a
      // previous account can never satisfy this account's launch check.
      queryKey: [...getGetMissionControlMeQueryKey(), userId],
      enabled: !!isSignedIn,
      staleTime: 0,
      refetchOnMount: "always",
      refetchOnReconnect: true,
      refetchOnWindowFocus: false,
      retry: false,
    },
  });
  const [foregroundCheckPending, setForegroundCheckPending] = useState(false);
  const promptedResume = useRef(false);
  const { isConnected, isInternetReachable } = useNetworkStatus();
  const online = isConnected && isInternetReachable !== false;
  const inMissionControl = pathname.startsWith("/mission-control");
  const missionControlAccess = missionControlAccessForGate({
    foregroundCheckPending,
    isFetching: missionControl.isFetching,
    isError: missionControl.isError,
    error: missionControl.error,
    isSuccess: missionControl.isSuccess,
    isSuperAdmin: missionControl.data?.isSuperAdmin,
  });
  const isNonAdmin =
    missionControlAccess === "non-admin" &&
    !missionControl.isFetching &&
    !foregroundCheckPending;
  const routeDecision = decideNativeRoute({
    access: missionControlAccess,
    inMissionControl,
    hasCompany: user?.companyId != null,
  });

  // Native apps don't get browser focus events. Recheck server authorization
  // each time the app returns to the foreground, and hide platform screens
  // while the check is in flight.
  useEffect(() => {
    let mounted = true;
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active" || !isSignedIn) return;
      setForegroundCheckPending(true);
      // Revalidate the current tenant as well as platform authorization. A
      // same-subject company change must revoke the previous local scope. Keep
      // the last verified scope for warm offline resumes; a cold start still
      // requires validation because its in-memory validation was lost.
      if (online) refetch();
      void missionControl.refetch().finally(() => {
        if (mounted) setForegroundCheckPending(false);
      });
    });
    return () => {
      mounted = false;
      subscription.remove();
    };
  }, [isSignedIn, missionControl.refetch, online, refetch]);

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
    if (!isServerVerified || !user || user.companyId != null || !isNonAdmin) return;
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
  }, [isServerVerified, user, clerkUser, autoCreateFailed, isNonAdmin]);

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
    if (!isServerVerified) return;

    // Case 2: profile loaded but auto-create failed due to a network error.
    if (
      shouldRetryAutoCreate({
        wasOffline,
        online,
        autoCreateNetworkError,
        hasDerivedName: !!derivedNameRef.current,
        autoCreating,
      })
    ) {
      autoCreateAttempted.current = false;
      runAutoCreate(derivedNameRef.current);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online, isServerVerified]);

  // Resume prompt: if the app was killed mid-inspection, the draft survives
  // in local storage. Offer to pick up exactly where the technician left off.
  const ready =
    isServerVerified &&
    activeLocalScopeKey === targetLocalScopeKey &&
    !isLoading &&
    !error &&
    !!user &&
    user.companyId != null;

  // Warm up the speech model as soon as the workspace loads — well before any
  // inspection starts. The ~75 MB ggml-tiny model is downloaded once and cached
  // on device. Fires silently in the background; never blocks the UI.
  useEffect(() => {
    if (!ready) return;
    speechService.initialize().catch((e: unknown) => {
      console.warn("[SpeechService] Background warm-up failed:", e);
    });
  }, [ready]);

  // ── Push token registration (owners and technicians) ────────────────────────
  // Request permission and register the Expo push token so the server can
  // deliver notifications: critical-risk alerts to owners and route-update
  // alerts to technicians. Runs once after the workspace is fully ready and
  // the user has a role that receives push notifications. Silently no-ops on
  // failure — notifications are a best-effort feature and must never block the UI.
  useEffect(() => {
    const notifiableRoles = ["owner", "technician"];
    if (!ready || !user?.role || !notifiableRoles.includes(user.role)) return;
    if (!Device.isDevice) return; // push not available on simulators

    void (async () => {
      try {
        // Set up notification channels for Android (required for Android 8+).
        if (Platform.OS === "android") {
          await Notifications.setNotificationChannelAsync("critical-alerts", {
            name: "Critical Risk Alerts",
            importance: Notifications.AndroidImportance.MAX,
            vibrationPattern: [0, 250, 250, 250],
            lightColor: "#ef4444",
          });
          await Notifications.setNotificationChannelAsync("route-updates", {
            name: "Route Updates",
            importance: Notifications.AndroidImportance.HIGH,
            vibrationPattern: [0, 150, 100, 150],
            lightColor: "#3b82f6",
          });
        }

        // NotificationPermissionsStatus extends PermissionResponse from
        // expo-modules-core, so `granted` is present in the type in v0.32.x.
        const existingPerm = await Notifications.getPermissionsAsync();
        if (!existingPerm.granted) {
          const requested = await Notifications.requestPermissionsAsync();
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
  if (!isServerVerified) {
    return <FullScreenLoader label="Confirming your workspace…" />;
  }
  if (activeLocalScopeKey !== targetLocalScopeKey) {
    return <FullScreenLoader label="Preparing your workspace…" />;
  }

  // A platform link is only renderable after a successful, current server
  // response. Mount a dedicated stack for Super Admins before any company
  // onboarding or tenant-company gate; cached flags never grant access.
  if (routeDecision === "wait") {
    return <FullScreenLoader label="Verifying platform access…" />;
  }
  if (routeDecision === "access-error") {
    return (
      <ErrorState
        title="Couldn't verify platform access"
        message="Connect to the internet and try again. Platform tools stay locked until access is confirmed."
        onRetry={() => { void missionControl.refetch(); }}
        onSignOut={() => { void signOut(); }}
      />
    );
  }
  if (routeDecision === "redirect-platform") {
    return <Redirect href="/mission-control" />;
  }
  if (routeDecision === "redirect-tenant") {
    return <Redirect href="/(app)/(tabs)" />;
  }
  if (routeDecision === "platform-stack") {
    return (
      <Stack
        key={`${userId}:company:${user.companyId === null ? "none" : user.companyId}`}
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.background },
        }}
      >
        <Stack.Screen name="mission-control" />
      </Stack>
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
        showOfflineBanner={shouldShowOfflineBanner(autoCreateNetworkError, online)}
      />
    );
  }

  return (
    <Stack
      key={`${userId}:company:${user.companyId === null ? "none" : user.companyId}`}
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
      <Stack.Screen name="executive-velocity-inspections" />
      <Stack.Screen name="executive-week-inspections" />
      <Stack.Screen name="reports-detail" />
    </Stack>
  );
}
