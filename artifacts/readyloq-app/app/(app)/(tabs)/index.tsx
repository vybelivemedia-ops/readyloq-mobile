import { useAuth, useUser } from "@clerk/expo";
import { Ionicons } from "@expo/vector-icons";
import {
  getGetAnalyticsDashboardQueryOptions,
  getListInspectionsQueryOptions,
} from "@/lib/api-client";
import { useQuery } from "@tanstack/react-query";
import { type Href, useRouter } from "expo-router";
import React from "react";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";

import { Card } from "@/components/ui/Card";
import { Screen } from "@/components/ui/Screen";
import { useColors } from "@/hooks/useColors";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useWindowSizeClass } from "@/hooks/useWindowSizeClass";
import { formatRelative } from "@/constants/inspection";

export default function DashboardScreen() {
  const colors = useColors();
  const router = useRouter();
  const { user: clerkUser } = useUser();
  const { signOut } = useAuth();
  const { user } = useCurrentUser();
  const { isCompact } = useWindowSizeClass();

  const dash = useQuery(getGetAnalyticsDashboardQueryOptions());
  const recent = useQuery(getListInspectionsQueryOptions());

  const refreshing = dash.isRefetching || recent.isRefetching;
  const onRefresh = () => {
    dash.refetch();
    recent.refetch();
  };

  const stats = [
    { label: "Total", value: dash.data?.totalInspections ?? 0, icon: "albums-outline", tone: colors.primary },
    { label: "Completed", value: dash.data?.completedInspections ?? 0, icon: "checkmark-done-outline", tone: colors.success },
    { label: "Open", value: dash.data?.openInspections ?? 0, icon: "time-outline", tone: colors.warning },
    {
      label: "Avg findings",
      value: dash.data ? Math.round((dash.data.avgFindingsPerInspection ?? 0) * 10) / 10 : 0,
      icon: "search-outline",
      tone: colors.info,
    },
  ] as const;

  const firstName = clerkUser?.firstName || "Technician";

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{
          padding: 16,
          gap: 18,
          paddingBottom: 32,
          width: "100%",
          maxWidth: 900,
          alignSelf: "center",
        }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
        }
      >
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 14 }}>
              Welcome back,
            </Text>
            <Text style={{ color: colors.foreground, fontFamily: "Inter_700Bold", fontSize: 24 }}>
              {firstName}
            </Text>
            {user?.company?.name ? (
              <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 13 }}>
                {user.company.name}
              </Text>
            ) : null}
          </View>
          <Pressable
            onPress={() => router.push("/about" as Href)}
            style={{
              width: 42,
              height: 42,
              borderRadius: 21,
              backgroundColor: colors.card,
              borderWidth: 1,
              borderColor: colors.border,
              alignItems: "center",
              justifyContent: "center",
              marginRight: 8,
            }}
          >
            <Ionicons name="information-circle-outline" size={20} color={colors.mutedForeground} />
          </Pressable>
          <Pressable
            onPress={() => signOut()}
            style={{
              width: 42,
              height: 42,
              borderRadius: 21,
              backgroundColor: colors.card,
              borderWidth: 1,
              borderColor: colors.border,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Ionicons name="log-out-outline" size={20} color={colors.mutedForeground} />
          </Pressable>
        </View>

        {/* Primary CTA */}
        <Pressable
          onPress={() => router.push("/new-inspection" as Href)}
          style={({ pressed }) => ({
            backgroundColor: colors.primary,
            borderRadius: colors.radius,
            padding: 20,
            flexDirection: "row",
            alignItems: "center",
            gap: 16,
            opacity: pressed ? 0.9 : 1,
          })}
        >
          <View
            style={{
              width: 52,
              height: 52,
              borderRadius: 14,
              backgroundColor: "rgba(255,255,255,0.18)",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Ionicons name="camera" size={28} color={colors.primaryForeground} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.primaryForeground, fontFamily: "Inter_700Bold", fontSize: 18 }}>
              Start AI Inspection
            </Text>
            <Text style={{ color: "rgba(255,255,255,0.85)", fontFamily: "Inter_400Regular", fontSize: 13 }}>
              Capture evidence and get instant analysis
            </Text>
          </View>
          <Ionicons name="arrow-forward" size={22} color={colors.primaryForeground} />
        </Pressable>

        {/* Stats grid */}
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>
          {stats.map((s) => (
            <Card key={s.label} style={{ width: isCompact ? "47.5%" : "23%", gap: 8 }}>
              <Ionicons name={s.icon as keyof typeof Ionicons.glyphMap} size={22} color={s.tone} />
              <Text style={{ color: colors.foreground, fontFamily: "Inter_700Bold", fontSize: 26 }}>
                {s.value}
              </Text>
              <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_500Medium", fontSize: 13 }}>
                {s.label}
              </Text>
            </Card>
          ))}
        </View>

        {/* Recent activity */}
        <View style={{ gap: 12 }}>
          <Text style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold", fontSize: 17 }}>
            Recent activity
          </Text>
          {dash.data?.recentActivity?.length ? (
            <Card padded={false}>
              {dash.data.recentActivity.slice(0, 6).map((a, i) => (
                <View
                  key={a.id}
                  style={{
                    flexDirection: "row",
                    gap: 12,
                    padding: 14,
                    borderTopWidth: i === 0 ? 0 : 1,
                    borderTopColor: colors.border,
                    alignItems: "center",
                  }}
                >
                  <View
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: 18,
                      backgroundColor: colors.accent,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Ionicons name="pulse-outline" size={18} color={colors.primary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text
                      numberOfLines={1}
                      style={{ color: colors.foreground, fontFamily: "Inter_500Medium", fontSize: 14 }}
                    >
                      {a.description}
                    </Text>
                    <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 12 }}>
                      {a.technicianName} · {formatRelative(a.createdAt)}
                    </Text>
                  </View>
                </View>
              ))}
            </Card>
          ) : (
            <Card>
              <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", textAlign: "center" }}>
                No activity yet. Start your first inspection above.
              </Text>
            </Card>
          )}
        </View>
      </ScrollView>
    </Screen>
  );
}
