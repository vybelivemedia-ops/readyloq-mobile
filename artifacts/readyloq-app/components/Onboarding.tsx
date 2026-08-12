import { useAuth } from "@clerk/expo";
import { useSignOut } from "@/hooks/useSignOut";
import React, { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import { Logo } from "@/components/brand/Logo";
import { Button } from "@/components/ui/Button";
import { Screen } from "@/components/ui/Screen";
import { TextField } from "@/components/ui/TextField";
import { useColors } from "@/hooks/useColors";
import { acceptInvite, ApiError, createCompany } from "@/lib/api";
import { isSubmitBlocked } from "@/lib/gate/offline-flow";

type Mode = "create" | "join";

interface OnboardingProps {
  onDone: () => void;
  /**
   * When true the submit button is disabled and an inline note is shown so the
   * user knows they cannot proceed until connectivity returns.
   */
  isOffline?: boolean;
  /**
   * When true the form shows a prominent "You're offline" banner instead of the
   * normal helper text. Used when the auto-create already failed due to a
   * network error — the user does not need to do anything; the app will retry
   * automatically once connectivity returns.
   */
  showOfflineBanner?: boolean;
}

export function Onboarding({ onDone, isOffline = false, showOfflineBanner = false }: OnboardingProps) {
  const colors = useColors();
  const { getToken } = useAuth();
  const signOut = useSignOut();

  const [mode, setMode] = useState<Mode>("create");
  const [companyName, setCompanyName] = useState("");
  const [inviteToken, setInviteToken] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (isSubmitBlocked(isOffline)) return; // guard — button should already be disabled
    setError(null);
    setSubmitting(true);
    try {
      const token = await getToken();
      if (mode === "create") {
        if (!companyName.trim()) throw new Error("Enter a company name.");
        await createCompany(token, companyName.trim());
      } else {
        if (!inviteToken.trim()) throw new Error("Enter your invite code.");
        await acceptInvite(token, inviteToken.trim());
      }
      onDone();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const Segment = ({ value, label }: { value: Mode; label: string }) => {
    const active = mode === value;
    return (
      <Pressable
        onPress={() => setMode(value)}
        style={{
          flex: 1,
          paddingVertical: 12,
          borderRadius: colors.radius - 2,
          backgroundColor: active ? colors.primary : "transparent",
          alignItems: "center",
        }}
      >
        <Text
          style={{
            color: active ? colors.primaryForeground : colors.mutedForeground,
            fontFamily: "Inter_600SemiBold",
            fontSize: 14,
          }}
        >
          {label}
        </Text>
      </Pressable>
    );
  };

  return (
    <Screen edges={["top", "bottom"]}>
      <ScrollView
        contentContainerStyle={{ flexGrow: 1, padding: 24, justifyContent: "center", gap: 24 }}
        keyboardShouldPersistTaps="handled"
      >
        <View style={{ alignItems: "center", gap: 12 }}>
          <Logo size={30} />
          <Text
            style={{
              color: colors.foreground,
              fontFamily: "Inter_700Bold",
              fontSize: 22,
              textAlign: "center",
            }}
          >
            Set up your workspace
          </Text>
          {showOfflineBanner ? (
            // Auto-create already failed due to a network error. The app will
            // retry automatically — no action needed from the user.
            <View
              style={{
                backgroundColor: colors.muted,
                borderRadius: colors.radius,
                borderWidth: 1,
                borderColor: colors.border,
                paddingHorizontal: 16,
                paddingVertical: 12,
                width: "100%",
              }}
            >
              <Text
                style={{
                  color: colors.foreground,
                  fontFamily: "Inter_600SemiBold",
                  fontSize: 14,
                  textAlign: "center",
                  lineHeight: 20,
                }}
              >
                You're offline — your workspace will be set up automatically once you're connected.
              </Text>
            </View>
          ) : (
            <Text
              style={{
                color: colors.mutedForeground,
                fontFamily: "Inter_400Regular",
                fontSize: 15,
                textAlign: "center",
                lineHeight: 21,
              }}
            >
              Create a new company or join an existing one with an invite code from your manager.
            </Text>
          )}
        </View>

        <View
          style={{
            flexDirection: "row",
            backgroundColor: colors.muted,
            borderRadius: colors.radius,
            padding: 4,
            borderWidth: 1,
            borderColor: colors.border,
          }}
        >
          <Segment value="create" label="Create company" />
          <Segment value="join" label="Join with code" />
        </View>

        {mode === "create" ? (
          <TextField
            label="Company name"
            placeholder="Acme Pest Control"
            value={companyName}
            onChangeText={setCompanyName}
            autoCapitalize="words"
          />
        ) : (
          <TextField
            label="Invite code"
            placeholder="Paste your invite code"
            value={inviteToken}
            onChangeText={setInviteToken}
            autoCapitalize="none"
          />
        )}

        {error ? (
          <Text style={{ color: colors.destructive, fontSize: 14, textAlign: "center" }}>
            {error}
          </Text>
        ) : null}

        <Button
          title={mode === "create" ? "Create company" : "Join company"}
          size="lg"
          onPress={submit}
          loading={submitting}
          disabled={isSubmitBlocked(isOffline) || submitting}
        />

        {isOffline ? (
          <Text
            style={{
              color: colors.mutedForeground,
              fontFamily: "Inter_400Regular",
              fontSize: 13,
              textAlign: "center",
            }}
          >
            You're offline. Connect to the internet to continue.
          </Text>
        ) : null}

        <Button title="Sign out" variant="ghost" onPress={() => signOut()} />
      </ScrollView>
    </Screen>
  );
}
