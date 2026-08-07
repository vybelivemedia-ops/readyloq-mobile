/**
 * Platform Super Admin — cross-tenant account manager
 *
 * Visible only to users with isSuperAdmin === true. Accessible from Settings.
 * Lists every account in the system, lets the super admin change roles,
 * toggle beta access, and grant/revoke super admin status.
 */
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@clerk/expo";
import { useRouter } from "expo-router";
import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  Switch,
  Text,
  View,
} from "react-native";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

import { Screen } from "@/components/ui/Screen";
import { Card } from "@/components/ui/Card";
import { useColors } from "@/hooks/useColors";
import { fetchAdminUsers, patchAdminUser, type AdminUser } from "@/lib/api";

const ROLES = ["owner", "manager", "sales", "technician"] as const;
type Role = (typeof ROLES)[number];

const ROLE_COLOR: Record<Role, string> = {
  owner: "#7c3aed",
  manager: "#0284c7",
  sales: "#059669",
  technician: "#d97706",
};

function RoleBadge({ role }: { role: string }) {
  const color = ROLE_COLOR[role as Role] ?? "#6b7280";
  return (
    <View style={{ backgroundColor: color + "22", borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 }}>
      <Text style={{ color, fontFamily: "Inter_600SemiBold", fontSize: 11, textTransform: "capitalize" }}>
        {role}
      </Text>
    </View>
  );
}

function UserRow({ user, onPress }: { user: AdminUser; onPress: () => void }) {
  const colors = useColors();
  const initials = user.clerkUserId.slice(-4).toUpperCase();
  const shortId = user.clerkUserId.slice(0, 8) + "…";

  return (
    <Pressable
      onPress={onPress}
      android_ripple={{ color: colors.muted }}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        padding: 14,
        gap: 12,
        opacity: pressed ? 0.7 : 1,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
      })}
    >
      {/* Avatar */}
      <View style={{
        width: 40, height: 40, borderRadius: 20,
        backgroundColor: colors.primary + "22",
        alignItems: "center", justifyContent: "center",
      }}>
        <Text style={{ color: colors.primary, fontFamily: "Inter_700Bold", fontSize: 13 }}>
          {initials}
        </Text>
      </View>

      {/* Info */}
      <View style={{ flex: 1, gap: 3 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Text style={{ color: colors.foreground, fontFamily: "Inter_500Medium", fontSize: 14 }}>
            {user.companyName ?? "No company"}
          </Text>
          {user.isSuperAdmin && (
            <View style={{ backgroundColor: "#7c3aed22", borderRadius: 4, paddingHorizontal: 5, paddingVertical: 2 }}>
              <Text style={{ color: "#7c3aed", fontFamily: "Inter_700Bold", fontSize: 9, letterSpacing: 0.5 }}>
                SUPER ADMIN
              </Text>
            </View>
          )}
        </View>
        <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 11 }}>
          {shortId}
        </Text>
      </View>

      {/* Right column */}
      <View style={{ alignItems: "flex-end", gap: 4 }}>
        <RoleBadge role={user.roleOverride ? `${user.roleOverride}*` : user.role} />
        {!user.betaAccess && (
          <Text style={{ color: colors.destructive, fontFamily: "Inter_400Regular", fontSize: 10 }}>
            beta paused
          </Text>
        )}
      </View>

      <Ionicons name="chevron-forward" size={14} color={colors.mutedForeground} />
    </Pressable>
  );
}

