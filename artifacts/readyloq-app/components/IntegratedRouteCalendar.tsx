/**
 * IntegratedRouteCalendar — dashboard module (technician / sales / manager).
 *
 * Shows the next 7 days of scheduled stops (today emphasized). Each stop
 * surfaces two flags directly on the entry — no need to open it first:
 *   - Route Readiness: whether the assigned technician's daily rig (chemical
 *     kit) has been set up for that stop's date.
 *   - Route Chemical Outlook: a rollup of due-soon/overdue products at that
 *     address, projected from label retreatment intervals.
 *
 * Tapping a stop's action row opens one of three destinations:
 *   1. Visit history   → /property-visit/[inspectionId]
 *   2. Chemical Outlook → /route-outlook/[inspectionId]
 *   3. Route Readiness  → the existing DailyRouteSetupModal when the stop is
 *      the viewer's own today's rig, otherwise a read-only /route-readiness
 *      lookup screen (future date, or another technician's rig).
 */

import React, { useMemo, useState } from "react";
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useQuery } from "@tanstack/react-query";
import { type Href, useRouter } from "expo-router";

import { useColors } from "@/hooks/useColors";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useDailyRoute } from "@/hooks/useDailyRoute";
import { DailyRouteSetupModal } from "@/components/DailyRouteSetupModal";
import {
  getRouteCalendar,
  type RouteCalendarDay,
  type RouteCalendarStop,
} from "@/lib/api-client/schedule";

const DAYS_AHEAD = 6; // today + 6 more days = 7-day window

