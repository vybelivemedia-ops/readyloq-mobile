import { Feather } from "@expo/vector-icons";
import React, { useMemo, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";

import { useColors } from "@/hooks/useColors";

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MINUTES = [0, 15, 30, 45];

function startOfDay(d: Date): Date {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** Build the 6-week grid (null = leading/trailing blanks) for a given month. */
function buildMonthGrid(year: number, month: number): (Date | null)[] {
  const first = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const leading = first.getDay();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < leading; i++) cells.push(null);
  for (let day = 1; day <= daysInMonth; day++) cells.push(new Date(year, month, day));
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

export interface CalendarPickerProps {
  visible: boolean;
  initialDate?: Date;
  /** Dates before this (day granularity) are disabled. Defaults to today. */
  minimumDate?: Date;
  onCancel: () => void;
  onConfirm: (date: Date) => void;
}

export function CalendarPicker({
  visible,
  initialDate,
  minimumDate,
  onCancel,
  onConfirm,
}: CalendarPickerProps) {
  const colors = useColors();
  const seed = initialDate ?? new Date(Date.now() + 60 * 60 * 1000);
  const min = startOfDay(minimumDate ?? new Date());

  const [viewYear, setViewYear] = useState(seed.getFullYear());
  const [viewMonth, setViewMonth] = useState(seed.getMonth());
  const [selected, setSelected] = useState<Date>(seed);

  const grid = useMemo(() => buildMonthGrid(viewYear, viewMonth), [viewYear, viewMonth]);

  const prevMonth = () => {
    const d = new Date(viewYear, viewMonth - 1, 1);
    setViewYear(d.getFullYear());
    setViewMonth(d.getMonth());
  };
  const nextMonth = () => {
    const d = new Date(viewYear, viewMonth + 1, 1);
    setViewYear(d.getFullYear());
    setViewMonth(d.getMonth());
  };

  const pickDay = (day: Date) => {
    const next = new Date(day);
    next.setHours(selected.getHours(), selected.getMinutes(), 0, 0);
    setSelected(next);
  };

  const pickHour = (h: number) => {
    const next = new Date(selected);
    next.setHours(h);
    setSelected(next);
  };
  const pickMinute = (m: number) => {
    const next = new Date(selected);
    next.setMinutes(m);
    setSelected(next);
  };

  const confirmDisabled = selected.getTime() < Date.now();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <Pressable style={styles.backdrop} onPress={onCancel}>
        <Pressable
          style={[styles.sheet, { backgroundColor: colors.card, borderColor: colors.border }]}
          onPress={(e) => e.stopPropagation()}
        >
          {/* Month header */}
          <View style={styles.monthHeader}>
            <TouchableOpacity onPress={prevMonth} hitSlop={10} style={styles.navBtn}>
              <Feather name="chevron-left" size={22} color={colors.foreground} />
            </TouchableOpacity>
            <Text style={[styles.monthLabel, { color: colors.foreground }]}>
              {MONTHS[viewMonth]} {viewYear}
            </Text>
            <TouchableOpacity onPress={nextMonth} hitSlop={10} style={styles.navBtn}>
              <Feather name="chevron-right" size={22} color={colors.foreground} />
            </TouchableOpacity>
          </View>

          {/* Weekday row */}
          <View style={styles.weekRow}>
            {WEEKDAYS.map((w, i) => (
              <Text key={i} style={[styles.weekday, { color: colors.mutedForeground }]}>
                {w}
              </Text>
            ))}
          </View>

          {/* Day grid */}
          <View style={styles.grid}>
            {grid.map((day, idx) => {
              if (!day) return <View key={idx} style={styles.dayCell} />;
              const disabled = startOfDay(day).getTime() < min.getTime();
              const isSelected = sameDay(day, selected);
              return (
                <TouchableOpacity
                  key={idx}
                  disabled={disabled}
                  onPress={() => pickDay(day)}
                  style={styles.dayCell}
                >
                  <View
                    style={[
                      styles.dayInner,
                      isSelected && { backgroundColor: colors.primary },
                    ]}
                  >
                    <Text
                      style={[
                        styles.dayText,
                        {
                          color: disabled
                            ? colors.mutedForeground + "55"
                            : isSelected
                              ? "#FFF"
                              : colors.foreground,
                        },
                      ]}
                    >
                      {day.getDate()}
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Time selection */}
          <Text style={[styles.timeLabel, { color: colors.mutedForeground }]}>Time</Text>
          <View style={styles.timeRow}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.timeScroll}
            >
              {HOURS.map((h) => {
                const active = selected.getHours() === h;
                return (
                  <TouchableOpacity
                    key={h}
                    onPress={() => pickHour(h)}
                    style={[
                      styles.timeChip,
                      { borderColor: colors.border },
                      active && { backgroundColor: colors.primary, borderColor: colors.primary },
                    ]}
                  >
                    <Text style={[styles.timeChipText, { color: active ? "#FFF" : colors.foreground }]}>
                      {String(h).padStart(2, "0")}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
          <View style={styles.timeRow}>
            {MINUTES.map((m) => {
              const active = selected.getMinutes() === m;
              return (
                <TouchableOpacity
                  key={m}
                  onPress={() => pickMinute(m)}
                  style={[
                    styles.minuteChip,
                    { borderColor: colors.border },
                    active && { backgroundColor: colors.primary, borderColor: colors.primary },
                  ]}
                >
                  <Text style={[styles.timeChipText, { color: active ? "#FFF" : colors.foreground }]}>
                    :{String(m).padStart(2, "0")}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Selected summary + actions */}
          <Text style={[styles.summary, { color: colors.foreground }]}>
            {selected.toLocaleString(undefined, {
              weekday: "short",
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })}
          </Text>
          <View style={styles.actions}>
            <TouchableOpacity
              onPress={onCancel}
              style={[styles.actBtn, styles.actGhost, { borderColor: colors.border }]}
            >
              <Text style={[styles.actText, { color: colors.foreground }]}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => onConfirm(selected)}
              disabled={confirmDisabled}
              style={[
                styles.actBtn,
                { backgroundColor: colors.primary, opacity: confirmDisabled ? 0.5 : 1 },
              ]}
            >
              <Text style={[styles.actText, { color: "#FFF" }]}>Set time</Text>
            </TouchableOpacity>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
  },
  sheet: { width: "100%", maxWidth: 360, borderRadius: 20, borderWidth: 1, padding: 16, gap: 10 },
  monthHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  navBtn: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  monthLabel: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  weekRow: { flexDirection: "row" },
  weekday: { flex: 1, textAlign: "center", fontSize: 12, fontFamily: "Inter_500Medium" },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  dayCell: { width: `${100 / 7}%`, aspectRatio: 1, alignItems: "center", justifyContent: "center" },
  dayInner: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
  },
  dayText: { fontSize: 14, fontFamily: "Inter_500Medium" },
  timeLabel: { fontSize: 12, fontFamily: "Inter_600SemiBold", marginTop: 4 },
  timeRow: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  timeScroll: { gap: 8, paddingVertical: 2 },
  timeChip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1 },
  minuteChip: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 8,
    borderRadius: 10,
    borderWidth: 1,
  },
  timeChipText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  summary: { fontSize: 14, fontFamily: "Inter_600SemiBold", textAlign: "center", marginTop: 4 },
  actions: { flexDirection: "row", gap: 10, marginTop: 4 },
  actBtn: { flex: 1, alignItems: "center", paddingVertical: 12, borderRadius: 12 },
  actGhost: { borderWidth: 1 },
  actText: { fontSize: 14, fontFamily: "Inter_600SemiBold" },
});
