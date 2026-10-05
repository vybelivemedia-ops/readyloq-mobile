/**
 * Visit drill-down — everything that happened at a property on one calendar
 * date. A "visit" groups every inspection that shares the same company +
 * site address + calendar date (one inspection per unit for multi-family
 * properties visited same day; a single inspection for single-family).
 *
 * Shows:
 *   - one card per unit (technician, purpose, findings, notes) that pushes
 *     through to the existing full inspection detail screen
 *   - a chemical usage ledger for the whole visit, with a compliance badge
 *     per application checked against the product's retreatment interval
 */

import { Ionicons } from "@expo/vector-icons";
import { type Href, useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Text, View } from "react-native";

import { EmptyState } from "@/components/ui/EmptyState";
import { Screen } from "@/components/ui/Screen";
import { useColors } from "@/hooks/useColors";
import {
  getPropertyVisit,
  type ChemicalLedgerEntry,
  type PropertyVisitDetail,
  type PropertyVisitUnit,
} from "@/lib/api-client/schedule";

const SEVERITY_COLOR: Record<string, string> = {
  high: "#f87171",
  medium: "#fbbf24",
  low: "#34d399",
};

function formatCalendarDate(calendarDate: string): string {
  const d = new Date(`${calendarDate}T00:00:00`);
  if (Number.isNaN(d.getTime())) return calendarDate;
  return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
}

function UnitCard({ unit, onPress }: { unit: PropertyVisitUnit; onPress: () => void }) {
  const colors = useColors();
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        backgroundColor: colors.card,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: colors.border,
        padding: 14,
        gap: 8,
        opacity: pressed ? 0.85 : 1,
      })}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Text style={{ color: colors.foreground, fontFamily: "Inter_700Bold", fontSize: 15, flex: 1 }}>
          {unit.unitNumber ? `Unit ${unit.unitNumber}` : "Single Unit"}
        </Text>
        {unit.severity && (
          <View
            style={{
              paddingHorizontal: 8,
              paddingVertical: 3,
              borderRadius: 6,
              backgroundColor: (SEVERITY_COLOR[unit.severity] ?? colors.muted) + "22",
            }}
          >
            <Text style={{ color: SEVERITY_COLOR[unit.severity] ?? colors.mutedForeground, fontFamily: "Inter_500Medium", fontSize: 11 }}>
              {unit.severity.charAt(0).toUpperCase() + unit.severity.slice(1)} risk
            </Text>
          </View>
        )}
        <Ionicons name="chevron-forward" size={16} color={colors.mutedForeground} />
      </View>

      <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 13 }}>
        {unit.technicianName} · {unit.visitPurpose ?? "Not specified"}
      </Text>

      <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 12 }}>
        {unit.findingsCount} finding{unit.findingsCount !== 1 ? "s" : ""} · {unit.mediaCount} photo{unit.mediaCount !== 1 ? "s" : ""}
        {unit.pestTypes.length > 0 ? ` · ${unit.pestTypes.join(", ")}` : ""}
      </Text>

      {unit.notes ? (
        <Text style={{ color: colors.foreground, fontFamily: "Inter_400Regular", fontSize: 13 }} numberOfLines={3}>
          {unit.notes}
        </Text>
      ) : null}
    </Pressable>
  );
}

function ComplianceBadge({ entry }: { entry: ChemicalLedgerEntry }) {
  const colors = useColors();
  const { compliance } = entry;

  if (compliance.retreatmentIntervalDays == null || compliance.priorApplicationAt == null) {
    // Nothing to compare against — first application on record, or the
    // product's label sets no minimum retreatment interval.
    return null;
  }

  if (compliance.eligibleNow) {
    return (
      <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, backgroundColor: "#34d39922" }}>
        <Ionicons name="checkmark-circle" size={13} color="#34d399" />
        <Text style={{ color: "#34d399", fontFamily: "Inter_500Medium", fontSize: 11 }}>
          Compliant · {compliance.daysSincePrior}d since prior
        </Text>
      </View>
    );
  }

  const eligibleDate = compliance.nextEligibleReapplicationDate
    ? new Date(compliance.nextEligibleReapplicationDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })
    : null;

  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, backgroundColor: "#f8717122" }}>
      <Ionicons name="warning" size={13} color="#f87171" />
      <Text style={{ color: "#f87171", fontFamily: "Inter_500Medium", fontSize: 11 }}>
        Too soon to reapply{eligibleDate ? ` · eligible ${eligibleDate}` : ""}
      </Text>
    </View>
  );
}

