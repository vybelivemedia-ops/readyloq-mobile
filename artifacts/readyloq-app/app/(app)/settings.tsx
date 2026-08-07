/**
 * Settings screen
 *
 * Accessible via the gear icon in the Dashboard header.
 * Currently exposes the View Mode toggle for owners plus a link to the
 * About screen.  Non-owners see a trimmed view without the layout toggle.
 */

import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
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
import { bootstrapSuperAdmin, setRoleOverride } from "@/lib/api";

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

// ─── Main screen ──────────────────────────────────────────────────────────────

// ─── Role Switcher (super-admin only) ─────────────────────────────────────────

const ROLE_OPTIONS = ["owner", "manager", "sales", "technician"] as const;
type RoleOption = (typeof ROLE_OPTIONS)[number];

const ROLE_META: Record<RoleOption, { color: string; icon: string; label: string }> = {
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
          <Ionicons name={meta.icon as any} size={17} color={meta.color} />
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
              <Ionicons name={m.icon as any} size={16} color={active ? "#fff" : colors.mutedForeground} />
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
        {/* ── View Mode (owners only) ──────────────────────────────────── */}
        {isOwner && isLoaded && (
          <View>
            <SectionHeader label="Dashboard Layout" />
            <Card style={{ overflow: "hidden", padding: 0 }}>
              <View style={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: 4 }}>
                <Text style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold", fontSize: 15 }}>
                  View Mode
                </Text>
                <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 13, marginTop: 3 }}>
                  {viewMode == null
                    ? "Auto — following your account type"
                    : "Manually set — overrides your account type"}
                </Text>
              </View>

              <ViewModeToggle
                mode={effectiveMode}
                onChange={(m) => void setMode(m)}
              />

              {viewMode != null && (
                <Pressable
                  onPress={() => void clearMode()}
                  style={({ pressed }) => ({
                    alignItems: "center",
                    paddingVertical: 10,
                    borderTopWidth: 1,
                    borderTopColor: colors.border,
                    opacity: pressed ? 0.6 : 1,
                  })}
                >
                  <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 13 }}>
                    Reset to automatic
                  </Text>
                </Pressable>
              )}
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
              {effectiveMode === "solo"
                ? "Solo Operator hides multi-tech queues and team metrics so the dashboard stays focused on your own field work."
                : "Enterprise shows approval queues, team performance metrics, and the training upload card."}
            </Text>
          </View>
        )}

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
                onPress={() => router.push("/admin" as any)}
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
