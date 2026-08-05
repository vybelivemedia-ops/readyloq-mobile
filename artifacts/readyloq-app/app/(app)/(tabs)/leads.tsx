/**
 * Leads tab — Sales role only.
 *
 * Pipeline management: open opportunities, proposal status, follow-up queue.
 * Surfaces the existing /opportunities and /proposals server data in a
 * mobile-optimized list with status chips and value indicators.
 */

import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { type Href, useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useState } from "react";
import {
  FlatList,
  Pressable,
  RefreshControl,
  Text,
  View,
} from "react-native";

import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { FullScreenLoader } from "@/components/ui/Loader";
import { Screen } from "@/components/ui/Screen";
import { useColors } from "@/hooks/useColors";
import { customFetch } from "@/lib/api-client/custom-fetch";
import { filterIntent } from "@/lib/filterIntent";

// ─── Types ────────────────────────────────────────────────────────────────────

type LeadStatus = "new" | "qualified" | "proposal_sent" | "negotiating" | "won" | "lost" | "stale";

interface Lead {
  id: number;
  inspectionId: number | null;
  title: string;
  propertyAddress: string;
  status: LeadStatus;
  estimatedValueTier: "high" | "medium" | "low";
  /** Auto-populated by the pricing engine when the opportunity is created. */
  estimatedAnnualValue?: number | null;
  riskLevel: "critical" | "high" | "medium" | "low";
  updatedAt: string;
  ageDays: number;
  /** Technician who ran the linked inspection — shown for recognition credit. */
  technicianName: string | null;
}

interface LeadsResponse {
  opportunities: Lead[];
  pipelineValue: number;
  openCount: number;
  staleCount: number;
}

// ─── API ──────────────────────────────────────────────────────────────────────

