/**
 * Connected Accounts screen — OAuth platform connections manager.
 *
 * Shows each platform card (YouTube, Facebook, Instagram, Twitch) with:
 *   - Connection status (connected / disconnected / refresh needed / expired)
 *   - Account name + avatar when connected
 *   - Connect / Disconnect / Re-auth buttons
 *
 * OAuth flow: calls /api/oauth/:platform/init → opens browser → deep link back.
 */

import { Feather } from "@expo/vector-icons";
import * as WebBrowser from "expo-web-browser";
import { router } from "expo-router";
import { useFocusEffect } from "expo-router/build/useFocusEffect";
import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/contexts/AuthContext";

const API_BASE = process.env["EXPO_PUBLIC_DOMAIN"]
  ? `https://${process.env["EXPO_PUBLIC_DOMAIN"]}/api`
  : "https://getvybe.live/api";

WebBrowser.maybeCompleteAuthSession();

// ─── Platform metadata ────────────────────────────────────────────────────────

type Platform_t = "youtube" | "facebook" | "instagram" | "twitch";

const PLATFORM_META: Record<Platform_t, { label: string; icon: string; color: string; description: string }> = {
  youtube:   { label: "YouTube",   icon: "▶",  color: "#FF0000", description: "Live stream to YouTube. Auto-creates broadcast." },
  facebook:  { label: "Facebook",  icon: "f",  color: "#1877F2", description: "Go live on Facebook Page or personal profile." },
  instagram: { label: "Instagram", icon: "◎",  color: "#E1306C", description: "Go live + publish clips. Needs a Professional account linked to a Page." },
  twitch:    { label: "Twitch",    icon: "⚡", color: "#9146FF", description: "Stream to your Twitch channel using your stream key." },
};

type ConnectionStatus = "connected" | "refresh_needed" | "expired" | "error" | "disconnected" | "not_connected";

interface OAuthConnection {
  id: string;
  platform: Platform_t;
  accountName?: string | null;
  profileImageUrl?: string | null;
  status: ConnectionStatus;
  errorMessage?: string | null;
  tokenExpiresAt?: string | null;
}

// ─── API helpers ──────────────────────────────────────────────────────────────

async function fetchConnections(accessToken: string): Promise<OAuthConnection[]> {
  const res = await fetch(`${API_BASE}/oauth/connections`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error("Failed to fetch connections");
  return res.json() as Promise<OAuthConnection[]>;
}

async function getOAuthInitUrl(accessToken: string, platform: Platform_t): Promise<string> {
  const res = await fetch(`${API_BASE}/oauth/${platform}/init`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Unknown error" })) as { error?: string };
    throw new Error(err.error ?? "Failed to initialize OAuth");
  }
  const data = await res.json() as { url: string };
  return data.url;
}

async function confirmOAuthConnection(
  accessToken: string,
  platform: Platform_t,
  confirmToken: string,
): Promise<void> {
  const res = await fetch(`${API_BASE}/oauth/${platform}/confirm`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ confirmToken }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Failed to activate connection" })) as { error?: string };
    throw new Error(err.error ?? "Failed to activate connection");
  }
}

