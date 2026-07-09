import { useSSO } from "@clerk/expo";
import * as AuthSession from "expo-auth-session";
import { type Href, useRouter } from "expo-router";
import * as WebBrowser from "expo-web-browser";
import React, { useCallback, useEffect, useState } from "react";
import { Platform } from "react-native";

import { Button } from "@/components/ui/Button";
import { clerkErrorMessage } from "@/lib/clerkErrors";

// Handle any pending authentication sessions
WebBrowser.maybeCompleteAuthSession();

export function GoogleAuthButton({
  label = "Continue with Google",
  onError,
}: {
  label?: string;
  onError?: (message: string) => void;
}) {
  // Preload the browser on Android to reduce auth load time
  useEffect(() => {
    if (Platform.OS !== "android") return;
    void WebBrowser.warmUpAsync();
    return () => {
      void WebBrowser.coolDownAsync();
    };
  }, []);

  const { startSSOFlow } = useSSO();
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  const onPress = useCallback(async () => {
    try {
      setLoading(true);
      const { createdSessionId, setActive, signUp } = await startSSOFlow({
        strategy: "oauth_google",
        // In a standalone (release) build the redirect must carry the app's
        // custom scheme explicitly — a bare makeRedirectUri() produces a
        // scheme-only URI that Android can hand to the wrong app (e.g. an
        // email client) instead of returning here.
        redirectUrl: AuthSession.makeRedirectUri({
          scheme: "readyloq-app",
          path: "sso-callback",
        }),
      });

      if (createdSessionId && setActive) {
        await setActive({
          session: createdSessionId,
          navigate: async ({ session, decorateUrl }) => {
            if (session?.currentTask) return;
            router.replace(decorateUrl("/") as Href);
          },
        });
      } else if (signUp?.status === "missing_requirements") {
        onError?.(
          "Your Google account needs additional information to finish signing up. Please sign up with email and password instead.",
        );
      } else {
        onError?.("Google sign-in didn't complete. Please try again.");
      }
    } catch (err) {
      onError?.(clerkErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [startSSOFlow, router, onError]);

  return (
    <Button
      title={label}
      variant="outline"
      icon="logo-google"
      onPress={onPress}
      loading={loading}
    />
  );
}