function EditUserModal({
  user,
  visible,
  onClose,
  onSaved,
}: {
  user: AdminUser;
  visible: boolean;
  onClose: () => void;
  onSaved: (updated: AdminUser) => void;
}) {
  const colors = useColors();
  const { getToken } = useAuth();
  const [saving, setSaving] = useState(false);

  const update = useCallback(
    async (patch: Parameters<typeof patchAdminUser>[2]) => {
      setSaving(true);
      try {
        const token = await getToken();
        const updated = await patchAdminUser(token, user.id, patch);
        onSaved(updated);
      } catch (e: unknown) {
        Alert.alert("Error", e instanceof Error ? e.message : "Update failed");
      } finally {
        setSaving(false);
      }
    },
    [getToken, user.id, onSaved],
  );

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)" }} onPress={onClose} />
      <View style={{
        position: "absolute", bottom: 0, left: 0, right: 0,
        backgroundColor: colors.card, borderTopLeftRadius: 20, borderTopRightRadius: 20,
        paddingBottom: 40,
      }}>
        {/* Handle */}
        <View style={{ width: 36, height: 4, borderRadius: 2, backgroundColor: colors.border, alignSelf: "center", marginTop: 12, marginBottom: 16 }} />

        <Text style={{ color: colors.foreground, fontFamily: "Inter_700Bold", fontSize: 17, paddingHorizontal: 20, marginBottom: 4 }}>
          Edit Account
        </Text>
        <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 12, paddingHorizontal: 20, marginBottom: 20 }}>
          {user.companyName ?? "No company"} · {user.clerkUserId.slice(0, 12)}…
        </Text>

        {saving && (
          <View style={{ alignItems: "center", paddingVertical: 12 }}>
            <ActivityIndicator color={colors.primary} />
          </View>
        )}

        {/* Role picker */}
        <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_600SemiBold", fontSize: 11, letterSpacing: 0.8, textTransform: "uppercase", paddingHorizontal: 20, marginBottom: 8 }}>
          Set Role
        </Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 20, gap: 8 }}>
          {ROLES.map((r) => {
            const active = user.role === r;
            return (
              <Pressable
                key={r}
                onPress={() => void update({ role: r })}
                disabled={saving}
                style={({ pressed }) => ({
                  paddingHorizontal: 16, paddingVertical: 10, borderRadius: 10,
                  backgroundColor: active ? ROLE_COLOR[r] : colors.muted,
                  opacity: pressed ? 0.7 : 1,
                  borderWidth: active ? 0 : 1, borderColor: colors.border,
                })}
              >
                <Text style={{ color: active ? "#fff" : colors.foreground, fontFamily: active ? "Inter_600SemiBold" : "Inter_400Regular", fontSize: 14, textTransform: "capitalize" }}>
                  {r}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {/* Toggles */}
        <View style={{ marginTop: 20, paddingHorizontal: 20, gap: 0 }}>
          {[
            {
              label: "Beta Access",
              sublabel: "Can access beta data routes",
              value: user.betaAccess,
              onChange: (v: boolean) => void update({ betaAccess: v }),
            },
            {
              label: "Super Admin",
              sublabel: "Cross-tenant account management",
              value: user.isSuperAdmin,
              onChange: (v: boolean) => {
                Alert.alert(
                  v ? "Grant Super Admin?" : "Revoke Super Admin?",
                  v
                    ? "This user will have full cross-tenant access."
                    : "This user will lose super admin privileges.",
                  [
                    { text: "Cancel", style: "cancel" },
                    { text: "Confirm", style: "destructive", onPress: () => void update({ isSuperAdmin: v }) },
                  ],
                );
              },
            },
          ].map((item, i, arr) => (
            <View
              key={item.label}
              style={{
                flexDirection: "row", alignItems: "center", paddingVertical: 14,
                borderTopWidth: 1, borderTopColor: colors.border,
                borderBottomWidth: i === arr.length - 1 ? 1 : 0, borderBottomColor: colors.border,
              }}
            >
              <View style={{ flex: 1 }}>
                <Text style={{ color: colors.foreground, fontFamily: "Inter_500Medium", fontSize: 15 }}>
                  {item.label}
                </Text>
                <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 12 }}>
                  {item.sublabel}
                </Text>
              </View>
              <Switch
                value={item.value}
                onValueChange={item.onChange}
                disabled={saving}
                trackColor={{ false: colors.muted, true: colors.primary }}
              />
            </View>
          ))}
        </View>

        <Pressable
          onPress={onClose}
          style={({ pressed }) => ({ marginTop: 20, alignItems: "center", opacity: pressed ? 0.6 : 1 })}
        >
          <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 14 }}>Done</Text>
        </Pressable>
      </View>
    </Modal>
  );
}

