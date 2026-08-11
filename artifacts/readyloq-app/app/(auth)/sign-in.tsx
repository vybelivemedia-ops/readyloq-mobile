import { useSignIn } from "@clerk/expo";
import { type Href, Link, useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import { ScrollView, Text, View } from "react-native";

import { GoogleAuthButton } from "@/components/auth/GoogleAuthButton";
import { Logo } from "@/components/brand/Logo";
import { Button } from "@/components/ui/Button";
import { OfflineBanner } from "@/components/ui/OfflineBanner";
import { Screen } from "@/components/ui/Screen";
import { TextField } from "@/components/ui/TextField";
import { useColors } from "@/hooks/useColors";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";
import { clerkErrorMessage } from "@/lib/clerkErrors";
import { isNetworkError, OFFLINE_MESSAGE } from "@/lib/auth/networkError";

export default function SignInScreen() {
  const colors = useColors();
  const { signIn, errors, fetchStatus } = useSignIn();
  const router = useRouter();
  const network = useNetworkStatus();

  const [emailAddress, setEmailAddress] = useState("");
  const [password, setPassword] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  const submitting = fetchStatus === "fetching";
  const isOffline = !network.isConnected || network.isInternetReachable === false;

  // Clear the offline-specific error automatically once connectivity is restored
  useEffect(() => {
    if (!isOffline && formError === OFFLINE_MESSAGE) {
      setFormError(null);
    }
  }, [isOffline, formError]);

  const handleSubmit = async () => {
    if (isOffline) {
      setFormError(OFFLINE_MESSAGE);
      return;
    }
    setFormError(null);
    try {
      const { error } = await signIn.password({ emailAddress, password });
      if (error) {
        setFormError(clerkErrorMessage(error));
        return;
      }

      if (signIn.status === "complete") {
        await signIn.finalize({
          navigate: ({ session, decorateUrl }) => {
            if (session?.currentTask) return;
            router.replace(decorateUrl("/") as Href);
          },
        });
      } else {
        setFormError("Additional verification is required. Please contact your administrator.");
      }
    } catch (err) {
      setFormError(isNetworkError(err) ? OFFLINE_MESSAGE : "Something went wrong. Please try again.");
    }
  };

  return (
    <Screen edges={["top", "bottom"]}>
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, padding: 24, justifyContent: "center", gap: 24 }}
        keyboardShouldPersistTaps="handled"
      >
        <OfflineBanner isOffline={isOffline} message={OFFLINE_MESSAGE} />

        <View style={{ alignItems: "center", gap: 12 }}>
          <Logo size={32} />
          <Text
            style={{
              color: colors.mutedForeground,
              fontFamily: "Inter_400Regular",
              fontSize: 15,
              textAlign: "center",
            }}
          >
            AI-powered pest inspections, in the field.
          </Text>
        </View>

        <View style={{ gap: 16 }}>
          <TextField
            label="Email address"
            autoCapitalize="none"
            autoComplete="email"
            keyboardType="email-address"
            placeholder="you@company.com"
            value={emailAddress}
            onChangeText={setEmailAddress}
          />
          <TextField
            label="Password"
            secureTextEntry
            placeholder="Enter password"
            value={password}
            onChangeText={setPassword}
          />

          {(formError || errors?.fields?.identifier || errors?.fields?.password) && (
            <Text style={{ color: colors.destructive, fontSize: 14, fontFamily: "Inter_400Regular" }}>
              {formError ||
                errors?.fields?.identifier?.message ||
                errors?.fields?.password?.message}
            </Text>
          )}

          <Button
            title="Sign in"
            size="lg"
            onPress={handleSubmit}
            loading={submitting}
            disabled={isOffline || !emailAddress || !password}
          />
        </View>

        <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
          <View style={{ flex: 1, height: 1, backgroundColor: colors.border }} />
          <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>or</Text>
          <View style={{ flex: 1, height: 1, backgroundColor: colors.border }} />
        </View>

        <GoogleAuthButton onError={setFormError} />

        <View style={{ flexDirection: "row", justifyContent: "center", gap: 6 }}>
          <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular" }}>
            Don&apos;t have an account?
          </Text>
          <Link href="/sign-up" replace>
            <Text style={{ color: colors.primary, fontFamily: "Inter_600SemiBold" }}>Sign up</Text>
          </Link>
        </View>
      </ScrollView>
    </Screen>
  );
}
