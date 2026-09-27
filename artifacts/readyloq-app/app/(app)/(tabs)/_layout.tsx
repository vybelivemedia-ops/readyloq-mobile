import { Ionicons } from "@expo/vector-icons";
import { Tabs, useRouter } from "expo-router";
import React from "react";
import { Pressable, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useColors } from "@/hooks/useColors";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";

/**
 * Role-conditional tab bar.
 *
 *   Technician  →  Dashboard | Inspections | Connections
 *   Sales       →  Dashboard | Scan | Reports | Leads
 *   Manager     →  Dashboard | Review | Reports | Team
 *   Owner       →  Dashboard | Reports
 *
 * All Tabs.Screen entries must always be declared (Expo Router constraint).
 * Tabs not visible to a role are hidden via `href: null`.
 */
// Standard RN bottom tab bar height (pts). Safe-area bottom inset is added on
// top of this so the FAB clears the home-indicator on notched devices.
const TAB_BAR_HEIGHT = 49;

export default function TabsLayout() {
  const colors = useColors();
  const router = useRouter();
  const { user } = useCurrentUser();
  const { isConnected } = useNetworkStatus();
  const insets = useSafeAreaInsets();
  const role = user?.role ?? "technician";

  const isTech    = role === "technician";
  const isSales   = role === "sales";
  const isManager = role === "manager";
  const isOwner   = role === "owner";

  // Only technicians and sales reps need the quick-capture FAB.
  const showFAB = isTech || isSales;
  const fabBottom = TAB_BAR_HEIGHT + insets.bottom + 14;

  // href helper — null removes the tab button from the bar entirely.
  const show = (visible: boolean) => (visible ? undefined : null);

  return (
    <View style={{ flex: 1 }}>
      {/* Offline indicator — non-blocking, appears above the tab bar so
          technicians know their queued work will sync once signal returns. */}
      {!isConnected && (
        <View
          style={{
            backgroundColor: "#4F7FFF",
            paddingVertical: 5,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Text
            style={{
              color: "#ffffff",
              fontSize: 12,
              fontFamily: "Inter_500Medium",
              letterSpacing: 0.1,
            }}
          >
            Offline — data will sync when connected
          </Text>
        </View>
      )}
      <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.mutedForeground,
        tabBarStyle: { backgroundColor: colors.card, borderTopColor: colors.border },
        tabBarLabelStyle: { fontFamily: "Inter_500Medium", fontSize: 11 },
      }}
    >
      {/* ── Always visible ──────────────────────────────────────────────── */}
      <Tabs.Screen
        name="index"
        options={{
          title: "Dashboard",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="grid-outline" color={color} size={size} />
          ),
        }}
      />

      {/* ── Technician & Manager ────────────────────────────────────────── */}
      <Tabs.Screen
        name="inspections"
        options={{
          title: "Inspections",
          href: show(isTech || isManager),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="clipboard-outline" color={color} size={size} />
          ),
        }}
      />

      {/* ── Schedule — technicians see their route; managers see the team ─ */}
      <Tabs.Screen
        name="schedule"
        options={{
          title: "Schedule",
          href: show(isTech || isManager),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="calendar-outline" color={color} size={size} />
          ),
        }}
      />

      {/* ── All roles — device pairing needed in field across all roles ─── */}
      <Tabs.Screen
        name="connections"
        options={{
          title: "Connections",
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="bluetooth-outline" color={color} size={size} />
          ),
        }}
      />

      {/* ── Sales only ──────────────────────────────────────────────────── */}
      <Tabs.Screen
        name="scan"
        options={{
          title: "Scan",
          href: show(isSales),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="scan-outline" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="leads"
        options={{
          title: "Leads",
          href: show(isSales),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="people-outline" color={color} size={size} />
          ),
        }}
      />

      {/* ── Manager only ────────────────────────────────────────────────── */}
      <Tabs.Screen
        name="review"
        options={{
          title: "Review",
          href: show(isManager),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="checkmark-done-outline" color={color} size={size} />
          ),
        }}
      />
      <Tabs.Screen
        name="team"
        options={{
          title: "Team",
          href: show(isManager),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="people-circle-outline" color={color} size={size} />
          ),
        }}
      />

      {/* ── Sales | Manager | Owner ─────────────────────────────────────── */}
      <Tabs.Screen
        name="reports"
        options={{
          title: isManager ? "All Reports" : "Reports",
          href: show(isSales || isManager || isOwner),
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="document-text-outline" color={color} size={size} />
          ),
        }}
      />
    </Tabs>

      {/* ── Persistent capture FAB ──────────────────────────────────────────
          Floats above the tab bar so technicians and sales reps can start
          a capture flow from any tab without navigating back to the dashboard.
          Hidden for managers and owners who do not perform field capture.     */}
      {showFAB && (
        <Pressable
          onPress={() =>
            isSales
              ? router.push("/(tabs)/scan" as never)
              : router.push("/new-inspection" as never)
          }
          style={({ pressed }) => ({
            position: "absolute",
            bottom: fabBottom,
            alignSelf: "center",
            width: 60,
            height: 60,
            borderRadius: 30,
            backgroundColor: colors.primary,
            alignItems: "center",
            justifyContent: "center",
            // Elevation / shadow
            shadowColor: "#000",
            shadowOffset: { width: 0, height: 4 },
            shadowOpacity: 0.22,
            shadowRadius: 6,
            elevation: 8,
            opacity: pressed ? 0.85 : 1,
            // Thin white ring so the button reads clearly over any tab bar colour
            borderWidth: 3,
            borderColor: colors.background,
          })}
          accessibilityLabel={isSales ? "Start property scan" : "Start new inspection"}
          accessibilityRole="button"
        >
          <Ionicons
            name={isSales ? "scan-outline" : "camera-outline"}
            size={26}
            color="#ffffff"
          />
        </Pressable>
      )}
    </View>
  );
}
