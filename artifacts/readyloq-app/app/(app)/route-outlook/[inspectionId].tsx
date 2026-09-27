/**
 * Route Chemical Outlook — full per-address breakdown of due/due-soon/overdue
 * products, reached by tapping a stop's "Outlook" action on the Integrated
 * Route Calendar. Deterministic projection off each product's label
 * retreatment interval (statistical stand-in for FAIE predictive consumption
 * forecasting) — not a trained model.
 */

import { Ionicons } from "@expo/vector-icons";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";

import { EmptyState } from "@/components/ui/EmptyState";
import { Screen } from "@/components/ui/Screen";
import { useColors } from "@/hooks/useColors";
import {
  getRouteOutlook,
  type RouteOutlookDetail,
  type RouteOutlookProduct,
  type RouteOutlookStatus,
} from "@/lib/api-client/schedule";

const STATUS_META: Record<RouteOutlookStatus, { label: string; color: string; icon: keyof typeof Ionicons.glyphMap }> = {
  overdue: { label: "Overdue", color: "#f87171", icon: "warning" },
  "due-soon": { label: "Due soon", color: "#fbbf24", icon: "time" },
  ok: { label: "OK", color: "#34d399", icon: "checkmark-circle" },
};

function formatCalendarDate(calendarDate: string): string {
  const d = new Date(`${calendarDate}T00:00:00`);
  if (Number.isNaN(d.getTime())) return calendarDate;
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}

function ProductRow({ product }: { product: RouteOutlookProduct }) {
  const colors = useColors();
  const meta = STATUS_META[product.outlookStatus];
  const lastApplied = new Date(product.lastAppliedAt);
  const lastAppliedLabel = Number.isNaN(lastApplied.getTime())
    ? product.lastAppliedAt
    : lastApplied.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const nextEligibleLabel = product.nextEligibleReapplicationDate
    ? new Date(product.nextEligibleReapplicationDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })
    : null;

  return (
    <View
      style={{
        backgroundColor: colors.card,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: colors.border,
        padding: 14,
        gap: 6,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Text style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold", fontSize: 14, flex: 1 }} numberOfLines={1}>
          {product.productName}
        </Text>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 5,
            paddingHorizontal: 8,
            paddingVertical: 3,
            borderRadius: 6,
            backgroundColor: meta.color + "22",
          }}
        >
          <Ionicons name={meta.icon} size={13} color={meta.color} />
          <Text style={{ color: meta.color, fontFamily: "Inter_600SemiBold", fontSize: 11 }}>{meta.label}</Text>
        </View>
      </View>

      <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 12 }}>
        Target: {product.targetPest} · Last applied {lastAppliedLabel} ({product.daysSinceApplication}d ago)
      </Text>

      <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 12 }}>
        {product.retreatmentIntervalDays != null
          ? `Retreatment interval: ${product.retreatmentIntervalDays}d${
              nextEligibleLabel ? ` · next eligible ${nextEligibleLabel}` : ""
            }`
          : "No label retreatment interval on record"}
        {product.applicationsLast90Days > 0
          ? ` · ${product.applicationsLast90Days} application${product.applicationsLast90Days === 1 ? "" : "s"} in last 90d`
          : ""}
      </Text>
    </View>
  );
}

export default function RouteOutlookScreen() {
  const colors = useColors();
  const router = useRouter();
  const { inspectionId: idParam } = useLocalSearchParams<{ inspectionId?: string | string[] }>();
  const id = Array.isArray(idParam) ? idParam[0] : idParam;
  const inspectionId = id ? Number(id) : NaN;

  const [outlook, setOutlook] = useState<RouteOutlookDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!Number.isInteger(inspectionId) || inspectionId <= 0) {
      setLoading(false);
      setNotFound(true);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setNotFound(false);

    getRouteOutlook(inspectionId)
      .then((v) => {
        if (cancelled) return;
        if (v == null) setNotFound(true);
        else setOutlook(v);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) {
          setNotFound(true);
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [inspectionId]);

  if (loading) {
    return (
      <Screen edges={["top", "bottom"]}>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 10 }}>
          <ActivityIndicator color={colors.primary} />
          <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 13 }}>
            Loading outlook…
          </Text>
        </View>
      </Screen>
    );
  }

  if (notFound || !outlook) {
    return (
      <Screen edges={["top", "bottom"]}>
        <EmptyState icon="flask-outline" title="Outlook not found" subtitle="This stop may have been removed." />
      </Screen>
    );
  }

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
            {outlook.address}
          </Text>
          <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 12 }}>
            Route Chemical Outlook · {formatCalendarDate(outlook.calendarDate)}
          </Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        {outlook.products.length === 0 ? (
          <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 13 }}>
            No chemical applications on record at this address yet.
          </Text>
        ) : (
          outlook.products.map((product) => <ProductRow key={product.productId} product={product} />)
        )}
      </ScrollView>
    </Screen>
  );
}
