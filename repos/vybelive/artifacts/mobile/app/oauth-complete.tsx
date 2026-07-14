/**
 * OAuth deep-link safety-net route.
 *
 * Handles mobile://oauth-complete?success=...&platform=...&confirmToken=...
 * when Android dispatches the redirect as a bare OS intent rather than letting
 * the Chrome Custom Tab / ASWebAuthenticationSession intercept it in-process.
 *
 * Flow:
 *   1. Expo Router navigates here instead of showing +not-found.
 *   2. We read search params, call POST /api/oauth/:platform/confirm with the
 *      user's bearer token, show a brief status, then replace to /settings/platforms.
 *
 * The confirm endpoint is idempotent on the "already used" path — if
 * openAuthSessionAsync already claimed the confirmToken first, the server
 * returns 400 "Invalid or expired confirmToken", which we treat as a silent
 * success (connection was already committed by the in-process handler).
 */

import { router, useLocalSearchParams } from "expo-router";
import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { useAuth } from "@/contexts/AuthContext";
import { useColors } from "@/hooks/useColors";

const API_BASE = process.env["EXPO_PUBLIC_DOMAIN"]
  ? `https://${process.env["EXPO_PUBLIC_DOMAIN"]}/api`
  : "https://getvybe.live/api";

type Status = "processing" | "success" | "error";

export default function OAuthCompleteScreen() {
  const colors = useColors();
  const { getValidToken, isLoading: authLoading } = useAuth();
  const params = useLocalSearchParams<{
    success?: string;
    platform?: string;
    confirmToken?: string;
    error?: string;
    accountName?: string;
  }>();

  const [status, setStatus] = useState<Status>("processing");
  const [message, setMessage] = useState("Connecting account…");
  const ran = useRef(false);

  useEffect(() => {
    if (authLoading) return;
    if (ran.current) return;
    ran.current = true;

    async function run() {
      const { success, platform, confirmToken, error: oauthError, accountName } = params;

      if (!success) {
        router.replace("/settings/platforms");
        return;
      }

      if (success !== "true") {
        const msg = oauthError ? decodeURIComponent(oauthError) : "Authorization was denied";
        setStatus("error");
        setMessage(msg);
        setTimeout(() => router.replace("/settings/platforms"), 2000);
        return;
      }

      if (!confirmToken || !platform) {
        setStatus("error");
        setMessage("Missing connection data — please try again.");
        setTimeout(() => router.replace("/settings/platforms"), 2000);
        return;
      }

      try {
        const token = await getValidToken();
        if (!token) {
          setStatus("error");
          setMessage("Session expired — please log in again.");
          setTimeout(() => router.replace("/(auth)/login"), 2000);
          return;
        }

        const res = await fetch(`${API_BASE}/oauth/${platform}/confirm`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ confirmToken }),
        });

        if (res.ok) {
          const name = accountName ? decodeURIComponent(accountName) : "";
          setStatus("success");
          setMessage(name ? `Connected as ${name}` : "Account connected!");
        } else {
          const data = await res.json().catch(() => ({ error: "Connection failed" })) as { error?: string };
          const serverMsg = data.error ?? "Connection failed";
          if (serverMsg.includes("Invalid or expired confirmToken")) {
            setStatus("success");
            setMessage("Account connected!");
          } else {
            setStatus("error");
            setMessage(serverMsg);
          }
        }
      } catch (err) {
        setStatus("error");
        setMessage((err as Error).message ?? "Connection failed");
      }

      setTimeout(() => router.replace("/settings/platforms"), 1500);
    }

    void run();
  }, [authLoading, getValidToken, params]);

  const iconColor = status === "success" ? "#39FF14" : status === "error" ? "#FF3B6C" : colors.primary;
  const icon = status === "success" ? "✓" : status === "error" ? "✕" : null;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
        {icon ? (
          <View style={[styles.iconCircle, { backgroundColor: iconColor + "20", borderColor: iconColor + "40" }]}>
            <Text style={[styles.iconText, { color: iconColor }]}>{icon}</Text>
          </View>
        ) : (
          <ActivityIndicator size="large" color={colors.primary} style={styles.spinner} />
        )}
        <Text style={[styles.message, { color: colors.foreground }]}>{message}</Text>
        {status === "processing" && (
          <Text style={[styles.sub, { color: colors.mutedForeground }]}>
            Finishing up…
          </Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
  },
  card: {
    width: "100%",
    maxWidth: 320,
    borderRadius: 20,
    borderWidth: 1,
    padding: 32,
    alignItems: "center",
    gap: 16,
  },
  spinner: {
    marginBottom: 4,
  },
  iconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  iconText: {
    fontSize: 26,
    fontFamily: "Inter_700Bold",
  },
  message: {
    fontSize: 16,
    fontFamily: "Inter_600SemiBold",
    textAlign: "center",
  },
  sub: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
  },
});
