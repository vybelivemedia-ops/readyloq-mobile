/**
 * Settings screen
 *
 * Accessible via the gear icon in the Dashboard header.
 * Currently exposes the View Mode toggle for owners plus a link to the
 * About screen.  Non-owners see a trimmed view without the layout toggle.
 */

import { Ionicons } from "@expo/vector-icons";
import { type Href, useRouter } from "expo-router";
import React from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";

import { useAuth, useUser } from "@clerk/expo";
import { Screen } from "@/components/ui/Screen";
import { Card } from "@/components/ui/Card";
import { useColors } from "@/hooks/useColors";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useViewPreference, resolveViewMode } from "@/hooks/useViewPreference";
import { useQuery } from "@tanstack/react-query";
import { getGetBriefingQueryOptions } from "@/lib/api-client";
import {
  bootstrapSuperAdmin,
  setRoleOverride,
  fetchIntegrationConfig,
  saveIntegrationConfig,
  deleteIntegrationConfig,
  setPushNotificationsEnabled,
  type FieldIntegrationSystem,
  type IntegrationConfigResponse,
} from "@/lib/api";

// ─── Shared primitives ────────────────────────────────────────────────────────

function SectionHeader({ label }: { label: string }) {
  const colors = useColors();
  return (
    <Text
      style={{
        color: colors.mutedForeground,
        fontFamily: "Inter_600SemiBold",
        fontSize: 11,
        letterSpacing: 0.8,
        textTransform: "uppercase",
        marginBottom: 6,
        marginTop: 4,
        paddingHorizontal: 2,
      }}
    >
      {label}
    </Text>
  );
}

function SettingRow({
  icon,
  label,
  sublabel,
  right,
  onPress,
  isLast,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  sublabel?: string;
  right?: React.ReactNode;
  onPress?: () => void;
  isLast?: boolean;
}) {
  const colors = useColors();

  const inner = (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        paddingVertical: 14,
        paddingHorizontal: 16,
        borderBottomWidth: isLast ? 0 : 1,
        borderBottomColor: colors.border,
        gap: 12,
      }}
    >
      <View
        style={{
          width: 32,
          height: 32,
          borderRadius: 8,
          backgroundColor: colors.muted,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Ionicons name={icon} size={17} color={colors.primary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ color: colors.foreground, fontFamily: "Inter_500Medium", fontSize: 15 }}>
          {label}
        </Text>
        {sublabel ? (
          <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 12, marginTop: 2 }}>
            {sublabel}
          </Text>
        ) : null}
      </View>
      {right ?? (
        onPress ? (
          <Ionicons name="chevron-forward" size={16} color={colors.mutedForeground} />
        ) : null
      )}
    </View>
  );

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        android_ripple={{ color: colors.muted }}
        style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
      >
        {inner}
      </Pressable>
    );
  }

  return inner;
}

// ─── View Mode Segment ────────────────────────────────────────────────────────

