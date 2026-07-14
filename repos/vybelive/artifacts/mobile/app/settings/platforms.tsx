/**
 * Streaming Platforms screen — unified OAuth + manual RTMP manager.
 *
 * OAuth platforms (YouTube, Facebook, Instagram, Twitch):
 *   Connect button → browser OAuth flow → shows connected channel name + avatar.
 *   Powered by /api/oauth/:platform/init + /api/oauth/:platform (DELETE).
 *
 * Manual platforms (Kick, TikTok, Custom RTMP):
 *   RTMP URL + stream key form stored in the platforms table.
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
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQueryClient } from "@tanstack/react-query";

import { useColors } from "@/hooks/useColors";
import { useAuth } from "@/contexts/AuthContext";
import {
  useListPlatforms,
  useConnectPlatform,
  useDisconnectPlatform,
  useUpdatePlatform,
  getListPlatformsQueryKey,
} from "@workspace/api-client-react";

WebBrowser.maybeCompleteAuthSession();

const API_BASE = process.env["EXPO_PUBLIC_DOMAIN"]
  ? `https://${process.env["EXPO_PUBLIC_DOMAIN"]}/api`
  : "https://getvybe.live/api";

// ─── Platform metadata ────────────────────────────────────────────────────────

type OAuthPlatformType = "youtube" | "facebook" | "instagram" | "twitch" | "kick";
type ManualPlatformType = "tiktok" | "custom_rtmp";

const OAUTH_PLATFORMS: Array<{
  type: OAuthPlatformType;
  label: string;
  color: string;
  glyph: string;
  description: string;
}> = [
  { type: "youtube",   label: "YouTube",   color: "#FF0000", glyph: "▶",  description: "Stream to YouTube Live. Broadcast created automatically." },
  { type: "facebook",  label: "Facebook",  color: "#1877F2", glyph: "f",  description: "Go live on your Facebook Page or personal profile." },
  { type: "instagram", label: "Instagram", color: "#E1306C", glyph: "◎", description: "Go live on Instagram + publish clips. Requires a Professional account linked to a Facebook Page." },
  { type: "twitch",    label: "Twitch",    color: "#9146FF", glyph: "⚡", description: "Stream directly to your Twitch channel." },
  { type: "kick",      label: "Kick",      color: "#53FC18", glyph: "K",  description: "One-tap connect to Kick. Your stream key is fetched automatically — if it's unavailable, add it manually under Custom RTMP." },
];

const MANUAL_PLATFORMS: Array<{
  type: ManualPlatformType;
  label: string;
  color: string;
  icon: React.ComponentProps<typeof Feather>["name"];
  rtmpPlaceholder: string;
  /** Whether this platform needs an explicit RTMP/server URL (not just a key). */
  requiresRtmpUrl?: boolean;
  /** Substring the RTMP host is expected to contain; used for a soft warning. */
  expectedHostHint?: string;
  /** Numbered setup steps shown in the add form. */
  instructions?: string[];
  /** Eligibility caveat shown in amber. */
  eligibilityNote?: string;
}> = [
  {
    type: "tiktok",
    label: "TikTok",
    color: "#00F2EA",
    icon: "music",
    rtmpPlaceholder: "rtmp://push.rtmp.tiktok.com/live/",
    requiresRtmpUrl: true,
    expectedHostHint: "tiktok",
    instructions: [
      "Open TikTok LIVE Studio (desktop) or LIVE Center on mobile.",
      "Start a LIVE and pick “Stream via third-party software / RTMP”.",
      "Copy the Server URL into RTMP URL, and the Stream Key below.",
    ],
    eligibilityNote: "TikTok LIVE requires an eligible account (usually 1,000+ followers and age 18+). RTMP access only appears once your account has LIVE enabled.",
  },
  { type: "custom_rtmp", label: "Custom RTMP",  color: "#AAAAAA", icon: "wifi",  rtmpPlaceholder: "rtmp://your-server/live", requiresRtmpUrl: true },
];

// ─── OAuth API helpers ────────────────────────────────────────────────────────

interface OAuthConnection {
  id: string;
  platform: OAuthPlatformType;
  accountName?: string | null;
  profileImageUrl?: string | null;
  status: "connected" | "refresh_needed" | "expired" | "error" | "not_connected";
  errorMessage?: string | null;
  targetType?: "profile" | "page" | null;
  targetId?: string | null;
  targetName?: string | null;
}

interface FacebookTarget {
  type: "profile" | "page";
  id: string;
  name: string;
}