function LedgerRow({ entry }: { entry: ChemicalLedgerEntry }) {
  const colors = useColors();
  const appliedAt = new Date(entry.appliedAt);
  const appliedLabel = Number.isNaN(appliedAt.getTime())
    ? entry.appliedAt
    : appliedAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });

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
        <Text style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold", fontSize: 14, flex: 1 }}>
          {entry.productName}
        </Text>
        <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 12 }}>
          {appliedLabel}
        </Text>
      </View>

      <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 12 }}>
        Target: {entry.targetPest} · {entry.siteClassification}
        {entry.totalProductOz != null ? ` · ${entry.totalProductOz} oz` : ""}
      </Text>

      {entry.epaRegistrationNumber ? (
        <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 11 }}>
          EPA Reg. {entry.epaRegistrationNumber}
        </Text>
      ) : null}

      <ComplianceBadge entry={entry} />

      {entry.notes ? (
        <Text style={{ color: colors.foreground, fontFamily: "Inter_400Regular", fontSize: 12 }} numberOfLines={2}>
          {entry.notes}
        </Text>
      ) : null}
    </View>
  );
}

export default function PropertyVisitScreen() {
  const colors = useColors();
  const router = useRouter();
  const { inspectionId: idParam } = useLocalSearchParams<{ inspectionId?: string | string[] }>();
  const id = Array.isArray(idParam) ? idParam[0] : idParam;
  const inspectionId = id ? Number(id) : NaN;

  const [visit, setVisit] = useState<PropertyVisitDetail | null>(null);
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

    getPropertyVisit(inspectionId)
      .then((v) => {
        if (cancelled) return;
        if (v == null) setNotFound(true);
        else setVisit(v);
        setLoading(false);
      })
      .catch(() => {
        if (!cancelled) {
          setNotFound(true);
          setLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [inspectionId]);

  if (loading) {
    return (
      <Screen edges={["top", "bottom"]}>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 10 }}>
          <ActivityIndicator color={colors.primary} />
          <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 13 }}>
            Loading visit…
          </Text>
        </View>
      </Screen>
    );
  }

  if (notFound || !visit) {
    return (
      <Screen edges={["top", "bottom"]}>
        <EmptyState
          icon="calendar-outline"
          title="Visit not found"
          subtitle="This visit may have been removed."
        />
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
            {visit.address}
          </Text>
          <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 12 }}>
            {formatCalendarDate(visit.calendarDate)}
          </Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, gap: 20, paddingBottom: 40 }} showsVerticalScrollIndicator={false}>
        <View style={{ gap: 10 }}>
          <Text style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold", fontSize: 14 }}>
            {visit.units.length > 1 ? `Units (${visit.units.length})` : "Visit Detail"}
          </Text>
          {visit.units.map((unit) => (
            <UnitCard
              key={unit.id}
              unit={unit}
              onPress={() => router.push(`/inspection/${unit.id}` as Href)}
            />
          ))}
        </View>

        <View style={{ gap: 10 }}>
          <Text style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold", fontSize: 14 }}>
            Chemical Usage Ledger
          </Text>
          {visit.chemicalLedger.length === 0 ? (
            <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 13 }}>
              No chemical applications logged for this visit.
            </Text>
          ) : (
            visit.chemicalLedger.map((entry) => <LedgerRow key={entry.id} entry={entry} />)
          )}
        </View>
      </ScrollView>
    </Screen>
  );
}
