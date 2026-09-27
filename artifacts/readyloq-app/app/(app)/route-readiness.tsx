/**
 * Route Readiness (read-only) — shows whether a technician's daily rig
 * (chemical kit) has been declared for a given date. Reached from the
 * Integrated Route Calendar's "Readiness" action for any stop that is NOT
 * the viewer's own today's rig (a future date, or another technician's
 * stop) — the viewer's own today's rig instead opens the existing editable
 * DailyRouteSetupModal in place.
 *
 * Query params: technicianId, date (YYYY-MM-DD), technicianName (display only).
 */

import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";

import { EmptyState } from "@/components/ui/EmptyState";
import { Screen } from "@/components/ui/Screen";
import { useColors } from "@/hooks/useColors";
import { lookupDailyRoute, type DailyRouteLookupResult } from "@/lib/api-client/daily-route";

function formatCalendarDate(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}

function param(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export default function RouteReadinessScreen() {
  const colors = useColors();
  const router = useRouter();
  const params = useLocalSearchParams<{
    technicianId?: string | string[];
    date?: string | string[];
    technicianName?: string | string[];
  }>();
  const technicianId = param(params.technicianId);
  const date = param(params.date);
  const technicianName = param(params.technicianName) ?? "Technician";

  const [result, setResult] = useState<DailyRouteLookupResult | { setUp: false } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!technicianId || !date) {
      setLoading(false);
      setError(true);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(false);

    lookupDailyRoute(technicianId, date)
      .then((r) => {
        if (!cancelled) setResult(r);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [technicianId, date]);

  return (
    <Screen edges={["top", "bottom"]}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 10,
          paddingHorizontal: 16,
          paddingVertical: 12,
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
        }}
      >
        <Pressable onPress={() => router.back()} hitSlop={12} style={{ padding: 4 }}>
          <Ionicons name="chevron-back" size={22} color={colors.foreground} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.foreground, fontFamily: "Inter_700Bold", fontSize: 16 }} numberOfLines={1}>
            {technicianName}
          </Text>
          <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 12 }}>
            Route Readiness{date ? ` · ${formatCalendarDate(date)}` : ""}
          </Text>
        </View>
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 10 }}>
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : error || !result ? (
        <EmptyState icon="alert-circle-outline" title="Couldn't load readiness" subtitle="Please try again." />
      ) : !result.setUp ? (
        <ScrollView contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 40 }}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 10,
              backgroundColor: colors.warning + "18",
              borderWidth: 1,
              borderColor: colors.warning + "55",
              borderRadius: colors.radius,
              padding: 14,
            }}
          >
            <Ionicons name="warning" size={20} color={colors.warning} />
            <Text style={{ color: colors.foreground, fontFamily: "Inter_500Medium", fontSize: 13, flex: 1 }}>
              No chemical kit has been declared for this date yet.
            </Text>
          </View>
        </ScrollView>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 40 }}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 10,
              backgroundColor: colors.success + "18",
              borderWidth: 1,
              borderColor: colors.success + "55",
              borderRadius: colors.radius,
              padding: 14,
            }}
          >
            <Ionicons name="checkmark-circle" size={20} color={colors.success} />
            <Text style={{ color: colors.foreground, fontFamily: "Inter_500Medium", fontSize: 13, flex: 1 }}>
              Kit declared · {result.assignments.length} product{result.assignments.length === 1 ? "" : "s"} assigned
            </Text>
          </View>

          {result.assignments.map((a, idx) => (
            <View
              key={`${a.productId}-${idx}`}
              style={{
                backgroundColor: colors.card,
                borderRadius: 12,
                borderWidth: 1,
                borderColor: colors.border,
                padding: 14,
                gap: 4,
              }}
            >
              <Text style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold", fontSize: 14 }}>
                {a.product?.name ?? `Product #${a.productId}`}
              </Text>
              <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 12 }}>
                Target: {a.targetPest}
              </Text>
              {a.notes ? (
                <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 12 }}>
                  {a.notes}
                </Text>
              ) : null}
            </View>
          ))}
        </ScrollView>
      )}
    </Screen>
  );
}
