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
  Pressable,
  ScrollView,
  Switch,
  Text,
  View,
} from "react-native";

import { useUser } from "@clerk/expo";
import { Screen } from "@/components/ui/Screen";
import { Card } from "@/components/ui/Card";
import { useColors } from "@/hooks/useColors";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useViewPreference, resolveViewMode } from "@/hooks/useViewPreference";
import { useQuery } from "@tanstack/react-query";
import { getGetBriefingQueryOptions } from "@/lib/api-client";

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

export default function SettingsScreen() {
  const colors = useColors();
  const router = useRouter();
  const { user: clerkUser } = useUser();
  const { user } = useCurrentUser();
  const { viewMode, setMode, clearMode, isLoaded } = useViewPreference();
  const isOwner = user?.role === "owner";

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
              sublabel={user?.role ? user.role.charAt(0).toUpperCase() + user.role.slice(1) : "—"}
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
    </Screen>
  );
}
