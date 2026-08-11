import { useAuth, useSignUp } from "@clerk/expo";
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

const OFFLINE_MESSAGE = "No internet connection — check your signal and try again.";

function isNetworkError(err: unknown): boolean {
  if (!err) return false;
  const msg = (err as { message?: string }).message ?? String(err);
  return /network|fetch|failed to fetch|no internet|offline|econnrefused|etimedout/i.test(msg);
}

export default function SignUpScreen() {
  const colors = useColors();
  const { signUp, errors, fetchStatus } = useSignUp();
  const { isSignedIn } = useAuth();
  const router = useRouter();
  const network = useNetworkStatus();

  const [emailAddress, setEmailAddress] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
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
      const { error } = await signUp.password({ emailAddress, password });
      if (error) {
        setFormError(clerkErrorMessage(error));
        return;
      }
      await signUp.verifications.sendEmailCode();
    } catch (err) {
      setFormError(isNetworkError(err) ? OFFLINE_MESSAGE : "Something went wrong. Please try again.");
    }
  };

  const handleVerify = async () => {
    if (isOffline) {
      setFormError(OFFLINE_MESSAGE);
      return;
    }
    setFormError(null);
    try {
      await signUp.verifications.verifyEmailCode({ code });
      if (signUp.status === "complete") {
        await signUp.finalize({
          navigate: ({ session, decorateUrl }) => {
            if (session?.currentTask) return;
            router.replace(decorateUrl("/") as Href);
          },
        });
      } else {
        setFormError(
          errors?.fields?.code?.message || "That code didn't work. Please try again.",
        );
      }
    } catch (err) {
      setFormError(isNetworkError(err) ? OFFLINE_MESSAGE : "Something went wrong. Please try again.");
    }
  };

  const handleResendCode = async () => {
    if (isOffline) {
      setFormError(OFFLINE_MESSAGE);
      return;
    }
    setFormError(null);
    try {
      await signUp.verifications.sendEmailCode();
    } catch (err) {
      setFormError(isNetworkError(err) ? OFFLINE_MESSAGE : "Something went wrong. Please try again.");
    }
  };

  if (signUp.status === "complete" || isSignedIn) {
    return null;
  }

  const needsCode =
    signUp.status === "missing_requirements" &&
    signUp.unverifiedFields.includes("email_address") &&
    signUp.missingFields.length === 0;

  if (needsCode) {
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
                color: colors.foreground,
                fontFamily: "Inter_600SemiBold",
                fontSize: 20,
              }}
            >
              Verify your email
            </Text>
            <Text
              style={{
                color: colors.mutedForeground,
                fontFamily: "Inter_400Regular",
                textAlign: "center",
              }}
            >
              We sent a code to {emailAddress}. Enter it below to finish setting up your account.
            </Text>
          </View>

          <View style={{ gap: 16 }}>
            <TextField
              label="Verification code"
              keyboardType="number-pad"
              placeholder="123456"
              value={code}
              onChangeText={setCode}
            />
            {(formError || errors?.fields?.code) && (
              <Text style={{ color: colors.destructive, fontSize: 14 }}>
                {formError || errors?.fields?.code?.message}
              </Text>
            )}
            <Button
              title="Verify & continue"
              size="lg"
              onPress={handleVerify}
              loading={submitting}
              disabled={isOffline || !code}
            />
            <Button
              title="Resend code"
              variant="ghost"
              onPress={handleResendCode}
              disabled={isOffline}
            />
          </View>
        </ScrollView>
      </Screen>
    );
  }

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
            Create your technician account.
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
            placeholder="Create a password"
            value={password}
            onChangeText={setPassword}
          />

          {(formError || errors?.fields?.emailAddress || errors?.fields?.password) && (
            <Text style={{ color: colors.destructive, fontSize: 14 }}>
              {formError ||
                errors?.fields?.emailAddress?.message ||
                errors?.fields?.password?.message}
            </Text>
          )}

          <Button
            title="Sign up"
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

        <GoogleAuthButton label="Sign up with Google" onError={setFormError} />

        <View style={{ flexDirection: "row", justifyContent: "center", gap: 6 }}>
          <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular" }}>
            Already have an account?
          </Text>
          <Link href="/sign-in" replace>
            <Text style={{ color: colors.primary, fontFamily: "Inter_600SemiBold" }}>Sign in</Text>
          </Link>
        </View>

        {/* Required for sign-up flows. Clerk's bot sign-up protection is enabled by default */}
        <View nativeID="clerk-captcha" />
      </ScrollView>
    </Screen>
  );
}
