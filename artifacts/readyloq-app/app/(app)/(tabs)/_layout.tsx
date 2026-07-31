import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import React from "react";

import { useColors } from "@/hooks/useColors";
import { useCurrentUser } from "@/hooks/useCurrentUser";

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
export default function TabsLayout() {
  const colors = useColors();
  const { user } = useCurrentUser();
  const role = user?.role ?? "technician";

  const isTech    = role === "technician";
  const isSales   = role === "sales";
  const isManager = role === "manager";
  const isOwner   = role === "owner";

  // href helper — null removes the tab button from the bar entirely.
  const show = (visible: boolean) => (visible ? undefined : null);

  return (
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

      {/* ── Technician only ─────────────────────────────────────────────── */}
      <Tabs.Screen
        name="connections"
        options={{
          title: "Connections",
          href: show(isTech),
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
  );
}