async function disconnectPlatform(accessToken: string, platform: Platform_t): Promise<void> {
  const res = await fetch(`${API_BASE}/oauth/${platform}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error("Failed to disconnect");
}

// ─── Platform card ────────────────────────────────────────────────────────────

interface PlatformCardProps {
  platform: Platform_t;
  connection: OAuthConnection | null;
  onConnect: () => void;
  onDisconnect: () => void;
  connecting: boolean;
  colors: ReturnType<typeof useColors>;
}

function PlatformCard({ platform, connection, onConnect, onDisconnect, connecting, colors }: PlatformCardProps) {
  const meta = PLATFORM_META[platform];
  const isConnected = connection?.status === "connected";
  const needsReauth = connection?.status === "refresh_needed" || connection?.status === "expired";

  const statusColor = isConnected ? "#39FF14" : needsReauth ? "#FFD700" : colors.mutedForeground;
  const statusLabel = isConnected ? "Connected" : needsReauth ? "Re-auth needed" : connection?.status === "error" ? "Error" : "Not connected";

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      {/* Platform header */}
      <View style={styles.cardHeader}>
        <View style={[styles.platformIcon, { backgroundColor: `${meta.color}20`, borderColor: `${meta.color}40` }]}>
          <Text style={[styles.platformIconText, { color: meta.color }]}>{meta.icon}</Text>
        </View>
        <View style={styles.platformInfo}>
          <Text style={[styles.platformLabel, { color: colors.foreground }]}>{meta.label}</Text>
          <View style={styles.statusRow}>
            <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
            <Text style={[styles.statusText, { color: statusColor }]}>{statusLabel}</Text>
          </View>
        </View>
        {connecting ? (
          <ActivityIndicator size="small" color={colors.primary} />
        ) : isConnected ? (
          <TouchableOpacity onPress={onDisconnect} style={[styles.actionBtn, { borderColor: colors.border }]}>
            <Text style={[styles.actionBtnText, { color: colors.mutedForeground }]}>Disconnect</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity onPress={onConnect} style={[styles.actionBtn, { borderColor: meta.color, backgroundColor: `${meta.color}15` }]}>
            <Text style={[styles.actionBtnText, { color: meta.color }]}>{needsReauth ? "Re-auth" : "Connect"}</Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Connected account info */}
      {isConnected && connection?.accountName && (
        <View style={[styles.accountRow, { borderTopColor: colors.border }]}>
          {connection.profileImageUrl ? (
            <Image source={{ uri: connection.profileImageUrl }} style={styles.accountAvatar} />
          ) : (
            <View style={[styles.accountAvatarFallback, { backgroundColor: `${meta.color}20` }]}>
              <Text style={{ color: meta.color, fontSize: 12 }}>{connection.accountName[0]?.toUpperCase()}</Text>
            </View>
          )}
          <Text style={[styles.accountName, { color: colors.foreground }]}>{connection.accountName}</Text>
          <Feather name="check-circle" size={14} color="#39FF14" />
        </View>
      )}

      {/* Error message */}
      {connection?.errorMessage && (
        <Text style={[styles.errorText, { color: "#FF3B6C" }]}>{connection.errorMessage}</Text>
      )}

      {/* Description */}
      <Text style={[styles.cardDesc, { color: colors.mutedForeground }]}>{meta.description}</Text>
    </View>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function ConnectedAccountsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { accessToken, getValidToken } = useAuth();
  const topPad = Platform.OS === "web" ? 67 : insets.top;

  const [connections, setConnections] = useState<OAuthConnection[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [connecting, setConnecting] = useState<Platform_t | null>(null);

  const platforms: Platform_t[] = ["youtube", "facebook", "instagram", "twitch"];

  const loadConnections = useCallback(async () => {
    if (!accessToken) return;
    setIsLoading(true);
    try {
      const token = await getValidToken();
      if (!token) return;
      const data = await fetchConnections(token);
      setConnections(data);
    } catch {
      // Silent — will show empty state
    } finally {
      setIsLoading(false);
    }
  }, [accessToken, getValidToken]);

  useFocusEffect(useCallback(() => {
    void loadConnections();
  }, [loadConnections]));

  const handleConnect = async (platform: Platform_t) => {
    if (!accessToken) return;
    setConnecting(platform);
    try {
      const token = await getValidToken();
      if (!token) return;
      const authUrl = await getOAuthInitUrl(token, platform);

      // Race openAuthSessionAsync (reliable on iOS via ASWebAuthenticationSession)
      // against a Linking event listener (required on Android where Chrome Custom
      // Tabs closes and dispatches the mobile:// redirect as a separate intent
      // that arrives AFTER openAuthSessionAsync resolves with "dismiss").
      // [OAUTH_DEBUG] Temporary instrumented race — remove after diagnosis.
      const redirectUrl = await new Promise<string | null>((resolve) => {
        let settled = false;
        let dismissTimer: ReturnType<typeof setTimeout> | null = null;
        const t0 = Date.now();
        const ts = () => `+${Date.now() - t0}ms`;

        const settle = (url: string | null, source: string) => {
          if (settled) {
            console.log(`[OAUTH_DEBUG] ${ts()} settle() from [${source}] ignored — already settled`);
            return;
          }
          settled = true;
          if (dismissTimer) { clearTimeout(dismissTimer); dismissTimer = null; }
          console.log(`[OAUTH_DEBUG] ${ts()} settle() FIRING from [${source}] url=${url ? "present" : "null"}`);
          sub.remove();
          resolve(url);
        };

        console.log(`[OAUTH_DEBUG] ${ts()} Registering Linking listener`);
        const sub = Linking.addEventListener("url", ({ url }) => {
          console.log(`[OAUTH_DEBUG] ${ts()} Linking URL received: ${url.substring(0, 80)}`);
          if (url.startsWith("mobile://oauth-complete")) {
            if (dismissTimer) {
              console.log(`[OAUTH_DEBUG] ${ts()} Cancelling dismiss timeout — Linking won the race`);
              clearTimeout(dismissTimer);
              dismissTimer = null;
            }
            settle(url, "Linking");
          }
        });

        console.log(`[OAUTH_DEBUG] ${ts()} Calling openAuthSessionAsync`);
        WebBrowser.openAuthSessionAsync(authUrl, "mobile://oauth-complete")
          .then((r) => {
            console.log(`[OAUTH_DEBUG] ${ts()} openAuthSessionAsync resolved: type=${r.type}`);
            if (r.type === "success") {
              settle(r.url, "openAuthSessionAsync(success)");
            } else if (r.type === "dismiss") {
              // Conservative fix: do NOT settle(null) yet. On Android the
              // mobile:// Linking event is dispatched shortly AFTER the tab
              // closes; give it a 500ms grace window before giving up.
              console.log(`[OAUTH_DEBUG] ${ts()} dismiss received — starting 500ms grace window for Linking`);
              dismissTimer = setTimeout(() => {
                console.log(`[OAUTH_DEBUG] ${ts()} grace window elapsed — no Linking URL, settling null`);
                dismissTimer = null;
                settle(null, "dismiss-timeout");
              }, 500);
            } else {
              settle(null, `openAuthSessionAsync(${r.type})`);
            }
          })
          .catch((e: unknown) => {
            console.log(`[OAUTH_DEBUG] ${ts()} openAuthSessionAsync threw: ${String(e)}`);
            settle(null, "openAuthSessionAsync(error)");
          });
      });

      console.log(`[OAUTH_DEBUG] Race resolved. redirectUrl=${redirectUrl ? "present" : "null"}`);

      if (redirectUrl) {
        const params = new URLSearchParams(redirectUrl.split("?")[1] ?? "");
        if (params.get("success") === "true") {
          const confirmToken = params.get("confirmToken");
          console.log(`[OAUTH_DEBUG] success=true confirmToken=${confirmToken ? "present (" + confirmToken.length + " chars)" : "MISSING"}`);
          if (!confirmToken) {
            Alert.alert("Connection failed", "Missing confirmation token — please try again.");
          } else {
            console.log(`[OAUTH_DEBUG] Calling confirmOAuthConnection`);
            const freshToken = await getValidToken();
            if (!freshToken) throw new Error("Session expired");
            await confirmOAuthConnection(freshToken, platform, confirmToken);
            console.log(`[OAUTH_DEBUG] confirmOAuthConnection completed — calling loadConnections`);
            await loadConnections();
          }
        } else {
          const errMsg = params.get("error") ?? "Authorization was denied";
          console.log(`[OAUTH_DEBUG] success=false error=${errMsg}`);
          Alert.alert("Connection failed", decodeURIComponent(errMsg));
        }
      } else {
        console.log(`[OAUTH_DEBUG] redirectUrl is null — confirm will NOT be called`);
      }
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes("not configured")) {
        Alert.alert(
          "Not available yet",
          `${PLATFORM_META[platform].label} OAuth credentials haven't been configured yet. Check back after closed beta setup.`
        );
      } else {
        Alert.alert("Connection failed", msg);
      }
    } finally {
      setConnecting(null);
    }
  };

  const handleDisconnect = (platform: Platform_t) => {
    Alert.alert(
      `Disconnect ${PLATFORM_META[platform].label}?`,
      "You'll no longer stream to this platform. You can reconnect at any time.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Disconnect",
          style: "destructive",
          onPress: async () => {
            if (!accessToken) return;
            try {
              const token = await getValidToken();
              if (!token) return;
              await disconnectPlatform(token, platform);
              await loadConnections();
            } catch {
              Alert.alert("Error", "Failed to disconnect. Please try again.");
            }
          },
        },
      ]
    );
  };

  const getConnection = (platform: Platform_t): OAuthConnection | null =>
    connections.find((c) => c.platform === platform) ?? null;

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: topPad + 16, paddingBottom: 40 }]}
        showsVerticalScrollIndicator={false}
      >
        {/* Header */}
        <View style={styles.topBar}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Feather name="arrow-left" size={22} color={colors.foreground} />
          </TouchableOpacity>
          <Text style={[styles.title, { color: colors.foreground }]}>Connected Accounts</Text>
          <View style={{ width: 40 }} />
        </View>

        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
          Connect your streaming accounts to multistream automatically when you go live.
        </Text>

        {isLoading ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        ) : (
          <View style={styles.cards}>
            {platforms.map((platform) => (
              <PlatformCard
                key={platform}
                platform={platform}
                connection={getConnection(platform)}
                onConnect={() => void handleConnect(platform)}
                onDisconnect={() => handleDisconnect(platform)}
                connecting={connecting === platform}
                colors={colors}
              />
            ))}
          </View>
        )}

        {/* Info banner */}
        <View style={[styles.infoBanner, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Feather name="shield" size={14} color={colors.primary} />
          <Text style={[styles.infoText, { color: colors.mutedForeground }]}>
            Your platform credentials are encrypted at rest and never shared. VYBE LIVE only requests the minimum permissions needed to stream.
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: 16, gap: 16 },
  topBar: {
    flexDirection: "row", alignItems: "center",
    justifyContent: "space-between", marginBottom: 4,
  },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 18, fontFamily: "Inter_700Bold" },
  subtitle: { fontSize: 14, fontFamily: "Inter_400Regular", lineHeight: 20, marginTop: -4 },
  loadingWrap: { height: 200, alignItems: "center", justifyContent: "center" },
  cards: { gap: 12 },
  card: {
    borderRadius: 18, borderWidth: 1, padding: 16, gap: 10,
  },
  cardHeader: { flexDirection: "row", alignItems: "center", gap: 12 },
  platformIcon: {
    width: 44, height: 44, borderRadius: 14,
    alignItems: "center", justifyContent: "center", borderWidth: 1,
  },
  platformIconText: { fontSize: 18, fontFamily: "Inter_700Bold" },
  platformInfo: { flex: 1, gap: 3 },
  platformLabel: { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  statusRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { fontSize: 12, fontFamily: "Inter_500Medium" },
  actionBtn: {
    paddingHorizontal: 14, paddingVertical: 7,
    borderRadius: 10, borderWidth: 1,
  },
  actionBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  accountRow: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth,
  },
  accountAvatar: { width: 24, height: 24, borderRadius: 12 },
  accountAvatarFallback: {
    width: 24, height: 24, borderRadius: 12,
    alignItems: "center", justifyContent: "center",
  },
  accountName: { flex: 1, fontSize: 13, fontFamily: "Inter_500Medium" },
  errorText: { fontSize: 12, fontFamily: "Inter_400Regular" },
  cardDesc: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 17 },
  infoBanner: {
    flexDirection: "row", gap: 10, padding: 14,
    borderRadius: 14, borderWidth: 1, alignItems: "flex-start",
  },
  infoText: { flex: 1, fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 18 },
});