function ViewModeToggle({
  mode,
  onChange,
}: {
  mode: "solo" | "enterprise";
  onChange: (m: "solo" | "enterprise") => void;
}) {
  const colors = useColors();
  const isSolo = mode === "solo";

  return (
    <View style={{ flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingVertical: 12 }}>
      {(["solo", "enterprise"] as const).map((m) => {
        const active = mode === m;
        return (
          <Pressable
            key={m}
            onPress={() => onChange(m)}
            style={({ pressed }) => ({
              flex: 1,
              paddingVertical: 10,
              borderRadius: 10,
              alignItems: "center",
              justifyContent: "center",
              gap: 4,
              backgroundColor: active ? colors.primary : colors.muted,
              opacity: pressed ? 0.8 : 1,
              borderWidth: active ? 0 : 1,
              borderColor: colors.border,
            })}
          >
            <Ionicons
              name={m === "solo" ? "person-outline" : "business-outline"}
              size={18}
              color={active ? "#ffffff" : colors.mutedForeground}
            />
            <Text
              style={{
                color: active ? "#ffffff" : colors.mutedForeground,
                fontFamily: "Inter_600SemiBold",
                fontSize: 13,
              }}
            >
              {m === "solo" ? "Solo Operator" : "Enterprise"}
            </Text>
            <Text
              style={{
                color: active ? "rgba(255,255,255,0.75)" : colors.mutedForeground,
                fontFamily: "Inter_400Regular",
                fontSize: 11,
                textAlign: "center",
                paddingHorizontal: 4,
              }}
            >
              {m === "solo" ? "Field execution focus" : "Full command centre"}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

// ─── Dispatch Integration Section (owner-only) ────────────────────────────────

const PLATFORM_OPTIONS: { value: FieldIntegrationSystem; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { value: "pestpac", label: "PestPac", icon: "bug-outline" },
  { value: "fieldroutes", label: "FieldRoutes", icon: "navigate-outline" },
];

function DispatchIntegrationSection() {
  const colors = useColors();
  const { getToken } = useAuth();

  // Current config state
  const [config, setConfig] = React.useState<IntegrationConfigResponse | null>(null);
  const [loadingConfig, setLoadingConfig] = React.useState(true);

  // Form state
  const [showForm, setShowForm] = React.useState(false);
  const [platform, setPlatform] = React.useState<FieldIntegrationSystem>("pestpac");
  const [accountId, setAccountId] = React.useState("");
  const [apiKey, setApiKey] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [disconnecting, setDisconnecting] = React.useState(false);

  // Load config on mount
  React.useEffect(() => {
    (async () => {
      try {
        const token = await getToken();
        const result = await fetchIntegrationConfig(token);
        setConfig(result);
        if (result.configured) {
          setPlatform(result.integration.systemType);
          setAccountId(result.integration.accountId);
        }
      } catch {
        // silently leave config=null; user can still try to connect
      } finally {
        setLoadingConfig(false);
      }
    })();
  }, []);

  const isConnected = config?.configured === true;

  const handleSave = async () => {
    if (!accountId.trim() || !apiKey.trim()) {
      Alert.alert("Missing fields", "Please enter both your Account ID and API key.");
      return;
    }
    setSaving(true);
    try {
      const token = await getToken();
      await saveIntegrationConfig(token, { systemType: platform, accountId: accountId.trim(), apiKey: apiKey.trim() });
      const updated = await fetchIntegrationConfig(token);
      setConfig(updated);
      setShowForm(false);
      setApiKey(""); // clear key from memory
      Alert.alert("Connected", `${platform === "pestpac" ? "PestPac" : "FieldRoutes"} integration saved.`);
    } catch (e: unknown) {
      Alert.alert("Save failed", e instanceof Error ? e.message : "Could not save integration.");
    } finally {
      setSaving(false);
    }
  };

  const handleDisconnect = () => {
    Alert.alert(
      "Disconnect integration",
      "This will remove your API key and stop syncing inspections. Continue?",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Disconnect",
          style: "destructive",
          onPress: async () => {
            setDisconnecting(true);
            try {
              const token = await getToken();
              await deleteIntegrationConfig(token);
              setConfig({ configured: false });
              setAccountId("");
              setApiKey("");
              setShowForm(false);
            } catch (e: unknown) {
              Alert.alert("Error", e instanceof Error ? e.message : "Could not disconnect.");
            } finally {
              setDisconnecting(false);
            }
          },
        },
      ],
    );
  };

  return (
    <View>
      <SectionHeader label="Dispatch Integration" />
      <Card style={{ overflow: "hidden", padding: 0 }}>
        {/* Status row */}
        <View style={{
          flexDirection: "row",
          alignItems: "center",
          paddingVertical: 14,
          paddingHorizontal: 16,
          borderBottomWidth: showForm ? 1 : 0,
          borderBottomColor: colors.border,
          gap: 12,
        }}>
          <View style={{
            width: 32, height: 32, borderRadius: 8,
            backgroundColor: colors.muted, alignItems: "center", justifyContent: "center",
          }}>
            <Ionicons name="git-branch-outline" size={17} color={colors.primary} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.foreground, fontFamily: "Inter_500Medium", fontSize: 15 }}>
              {isConnected
                ? `${config.integration.systemType === "pestpac" ? "PestPac" : "FieldRoutes"} connected`
                : "Not connected"}
            </Text>
            {isConnected ? (
              <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 12, marginTop: 2 }}>
                Account: {config.integration.accountId}
              </Text>
            ) : (
              <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 12, marginTop: 2 }}>
                Connect PestPac or FieldRoutes to sync inspections
              </Text>
            )}
          </View>

          {loadingConfig ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
              {/* Status chip */}
              <View style={{
                borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3,
                backgroundColor: isConnected ? "#05966922" : colors.muted,
              }}>
                <Text style={{
                  fontFamily: "Inter_700Bold", fontSize: 10, letterSpacing: 0.5,
                  color: isConnected ? "#059669" : colors.mutedForeground,
                }}>
                  {isConnected ? "CONNECTED" : "NOT SET"}
                </Text>
              </View>
              {/* Toggle form */}
              <Pressable
                onPress={() => setShowForm((v) => !v)}
                style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
              >
                <Ionicons
                  name={showForm ? "chevron-up" : "chevron-down"}
                  size={18}
                  color={colors.mutedForeground}
                />
              </Pressable>
            </View>
          )}
        </View>

        {/* Inline form */}
        {showForm && (
          <View style={{ padding: 16, gap: 14 }}>
            {/* Platform picker */}
            <View style={{ gap: 6 }}>
              <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_500Medium", fontSize: 12 }}>
                Platform
              </Text>
              <View style={{ flexDirection: "row", gap: 8 }}>
                {PLATFORM_OPTIONS.map((opt) => {
                  const active = platform === opt.value;
                  return (
                    <Pressable
                      key={opt.value}
                      onPress={() => setPlatform(opt.value)}
                      style={({ pressed }) => ({
                        flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center",
                        gap: 6, paddingVertical: 10, borderRadius: 10,
                        backgroundColor: active ? colors.primary : colors.muted,
                        borderWidth: active ? 0 : 1, borderColor: colors.border,
                        opacity: pressed ? 0.8 : 1,
                      })}
                    >
                      <Ionicons name={opt.icon} size={15} color={active ? "#fff" : colors.mutedForeground} />
                      <Text style={{
                        color: active ? "#fff" : colors.mutedForeground,
                        fontFamily: "Inter_600SemiBold", fontSize: 13,
                      }}>
                        {opt.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            {/* Account ID */}
            <View style={{ gap: 6 }}>
              <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_500Medium", fontSize: 12 }}>
                Account ID
              </Text>
              <TextInput
                value={accountId}
                onChangeText={setAccountId}
                placeholder="Your account identifier…"
                placeholderTextColor={colors.mutedForeground}
                autoCapitalize="none"
                autoCorrect={false}
                style={{
                  backgroundColor: colors.muted, borderRadius: 10, padding: 12,
                  color: colors.foreground, fontFamily: "Inter_400Regular", fontSize: 14,
                  borderWidth: 1, borderColor: colors.border,
                }}
              />
            </View>

            {/* API key */}
            <View style={{ gap: 6 }}>
              <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_500Medium", fontSize: 12 }}>
                API Key
              </Text>
              <TextInput
                value={apiKey}
                onChangeText={setApiKey}
                placeholder={isConnected ? "Enter new key to rotate…" : "Paste your API key…"}
                placeholderTextColor={colors.mutedForeground}
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry
                style={{
                  backgroundColor: colors.muted, borderRadius: 10, padding: 12,
                  color: colors.foreground, fontFamily: "Inter_400Regular", fontSize: 14,
                  borderWidth: 1, borderColor: colors.border,
                }}
              />
              <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 11, lineHeight: 15 }}>
                Your key is stored securely on the server and never returned to the app.
              </Text>
            </View>

            {/* Action buttons */}
            <View style={{ flexDirection: "row", gap: 10 }}>
              {isConnected && (
                <Pressable
                  onPress={handleDisconnect}
                  disabled={disconnecting}
                  style={({ pressed }) => ({
                    flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: "center",
                    backgroundColor: "#dc262622",
                    opacity: pressed || disconnecting ? 0.6 : 1,
                  })}
                >
                  {disconnecting
                    ? <ActivityIndicator size="small" color="#dc2626" />
                    : <Text style={{ color: "#dc2626", fontFamily: "Inter_600SemiBold", fontSize: 14 }}>Disconnect</Text>
                  }
                </Pressable>
              )}
              <Pressable
                onPress={handleSave}
                disabled={saving || !accountId.trim() || !apiKey.trim()}
                style={({ pressed }) => ({
                  flex: 2, paddingVertical: 12, borderRadius: 10, alignItems: "center",
                  backgroundColor: colors.primary,
                  opacity: pressed || saving || !accountId.trim() || !apiKey.trim() ? 0.6 : 1,
                })}
              >
                {saving
                  ? <ActivityIndicator color="#fff" />
                  : <Text style={{ color: "#fff", fontFamily: "Inter_600SemiBold", fontSize: 14 }}>
                      {isConnected ? "Update" : "Connect"}
                    </Text>
                }
              </Pressable>
            </View>
          </View>
        )}
      </Card>
    </View>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

// ─── Role Switcher (super-admin only) ─────────────────────────────────────────

const ROLE_OPTIONS = ["owner", "manager", "sales", "technician"] as const;
type RoleOption = (typeof ROLE_OPTIONS)[number];

const ROLE_META: Record<RoleOption, { color: string; icon: keyof typeof Ionicons.glyphMap; label: string }> = {
  owner:      { color: "#7c3aed", icon: "ribbon-outline",       label: "Owner"      },
  manager:    { color: "#0284c7", icon: "briefcase-outline",     label: "Manager"    },
  sales:      { color: "#059669", icon: "trending-up-outline",   label: "Sales"      },
  technician: { color: "#d97706", icon: "construct-outline",     label: "Technician" },
};

function RoleSwitcher({
  currentRole,
  override,
  onSwitch,
  onClear,
  loading,
}: {
  currentRole: string;
  override: string | null;
  onSwitch: (r: RoleOption) => void;
  onClear: () => void;
  loading: boolean;
}) {
  const colors = useColors();
  const effective = (override ?? currentRole) as RoleOption;
  const meta = ROLE_META[effective] ?? ROLE_META.technician;

  return (
    <View style={{ paddingVertical: 4 }}>
      {/* Effective role banner */}
      <View style={{
        flexDirection: "row", alignItems: "center", gap: 10,
        paddingHorizontal: 16, paddingTop: 12, paddingBottom: 10,
        borderBottomWidth: 1, borderBottomColor: colors.border,
      }}>
        <View style={{
          width: 36, height: 36, borderRadius: 18,
          backgroundColor: meta.color + "22", alignItems: "center", justifyContent: "center",
        }}>
          <Ionicons name={meta.icon} size={17} color={meta.color} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold", fontSize: 14 }}>
            Acting as: {meta.label}
          </Text>
          {override ? (
            <Text style={{ color: meta.color, fontFamily: "Inter_400Regular", fontSize: 12 }}>
              Override active — real role: {currentRole}
            </Text>
          ) : (
            <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 12 }}>
              Real role (no override)
            </Text>
          )}
        </View>
        {loading && <ActivityIndicator size="small" color={colors.primary} />}
      </View>

      {/* Role buttons */}
      <View style={{ flexDirection: "row", gap: 8, padding: 12 }}>
        {ROLE_OPTIONS.map((r) => {
          const m = ROLE_META[r];
          const active = effective === r;
          return (
            <Pressable
              key={r}
              onPress={() => onSwitch(r)}
              disabled={loading}
              style={({ pressed }) => ({
                flex: 1, alignItems: "center", gap: 4,
                paddingVertical: 10, borderRadius: 10,
                backgroundColor: active ? m.color : colors.muted,
                opacity: pressed || loading ? 0.7 : 1,
                borderWidth: active ? 0 : 1, borderColor: colors.border,
              })}
            >
              <Ionicons name={m.icon} size={16} color={active ? "#fff" : colors.mutedForeground} />
              <Text style={{
                color: active ? "#fff" : colors.mutedForeground,
                fontFamily: "Inter_600SemiBold", fontSize: 10,
              }}>
                {m.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* Clear override */}
      {override && (
        <Pressable
          onPress={onClear}
          disabled={loading}
          style={({ pressed }) => ({
            alignItems: "center", paddingVertical: 10,
            borderTopWidth: 1, borderTopColor: colors.border,
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <Text style={{ color: colors.primary, fontFamily: "Inter_500Medium", fontSize: 13 }}>
            Reset to real role ({currentRole})
          </Text>
        </Pressable>
      )}
    </View>
  );
}

// ─── Bootstrap modal (claim super admin) ──────────────────────────────────────

function BootstrapModal({
  visible,
  onClose,
  onSuccess,
}: {
  visible: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const colors = useColors();
  const { getToken } = useAuth();
  const [tokenInput, setTokenInput] = React.useState("");
  const [loading, setLoading] = React.useState(false);

  const handleSubmit = async () => {
    if (!tokenInput.trim()) return;
    setLoading(true);
    try {
      const t = await getToken();
      await bootstrapSuperAdmin(t, tokenInput.trim());
      Alert.alert("Access granted", "You now have super admin privileges. Restart the app to fully refresh.");
      onSuccess();
      onClose();
    } catch (e: unknown) {
      Alert.alert("Failed", e instanceof Error ? e.message : "Invalid token");
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.6)" }} onPress={onClose} />
      <View style={{
        position: "absolute", bottom: 0, left: 0, right: 0,
        backgroundColor: colors.card, borderTopLeftRadius: 20, borderTopRightRadius: 20,
        padding: 24, paddingBottom: 40, gap: 16,
      }}>
        <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: "center", marginBottom: 4 }} />
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <Ionicons name="shield-outline" size={22} color="#7c3aed" />
          <Text style={{ color: colors.foreground, fontFamily: "Inter_700Bold", fontSize: 18 }}>
            Claim Super Admin
          </Text>
        </View>
        <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 13, lineHeight: 19 }}>
          Enter the platform bootstrap token to elevate this account to super admin.
        </Text>
        <TextInput
          value={tokenInput}
          onChangeText={setTokenInput}
          placeholder="Bootstrap token…"
          placeholderTextColor={colors.mutedForeground}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
          style={{
            backgroundColor: colors.muted, borderRadius: 10, padding: 14,
            color: colors.foreground, fontFamily: "Inter_400Regular", fontSize: 15,
            borderWidth: 1, borderColor: colors.border,
          }}
        />
        <Pressable
          onPress={handleSubmit}
          disabled={loading || !tokenInput.trim()}
          style={({ pressed }) => ({
            backgroundColor: "#7c3aed", borderRadius: 10, paddingVertical: 14,
            alignItems: "center", opacity: pressed || loading || !tokenInput.trim() ? 0.6 : 1,
          })}
        >
          {loading ? <ActivityIndicator color="#fff" /> : (
            <Text style={{ color: "#fff", fontFamily: "Inter_600SemiBold", fontSize: 15 }}>
              Claim Access
            </Text>
          )}
        </Pressable>
      </View>
    </Modal>
  );
}

// ─── Main screen ──────────────────────────────────────────────────────────────

export default function SettingsScreen() {
  const colors = useColors();
  const router = useRouter();
  const { getToken } = useAuth();
  const { user: clerkUser } = useUser();
  const { user, refetch: refetchUser } = useCurrentUser();
  const { viewMode, setMode, clearMode, isLoaded } = useViewPreference();
  const isOwner = user?.role === "owner";
  const isSuperAdmin = !!user?.isSuperAdmin;
  const [roleSwitching, setRoleSwitching] = React.useState(false);
  const [showBootstrap, setShowBootstrap] = React.useState(false);

  const handleSwitchRole = async (role: RoleOption) => {
    if (roleSwitching) return;
    setRoleSwitching(true);
    try {
      const token = await getToken();
      await setRoleOverride(token, role);
      refetchUser();
    } catch (e: unknown) {
      Alert.alert("Error", e instanceof Error ? e.message : "Failed to switch role");
    } finally {
      setRoleSwitching(false);
    }
  };

  const handleClearRoleOverride = async () => {
    if (roleSwitching) return;
    setRoleSwitching(true);
    try {
      const token = await getToken();
      await setRoleOverride(token, null);
      refetchUser();
    } catch {
      Alert.alert("Error", "Failed to clear role override");
    } finally {
      setRoleSwitching(false);
    }
  };

  const briefing = useQuery(getGetBriefingQueryOptions());
  const serverIsSolo = briefing.data?.owner?.isSoloOperator ?? true;
  const effectiveMode = resolveViewMode(viewMode, serverIsSolo);

  // ── Push notification toggle (owner only) ────────────────────────────────────
  const [pushEnabled, setPushEnabled] = React.useState<boolean>(
    user?.pushNotificationsEnabled ?? true,
  );
  const [pushToggling, setPushToggling] = React.useState(false);

  const handlePushToggle = async (value: boolean) => {
    if (pushToggling) return;
    setPushEnabled(value);
    setPushToggling(true);
    try {
      const token = await getToken();
      await setPushNotificationsEnabled(token, value);
    } catch {
      // Revert optimistic update on failure
      setPushEnabled(!value);
      Alert.alert("Error", "Failed to update notification preference.");
    } finally {
      setPushToggling(false);
    }
  };

  return (
    <Screen>
      {/* Header */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          paddingHorizontal: 16,
          paddingTop: 16,
          paddingBottom: 8,
          gap: 12,
        }}
      >
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => ({
            width: 36,
            height: 36,
            borderRadius: 18,
            backgroundColor: colors.muted,
            alignItems: "center",
            justifyContent: "center",
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <Ionicons name="arrow-back" size={20} color={colors.foreground} />
        </Pressable>
        <Text style={{ color: colors.foreground, fontFamily: "Inter_700Bold", fontSize: 22, flex: 1 }}>
          Settings
        </Text>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 16, gap: 20, paddingBottom: 48 }}
      >
        {/* ── Dashboard Preferences (owners only) ──────────────────────── */}
        {isOwner && isLoaded && (
          <View>
            <SectionHeader label="Dashboard Preferences" />
            <Card style={{ overflow: "hidden", padding: 0 }}>
              <SettingRow
                icon="pulse-outline"
                label="Mission Control Mode"
                sublabel="Show full metrics, KPIs, and agent roster"
                isLast
                right={
                  <Switch
                    value={effectiveMode === "enterprise"}
                    onValueChange={(v) => void setMode(v ? "enterprise" : "solo")}
                    trackColor={{ false: colors.border, true: colors.primary }}
                    thumbColor="#ffffff"
                  />
                }
              />
            </Card>
            <Text
              style={{
                color: colors.mutedForeground,
                fontFamily: "Inter_400Regular",
                fontSize: 12,
                marginTop: 8,
                paddingHorizontal: 4,
                lineHeight: 17,
              }}
            >
              {effectiveMode === "enterprise"
                ? "Mission Control is ON — showing full KPIs, alerts, and the complete agent roster."
                : "Mission Control is OFF — dashboard shows only your core actions and AI assistant."}
            </Text>
          </View>
        )}

        {/* ── Notifications (owners only) ──────────────────────────────── */}
        {isOwner && (
          <View>
            <SectionHeader label="Notifications" />
            <Card style={{ overflow: "hidden", padding: 0 }}>
              <SettingRow
                icon="notifications-outline"
                label="Critical Risk Alerts"
                sublabel="Push notification when an inspection scores critical risk"
                isLast
                right={
                  <Switch
                    value={pushEnabled}
                    onValueChange={(v) => void handlePushToggle(v)}
                    disabled={pushToggling}
                    trackColor={{ false: colors.border, true: colors.primary }}
                    thumbColor="#ffffff"
                  />
                }
              />
            </Card>
            <Text
              style={{
                color: colors.mutedForeground,
                fontFamily: "Inter_400Regular",
                fontSize: 12,
                marginTop: 8,
                paddingHorizontal: 4,
                lineHeight: 17,
              }}
            >
              {pushEnabled
                ? "You'll be notified immediately when a completed inspection scores as critical risk."
                : "Critical risk alerts are off. Enable to get instant push notifications."}
            </Text>
          </View>
        )}

        {/* ── Executive Intelligence (owners only) ─────────────────────── */}
        {isOwner && (
          <View>
            <SectionHeader label="Executive Intelligence" />
            <Card style={{ overflow: "hidden", padding: 0 }}>
              <SettingRow
                icon="bar-chart-outline"
                label="Intelligence Dashboard"
                sublabel="Pipeline, quality scores, risk & team performance"
                onPress={() => router.push("/executive-dashboard" as Href)}
                isLast
              />
            </Card>
          </View>
        )}

        {/* ── Company Playbooks (owners only) ──────────────────────────── */}
        {isOwner && (
          <View>
            <SectionHeader label="Company Playbooks" />
            <Card style={{ overflow: "hidden", padding: 0 }}>
              <SettingRow
                icon="book-outline"
                label="Manage Playbooks"
                sublabel="SOPs, required steps, and chemical restrictions"
                onPress={() => router.push("/playbooks" as Href)}
                isLast
              />
            </Card>
          </View>
        )}

        {/* ── Dispatch Integration (owners only) ───────────────────────── */}
        {isOwner && <DispatchIntegrationSection />}

        {/* ── Role Switcher (super admin only) ─────────────────────────── */}
        {isSuperAdmin && (
          <View>
            <SectionHeader label="Role Switcher" />
            <Card style={{ overflow: "hidden", padding: 0 }}>
              <RoleSwitcher
                currentRole={user!.role}
                override={user?.roleOverride ?? null}
                onSwitch={(r) => void handleSwitchRole(r)}
                onClear={() => void handleClearRoleOverride()}
                loading={roleSwitching}
              />
            </Card>
            <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 12, marginTop: 8, paddingHorizontal: 4, lineHeight: 17 }}>
              Override your effective role to test the Owner, Manager, Sales, or Technician experience without switching accounts. Super Admin endpoints always use your real identity.
            </Text>
          </View>
        )}

        {/* ── Platform Admin (super admin only) ────────────────────────── */}
        {isSuperAdmin && (
          <View>
            <SectionHeader label="Platform Admin" />
            <Card style={{ overflow: "hidden", padding: 0 }}>
              <SettingRow
                icon="people-outline"
                label="Manage All Accounts"
                sublabel="View and edit every user across all companies"
                onPress={() => router.push("/admin" as Href)}
              />
              <SettingRow
                icon="shield-outline"
                label="Super Admin Active"
                sublabel="Cross-tenant access enabled"
                isLast
                right={
                  <View style={{ backgroundColor: "#7c3aed22", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 }}>
                    <Text style={{ color: "#7c3aed", fontFamily: "Inter_700Bold", fontSize: 10, letterSpacing: 0.5 }}>ON</Text>
                  </View>
                }
              />
            </Card>
          </View>
        )}

        {/* ── Claim Super Admin (non-superAdmin) ───────────────────────── */}
        {!isSuperAdmin && (
          <View>
            <SectionHeader label="Platform" />
            <Card style={{ overflow: "hidden", padding: 0 }}>
              <SettingRow
                icon="shield-outline"
                label="Claim Super Admin"
                sublabel="Enter the platform bootstrap token"
                onPress={() => setShowBootstrap(true)}
                isLast
              />
            </Card>
          </View>
        )}

        {/* ── App ─────────────────────────────────────────────────────── */}
        <View>
          <SectionHeader label="App" />
          <Card style={{ overflow: "hidden", padding: 0 }}>
            <SettingRow
              icon="information-circle-outline"
              label="About ReadyLoq"
              onPress={() => router.push("/about")}
            />
            <SettingRow
              icon="shield-checkmark-outline"
              label="Role"
              sublabel={
                user?.roleOverride
                  ? `${user.roleOverride} (override — real: ${user.role})`
                  : user?.role
                    ? user.role.charAt(0).toUpperCase() + user.role.slice(1)
                    : "—"
              }
              isLast
            />
          </Card>
        </View>

        {/* ── Account ──────────────────────────────────────────────────── */}
        <View>
          <SectionHeader label="Account" />
          <Card style={{ overflow: "hidden", padding: 0 }}>
            <SettingRow
              icon="mail-outline"
              label="Email"
              sublabel={clerkUser?.primaryEmailAddress?.emailAddress ?? "—"}
              isLast
            />
          </Card>
        </View>
      </ScrollView>

      {/* Bootstrap modal */}
      <BootstrapModal
        visible={showBootstrap}
        onClose={() => setShowBootstrap(false)}
        onSuccess={() => refetchUser()}
      />
    </Screen>
  );
}