// Route Calendar dates are this DEVICE's own local calendar dates — matching
// `technicianDailyRigsTable.rigDate`, which the daily-rig client (see
// daily-route.ts's `todayDateString()`) also writes using local device date.
// `getRouteCalendar`/`getRouteOutlook` send this device's UTC offset so the
// server buckets/labels every stop's calendarDate in the same local frame,
// keeping the calendar and Route Readiness consistent with each other.
function localDateString(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function dayChipLabel(dateStr: string, todayStr: string, tomorrowStr: string): string {
  if (dateStr === todayStr) return "Today";
  if (dateStr === tomorrowStr) return "Tomorrow";
  const d = new Date(`${dateStr}T00:00:00`);
  return d.toLocaleDateString(undefined, { weekday: "short", day: "numeric" });
}

interface IntegratedRouteCalendarProps {
  router: ReturnType<typeof useRouter>;
  /** Show the assigned technician's name on each stop (manager view of the whole team). */
  showTechnicianNames: boolean;
}

export function IntegratedRouteCalendar({
  router,
  showTechnicianNames,
}: IntegratedRouteCalendarProps) {
  const colors = useColors();
  const { user } = useCurrentUser();

  const { todayStr, tomorrowStr, endStr } = useMemo(() => {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const end = new Date(now);
    end.setDate(end.getDate() + DAYS_AHEAD);
    return {
      todayStr: localDateString(now),
      tomorrowStr: localDateString(tomorrow),
      endStr: localDateString(end),
    };
  }, []);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["route-calendar", todayStr, endStr],
    queryFn: () => getRouteCalendar(todayStr, endStr),
    staleTime: 60_000,
  });

  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  // Reusable hook that backs the existing "Route Readiness" setup flow — used
  // here only for the viewer's OWN today's stop; everything else is read-only.
  const {
    assignmentsWithProducts,
    saveRoute,
    showSetupModal,
    openSetupModal,
    closeSetupModal,
  } = useDailyRoute();

  const days: RouteCalendarDay[] = data ?? [];
  const activeDate =
    selectedDate && days.some((d) => d.date === selectedDate)
      ? selectedDate
      : (days.find((d) => d.date === todayStr)?.date ?? days[0]?.date ?? todayStr);
  const activeDay = days.find((d) => d.date === activeDate);
  const stops = activeDay?.stops ?? [];

  const dayHasFlag = (day: RouteCalendarDay): boolean =>
    day.stops.some(
      (s) => s.readiness.dailyRigSetUp === false || s.outlook.overdueCount > 0 || s.outlook.dueSoonCount > 0,
    );

  const handleReadinessPress = (stop: RouteCalendarStop) => {
    const isOwnToday = stop.calendarDate === todayStr && stop.technicianId === user?.clerkUserId;
    if (isOwnToday) {
      openSetupModal();
      return;
    }
    if (!stop.technicianId) {
      Alert.alert("Route Readiness", "No technician is assigned to this stop yet.");
      return;
    }
    router.push(
      (`/route-readiness?technicianId=${encodeURIComponent(stop.technicianId)}&date=${encodeURIComponent(stop.calendarDate)}&technicianName=${encodeURIComponent(stop.technicianName)}`) as Href,
    );
  };

  return (
    <View style={{ gap: 10 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Ionicons name="calendar-outline" size={18} color={colors.primary} />
        <Text style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold", fontSize: 15 }}>
          Route Calendar
        </Text>
      </View>

      {isLoading ? (
        <View
          style={{
            padding: 20,
            alignItems: "center",
            backgroundColor: colors.card,
            borderRadius: colors.radius,
            borderWidth: 1,
            borderColor: colors.border,
          }}
        >
          <ActivityIndicator color={colors.primary} />
        </View>
      ) : isError ? (
        <View
          style={{
            padding: 14,
            backgroundColor: colors.card,
            borderRadius: colors.radius,
            borderWidth: 1,
            borderColor: colors.border,
          }}
        >
          <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 13 }}>
            Couldn't load the route calendar right now.
          </Text>
        </View>
      ) : (
        <>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {days.length === 0 ? (
              <View
                style={{
                  paddingVertical: 8,
                  paddingHorizontal: 12,
                  borderRadius: 10,
                  backgroundColor: colors.card,
                  borderWidth: 1,
                  borderColor: colors.border,
                }}
              >
                <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 12 }}>
                  No stops scheduled in the next 7 days
                </Text>
              </View>
            ) : (
              days.map((day) => {
                const active = day.date === activeDate;
                const flagged = dayHasFlag(day);
                return (
                  <Pressable
                    key={day.date}
                    onPress={() => setSelectedDate(day.date)}
                    style={({ pressed }) => ({
                      paddingVertical: 8,
                      paddingHorizontal: 12,
                      borderRadius: 10,
                      backgroundColor: active ? colors.primary + "22" : colors.card,
                      borderWidth: 1,
                      borderColor: active ? colors.primary : colors.border,
                      opacity: pressed ? 0.8 : 1,
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 6,
                    })}
                  >
                    <View style={{ alignItems: "center" }}>
                      <Text
                        style={{
                          color: active ? colors.primary : colors.foreground,
                          fontFamily: "Inter_600SemiBold",
                          fontSize: 12,
                        }}
                      >
                        {dayChipLabel(day.date, todayStr, tomorrowStr)}
                      </Text>
                      <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 10 }}>
                        {day.stops.length} stop{day.stops.length === 1 ? "" : "s"}
                      </Text>
                    </View>
                    {flagged ? (
                      <View
                        style={{
                          width: 7,
                          height: 7,
                          borderRadius: 4,
                          backgroundColor: colors.warning,
                        }}
                      />
                    ) : null}
                  </Pressable>
                );
              })
            )}
          </ScrollView>

          {stops.length > 0 ? (
            <View style={{ gap: 8 }}>
              {stops.map((stop) => (
                <RouteCalendarStopCard
                  key={stop.id}
                  stop={stop}
                  showTechnicianName={showTechnicianNames}
                  onVisitHistory={() => router.push(`/property-visit/${stop.id}` as Href)}
                  onOutlook={() => router.push(`/route-outlook/${stop.id}` as Href)}
                  onReadiness={() => handleReadinessPress(stop)}
                />
              ))}
            </View>
          ) : null}
        </>
      )}

      {/* Route Readiness edit modal — only reachable for the viewer's OWN
          today's stop; every other case routes to the read-only lookup screen. */}
      <DailyRouteSetupModal
        visible={showSetupModal}
        initialAssignments={assignmentsWithProducts.map((a) => ({
          productId: a.productId,
          targetPest: a.targetPest,
          notes: a.notes,
        }))}
        onClose={closeSetupModal}
        onSave={(assignments) => {
          void saveRoute(assignments);
          closeSetupModal();
        }}
      />
    </View>
  );
}