export default function AdminScreen() {
  const colors = useColors();
  const router = useRouter();
  const { getToken } = useAuth();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<AdminUser | null>(null);

  const { data: users, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ["admin-users"],
    queryFn: async () => {
      const token = await getToken();
      return fetchAdminUsers(token);
    },
    staleTime: 30_000,
  });

  const handleSaved = useCallback(
    (updated: AdminUser) => {
      queryClient.setQueryData<AdminUser[]>(["admin-users"], (prev) =>
        prev ? prev.map((u) => (u.id === updated.id ? { ...u, ...updated } : u)) : prev,
      );
      setSelected((prev) => (prev?.id === updated.id ? { ...prev, ...updated } : prev));
    },
    [queryClient],
  );

  // Group by company
  const byCompany = (users ?? []).reduce<Record<string, AdminUser[]>>((acc, u) => {
    const key = u.companyName ?? "— No Company —";
    (acc[key] ??= []).push(u);
    return acc;
  }, {});

  const sections = Object.entries(byCompany).sort(([a], [b]) => a.localeCompare(b));
  const totalUsers = users?.length ?? 0;

  return (
    <Screen>
      {/* Header */}
      <View style={{
        flexDirection: "row", alignItems: "center",
        paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8, gap: 12,
      }}>
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => ({
            width: 36, height: 36, borderRadius: 18,
            backgroundColor: colors.muted, alignItems: "center", justifyContent: "center",
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <Ionicons name="arrow-back" size={20} color={colors.foreground} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.foreground, fontFamily: "Inter_700Bold", fontSize: 22 }}>
            Platform Admin
          </Text>
          {!isLoading && (
            <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 12 }}>
              {totalUsers} account{totalUsers !== 1 ? "s" : ""} across {sections.length} compan{sections.length !== 1 ? "ies" : "y"}
            </Text>
          )}
        </View>
        <View style={{ backgroundColor: "#7c3aed22", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 }}>
          <Text style={{ color: "#7c3aed", fontFamily: "Inter_700Bold", fontSize: 11, letterSpacing: 0.5 }}>
            SUPER ADMIN
          </Text>
        </View>
      </View>

      {isLoading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      ) : (
        <FlatList
          data={sections}
          keyExtractor={([company]) => company}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={() => void refetch()}
              tintColor={colors.primary}
            />
          }
          contentContainerStyle={{ padding: 16, gap: 20, paddingBottom: 48 }}
          renderItem={({ item: [company, companyUsers] }) => (
            <View>
              <Text style={{
                color: colors.mutedForeground, fontFamily: "Inter_600SemiBold",
                fontSize: 11, letterSpacing: 0.8, textTransform: "uppercase",
                marginBottom: 6, paddingHorizontal: 2,
              }}>
                {company} · {companyUsers.length} user{companyUsers.length !== 1 ? "s" : ""}
              </Text>
              <Card style={{ overflow: "hidden", padding: 0 }}>
                {companyUsers.map((u, i) => (
                  <View key={u.id} style={{ borderBottomWidth: i < companyUsers.length - 1 ? 1 : 0, borderBottomColor: colors.border }}>
                    <UserRow
                      user={u}
                      onPress={() => setSelected(u)}
                    />
                  </View>
                ))}
              </Card>
            </View>
          )}
        />
      )}

      {selected && (
        <EditUserModal
          user={selected}
          visible={!!selected}
          onClose={() => setSelected(null)}
          onSaved={handleSaved}
        />
      )}
    </Screen>
  );
}
