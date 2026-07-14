/**
 * Onboarding screen — shown after registration.
 *
 * Step 1: Feature intro slides (4 cards, swipeable)
 * Step 2: Connect your platforms (OAuth) — optional, can skip
 *
 * After completing both steps → marks onboarding as done → navigates to /(tabs).
 */

import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import * as WebBrowser from "expo-web-browser";
import { router } from "expo-router";
import React, { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Linking,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { GlowButton } from "@/components/ui/GlowButton";
import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/contexts/AuthContext";

const API_BASE = process.env["EXPO_PUBLIC_DOMAIN"]
  ? `https://${process.env["EXPO_PUBLIC_DOMAIN"]}/api`
  : "https://getvybe.live/api";

WebBrowser.maybeCompleteAuthSession();

// ─── Intro slides ─────────────────────────────────────────────────────────────

const INTRO_SLIDES = [
  {
    icon: "radio" as const,
    title: "POV Streaming",
    description: "Connect your Meta smart glasses, GoPro, or any wearable camera. Tap once — stream everywhere.",
    accent: "#FF3B6C",
  },
  {
    icon: "share-2" as const,
    title: "Multistream Instantly",
    description: "Go live on YouTube, Twitch, Facebook, and Instagram simultaneously with zero delay.",
    accent: "#7B61FF",
  },
  {
    icon: "zap" as const,
    title: "AI Clips on Autopilot",
    description: "Your best moments become vertical clips automatically. Voice-triggered or AI-detected highlights.",
    accent: "#00D4FF",
  },
  {
    icon: "bar-chart-2" as const,
    title: "Unified Analytics",
    description: "See all your stats in one place. Views, followers, watch time — across every platform.",
    accent: "#39FF14",
  },
];

// ─── Platform connect step ────────────────────────────────────────────────────

type OAuthPlatform_t = "youtube" | "facebook" | "instagram" | "twitch";

const CONNECT_PLATFORMS: Array<{ id: OAuthPlatform_t; label: string; icon: string; color: string }> = [
  { id: "youtube",   label: "YouTube",   icon: "▶",  color: "#FF0000" },
  { id: "twitch",    label: "Twitch",    icon: "⚡", color: "#9146FF" },
  { id: "facebook",  label: "Facebook",  icon: "f",  color: "#1877F2" },
  { id: "instagram", label: "Instagram", icon: "◎",  color: "#E1306C" },
];

async function getOAuthInitUrl(accessToken: string, platform: OAuthPlatform_t): Promise<string> {
  const res = await fetch(`${API_BASE}/oauth/${platform}/init`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Not configured" })) as { error?: string };
    throw new Error(err.error ?? "OAuth not configured");
  }
  const data = await res.json() as { url: string };
  return data.url;
}

async function confirmOAuthConnection(
  accessToken: string,
  platform: OAuthPlatform_t,
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

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function OnboardingScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { accessToken, getValidToken } = useAuth();

  const topPad = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  // Phase 1: intro slides, Phase 2: connect platforms
  const [phase, setPhase] = useState<"intro" | "connect">("intro");
  const [introStep, setIntroStep] = useState(0);
  const slideAnim = useRef(new Animated.Value(0)).current;

  // Platform connection state
  const [connectedPlatforms, setConnectedPlatforms] = useState<Set<OAuthPlatform_t>>(new Set());
  const [connecting, setConnecting] = useState<OAuthPlatform_t | null>(null);

  const current = INTRO_SLIDES[introStep]!;

  const goNextIntro = () => {
    if (introStep < INTRO_SLIDES.length - 1) {
      Animated.spring(slideAnim, { toValue: -width, useNativeDriver: true, tension: 80, friction: 12 }).start(() => {
        slideAnim.setValue(width);
        setIntroStep((s) => s + 1);
        Animated.spring(slideAnim, { toValue: 0, useNativeDriver: true, tension: 80, friction: 12 }).start();
      });
    } else {
      setPhase("connect");
    }
  };

  const finish = () => router.replace("/(tabs)");

  const handleConnect = useCallback(async (platform: OAuthPlatform_t) => {
    if (!accessToken) return;
    setConnecting(platform);
    try {
      const token = await getValidToken();
      if (!token) return;
      const authUrl = await getOAuthInitUrl(token, platform);

      // Race openAuthSessionAsync (reliable on iOS via ASWebAuthenticationSession)
      // against a Linking event listener (required on Android where Chrome Custom
      // Tabs doesn't always intercept custom-scheme redirects back to the promise).
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
          if (confirmToken) {
            console.log(`[OAUTH_DEBUG] Calling confirmOAuthConnection (token present, ${confirmToken.length} chars)`);
            const freshToken = await getValidToken();
            if (!freshToken) throw new Error("Session expired");
            await confirmOAuthConnection(freshToken, platform, confirmToken);
            console.log(`[OAUTH_DEBUG] confirmOAuthConnection completed`);
          } else {
            console.log(`[OAUTH_DEBUG] confirmToken MISSING — skipping confirm`);
          }
          setConnectedPlatforms((prev) => new Set([...prev, platform]));
        } else {
          const err = params.get("error") ?? "Authorization denied";
          console.log(`[OAUTH_DEBUG] success=false error=${err}`);
          Alert.alert("Connection failed", decodeURIComponent(err));
        }
      } else {
        console.log(`[OAUTH_DEBUG] redirectUrl is null — confirm will NOT be called`);
      }
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.includes("not configured") || msg.includes("not available")) {
        Alert.alert(
          "Coming soon",
          `${CONNECT_PLATFORMS.find((p) => p.id === platform)?.label ?? platform} OAuth will be enabled before open beta. You can connect at any time from Settings.`
        );
      } else {
        Alert.alert("Error", msg);
      }
    } finally {
      setConnecting(null);
    }
  }, [accessToken, getValidToken]);

  // ── Phase 1: Intro slides ──────────────────────────────────────────────────
  if (phase === "intro") {
    return (
      <View style={[styles.container, { backgroundColor: colors.background }]}>
        <TouchableOpacity onPress={finish} style={[styles.skip, { top: topPad + 12 }]}>
          <Text style={[styles.skipText, { color: colors.mutedForeground }]}>Skip</Text>
        </TouchableOpacity>

        <Animated.View style={[styles.stepContent, { transform: [{ translateX: slideAnim }] }]}>
          <LinearGradient colors={[`${current.accent}25`, "transparent"]} style={styles.glow} />
          <View style={[styles.iconContainer, { backgroundColor: `${current.accent}20`, borderColor: `${current.accent}50` }]}>
            <Feather name={current.icon} size={48} color={current.accent} />
          </View>
          <Text style={[styles.stepTitle, { color: colors.foreground }]}>{current.title}</Text>
          <Text style={[styles.stepDesc, { color: colors.secondaryForeground }]}>{current.description}</Text>
        </Animated.View>

        <View style={styles.dots}>
          {INTRO_SLIDES.map((_, i) => (
            <View
              key={i}
              style={[styles.dot, {
                backgroundColor: i === introStep ? current.accent : colors.muted,
                width: i === introStep ? 24 : 8,
              }]}
            />
          ))}
        </View>

        <View style={[styles.cta, { paddingBottom: bottomPad + 24 }]}>
          <GlowButton
            title={introStep === INTRO_SLIDES.length - 1 ? "Connect Your Platforms →" : "Continue"}
            onPress={goNextIntro}
            variant={introStep === INTRO_SLIDES.length - 1 ? "live" : "primary"}
            size="lg"
            fullWidth
          />
        </View>
      </View>
    );
  }

  // ── Phase 2: Connect platforms ─────────────────────────────────────────────
  return (
    <View style={[styles.container, { backgroundColor: colors.background, paddingTop: topPad + 16 }]}>
      <View style={styles.connectHeader}>
        <Text style={[styles.connectTitle, { color: colors.foreground }]}>Connect your platforms</Text>
        <Text style={[styles.connectSub, { color: colors.mutedForeground }]}>
          Optional — connect now or later from Settings. You can go live on VYBE without connecting.
        </Text>
      </View>

      <View style={styles.platformList}>
        {CONNECT_PLATFORMS.map((p) => {
          const isConnected = connectedPlatforms.has(p.id);
          const isConnecting = connecting === p.id;
          return (
            <TouchableOpacity
              key={p.id}
              onPress={() => void handleConnect(p.id)}
              disabled={isConnected || isConnecting}
              style={[
                styles.platformRow,
                {
                  backgroundColor: colors.card,
                  borderColor: isConnected ? "#39FF14" : colors.border,
                },
              ]}
            >
              <View style={[styles.platformBadge, { backgroundColor: `${p.color}20`, borderColor: `${p.color}40` }]}>
                <Text style={{ color: p.color, fontSize: 16, fontFamily: "Inter_700Bold" }}>{p.icon}</Text>
              </View>
              <Text style={[styles.platformName, { color: colors.foreground }]}>{p.label}</Text>
              {isConnecting ? (
                <ActivityIndicator size="small" color={p.color} />
              ) : isConnected ? (
                <View style={styles.connectedBadge}>
                  <Feather name="check" size={12} color="#39FF14" />
                  <Text style={styles.connectedText}>Connected</Text>
                </View>
              ) : (
                <View style={[styles.connectBtn, { borderColor: p.color, backgroundColor: `${p.color}15` }]}>
                  <Text style={[styles.connectBtnText, { color: p.color }]}>Connect</Text>
                </View>
              )}
            </TouchableOpacity>
          );
        })}
      </View>

      <View style={[styles.bottomActions, { paddingBottom: bottomPad + 24 }]}>
        <GlowButton
          title={connectedPlatforms.size > 0 ? `Start Creating (${connectedPlatforms.size} connected)` : "Skip for now"}
          onPress={finish}
          variant={connectedPlatforms.size > 0 ? "live" : "primary"}
          size="lg"
          fullWidth
        />
        {connectedPlatforms.size === 0 && (
          <Text style={[styles.skipNote, { color: colors.mutedForeground }]}>
            You can connect platforms at any time from Settings → Connected Accounts
          </Text>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center" },
  skip: { position: "absolute", right: 24 },
  skipText: { fontSize: 15, fontFamily: "Inter_500Medium" },
  stepContent: { alignItems: "center", paddingHorizontal: 32, gap: 24 },
  glow: {
    position: "absolute", top: -80,
    width: 300, height: 300, borderRadius: 150, alignSelf: "center",
  },
  iconContainer: {
    width: 120, height: 120, borderRadius: 40,
    alignItems: "center", justifyContent: "center", borderWidth: 1,
  },
  stepTitle: { fontSize: 30, fontFamily: "Inter_700Bold", textAlign: "center", letterSpacing: -0.5 },
  stepDesc: { fontSize: 16, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 26 },
  dots: { flexDirection: "row", gap: 6, alignItems: "center", marginTop: 40 },
  dot: { height: 8, borderRadius: 4 },
  cta: { width: "100%", paddingHorizontal: 24, paddingTop: 24 },
  // ── Connect phase ───────────────────────────────────────────────────────────
  connectHeader: { alignItems: "center", paddingHorizontal: 28, gap: 8, marginBottom: 24 },
  connectTitle: { fontSize: 26, fontFamily: "Inter_700Bold", textAlign: "center", letterSpacing: -0.5 },
  connectSub: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 20 },
  platformList: { width: "100%", paddingHorizontal: 20, gap: 10 },
  platformRow: {
    flexDirection: "row", alignItems: "center", gap: 12,
    padding: 16, borderRadius: 16, borderWidth: 1,
  },
  platformBadge: {
    width: 40, height: 40, borderRadius: 12,
    alignItems: "center", justifyContent: "center", borderWidth: 1,
  },
  platformName: { flex: 1, fontSize: 15, fontFamily: "Inter_600SemiBold" },
  connectedBadge: { flexDirection: "row", alignItems: "center", gap: 4 },
  connectedText: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#39FF14" },
  connectBtn: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 10, borderWidth: 1 },
  connectBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },
  bottomActions: { width: "100%", paddingHorizontal: 24, paddingTop: 24, gap: 12 },
  skipNote: { fontSize: 12, fontFamily: "Inter_400Regular", textAlign: "center" },
});
