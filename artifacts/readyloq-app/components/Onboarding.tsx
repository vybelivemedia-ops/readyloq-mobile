import { useAuth } from "@clerk/expo";
import React, { useState } from "react";
import { Pressable, ScrollView, Text, View } from "react-native";

import { Logo } from "@/components/brand/Logo";
import { Button } from "@/components/ui/Button";
import { Screen } from "@/components/ui/Screen";
import { TextField } from "@/components/ui/TextField";
import { useColors } from "@/hooks/useColors";
import { acceptInvite, ApiError, createCompany } from "@/lib/api";

type Mode = "create" | "join";

export function Onboarding({ onDone }: { onDone: () => void }) {
  const colors = useColors();
  const { getToken, signOut } = useAuth();

  const [mode, setMode] = useState<Mode>("create");
  const [companyName, setCompanyName] = useState("");
  const [inviteToken, setInviteToken] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
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
        />

        <Button title="Sign out" variant="ghost" onPress={() => signOut()} />
      </ScrollView>
    </Screen>
  );
}