async function fetchOAuthConnections(token: string): Promise<OAuthConnection[]> {
  const res = await fetch(`${API_BASE}/oauth/connections`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return [];
  return res.json() as Promise<OAuthConnection[]>;
}

async function getOAuthInitUrl(token: string, platform: OAuthPlatformType): Promise<string> {
  const res = await fetch(`${API_BASE}/oauth/${platform}/init`, {
    headers: { Authorization: `Bearer ${token}` },
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
  platform: OAuthPlatformType,
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

async function revokeOAuth(token: string, platform: OAuthPlatformType): Promise<void> {
  await fetch(`${API_BASE}/oauth/${platform}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
}

async function fetchFacebookTargets(
  token: string,
): Promise<{ targets: FacebookTarget[]; selectedAvailable: boolean }> {
  const res = await fetch(`${API_BASE}/oauth/facebook/targets`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Failed to load destinations" })) as { error?: string };
    throw new Error(err.error ?? "Failed to load destinations");
  }
  const data = await res.json() as { targets: FacebookTarget[]; selectedAvailable?: boolean };
  // Older API responses omit selectedAvailable — treat as available to avoid
  // false "re-select" prompts.
  return { targets: data.targets, selectedAvailable: data.selectedAvailable ?? true };
}

async function fetchInstagramStatus(
  token: string,
): Promise<{ available: boolean }> {
  const res = await fetch(`${API_BASE}/oauth/instagram/status`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Failed to verify Instagram destination" })) as { error?: string };
    throw new Error(err.error ?? "Failed to verify Instagram destination");
  }
  const data = await res.json() as { available?: boolean };
  // Older API responses omit `available` — treat as available to avoid false
  // "reconnect" prompts.
  return { available: data.available ?? true };
}

async function setFacebookTarget(
  token: string,
  target: { targetType: "profile" | "page"; targetId?: string },
): Promise<void> {
  const res = await fetch(`${API_BASE}/oauth/facebook/target`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(target),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: "Failed to set destination" })) as { error?: string };
    throw new Error(err.error ?? "Failed to set destination");
  }
}

// ─── OAuth platform card ──────────────────────────────────────────────────────

interface OAuthCardProps {
  meta: typeof OAUTH_PLATFORMS[number];
  connection: OAuthConnection | null;
  connecting: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
  onSelectDestination?: () => void;
  targetStale?: boolean;
  colors: ReturnType<typeof useColors>;
}

function OAuthCard({ meta, connection, connecting, onConnect, onDisconnect, onSelectDestination, targetStale, colors }: OAuthCardProps) {
  const isConnected = connection?.status === "connected";
  const needsReauth = connection?.status === "refresh_needed" || connection?.status === "expired";
  const statusColor = isConnected ? "#39FF14" : needsReauth ? "#FFD700" : colors.mutedForeground;
  const statusLabel = isConnected ? "Connected" : needsReauth ? "Re-auth needed" : "Not connected";

  return (
    <View style={[styles.oauthCard, { backgroundColor: colors.card, borderColor: isConnected ? meta.color + "50" : colors.border }]}>
      <View style={styles.oauthCardHeader}>
        <View style={[styles.oauthIcon, { backgroundColor: meta.color + "20", borderColor: meta.color + "40" }]}>
          <Text style={[styles.oauthGlyph, { color: meta.color }]}>{meta.glyph}</Text>
        </View>
        <View style={styles.oauthInfo}>
          <Text style={[styles.oauthLabel, { color: colors.foreground }]}>{meta.label}</Text>
          <View style={styles.oauthStatusRow}>
            <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
            <Text style={[styles.statusText, { color: statusColor }]}>{statusLabel}</Text>
          </View>
        </View>
        {connecting ? (
          <ActivityIndicator size="small" color={colors.primary} />
        ) : isConnected ? (
          <TouchableOpacity onPress={onDisconnect} style={[styles.oauthBtn, { borderColor: colors.border }]}>
            <Text style={[styles.oauthBtnText, { color: colors.mutedForeground }]}>Disconnect</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity onPress={onConnect} style={[styles.oauthBtn, { borderColor: meta.color, backgroundColor: meta.color + "15" }]}>
            <Text style={[styles.oauthBtnText, { color: meta.color }]}>{needsReauth ? "Re-auth" : "Connect"}</Text>
          </TouchableOpacity>
        )}
      </View>

      {isConnected && connection?.accountName ? (
        <View style={[styles.accountRow, { borderTopColor: colors.border }]}>
          {connection.profileImageUrl ? (
            <Image source={{ uri: connection.profileImageUrl }} style={styles.accountAvatar} />
          ) : (
            <View style={[styles.accountAvatarFallback, { backgroundColor: meta.color + "25" }]}>
              <Text style={{ color: meta.color, fontSize: 11, fontFamily: "Inter_600SemiBold" }}>
                {connection.accountName[0]?.toUpperCase()}
              </Text>
            </View>
          )}
          <Text style={[styles.accountName, { color: colors.foreground }]}>{connection.accountName}</Text>
          <Feather name="check-circle" size={14} color="#39FF14" />
        </View>
      ) : null}

      {isConnected && meta.type === "facebook" && onSelectDestination ? (
        <TouchableOpacity
          onPress={onSelectDestination}
          style={[styles.destinationRow, {
            borderColor: targetStale ? "#FFD700" : colors.border,
            backgroundColor: targetStale ? "#FFD70015" : colors.input,
          }]}
        >
          <Feather name={targetStale ? "alert-triangle" : "radio"} size={14} color={targetStale ? "#FFD700" : meta.color} />
          <View style={styles.destinationInfo}>
            <Text style={[styles.destinationLabel, { color: targetStale ? "#FFD700" : colors.mutedForeground }]}>
              {targetStale ? "DESTINATION UNAVAILABLE" : "LIVE DESTINATION"}
            </Text>
            {targetStale ? (
              <Text style={[styles.destinationValue, { color: colors.foreground }]} numberOfLines={2}>
                {connection.targetName ? `"${connection.targetName}" is no longer available — tap to re-select` : "Tap to re-select a destination"}
              </Text>
            ) : (
              <Text style={[styles.destinationValue, { color: colors.foreground }]} numberOfLines={1}>
                {connection.targetName ?? "Personal Timeline"}
                {connection.targetType === "page" ? "  ·  Page" : "  ·  Profile"}
              </Text>
            )}
          </View>
          <Feather name="chevron-right" size={16} color={targetStale ? "#FFD700" : colors.mutedForeground} />
        </TouchableOpacity>
      ) : null}

      {isConnected && meta.type === "instagram" && targetStale ? (
        <TouchableOpacity
          onPress={onConnect}
          style={[styles.destinationRow, { borderColor: "#FFD700", backgroundColor: "#FFD70015" }]}
        >
          <Feather name="alert-triangle" size={14} color="#FFD700" />
          <View style={styles.destinationInfo}>
            <Text style={[styles.destinationLabel, { color: "#FFD700" }]}>DESTINATION UNAVAILABLE</Text>
            <Text style={[styles.destinationValue, { color: colors.foreground }]} numberOfLines={2}>
              Your linked Instagram Professional account is no longer available — tap to reconnect
            </Text>
          </View>
          <Feather name="chevron-right" size={16} color="#FFD700" />
        </TouchableOpacity>
      ) : null}

      {connection?.errorMessage ? (
        <Text style={[styles.errorText, { color: "#FF3B6C" }]}>{connection.errorMessage}</Text>
      ) : null}

      <Text style={[styles.oauthDesc, { color: colors.mutedForeground }]}>{meta.description}</Text>
    </View>
  );
}

// ─── Manual RTMP card ─────────────────────────────────────────────────────────

interface ManualCardProps {
  meta: typeof MANUAL_PLATFORMS[number];
  existingPlatform: { id: string; name: string; rtmpUrl?: string | null; isActive: boolean } | null;
  onAdd: (rtmpUrl: string, streamKey: string) => Promise<void>;
  onRemove: (id: string, name: string) => void;
  onToggleActive: (id: string, current: boolean) => void;
  adding: boolean;
  colors: ReturnType<typeof useColors>;
}

function ManualCard({ meta, existingPlatform, onAdd, onRemove, onToggleActive, adding, colors }: ManualCardProps) {
  const [expanded, setExpanded] = useState(false);
  const [rtmpUrl, setRtmpUrl] = useState("");
  const [streamKey, setStreamKey] = useState("");

  const requiresUrl = meta.requiresRtmpUrl ?? false;

  const handleAdd = async () => {
    const url = rtmpUrl.trim();
    const key = streamKey.trim();

    if (requiresUrl && !url) {
      Alert.alert("RTMP URL required", `Enter the ${meta.label} server / RTMP URL to connect.`);
      return;
    }
    if (url && !/^rtmps?:\/\//i.test(url)) {
      Alert.alert("Invalid RTMP URL", "The URL should start with rtmp:// or rtmps://.");
      return;
    }
    if (!key) {
      Alert.alert("Stream key required", `Enter your ${meta.label} stream key to connect.`);
      return;
    }
    // Soft host check: warn (but allow override) when the URL doesn't look like
    // the platform's expected ingest host — catches pasted-from-wrong-place keys.
    if (meta.expectedHostHint && url && !url.toLowerCase().includes(meta.expectedHostHint)) {
      const proceed = await new Promise<boolean>((resolve) => {
        Alert.alert(
          "Double-check the RTMP URL",
          `This doesn't look like a ${meta.label} server URL (expected it to contain "${meta.expectedHostHint}"). Use it anyway?`,
          [
            { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
            { text: "Use anyway", onPress: () => resolve(true) },
          ],
        );
      });
      if (!proceed) return;
    }

    await onAdd(url, key);
    setExpanded(false);
    setRtmpUrl("");
    setStreamKey("");
  };

  return (
    <View style={[styles.manualCard, { backgroundColor: colors.card, borderColor: existingPlatform ? meta.color + "50" : colors.border }]}>
      <View style={styles.manualCardRow}>
        <View style={[styles.manualIcon, { backgroundColor: meta.color + "20" }]}>
          <Feather name={meta.icon} size={18} color={meta.color} />
        </View>
        <View style={styles.manualInfo}>
          <Text style={[styles.manualLabel, { color: colors.foreground }]}>{meta.label}</Text>
          {existingPlatform ? (
            <View style={styles.oauthStatusRow}>
              <View style={[styles.statusDot, { backgroundColor: "#39FF14" }]} />
              <Text style={[styles.statusText, { color: "#39FF14" }]}>Stream key saved</Text>
            </View>
          ) : (
            <Text style={[styles.statusText, { color: colors.mutedForeground }]}>Not connected</Text>
          )}
        </View>
        {existingPlatform ? (
          <View style={styles.manualActions}>
            <TouchableOpacity
              onPress={() => onToggleActive(existingPlatform.id, existingPlatform.isActive)}
              style={[styles.togglePill, { backgroundColor: existingPlatform.isActive ? meta.color + "20" : colors.muted }]}
            >
              <Text style={[styles.toggleText, { color: existingPlatform.isActive ? meta.color : colors.mutedForeground }]}>
                {existingPlatform.isActive ? "On" : "Off"}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => onRemove(existingPlatform.id, meta.label)}>
              <Feather name="trash-2" size={15} color={colors.destructive} />
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity
            onPress={() => setExpanded((v) => !v)}
            style={[styles.oauthBtn, { borderColor: meta.color, backgroundColor: meta.color + "15" }]}
          >
            <Text style={[styles.oauthBtnText, { color: meta.color }]}>{expanded ? "Cancel" : "Add"}</Text>
          </TouchableOpacity>
        )}
      </View>

      {expanded && !existingPlatform && (
        <View style={[styles.rtmpForm, { borderTopColor: colors.border }]}>
          {meta.instructions ? (
            <View style={styles.instructionsBlock}>
              {meta.instructions.map((step, i) => (
                <Text key={i} style={[styles.rtmpNote, { color: colors.mutedForeground }]}>
                  {i + 1}. {step}
                </Text>
              ))}
              {meta.eligibilityNote ? (
                <Text style={[styles.eligibilityNote, { color: "#FFD700" }]}>{meta.eligibilityNote}</Text>
              ) : null}
            </View>
          ) : meta.type !== "custom_rtmp" ? (
            <Text style={[styles.rtmpNote, { color: colors.mutedForeground }]}>
              Find your stream key in {meta.label} → Settings → Stream.
            </Text>
          ) : null}
          {requiresUrl && (
            <View style={styles.formField}>
              <Text style={[styles.formLabel, { color: colors.mutedForeground }]}>RTMP URL</Text>
              <TextInput
                style={[styles.formInput, { color: colors.foreground, backgroundColor: colors.input, borderColor: colors.border }]}
                value={rtmpUrl}
                onChangeText={setRtmpUrl}
                placeholder={meta.rtmpPlaceholder}
                placeholderTextColor={colors.mutedForeground}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>
          )}
          <View style={styles.formField}>
            <Text style={[styles.formLabel, { color: colors.mutedForeground }]}>STREAM KEY</Text>
            <TextInput
              style={[styles.formInput, { color: colors.foreground, backgroundColor: colors.input, borderColor: colors.border }]}
              value={streamKey}
              onChangeText={setStreamKey}
              placeholder="Paste your stream key"
              placeholderTextColor={colors.mutedForeground}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
            />
          </View>
          <TouchableOpacity
            onPress={() => void handleAdd()}
            disabled={adding}
            style={[styles.saveBtn, { backgroundColor: meta.color }]}
          >
            <Text style={styles.saveBtnText}>{adding ? "Saving…" : "Save"}</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

// ─── Screen ───────────────────────────────────────────────────────────────────

export default function PlatformsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { accessToken, getValidToken } = useAuth();
  const queryClient = useQueryClient();

  const topPad = Platform.OS === "web" ? 67 : insets.top;

  const [oauthConnections, setOauthConnections] = useState<OAuthConnection[]>([]);
  const [oauthLoading, setOauthLoading] = useState(true);
  const [connectingPlatform, setConnectingPlatform] = useState<OAuthPlatformType | null>(null);
  const [addingManual, setAddingManual] = useState<ManualPlatformType | null>(null);

  // Facebook destination picker state
  const [fbPickerVisible, setFbPickerVisible] = useState(false);
  const [fbTargets, setFbTargets] = useState<FacebookTarget[]>([]);
  const [fbTargetsLoading, setFbTargetsLoading] = useState(false);
  const [fbSaving, setFbSaving] = useState<string | null>(null);
  // True when the stored Facebook Page destination is no longer in the live
  // list (admin access lost / page token revoked) — prompts a re-selection.
  const [fbTargetStale, setFbTargetStale] = useState(false);
  // True when the linked Instagram Professional account is no longer resolvable
  // (account unlinked / admin access lost / scopes revoked) — prompts a
  // reconnect, since Instagram has no separate destination picker.
  const [igTargetStale, setIgTargetStale] = useState(false);

  const { data: manualPlatforms } = useListPlatforms();
  const connectPlatform = useConnectPlatform();
  const disconnectPlatform = useDisconnectPlatform();
  const updatePlatform = useUpdatePlatform();

  const loadOAuth = useCallback(async () => {
    if (!accessToken) return;
    setOauthLoading(true);
    try {
      const conns = await fetchOAuthConnections(accessToken);
      setOauthConnections(conns);

      // Auto-validate the stored Facebook Page destination against the live
      // list. A Page can disappear (admin access lost / token revoked) after it
      // was first selected; detecting it here surfaces a "re-select" prompt
      // before the user hits a failure at push time. Profile targets are always
      // valid, so only Page selections need the extra check.
      const fb = conns.find((c) => c.platform === "facebook");
      if (fb?.status === "connected" && fb.targetType === "page" && fb.targetId) {
        try {
          const token = await getValidToken();
          if (token) {
            const { selectedAvailable } = await fetchFacebookTargets(token);
            setFbTargetStale(!selectedAvailable);
          }
        } catch {
          // A validation hiccup should not block the screen; leave prior state.
        }
      } else {
        setFbTargetStale(false);
      }

      // Auto-validate the Instagram Live destination. Instagram Live depends on
      // an IG Professional account linked to a Facebook Page; that link can be
      // lost the same way a Page selection can. There is no destination picker
      // for Instagram — the linked account IS the destination — so a broken link
      // surfaces a reconnect prompt instead of a re-selection.
      const ig = conns.find((c) => c.platform === "instagram");
      if (ig?.status === "connected") {
        try {
          const token = await getValidToken();
          if (token) {
            const { available } = await fetchInstagramStatus(token);
            setIgTargetStale(!available);
          }
        } catch {
          // A validation hiccup should not block the screen; leave prior state.
        }
      } else {
        setIgTargetStale(false);
      }
    } finally {
      setOauthLoading(false);
    }
  }, [accessToken, getValidToken]);

  useFocusEffect(useCallback(() => { void loadOAuth(); }, [loadOAuth]));

  const getOAuthConnection = (type: OAuthPlatformType): OAuthConnection | null =>
    oauthConnections.find((c) => c.platform === type) ?? null;

  const getManualPlatform = (type: ManualPlatformType) =>
    (manualPlatforms ?? []).find((p) => p.type === type) ?? null;

  // ── OAuth handlers ──────────────────────────────────────────────────────────

  const handleOAuthConnect = async (platform: OAuthPlatformType) => {
    if (!accessToken) return;
    setConnectingPlatform(platform);
    try {
      const token = await getValidToken();
      if (!token) return;
      const authUrl = await getOAuthInitUrl(token, platform);

      // Race openAuthSessionAsync (reliable on iOS via ASWebAuthenticationSession)
      // against a Linking event listener (required on Android where Chrome Custom
      // Tabs closes and dispatches the mobile:// redirect as a separate intent
      // that arrives AFTER openAuthSessionAsync resolves with "dismiss").
      const redirectUrl = await new Promise<string | null>((resolve) => {
        let settled = false;
        let dismissTimer: ReturnType<typeof setTimeout> | null = null;

        const settle = (url: string | null) => {
          if (settled) return;
          settled = true;
          if (dismissTimer) { clearTimeout(dismissTimer); dismissTimer = null; }
          sub.remove();
          resolve(url);
        };

        const sub = Linking.addEventListener("url", ({ url }) => {
          if (url.startsWith("mobile://oauth-complete")) {
            if (dismissTimer) { clearTimeout(dismissTimer); dismissTimer = null; }
            settle(url);
          }
        });

        WebBrowser.openAuthSessionAsync(authUrl, "mobile://oauth-complete")
          .then((r) => {
            if (r.type === "success") {
              settle(r.url);
            } else if (r.type === "dismiss") {
              // Give Android's Linking event 500ms to arrive before giving up.
              dismissTimer = setTimeout(() => { dismissTimer = null; settle(null); }, 500);
            } else {
              settle(null);
            }
          })
          .catch(() => { settle(null); });
      });

      if (redirectUrl) {
        const params = new URLSearchParams(redirectUrl.split("?")[1] ?? "");
        if (params.get("success") === "true") {
          const confirmToken = params.get("confirmToken");
          if (!confirmToken) {
            Alert.alert("Connection failed", "Missing confirmation token — please try again.");
          } else {
            const freshToken = await getValidToken();
            if (!freshToken) throw new Error("Session expired");
            await confirmOAuthConnection(freshToken, platform, confirmToken);
            await loadOAuth();
          }
        } else {
          Alert.alert("Connection failed", decodeURIComponent(params.get("error") ?? "Authorization was denied"));
        }
      }
    } catch (err) {
      const msg = (err as Error).message;
      if (msg.toLowerCase().includes("not configured") || msg.includes("503")) {
        Alert.alert(
          "Not available yet",
          `${OAUTH_PLATFORMS.find((p) => p.type === platform)?.label} credentials haven't been added yet. Check BETA_CHECKLIST.md for setup steps.`
        );
      } else {
        Alert.alert("Connection failed", msg);
      }
    } finally {
      setConnectingPlatform(null);
    }
  };

  const openFacebookPicker = async () => {
    setFbPickerVisible(true);
    setFbTargetsLoading(true);
    setFbTargets([]);
    try {
      const token = await getValidToken();
      if (!token) return;
      const { targets, selectedAvailable } = await fetchFacebookTargets(token);
      setFbTargets(targets);
      setFbTargetStale(!selectedAvailable);
    } catch (err) {
      setFbPickerVisible(false);
      Alert.alert("Couldn't load destinations", (err as Error).message);
    } finally {
      setFbTargetsLoading(false);
    }
  };

  const handleSelectFacebookTarget = async (target: FacebookTarget) => {
    setFbSaving(target.id);
    try {
      const token = await getValidToken();
      if (!token) return;
      await setFacebookTarget(token, {
        targetType: target.type,
        targetId: target.type === "page" ? target.id : undefined,
      });
      setFbTargetStale(false);
      setFbPickerVisible(false);
      await loadOAuth();
    } catch (err) {
      Alert.alert("Couldn't set destination", (err as Error).message);
    } finally {
      setFbSaving(null);
    }
  };

  const handleOAuthDisconnect = (platform: OAuthPlatformType) => {
    const meta = OAUTH_PLATFORMS.find((p) => p.type === platform)!;
    Alert.alert(`Disconnect ${meta.label}?`, "You'll stop streaming to this platform. You can reconnect at any time.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Disconnect",
        style: "destructive",
        onPress: async () => {
          if (!accessToken) return;
          await revokeOAuth(accessToken, platform).catch(() => undefined);
          await loadOAuth();
        },
      },
    ]);
  };

  // ── Manual RTMP handlers ────────────────────────────────────────────────────

  const handleManualAdd = async (type: ManualPlatformType, rtmpUrl: string, streamKey: string) => {
    const meta = MANUAL_PLATFORMS.find((p) => p.type === type)!;
    setAddingManual(type);
    try {
      await connectPlatform.mutateAsync({
        data: { name: meta.label, type, rtmpUrl: rtmpUrl || undefined, streamKey: streamKey || undefined },
      });
      queryClient.invalidateQueries({ queryKey: getListPlatformsQueryKey() });
    } catch {
      Alert.alert("Error", "Failed to save. Please try again.");
    } finally {
      setAddingManual(null);
    }
  };

  const handleManualRemove = (id: string, name: string) => {
    Alert.alert(`Remove ${name}?`, "Stream key will be deleted.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: async () => {
          await disconnectPlatform.mutateAsync({ platformId: id });
          queryClient.invalidateQueries({ queryKey: getListPlatformsQueryKey() });
        },
      },
    ]);
  };

  const handleManualToggle = async (id: string, current: boolean) => {
    await updatePlatform.mutateAsync({ platformId: id, data: { isActive: !current } });
    queryClient.invalidateQueries({ queryKey: getListPlatformsQueryKey() });
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  const oauthConnectedCount = oauthConnections.filter((c) => c.status === "connected").length;
  const manualConnectedCount = (manualPlatforms ?? []).filter((p) => p.isActive).length;

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: colors.background }]}
      behavior={Platform.OS === "ios" ? "padding" : "height"}
    >
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: topPad + 16, paddingBottom: 48 }]}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {/* Header */}
        <View style={styles.topBar}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Feather name="arrow-left" size={22} color={colors.foreground} />
          </TouchableOpacity>
          <Text style={[styles.title, { color: colors.foreground }]}>Streaming Platforms</Text>
          <View style={{ width: 40 }} />
        </View>

        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
          Connect your accounts to multistream automatically when you go live.
        </Text>

        {/* OAuth section */}
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>SOCIAL ACCOUNTS</Text>
          {oauthConnectedCount > 0 && (
            <View style={[styles.sectionBadge, { backgroundColor: "#39FF1420" }]}>
              <Text style={[styles.sectionBadgeText, { color: "#39FF14" }]}>{oauthConnectedCount} connected</Text>
            </View>
          )}
        </View>

        {oauthLoading ? (
          <View style={styles.loadingRow}>
            <ActivityIndicator size="small" color={colors.primary} />
          </View>
        ) : (
          OAUTH_PLATFORMS.map((meta) => (
            <OAuthCard
              key={meta.type}
              meta={meta}
              connection={getOAuthConnection(meta.type)}
              connecting={connectingPlatform === meta.type}
              onConnect={() => void handleOAuthConnect(meta.type)}
              onDisconnect={() => handleOAuthDisconnect(meta.type)}
              onSelectDestination={meta.type === "facebook" ? () => void openFacebookPicker() : undefined}
              targetStale={
                meta.type === "facebook"
                  ? fbTargetStale
                  : meta.type === "instagram"
                    ? igTargetStale
                    : false
              }
              colors={colors}
            />
          ))
        )}

        {/* Manual RTMP section */}
        <View style={styles.sectionHeader}>
          <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>STREAM KEY PLATFORMS</Text>
          {manualConnectedCount > 0 && (
            <View style={[styles.sectionBadge, { backgroundColor: colors.primary + "20" }]}>
              <Text style={[styles.sectionBadgeText, { color: colors.primary }]}>{manualConnectedCount} active</Text>
            </View>
          )}
        </View>

        {MANUAL_PLATFORMS.map((meta) => {
          const existing = getManualPlatform(meta.type);
          return (
            <ManualCard
              key={meta.type}
              meta={meta}
              existingPlatform={existing ? { id: existing.id, name: existing.name, rtmpUrl: existing.rtmpUrl, isActive: existing.isActive } : null}
              onAdd={(rtmpUrl, streamKey) => handleManualAdd(meta.type, rtmpUrl, streamKey)}
              onRemove={handleManualRemove}
              onToggleActive={handleManualToggle}
              adding={addingManual === meta.type}
              colors={colors}
            />
          );
        })}

        {/* Security note */}
        <View style={[styles.securityNote, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Feather name="shield" size={13} color={colors.primary} />
          <Text style={[styles.securityText, { color: colors.mutedForeground }]}>
            OAuth tokens and stream keys are encrypted at rest. VYBE LIVE requests only the minimum permissions required to stream.
          </Text>
        </View>
      </ScrollView>

      {/* Facebook destination picker */}
      <Modal
        visible={fbPickerVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setFbPickerVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={[styles.modalSheet, { backgroundColor: colors.card, borderColor: colors.border, paddingBottom: insets.bottom + 16 }]}>
            <View style={styles.modalHeader}>
              <Text style={[styles.modalTitle, { color: colors.foreground }]}>Facebook Live destination</Text>
              <TouchableOpacity onPress={() => setFbPickerVisible(false)}>
                <Feather name="x" size={22} color={colors.mutedForeground} />
              </TouchableOpacity>
            </View>
            <Text style={[styles.modalSubtitle, { color: colors.mutedForeground }]}>
              Choose where your stream goes live. Pages require admin access with live-video permissions.
            </Text>

            {!fbTargetsLoading && fbTargetStale ? (
              <View style={[styles.staleBanner, { borderColor: "#FFD700", backgroundColor: "#FFD70015" }]}>
                <Feather name="alert-triangle" size={15} color="#FFD700" />
                <Text style={[styles.staleBannerText, { color: colors.foreground }]}>
                  {getOAuthConnection("facebook")?.targetName
                    ? `"${getOAuthConnection("facebook")?.targetName}" is no longer available — you may have lost admin access to that Page. Choose a new destination below.`
                    : "Your previous destination is no longer available. Choose a new one below."}
                </Text>
              </View>
            ) : null}

            {fbTargetsLoading ? (
              <View style={styles.loadingRow}>
                <ActivityIndicator size="small" color={colors.primary} />
              </View>
            ) : (
              <ScrollView style={{ maxHeight: 360 }} showsVerticalScrollIndicator={false}>
                {fbTargets.map((t) => {
                  const fbConn = getOAuthConnection("facebook");
                  const isSelected =
                    t.type === "profile"
                      ? (fbConn?.targetType ?? "profile") === "profile"
                      : fbConn?.targetType === "page" && fbConn?.targetId === t.id;
                  return (
                    <TouchableOpacity
                      key={`${t.type}-${t.id}`}
                      onPress={() => void handleSelectFacebookTarget(t)}
                      disabled={fbSaving !== null}
                      style={[styles.targetRow, { borderColor: isSelected ? "#1877F2" : colors.border, backgroundColor: isSelected ? "#1877F215" : colors.input }]}
                    >
                      <Feather name={t.type === "page" ? "flag" : "user"} size={16} color="#1877F2" />
                      <View style={{ flex: 1 }}>
                        <Text style={[styles.targetName, { color: colors.foreground }]} numberOfLines={1}>{t.name}</Text>
                        <Text style={[styles.targetType, { color: colors.mutedForeground }]}>
                          {t.type === "page" ? "Facebook Page" : "Personal Timeline"}
                        </Text>
                      </View>
                      {fbSaving === t.id ? (
                        <ActivityIndicator size="small" color="#1877F2" />
                      ) : isSelected ? (
                        <Feather name="check-circle" size={18} color="#39FF14" />
                      ) : null}
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: 16, gap: 12 },
  topBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 2 },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 18, fontFamily: "Inter_700Bold" },
  subtitle: { fontSize: 13, fontFamily: "Inter_400Regular", lineHeight: 19, marginTop: -4, marginBottom: 4 },
  sectionHeader: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8 },
  sectionLabel: { fontSize: 10, fontFamily: "Inter_600SemiBold", letterSpacing: 1.2 },
  sectionBadge: { paddingHorizontal: 7, paddingVertical: 2, borderRadius: 8 },
  sectionBadgeText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },
  loadingRow: { height: 60, alignItems: "center", justifyContent: "center" },

  // OAuth card
  oauthCard: { borderRadius: 16, borderWidth: 1, padding: 14, gap: 10 },
  oauthCardHeader: { flexDirection: "row", alignItems: "center", gap: 12 },
  oauthIcon: { width: 42, height: 42, borderRadius: 13, alignItems: "center", justifyContent: "center", borderWidth: 1 },
  oauthGlyph: { fontSize: 17, fontFamily: "Inter_700Bold" },
  oauthInfo: { flex: 1, gap: 3 },
  oauthLabel: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  oauthStatusRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusText: { fontSize: 11, fontFamily: "Inter_500Medium" },
  oauthBtn: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 9, borderWidth: 1 },
  oauthBtnText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  accountRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingTop: 9, borderTopWidth: StyleSheet.hairlineWidth },
  accountAvatar: { width: 22, height: 22, borderRadius: 11 },
  accountAvatarFallback: { width: 22, height: 22, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  accountName: { flex: 1, fontSize: 13, fontFamily: "Inter_500Medium" },
  errorText: { fontSize: 11, fontFamily: "Inter_400Regular" },
  oauthDesc: { fontSize: 11, fontFamily: "Inter_400Regular", lineHeight: 16 },

  // Facebook destination selector
  destinationRow: {
    flexDirection: "row", alignItems: "center", gap: 10, marginTop: 9,
    paddingHorizontal: 11, paddingVertical: 10, borderRadius: 10, borderWidth: 1,
  },
  destinationInfo: { flex: 1, gap: 2 },
  destinationLabel: { fontSize: 9, fontFamily: "Inter_600SemiBold", letterSpacing: 0.8 },
  destinationValue: { fontSize: 13, fontFamily: "Inter_500Medium" },

  // Destination picker modal
  modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.6)", justifyContent: "flex-end" },
  modalSheet: {
    borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: 1,
    paddingHorizontal: 18, paddingTop: 18, gap: 12,
  },
  modalHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  modalTitle: { fontSize: 17, fontFamily: "Inter_600SemiBold" },
  modalSubtitle: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 17 },
  staleBanner: {
    flexDirection: "row", alignItems: "flex-start", gap: 9,
    paddingHorizontal: 12, paddingVertical: 11, borderRadius: 10, borderWidth: 1,
  },
  staleBannerText: { flex: 1, fontSize: 12, fontFamily: "Inter_500Medium", lineHeight: 17 },
  targetRow: {
    flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 9,
    paddingHorizontal: 13, paddingVertical: 13, borderRadius: 12, borderWidth: 1,
  },
  targetName: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  targetType: { fontSize: 11, fontFamily: "Inter_400Regular", marginTop: 1 },

  // Manual card
  manualCard: { borderRadius: 14, borderWidth: 1, padding: 14, gap: 0 },
  manualCardRow: { flexDirection: "row", alignItems: "center", gap: 12 },
  manualIcon: { width: 38, height: 38, borderRadius: 11, alignItems: "center", justifyContent: "center" },
  manualInfo: { flex: 1, gap: 3 },
  manualLabel: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  manualActions: { flexDirection: "row", alignItems: "center", gap: 10 },
  togglePill: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 8 },
  toggleText: { fontSize: 12, fontFamily: "Inter_600SemiBold" },
  rtmpForm: { borderTopWidth: StyleSheet.hairlineWidth, marginTop: 12, paddingTop: 12, gap: 10 },
  rtmpNote: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 17 },
  instructionsBlock: { gap: 4 },
  eligibilityNote: { fontSize: 11, fontFamily: "Inter_400Regular", lineHeight: 16, marginTop: 4 },
  formField: { gap: 5 },
  formLabel: { fontSize: 10, fontFamily: "Inter_600SemiBold", letterSpacing: 0.8 },
  formInput: {
    borderRadius: 10, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 10,
    fontSize: 13, fontFamily: "Inter_400Regular",
  },
  saveBtn: { borderRadius: 10, paddingVertical: 11, alignItems: "center", marginTop: 2 },
  saveBtnText: { color: "#FFF", fontSize: 14, fontFamily: "Inter_600SemiBold" },

  securityNote: {
    flexDirection: "row", gap: 8, padding: 12, borderRadius: 12,
    borderWidth: 1, alignItems: "flex-start", marginTop: 4,
  },
  securityText: { flex: 1, fontSize: 11, fontFamily: "Inter_400Regular", lineHeight: 17 },
});