async function fetchLeads(): Promise<LeadsResponse> {
  return customFetch<LeadsResponse>("/api/opportunities");
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<LeadStatus, string> = {
  new:           "New",
  qualified:     "Qualified",
  proposal_sent: "Proposal sent",
  negotiating:   "Negotiating",
  won:           "Won",
  lost:          "Lost",
  stale:         "Stale",
};

const STATUS_TONES: Record<LeadStatus, "primary" | "success" | "warning" | "danger" | "default"> = {
  new:           "primary",
  qualified:     "primary",
  proposal_sent: "warning",
  negotiating:   "warning",
  won:           "success",
  lost:          "danger",
  stale:         "danger",
};

const VALUE_COLORS: Record<string, string> = {
  high:   "#16a34a",
  medium: "#d97706",
  low:    "#6b7280",
};

const VALUE_LABELS: Record<string, string> = {
  high:   "High value",
  medium: "Mid-tier",
  low:    "Entry",
};

function formatMoney(cents: number): string {
  if (cents >= 100_000) return `$${(cents / 100_000).toFixed(0)}M+`;
  if (cents >= 1_000)   return `$${(cents / 1_000).toFixed(0)}K`;
  return `$${cents}`;
}

const FILTER_TABS: { key: LeadStatus | "all"; label: string }[] = [
  { key: "all",           label: "All" },
  { key: "new",           label: "New" },
  { key: "proposal_sent", label: "Proposals" },
  { key: "stale",         label: "Stale" },
];

// ─── Component ────────────────────────────────────────────────────────────────

export default function LeadsScreen() {
  const colors = useColors();
  const router = useRouter();
  const [filter, setFilter] = useState<LeadStatus | "all">("all");

  // Consume any pending deep-link filter intent set by dashboard cards.
  // useFocusEffect fires on every tab focus — even when the screen is already
  // mounted — so this reliably picks up intents regardless of mount state.
  useFocusEffect(
    useCallback(() => {
      const f = filterIntent.consume("leads");
      if (f) setFilter(f as LeadStatus | "all");
    }, []),
  );

  const { data, isLoading, isRefetching, refetch } = useQuery({
    queryKey: ["leads"],
    queryFn: fetchLeads,
    staleTime: 60_000,
  });

  const allLeads = data?.opportunities ?? [];
  const filtered = filter === "all" ? allLeads : allLeads.filter((l) => l.status === filter);

  const renderItem = ({ item }: { item: Lead }) => (
    <Card
      onPress={() =>
        item.inspectionId
          ? router.push(`/inspection/${item.inspectionId}` as Href)
          : undefined
      }
      style={{ gap: 10 }}
    >
      <View style={{ flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
        <Text
          style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold", fontSize: 15, flex: 1 }}
          numberOfLines={2}
        >
          {item.title}
        </Text>
        <Badge label={STATUS_LABELS[item.status]} tone={STATUS_TONES[item.status]} />
      </View>

      <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
        <Ionicons name="location-outline" size={13} color={colors.mutedForeground} />
        <Text
          style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 13, flex: 1 }}
          numberOfLines={1}
        >
          {item.propertyAddress}
        </Text>
      </View>

      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          <View
            style={{
              width: 8,
              height: 8,
              borderRadius: 4,
              backgroundColor: VALUE_COLORS[item.estimatedValueTier],
            }}
          />
          {item.estimatedAnnualValue ? (
            <Text
              style={{
                color: VALUE_COLORS[item.estimatedValueTier],
                fontFamily: "Inter_600SemiBold",
                fontSize: 12,
              }}
            >
              {formatMoney(item.estimatedAnnualValue)}/yr
            </Text>
          ) : (
            <Text
              style={{
                color: VALUE_COLORS[item.estimatedValueTier],
                fontFamily: "Inter_500Medium",
                fontSize: 12,
              }}
            >
              {VALUE_LABELS[item.estimatedValueTier]}
            </Text>
          )}
        </View>
        {item.ageDays > 14 ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
            <Ionicons name="hourglass-outline" size={12} color={colors.warning ?? "#d97706"} />
            <Text style={{ color: colors.warning ?? "#d97706", fontFamily: "Inter_400Regular", fontSize: 12 }}>
              {item.ageDays}d old
            </Text>
          </View>
        ) : null}
        {item.inspectionId ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 3 }}>
            <Ionicons name="scan-outline" size={12} color={colors.mutedForeground} />
            <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 12 }}>
              Scan on file
            </Text>
          </View>
        ) : null}
      </View>

      {/* Attribution — tech gets primary recognition credit; financial amounts are
          intentionally omitted from field-facing views per commission policy. */}
      {item.technicianName ? (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 6,
            paddingTop: 6,
            borderTopWidth: 1,
            borderTopColor: colors.border,
          }}
        >
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 4,
              backgroundColor: "rgba(22,163,74,0.10)",
              borderRadius: 999,
              paddingHorizontal: 8,
              paddingVertical: 3,
              borderWidth: 1,
              borderColor: "rgba(22,163,74,0.25)",
            }}
          >
            <Ionicons name="ribbon" size={11} color="#16a34a" />
            <Text style={{ color: "#16a34a", fontFamily: "Inter_600SemiBold", fontSize: 11 }}>
              Found by Tech
            </Text>
          </View>
          <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_500Medium", fontSize: 11 }}>
            {item.technicianName}
          </Text>
        </View>
      ) : (
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: 4,
            paddingTop: 6,
            borderTopWidth: 1,
            borderTopColor: colors.border,
          }}
        >
          <Ionicons name="sparkles" size={11} color="#7c3aed" />
          <Text style={{ color: "#7c3aed", fontFamily: "Inter_600SemiBold", fontSize: 11 }}>
            Discovered by FAIE
          </Text>
        </View>
      )}
    </Card>
  );

  return (
    <Screen>
      {/* Header */}
      <View style={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8 }}>
        <Text style={{ color: colors.foreground, fontFamily: "Inter_700Bold", fontSize: 24 }}>
          Leads & Pipeline
        </Text>
      </View>

      {/* Pipeline summary */}
      {data ? (
        <View
          style={{
            flexDirection: "row",
            marginHorizontal: 16,
            marginBottom: 12,
            gap: 10,
          }}
        >
          {[
            { label: "Open",     value: String(data.openCount),       icon: "briefcase-outline" as const,    color: colors.primary,              filterKey: "new" as const },
            { label: "Stale",    value: String(data.staleCount),      icon: "snow-outline" as const,         color: colors.warning ?? "#d97706", filterKey: "stale" as const },
            { label: "Pipeline", value: formatMoney(data.pipelineValue), icon: "trending-up-outline" as const, color: colors.success ?? "#16a34a", filterKey: "all" as const },
          ].map((stat) => (
            <Pressable
              key={stat.label}
              onPress={() => setFilter(stat.filterKey)}
              style={({ pressed }) => ({
                flex: 1,
                padding: 12,
                borderRadius: 12,
                backgroundColor: filter === stat.filterKey && stat.filterKey !== "all"
                  ? stat.color + "18"
                  : colors.card,
                borderWidth: 1,
                borderColor: filter === stat.filterKey && stat.filterKey !== "all"
                  ? stat.color
                  : colors.border,
                alignItems: "center",
                gap: 4,
                opacity: pressed ? 0.75 : 1,
              })}
            >
              <Ionicons name={stat.icon} size={18} color={stat.color} />
              <Text style={{ color: stat.color, fontFamily: "Inter_700Bold", fontSize: 18 }}>
                {stat.value}
              </Text>
              <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 11 }}>
                {stat.label}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {/* Filter tabs */}
      <View style={{ flexDirection: "row", paddingHorizontal: 16, marginBottom: 10, gap: 8 }}>
        {FILTER_TABS.map(({ key, label }) => (
          <Pressable
            key={key}
            onPress={() => setFilter(key)}
            style={{
              paddingHorizontal: 14,
              paddingVertical: 7,
              borderRadius: 999,
              backgroundColor: filter === key ? colors.primary : colors.card,
              borderWidth: 1,
              borderColor: filter === key ? colors.primary : colors.border,
            }}
          >
            <Text
              style={{
                color: filter === key ? colors.primaryForeground : colors.foreground,
                fontFamily: "Inter_500Medium",
                fontSize: 13,
              }}
            >
              {label}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* List */}
      {isLoading ? (
        <FullScreenLoader />
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(i) => String(i.id)}
          renderItem={renderItem}
          contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32, gap: 10 }}
          refreshControl={
            <RefreshControl refreshing={isRefetching} onRefresh={refetch} tintColor={colors.primary} />
          }
          ListEmptyComponent={
            <EmptyState
              icon="briefcase-outline"
              title="No leads here"
              subtitle={
                filter === "all"
                  ? "Complete a property scan to generate your first lead."
                  : `No ${filter.replace("_", " ")} leads right now.`
              }
            />
          }
        />
      )}
    </Screen>
  );
}
