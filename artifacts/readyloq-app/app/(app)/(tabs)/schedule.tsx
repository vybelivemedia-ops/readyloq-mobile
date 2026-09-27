/**
 * Schedule tab — weekly / monthly calendar for technicians and managers.
 *
 * Technicians see their own upcoming stops; managers see the full team.
 * The current week's stops are cached in AsyncStorage so the calendar
 * remains usable without network connectivity.
 */

import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { useUser } from "@clerk/expo";
import { type Href, useRouter } from "expo-router";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
  Platform,
} from "react-native";

import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Screen } from "@/components/ui/Screen";
import { useColors } from "@/hooks/useColors";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";
import { getScheduleEntries, getStopHistory } from "@/lib/api-client/schedule";
import type { ScheduleEntry, StopHistory } from "@/lib/api-client/schedule";
import { getCachedWeek, cacheWeek } from "@/lib/local/schedule-store";

// ─── Date helpers ─────────────────────────────────────────────────────────────

function padded(n: number): string {
  return String(n).padStart(2, "0");
}

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${padded(d.getMonth() + 1)}-${padded(d.getDate())}`;
}

/** Monday of the week containing `d` (ISO week: Mon = 0). */
function mondayOf(d: Date): Date {
  const copy = new Date(d);
  const day = copy.getDay(); // 0 = Sun
  const diff = day === 0 ? -6 : 1 - day; // shift to Monday
  copy.setDate(copy.getDate() + diff);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

/** Add `n` days to a date (returns new Date). */
function addDays(d: Date, n: number): Date {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + n);
  return copy;
}

/** First day of the month containing `d`. */
function firstOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

/** Number of days in the month containing `d`. */
function daysInMonth(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}

const SHORT_DAY = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// ─── Status helpers ───────────────────────────────────────────────────────────

const STATUS_COLOR: Record<string, string> = {
  pending:       "#60a5fa",
  "in-progress": "#fbbf24",
  completed:     "#34d399",
  overdue:       "#f87171",
};

function stopColor(status: string, calendarDate: string): string {
  if (status === "pending" && calendarDate < dateKey(new Date())) {
    return STATUS_COLOR.overdue;
  }
  return STATUS_COLOR[status] ?? STATUS_COLOR.pending;
}

function stopLabel(status: string, calendarDate: string): string {
  if (status === "pending" && calendarDate < dateKey(new Date())) return "Overdue";
  const map: Record<string, string> = {
    pending: "Scheduled",
    "in-progress": "In Progress",
    completed: "Completed",
  };
  return map[status] ?? "Scheduled";
}

// ─── Week Strip ───────────────────────────────────────────────────────────────

function WeekStrip({
  weekStart,
  selectedDay,
  entriesByDay,
  onSelectDay,
  onPrevWeek,
  onNextWeek,
}: {
  weekStart: Date;
  selectedDay: string;
  entriesByDay: Map<string, ScheduleEntry[]>;
  onSelectDay: (d: string) => void;
  onPrevWeek: () => void;
  onNextWeek: () => void;
}) {
  const colors = useColors();
  const today = dateKey(new Date());
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  return (
    <View style={{ backgroundColor: colors.card, borderBottomWidth: 1, borderBottomColor: colors.border }}>
      {/* Week label + navigation */}
      <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingTop: 10, paddingBottom: 4 }}>
        <Pressable onPress={onPrevWeek} hitSlop={12} style={{ padding: 4 }}>
          <Ionicons name="chevron-back" size={18} color={colors.mutedForeground} />
        </Pressable>
        <Text style={{ flex: 1, textAlign: "center", color: colors.foreground, fontFamily: "Inter_600SemiBold", fontSize: 14 }}>
          {MONTH_NAMES[weekStart.getMonth()]} {weekStart.getFullYear()}
        </Text>
        <Pressable onPress={onNextWeek} hitSlop={12} style={{ padding: 4 }}>
          <Ionicons name="chevron-forward" size={18} color={colors.mutedForeground} />
        </Pressable>
      </View>

      {/* Day buttons */}
      <View style={{ flexDirection: "row", paddingHorizontal: 8, paddingBottom: 10 }}>
        {days.map((d) => {
          const dk = dateKey(d);
          const isSelected = dk === selectedDay;
          const isToday = dk === today;
          const count = entriesByDay.get(dk)?.length ?? 0;
          return (
            <Pressable
              key={dk}
              onPress={() => onSelectDay(dk)}
              style={{ flex: 1, alignItems: "center", gap: 4, paddingVertical: 6 }}
            >
              <Text style={{ fontFamily: "Inter_400Regular", fontSize: 11, color: colors.mutedForeground }}>
                {SHORT_DAY[d.getDay() === 0 ? 6 : d.getDay() - 1]}
              </Text>
              <View
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 17,
                  backgroundColor: isSelected
                    ? colors.primary
                    : isToday
                    ? colors.primary + "22"
                    : "transparent",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Text
                  style={{
                    fontFamily: isSelected ? "Inter_700Bold" : "Inter_500Medium",
                    fontSize: 14,
                    color: isSelected
                      ? colors.primaryForeground
                      : isToday
                      ? colors.primary
                      : colors.foreground,
                  }}
                >
                  {d.getDate()}
                </Text>
              </View>
              {/* Stop count dot */}
              {count > 0 ? (
                <View
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: 9,
                    backgroundColor: isSelected ? colors.primaryForeground + "33" : colors.primary + "33",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Text style={{ fontFamily: "Inter_600SemiBold", fontSize: 10, color: isSelected ? colors.primaryForeground : colors.primary }}>
                    {count}
                  </Text>
                </View>
              ) : (
                <View style={{ width: 18, height: 18 }} />
              )}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

// ─── Month Grid ───────────────────────────────────────────────────────────────

function MonthGrid({
  referenceDate,
  selectedDay,
  entriesByDay,
  onSelectDay,
  onPrevMonth,
  onNextMonth,
}: {
  referenceDate: Date;
  selectedDay: string;
  entriesByDay: Map<string, ScheduleEntry[]>;
  onSelectDay: (d: string, weekStart: Date) => void;
  onPrevMonth: () => void;
  onNextMonth: () => void;
}) {
  const colors = useColors();
  const today = dateKey(new Date());

  // Build the 6-week grid for this month
  const monthStart = firstOfMonth(referenceDate);
  const gridStart = mondayOf(monthStart);
  const cells = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const monthIdx = referenceDate.getMonth();

  return (
    <View style={{ backgroundColor: colors.card, borderBottomWidth: 1, borderBottomColor: colors.border, paddingHorizontal: 12, paddingBottom: 8 }}>
      {/* Month header */}
      <View style={{ flexDirection: "row", alignItems: "center", paddingVertical: 10 }}>
        <Pressable onPress={onPrevMonth} hitSlop={12} style={{ padding: 4 }}>
          <Ionicons name="chevron-back" size={18} color={colors.mutedForeground} />
        </Pressable>
        <Text style={{ flex: 1, textAlign: "center", color: colors.foreground, fontFamily: "Inter_600SemiBold", fontSize: 14 }}>
          {MONTH_NAMES[referenceDate.getMonth()]} {referenceDate.getFullYear()}
        </Text>
        <Pressable onPress={onNextMonth} hitSlop={12} style={{ padding: 4 }}>
          <Ionicons name="chevron-forward" size={18} color={colors.mutedForeground} />
        </Pressable>
      </View>

      {/* Day-of-week headers */}
      <View style={{ flexDirection: "row", marginBottom: 4 }}>
        {SHORT_DAY.map((d) => (
          <Text
            key={d}
            style={{ flex: 1, textAlign: "center", fontFamily: "Inter_500Medium", fontSize: 10, color: colors.mutedForeground }}
          >
            {d}
          </Text>
        ))}
      </View>

      {/* 6 × 7 cells */}
      {Array.from({ length: 6 }, (_, row) => (
        <View key={row} style={{ flexDirection: "row" }}>
          {cells.slice(row * 7, row * 7 + 7).map((d) => {
            const dk = dateKey(d);
            const inMonth = d.getMonth() === monthIdx;
            const isSelected = dk === selectedDay;
            const isToday = dk === today;
            const count = entriesByDay.get(dk)?.length ?? 0;
            return (
              <Pressable
                key={dk}
                onPress={() => onSelectDay(dk, mondayOf(d))}
                style={{ flex: 1, alignItems: "center", paddingVertical: 3 }}
              >
                <View
                  style={{
                    width: 30,
                    height: 30,
                    borderRadius: 15,
                    backgroundColor: isSelected
                      ? colors.primary
                      : isToday
                      ? colors.primary + "22"
                      : "transparent",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Text
                    style={{
                      fontFamily: isSelected ? "Inter_700Bold" : "Inter_400Regular",
                      fontSize: 12,
                      color: isSelected
                        ? colors.primaryForeground
                        : inMonth
                        ? isToday ? colors.primary : colors.foreground
                        : colors.mutedForeground + "66",
                    }}
                  >
                    {d.getDate()}
                  </Text>
                </View>
                {count > 0 && (
                  <View
                    style={{
                      width: 4,
                      height: 4,
                      borderRadius: 2,
                      backgroundColor: isSelected ? colors.primaryForeground + "99" : colors.primary,
                      marginTop: 1,
                    }}
                  />
                )}
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

// ─── Stop Card ────────────────────────────────────────────────────────────────

function StopCard({
  entry,
  showTech,
  onPress,
}: {
  entry: ScheduleEntry;
  showTech: boolean;
  onPress: () => void;
}) {
  const colors = useColors();
  const color = stopColor(entry.status, entry.calendarDate);
  const label = stopLabel(entry.status, entry.calendarDate);
  const pests = entry.pestTypes?.join(", ") || null;

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        backgroundColor: colors.card,
        borderRadius: colors.radius,
        borderWidth: 1,
        borderColor: colors.border,
        borderLeftWidth: 3,
        borderLeftColor: color,
        padding: 14,
        marginBottom: 10,
        opacity: pressed ? 0.75 : 1,
        flexDirection: "row",
        alignItems: "flex-start",
        gap: 12,
      })}
    >
      <View style={{ flex: 1, gap: 3 }}>
        <Text
          numberOfLines={1}
          style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold", fontSize: 15 }}
        >
          {entry.siteAddress}
        </Text>
        {entry.clientName ? (
          <Text numberOfLines={1} style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 13 }}>
            {entry.clientName}
          </Text>
        ) : null}
        {pests ? (
          <Text numberOfLines={1} style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 12 }}>
            {pests}
          </Text>
        ) : null}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color }} />
            <Text style={{ color, fontFamily: "Inter_500Medium", fontSize: 12 }}>{label}</Text>
          </View>
          {showTech && (
            <>
              <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>·</Text>
              <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 12 }}>
                {entry.technicianName}
              </Text>
            </>
          )}
        </View>
      </View>
      <Ionicons name="chevron-forward" size={16} color={colors.mutedForeground} style={{ marginTop: 2 }} />
    </Pressable>
  );
}

// ─── Property Profile Sheet ───────────────────────────────────────────────────

function PropertyProfileSheet({
  entry,
  onClose,
  onStartInspection,
  onOpenVisit,
}: {
  entry: ScheduleEntry;
  onClose: () => void;
  onStartInspection: () => void;
  onOpenVisit: (inspectionId: number) => void;
}) {
  const colors = useColors();
  const [profile, setProfile] = useState<StopHistory | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setProfile(null);
    setLoadError(null);

    getStopHistory(entry.id)
      .then((history) => {
        if (cancelled) return;
        setProfile(history);
        setLoadError(history ? null : "This scheduled stop is no longer available.");
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setLoadError("Property history could not be loaded. Check your connection and try again.");
        setLoading(false);
      });

    return () => { cancelled = true; };
  }, [entry.id, retryNonce]);

  const SEVERITY_COLOR: Record<string, string> = {
    high: "#f87171",
    medium: "#fbbf24",
    low: "#34d399",
  };

  return (
    <Modal
      visible
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <Pressable
        style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.5)" }}
        onPress={onClose}
      />
      <View
        style={{
          backgroundColor: colors.background,
          borderTopLeftRadius: 20,
          borderTopRightRadius: 20,
          maxHeight: "82%",
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
        }}
      >
        {/* Handle */}
        <View style={{ alignItems: "center", paddingTop: 10 }}>
          <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border }} />
        </View>

        {/* Header */}
        <View style={{ flexDirection: "row", alignItems: "center", paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.border }}>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ color: colors.foreground, fontFamily: "Inter_700Bold", fontSize: 16 }} numberOfLines={2}>
              {entry.siteAddress}
            </Text>
            {entry.clientName ? (
              <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 13 }}>
                {entry.clientName}
              </Text>
            ) : null}
          </View>
          <Pressable onPress={onClose} hitSlop={12} style={{ padding: 4, marginLeft: 8 }}>
            <Ionicons name="close" size={20} color={colors.mutedForeground} />
          </Pressable>
        </View>

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 20, gap: 20 }}
          showsVerticalScrollIndicator={false}
        >
          {loading ? (
            <View style={{ alignItems: "center", paddingVertical: 32 }}>
              <ActivityIndicator color={colors.primary} />
              <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 13, marginTop: 10 }}>
                Loading property history…
              </Text>
            </View>
          ) : loadError ? (
            <View style={{ alignItems: "center", paddingVertical: 28, gap: 12 }}>
              <Ionicons name="cloud-offline-outline" size={36} color={colors.mutedForeground} />
              <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 14, textAlign: "center" }}>
                {loadError}
              </Text>
              <Pressable
                testID="stop-history-retry"
                onPress={() => setRetryNonce((value) => value + 1)}
                style={({ pressed }) => ({
                  borderWidth: 1,
                  borderColor: colors.primary,
                  borderRadius: 8,
                  paddingHorizontal: 16,
                  paddingVertical: 9,
                  opacity: pressed ? 0.8 : 1,
                })}
              >
                <Text style={{ color: colors.primary, fontFamily: "Inter_600SemiBold", fontSize: 13 }}>
                  Try Again
                </Text>
              </Pressable>
            </View>
          ) : (
            <>
              {/* Visit history */}
              {profile && profile.recentInspections.length > 0 && (
                <View style={{ gap: 8 }}>
                  <Text style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold", fontSize: 14 }}>
                    Recent Visits
                  </Text>
                  {profile.recentInspections.slice(0, 3).map((r) => (
                    <Pressable
                      key={r.id}
                      onPress={() => onOpenVisit(r.id)}
                      style={({ pressed }) => ({
                        backgroundColor: colors.card,
                        borderRadius: 10,
                        borderWidth: 1,
                        borderColor: colors.border,
                        padding: 12,
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 10,
                        opacity: pressed ? 0.85 : 1,
                      })}
                    >
                      <View style={{ flex: 1, gap: 2 }}>
                        <Text style={{ color: colors.foreground, fontFamily: "Inter_500Medium", fontSize: 13 }}>
                          {r.calendarDate}
                        </Text>
                        <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 12 }}>
                          {r.technicianName} · {r.findingsCount} finding{r.findingsCount !== 1 ? "s" : ""}
                        </Text>
                      </View>
                      {r.severity && (
                        <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, backgroundColor: (SEVERITY_COLOR[r.severity] ?? colors.muted) + "22" }}>
                          <Text style={{ color: SEVERITY_COLOR[r.severity] ?? colors.mutedForeground, fontFamily: "Inter_500Medium", fontSize: 11 }}>
                            {r.severity.charAt(0).toUpperCase() + r.severity.slice(1)} risk
                          </Text>
                        </View>
                      )}
                      <Ionicons name="chevron-forward" size={16} color={colors.mutedForeground} />
                    </Pressable>
                  ))}
                </View>
              )}

              {/* Historical photo evidence */}
              {profile && (profile.historicalPhotos ?? []).length > 0 && (
                <View style={{ gap: 8 }}>
                  <Text style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold", fontSize: 14 }}>
                    Photo History
                  </Text>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    contentContainerStyle={{ gap: 10 }}
                  >
                    {profile.historicalPhotos.map((photo) => (
                      <Pressable
                        key={photo.id}
                        testID={`stop-history-photo-${photo.id}`}
                        onPress={() => onOpenVisit(photo.inspectionId)}
                        style={({ pressed }) => ({
                          width: 124,
                          borderRadius: 10,
                          overflow: "hidden",
                          borderWidth: 1,
                          borderColor: colors.border,
                          backgroundColor: colors.card,
                          opacity: pressed ? 0.85 : 1,
                        })}
                      >
                        <Image
                          source={{ uri: photo.url }}
                          accessibilityLabel={photo.caption ?? `Inspection photo from ${photo.calendarDate}`}
                          style={{ width: "100%", height: 86, backgroundColor: colors.muted }}
                          resizeMode="cover"
                        />
                        <View style={{ paddingHorizontal: 8, paddingVertical: 7, gap: 2 }}>
                          <Text style={{ color: colors.foreground, fontFamily: "Inter_500Medium", fontSize: 11 }} numberOfLines={1}>
                            {photo.caption ?? photo.filename ?? "Inspection photo"}
                          </Text>
                          <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 10 }}>
                            {photo.calendarDate}
                          </Text>
                        </View>
                      </Pressable>
                    ))}
                  </ScrollView>
                </View>
              )}

              {/* Recent material and chemical usage */}
              {profile && (profile.materialHistory ?? []).length > 0 && (
                <View style={{ gap: 8 }}>
                  <Text style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold", fontSize: 14 }}>
                    Material History
                  </Text>
                  {profile.materialHistory.slice(0, 6).map((material) => {
                    const appliedDate = new Date(material.appliedAt);
                    const dateLabel = Number.isNaN(appliedDate.getTime())
                      ? material.appliedAt
                      : appliedDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
                    return (
                      <Pressable
                        key={material.id}
                        onPress={() => onOpenVisit(material.inspectionId)}
                        style={({ pressed }) => ({
                          backgroundColor: colors.card,
                          borderRadius: 10,
                          borderWidth: 1,
                          borderColor: colors.border,
                          padding: 12,
                          gap: 5,
                          opacity: pressed ? 0.85 : 1,
                        })}
                      >
                        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                          <Text style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold", fontSize: 13, flex: 1 }}>
                            {material.productName}
                          </Text>
                          <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 11 }}>
                            {dateLabel}
                          </Text>
                        </View>
                        <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 12 }}>
                          {material.targetPest}
                          {material.totalProductOz != null ? ` · ${material.totalProductOz} oz` : ""}
                          {material.equipmentUsed ? ` · ${material.equipmentUsed}` : ""}
                        </Text>
                        {material.compliance.retreatmentIntervalDays != null && material.compliance.priorApplicationAt != null ? (
                          <Text style={{ color: material.compliance.isCompliant ? colors.primary : colors.warning, fontFamily: "Inter_500Medium", fontSize: 11 }}>
                            {material.compliance.isCompliant
                              ? `Compliant · ${material.compliance.daysSincePrior ?? 0}d since prior use`
                              : "Applied before the label retreatment interval"}
                          </Text>
                        ) : null}
                      </Pressable>
                    );
                  })}
                </View>
              )}

              {/* Recurring issues */}
              {profile && profile.historicalFindings.length > 0 && (
                <View style={{ gap: 8 }}>
                  <Text style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold", fontSize: 14 }}>
                    Recurring Issues
                  </Text>
                  {profile.historicalFindings.slice(0, 4).map((f, i) => (
                    <View key={i} style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
                      <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: colors.primary, marginTop: 6 }} />
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: colors.foreground, fontFamily: "Inter_500Medium", fontSize: 13 }}>
                          {f.description}
                        </Text>
                        <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 11 }}>
                          {f.category} · seen {f.frequency}× 
                        </Text>
                      </View>
                    </View>
                  ))}
                </View>
              )}

              {/* Bait stations */}
              {profile && profile.activeBaitStations > 0 && (
                <View style={{ flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: colors.card, borderRadius: 10, borderWidth: 1, borderColor: colors.border, padding: 14 }}>
                  <Ionicons name="radio-button-on-outline" size={22} color={colors.primary} />
                  <View>
                    <Text style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold", fontSize: 14 }}>
                      {profile.activeBaitStations} Active Bait Station{profile.activeBaitStations !== 1 ? "s" : ""}
                    </Text>
                    <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 12 }}>
                      From most recent inspection
                    </Text>
                  </View>
                </View>
              )}

              {/* Guarded legacy PestPac history */}
              {profile && (
                <View style={{ gap: 8 }} testID="pestpac-stop-history">
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    <Text style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold", fontSize: 14, flex: 1 }}>
                      Legacy PestPac Notes
                    </Text>
                    <View style={{ paddingHorizontal: 8, paddingVertical: 3, borderRadius: 12, backgroundColor: colors.accent }}>
                      <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_500Medium", fontSize: 10 }}>
                        {profile.pestPacHistory.status === "available" ? "CONNECTED" : "LOCAL HISTORY ACTIVE"}
                      </Text>
                    </View>
                  </View>
                  {profile.pestPacHistory.status === "available" && profile.pestPacHistory.notes.length > 0 ? (
                    profile.pestPacHistory.notes.map((note) => (
                      <View
                        key={note.id}
                        style={{
                          backgroundColor: colors.card,
                          borderRadius: 10,
                          borderWidth: 1,
                          borderColor: colors.border,
                          padding: 12,
                          gap: 4,
                        }}
                      >
                        {(note.category || note.createdAt) && (
                          <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_500Medium", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.4 }}>
                            {[note.category, note.createdAt ? new Date(note.createdAt).toLocaleDateString() : null]
                              .filter(Boolean)
                              .join(" · ")}
                          </Text>
                        )}
                        <Text style={{ color: colors.foreground, fontFamily: "Inter_400Regular", fontSize: 13 }}>
                          {note.note}
                        </Text>
                        {note.authorName ? (
                          <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 11 }}>
                            Added by {note.authorName}
                          </Text>
                        ) : null}
                      </View>
                    ))
                  ) : (
                    <View style={{ backgroundColor: colors.card, borderRadius: 10, borderWidth: 1, borderColor: colors.border, padding: 12 }}>
                      <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 12 }}>
                        {profile.pestPacHistory.status === "available"
                          ? "No legacy PestPac notes were found for this location."
                          : profile.pestPacHistory.status === "disabled"
                          ? "Legacy PestPac history is awaiting contract activation. ReadyLoq history remains available."
                          : profile.pestPacHistory.status === "not_configured"
                          ? "PestPac history is not configured for this company. ReadyLoq history remains available."
                          : profile.pestPacHistory.status === "not_mapped"
                          ? "This stop is not linked to a PestPac location. ReadyLoq history remains available."
                          : "Legacy PestPac history is temporarily unavailable. ReadyLoq history remains available."}
                      </Text>
                    </View>
                  )}
                </View>
              )}

              {/* Site notes */}
              {profile && profile.notes.length > 0 && (
                <View style={{ gap: 8 }}>
                  <Text style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold", fontSize: 14 }}>
                    Site Notes
                  </Text>
                  {profile.notes.map((n) => (
                    <View
                      key={n.id}
                      style={{
                        backgroundColor: colors.warning ? colors.warning + "0D" : colors.accent,
                        borderRadius: 10,
                        borderWidth: 1,
                        borderColor: colors.border,
                        padding: 12,
                        gap: 4,
                      }}
                    >
                      {n.category && (
                        <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_500Medium", fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5 }}>
                          {n.category}{n.zone ? ` · ${n.zone}` : ""}
                        </Text>
                      )}
                      <Text style={{ color: colors.foreground, fontFamily: "Inter_400Regular", fontSize: 13 }}>
                        {n.note}
                      </Text>
                    </View>
                  ))}
                </View>
              )}

              {/* Historical pests */}
              {profile && profile.historicalPests.length > 0 && (
                <View style={{ gap: 8 }}>
                  <Text style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold", fontSize: 14 }}>
                    Historical Pests
                  </Text>
                  <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                    {profile.historicalPests.map((p) => (
                      <View key={p} style={{ paddingHorizontal: 10, paddingVertical: 4, backgroundColor: colors.accent, borderRadius: 20, borderWidth: 1, borderColor: colors.border }}>
                        <Text style={{ color: colors.foreground, fontFamily: "Inter_500Medium", fontSize: 12 }}>{p}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              )}

              {(!profile || (
                profile.recentInspections.length === 0 &&
                (profile.historicalPhotos ?? []).length === 0 &&
                (profile.materialHistory ?? []).length === 0 &&
                profile.historicalFindings.length === 0 &&
                profile.notes.length === 0 &&
                profile.activeBaitStations === 0
              )) && !loading && (
                <View style={{ alignItems: "center", paddingVertical: 24 }}>
                  <Ionicons name="document-outline" size={36} color={colors.mutedForeground} />
                  <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 14, marginTop: 10, textAlign: "center" }}>
                    No prior history for this property.
                  </Text>
                </View>
              )}
            </>
          )}
        </ScrollView>

        {/* Start Inspection CTA */}
        <View style={{ paddingHorizontal: 20, paddingVertical: 16, borderTopWidth: 1, borderTopColor: colors.border, paddingBottom: Platform.OS === "ios" ? 32 : 16 }}>
          <Pressable
            onPress={onStartInspection}
            style={({ pressed }) => ({
              backgroundColor: colors.primary,
              borderRadius: colors.radius,
              padding: 16,
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: 10,
              opacity: pressed ? 0.9 : 1,
            })}
          >
            <Ionicons name="camera-outline" size={20} color={colors.primaryForeground} />
            <Text style={{ color: colors.primaryForeground, fontFamily: "Inter_600SemiBold", fontSize: 16 }}>
              Start Inspection
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function ScheduleScreen() {
  const colors = useColors();
  const router = useRouter();
  const { user } = useCurrentUser();
  const { isConnected } = useNetworkStatus();

  const { user: clerkUser } = useUser();
  const role = user?.role ?? "technician";
  const isManager = role === "manager" || role === "owner";
  const technicianId = user?.clerkUserId ?? null;
  const technicianFullName = clerkUser?.fullName ?? null;

  // ── View state ─────────────────────────────────────────────────────────────
  type ViewMode = "week" | "month";
  const [viewMode, setViewMode] = useState<ViewMode>("week");
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()));
  const [monthRef, setMonthRef] = useState(() => new Date());
  const [selectedDay, setSelectedDay] = useState(() => dateKey(new Date()));
  const [filterTech, setFilterTech] = useState<string>("");
  const [selectedEntry, setSelectedEntry] = useState<ScheduleEntry | null>(null);

  // ── Date window for the query ───────────────────────────────────────────────
  // For month view we extend the window so all month cells are covered.
  const queryStart = viewMode === "month"
    ? dateKey(mondayOf(firstOfMonth(monthRef)))
    : dateKey(weekStart);
  const queryEnd = viewMode === "month"
    ? dateKey(addDays(mondayOf(firstOfMonth(monthRef)), 41))
    : dateKey(addDays(weekStart, 6));

  // ── Network fetch ───────────────────────────────────────────────────────────
  const {
    data: networkEntries,
    isLoading,
    isRefetching,
    refetch,
    error: fetchError,
  } = useQuery({
    queryKey: ["schedule", queryStart, queryEnd],
    queryFn: () => getScheduleEntries(queryStart, queryEnd),
    enabled: isConnected,
    staleTime: 60_000,
    retry: 1,
  });

  // Stable user ID for cache scoping — prevents cross-account data leaks on
  // shared devices by keying each cache entry to the authenticated Clerk user.
  const userId = user?.clerkUserId ?? null;

  // ── Offline cache ───────────────────────────────────────────────────────────
  const [cachedEntries, setCachedEntries] = useState<ScheduleEntry[] | null>(null);
  const [servingFromCache, setServingFromCache] = useState(false);

  // Load cache for current week when offline or network fails
  useEffect(() => {
    if (!userId) return;
    if (!isConnected || fetchError) {
      getCachedWeek(userId, dateKey(weekStart)).then((cached) => {
        if (cached) {
          setCachedEntries(cached.entries);
          setServingFromCache(true);
        }
      });
    } else {
      setServingFromCache(false);
    }
  }, [isConnected, fetchError, weekStart, userId]);

  // Persist fetched entries to cache whenever the query succeeds (including
  // empty weeks) so stale stops are evicted when the server returns an empty week.
  useEffect(() => {
    if (networkEntries !== undefined && userId) {
      void cacheWeek(userId, dateKey(weekStart), networkEntries);
    }
  }, [networkEntries, weekStart, userId]);

  const entries: ScheduleEntry[] = networkEntries ?? cachedEntries ?? [];

  // ── Filter entries ──────────────────────────────────────────────────────────
  const visibleEntries = useMemo(() => {
    let list = entries;
    // Technicians only see their own stops.
    if (!isManager && technicianId) {
      list = list.filter(
        (e) =>
          e.technicianId === technicianId ||
          // Fallback: name match for inspections created before ID was stored
          (e.technicianId == null &&
            technicianFullName != null &&
            e.technicianName === technicianFullName),
      );
    }
    // Managers can filter by tech.
    if (isManager && filterTech) {
      list = list.filter((e) => e.technicianName === filterTech);
    }
    return list;
  }, [entries, isManager, technicianId, filterTech, technicianFullName]);

  // Build a day → entries map for both week strip and month grid
  const entriesByDay = useMemo(() => {
    const map = new Map<string, ScheduleEntry[]>();
    for (const e of visibleEntries) {
      const k = e.calendarDate;
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(e);
    }
    return map;
  }, [visibleEntries]);

  // Stops for the selected day
  const dayEntries = useMemo(
    () => entriesByDay.get(selectedDay) ?? [],
    [entriesByDay, selectedDay],
  );

  // Unique technician names for manager filter
  const technicianNames = useMemo(
    () => Array.from(new Set(entries.map((e) => e.technicianName))).sort(),
    [entries],
  );

  // ── Navigation handlers ─────────────────────────────────────────────────────

  const handlePrevWeek = useCallback(() => {
    setWeekStart((w) => addDays(w, -7));
    setMonthRef((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1));
  }, []);

  const handleNextWeek = useCallback(() => {
    setWeekStart((w) => addDays(w, 7));
    setMonthRef((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1));
  }, []);

  const handlePrevMonth = useCallback(() => {
    setMonthRef((m) => new Date(m.getFullYear(), m.getMonth() - 1, 1));
  }, []);

  const handleNextMonth = useCallback(() => {
    setMonthRef((m) => new Date(m.getFullYear(), m.getMonth() + 1, 1));
  }, []);

  const handleMonthDaySelect = useCallback((dk: string, ws: Date) => {
    setSelectedDay(dk);
    setWeekStart(ws);
    // Keep monthRef in sync so the month header stays correct
    const d = new Date(dk);
    setMonthRef(new Date(d.getFullYear(), d.getMonth(), 1));
    setViewMode("week");
  }, []);

  // ── Entry interaction ───────────────────────────────────────────────────────

  const handleStartInspection = useCallback((entry: ScheduleEntry) => {
    setSelectedEntry(null);
    router.push(
      `/new-inspection?address=${encodeURIComponent(entry.siteAddress)}&client=${encodeURIComponent(entry.clientName ?? "")}&unit=${encodeURIComponent(entry.unitNumber ?? "")}` as Href,
    );
  }, [router]);

  const handleOpenVisit = useCallback((inspectionId: number) => {
    setSelectedEntry(null);
    router.push(`/property-visit/${inspectionId}` as Href);
  }, [router]);

  // ── Formatted day label ─────────────────────────────────────────────────────
  const selectedDayLabel = useMemo(() => {
    const d = new Date(selectedDay + "T00:00:00");
    return d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  }, [selectedDay]);

  const showLoading = isLoading && !cachedEntries;
  const showOfflineBanner = servingFromCache && !isConnected;

  return (
    <Screen edges={["top"]}>
      {/* ── Header ── */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          paddingHorizontal: 16,
          paddingVertical: 12,
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
          backgroundColor: colors.card,
        }}
      >
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.foreground, fontFamily: "Inter_700Bold", fontSize: 20 }}>
            Schedule
          </Text>
          {isManager && (
            <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 12 }}>
              Full team calendar
            </Text>
          )}
        </View>

        {/* Week / Month toggle */}
        <View
          style={{
            flexDirection: "row",
            backgroundColor: colors.muted ?? colors.border,
            borderRadius: 8,
            padding: 2,
          }}
        >
          {(["week", "month"] as ViewMode[]).map((v) => (
            <Pressable
              key={v}
              onPress={() => setViewMode(v)}
              style={{
                paddingHorizontal: 12,
                paddingVertical: 5,
                borderRadius: 6,
                backgroundColor: viewMode === v ? colors.card : "transparent",
              }}
            >
              <Text
                style={{
                  fontFamily: "Inter_500Medium",
                  fontSize: 13,
                  color: viewMode === v ? colors.foreground : colors.mutedForeground,
                }}
              >
                {v.charAt(0).toUpperCase() + v.slice(1)}
              </Text>
            </Pressable>
          ))}
        </View>

        {/* Refresh */}
        <Pressable onPress={() => void refetch()} hitSlop={12} style={{ padding: 4, marginLeft: 8 }}>
          <Ionicons
            name="refresh-outline"
            size={20}
            color={isRefetching ? colors.primary : colors.mutedForeground}
          />
        </Pressable>
      </View>

      {/* ── Offline banner ── */}
      {showOfflineBanner && (
        <View style={{ backgroundColor: "#4F7FFF", paddingVertical: 5, alignItems: "center" }}>
          <Text style={{ color: "#fff", fontFamily: "Inter_500Medium", fontSize: 12 }}>
            Offline — showing cached schedule
          </Text>
        </View>
      )}

      {/* ── Manager tech filter ── */}
      {isManager && technicianNames.length > 1 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 8, gap: 8 }}
          style={{ backgroundColor: colors.card, borderBottomWidth: 1, borderBottomColor: colors.border }}
        >
          {["All", ...technicianNames].map((name) => {
            const active = name === "All" ? !filterTech : filterTech === name;
            return (
              <Pressable
                key={name}
                onPress={() => setFilterTech(name === "All" ? "" : name)}
                style={{
                  paddingHorizontal: 12,
                  paddingVertical: 5,
                  borderRadius: 20,
                  backgroundColor: active ? colors.primary : colors.muted ?? colors.border,
                  borderWidth: 1,
                  borderColor: active ? colors.primary : colors.border,
                }}
              >
                <Text
                  style={{
                    color: active ? colors.primaryForeground : colors.foreground,
                    fontFamily: "Inter_500Medium",
                    fontSize: 13,
                  }}
                >
                  {name}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      )}

      {/* ── Month grid (month mode only) ── */}
      {viewMode === "month" && (
        <MonthGrid
          referenceDate={monthRef}
          selectedDay={selectedDay}
          entriesByDay={entriesByDay}
          onSelectDay={handleMonthDaySelect}
          onPrevMonth={handlePrevMonth}
          onNextMonth={handleNextMonth}
        />
      )}

      {/* ── Week strip (always visible) ── */}
      <WeekStrip
        weekStart={weekStart}
        selectedDay={selectedDay}
        entriesByDay={entriesByDay}
        onSelectDay={setSelectedDay}
        onPrevWeek={handlePrevWeek}
        onNextWeek={handleNextWeek}
      />

      {/* ── Day stops list ── */}
      {showLoading ? (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={colors.primary} />
          <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 13, marginTop: 10 }}>
            Loading schedule…
          </Text>
        </View>
      ) : (
        <FlatList
          data={dayEntries}
          keyExtractor={(e) => String(e.id)}
          contentContainerStyle={{ padding: 16, paddingBottom: 40, flexGrow: 1 }}
          refreshControl={
            <RefreshControl
              refreshing={isRefetching}
              onRefresh={() => void refetch()}
              tintColor={colors.primary}
            />
          }
          ListHeaderComponent={
            <Text
              style={{
                color: colors.foreground,
                fontFamily: "Inter_600SemiBold",
                fontSize: 15,
                marginBottom: 12,
              }}
            >
              {selectedDayLabel}
            </Text>
          }
          ListEmptyComponent={
            <EmptyState
              icon="calendar-outline"
              title="No stops scheduled"
              subtitle={
                isManager
                  ? "No inspections are scheduled for this day yet. Book one from the portal."
                  : "No stops assigned for this day."
              }
            />
          }
          renderItem={({ item }) => (
            <StopCard
              entry={item}
              showTech={isManager}
              onPress={() => setSelectedEntry(item)}
            />
          )}
        />
      )}

      {/* ── Property profile sheet ── */}
      {selectedEntry && (
        <PropertyProfileSheet
          entry={selectedEntry}
          onClose={() => setSelectedEntry(null)}
          onStartInspection={() => handleStartInspection(selectedEntry)}
          onOpenVisit={handleOpenVisit}
        />
      )}
    </Screen>
  );
}