function outlookTone(stop: RouteCalendarStop, colors: ReturnType<typeof useColors>): { label: string; color: string } | null {
  if (stop.outlook.overdueCount > 0) {
    return { label: `${stop.outlook.overdueCount} overdue`, color: colors.destructive };
  }
  if (stop.outlook.dueSoonCount > 0) {
    return { label: `${stop.outlook.dueSoonCount} due soon`, color: colors.warning };
  }
  return null;
}

function RouteCalendarStopCard({
  stop,
  showTechnicianName,
  onVisitHistory,
  onOutlook,
  onReadiness,
}: {
  stop: RouteCalendarStop;
  showTechnicianName: boolean;
  onVisitHistory: () => void;
  onOutlook: () => void;
  onReadiness: () => void;
}) {
  const colors = useColors();
  const outlook = outlookTone(stop, colors);
  const readinessMissing = stop.readiness.dailyRigSetUp === false;

  return (
    <View
      style={{
        backgroundColor: colors.card,
        borderRadius: colors.radius,
        borderWidth: 1,
        borderColor: colors.border,
        padding: 12,
        gap: 8,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Text
            style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold", fontSize: 14 }}
            numberOfLines={1}
          >
            {stop.siteAddress}
            {stop.unitNumber ? ` · Unit ${stop.unitNumber}` : ""}
          </Text>
          {showTechnicianName ? (
            <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 12, marginTop: 1 }}>
              {stop.technicianName}
            </Text>
          ) : null}
        </View>
      </View>

      {readinessMissing || outlook ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {readinessMissing ? (
            <FlagBadge label="Route not ready" color={colors.warning} />
          ) : null}
          {outlook ? <FlagBadge label={outlook.label} color={outlook.color} /> : null}
        </View>
      ) : null}

      <View style={{ flexDirection: "row", gap: 8 }}>
        <StopActionButton icon="time-outline" label="History" onPress={onVisitHistory} />
        <StopActionButton icon="flask-outline" label="Outlook" onPress={onOutlook} />
        <StopActionButton
          icon="checkmark-done-outline"
          label="Readiness"
          onPress={onReadiness}
          tone={readinessMissing ? colors.warning : undefined}
        />
      </View>
    </View>
  );
}

function FlagBadge({ label, color }: { label: string; color: string }) {
  return (
    <View
      style={{
        paddingVertical: 3,
        paddingHorizontal: 8,
        borderRadius: 999,
        backgroundColor: color + "22",
        borderWidth: 1,
        borderColor: color + "55",
      }}
    >
      <Text style={{ color, fontFamily: "Inter_600SemiBold", fontSize: 10 }}>{label}</Text>
    </View>
  );
}

function StopActionButton({
  icon,
  label,
  onPress,
  tone,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  tone?: string;
}) {
  const colors = useColors();
  const color = tone ?? colors.mutedForeground;
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 5,
        paddingVertical: 7,
        borderRadius: 8,
        backgroundColor: colors.secondary,
        opacity: pressed ? 0.75 : 1,
      })}
    >
      <Ionicons name={icon} size={14} color={color} />
      <Text style={{ color, fontFamily: "Inter_600SemiBold", fontSize: 11 }}>{label}</Text>
    </Pressable>
  );
}
