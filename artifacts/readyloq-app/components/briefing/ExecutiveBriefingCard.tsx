/**
 * ExecutiveBriefingCard
 *
 * A compact banner that shows when yesterday's executive digest is ready.
 * Tapping it opens a full-screen modal reader — the owner's 20-minute
 * morning brief: summary, KPI snapshot, and Quinn's recommendation.
 *
 * Data flows through fetchDailyBriefing() from @/lib/api — no separate
 * services/api module exists in this codebase.
 */
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "@clerk/expo";
import React, { useEffect, useState } from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { fetchDailyBriefing, type DailyBriefing } from "@/lib/api";

// ── Palette — matches MissionControlDashboard ──────────────────────────────

const MC = {
  bg:        "#08090E",
  surface:   "#10141F",
  border:    "#1C2235",
  accent:    "#17c4d3",
  text:      "#FFFFFF",
  muted:     "rgba(255,255,255,0.45)",
  critical:  "#ef4444",
  success:   "#22c55e",
  warning:   "#f59e0b",
} as const;

// ─── Banner ────────────────────────────────────────────────────────────────────

export function ExecutiveBriefingCard() {
  const { getToken } = useAuth();
  const [briefing, setBriefing]         = useState<DailyBriefing | null>(null);
  const [modalVisible, setModalVisible] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const token = await getToken();
        const res   = await fetchDailyBriefing(token);
        if (res.success) setBriefing(res.briefing);
      } catch {
        // Non-fatal — banner simply stays hidden if the fetch fails.
      }
    })();
  }, [getToken]);

  if (!briefing) return null;

  const hasCritical = briefing.criticalRiskCount > 0;

  return (
    <>
      {/* ── Tap-to-open banner ─────────────────────────────────────────────── */}
      <Pressable
        style={({ pressed }) => [
          styles.banner,
          hasCritical && styles.bannerCritical,
          { opacity: pressed ? 0.8 : 1 },
        ]}
        onPress={() => setModalVisible(true)}
      >
        {/* Icon */}
        <View
          style={[
            styles.bannerIconWrap,
            { backgroundColor: hasCritical ? `${MC.critical}18` : `${MC.accent}18` },
          ]}
        >
          <Ionicons
            name="newspaper-outline"
            size={18}
            color={hasCritical ? MC.critical : MC.accent}
          />
        </View>

        {/* Text */}
        <View style={{ flex: 1 }}>
          <Text style={styles.bannerTitle}>Yesterday's Executive Briefing</Text>
          <Text style={styles.bannerSub}>
            {hasCritical
              ? `${briefing.criticalRiskCount} critical risk${briefing.criticalRiskCount > 1 ? "s" : ""} flagged — tap to review`
              : "Tap for Quinn's 20-minute company review"}
          </Text>
        </View>

        <Ionicons name="chevron-forward" size={16} color={MC.muted} />
      </Pressable>

      {/* ── Full briefing modal ────────────────────────────────────────────── */}
      <Modal
        visible={modalVisible}
        animationType="slide"
        transparent
        onRequestClose={() => setModalVisible(false)}
      >
        <View style={styles.overlay}>
          <View style={styles.sheet}>

            {/* Header */}
            <View style={styles.sheetHeader}>
              <View style={{ flex: 1 }}>
                <Text style={styles.sheetHeaderTitle}>DAILY EXECUTIVE BRIEFING</Text>
                <Text style={styles.sheetHeaderDate}>{briefing.date}</Text>
              </View>
              <Pressable
                onPress={() => setModalVisible(false)}
                style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
                hitSlop={12}
              >
                <Ionicons name="close" size={22} color={MC.text} />
              </Pressable>
            </View>

            <ScrollView
              contentContainerStyle={styles.sheetScroll}
              showsVerticalScrollIndicator={false}
            >
              {/* ── Executive Summary ─────────────────────────────────────── */}
              <Text style={styles.sectionHeading}>EXECUTIVE SUMMARY</Text>
              <Text style={styles.bodyText}>{briefing.summary}</Text>

              {/* ── KPI snapshot ──────────────────────────────────────────── */}
              <Text style={styles.sectionHeading}>KEY PERFORMANCE METRICS</Text>
              <View style={styles.metricsCard}>
                <MetricRow
                  label="Inspections completed"
                  value={String(briefing.inspectionsCount)}
                  valueColor={MC.text}
                  first
                />
                <MetricRow
                  label="Critical risks flagged"
                  value={String(briefing.criticalRiskCount)}
                  valueColor={briefing.criticalRiskCount > 0 ? MC.critical : MC.success}
                />
                <MetricRow
                  label="New opportunities"
                  value={String(briefing.newOpportunities)}
                  valueColor={MC.text}
                />
                <MetricRow
                  label="Pipeline value added"
                  value={`$${briefing.pipelineAdded.toLocaleString()}`}
                  valueColor={MC.accent}
                  last
                />
              </View>

              {/* ── Quinn's Recommendation ────────────────────────────────── */}
              <Text style={styles.sectionHeading}>QUINN'S RECOMMENDATION</Text>
              <View style={styles.recommendationCard}>
                <View style={styles.recommendationIcon}>
                  <Ionicons
                    name="bulb-outline"
                    size={15}
                    color={briefing.criticalRiskCount > 0 ? MC.critical : MC.warning}
                  />
                </View>
                <Text style={styles.bodyText}>{briefing.recommendation}</Text>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </>
  );
}

// ─── MetricRow helper ─────────────────────────────────────────────────────────

function MetricRow({
  label,
  value,
  valueColor,
  first = false,
  last  = false,
}: {
  label:      string;
  value:      string;
  valueColor: string;
  first?:     boolean;
  last?:      boolean;
}) {
  return (
    <View
      style={[
        styles.metricRow,
        first && { borderTopWidth: 0 },
        last  && { borderBottomWidth: 0 },
      ]}
    >
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={[styles.metricValue, { color: valueColor }]}>{value}</Text>
    </View>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  // Banner
  banner: {
    flexDirection:   "row",
    alignItems:      "center",
    gap:             12,
    padding:         12,
    backgroundColor: MC.surface,
    borderRadius:    10,
    borderWidth:     1,
    borderColor:     MC.border,
  },
  bannerCritical: {
    borderColor:     `${MC.critical}44`,
    backgroundColor: `${MC.critical}08`,
  },
  bannerIconWrap: {
    width:           36,
    height:          36,
    borderRadius:    10,
    alignItems:      "center",
    justifyContent:  "center",
  },
  bannerTitle: {
    color:       MC.text,
    fontFamily:  "Inter_600SemiBold",
    fontSize:    13,
  },
  bannerSub: {
    color:      MC.muted,
    fontFamily: "Inter_400Regular",
    fontSize:   11,
    marginTop:  2,
  },

  // Modal sheet
  overlay: {
    flex:            1,
    backgroundColor: "rgba(0,0,0,0.85)",
    justifyContent:  "flex-end",
  },
  sheet: {
    backgroundColor:   MC.bg,
    borderTopLeftRadius:  20,
    borderTopRightRadius: 20,
    height:            "82%",
    borderWidth:       1,
    borderColor:       MC.border,
  },
  sheetHeader: {
    flexDirection:  "row",
    alignItems:     "center",
    padding:        20,
    paddingBottom:  14,
    borderBottomWidth: 1,
    borderBottomColor: MC.border,
  },
  sheetHeaderTitle: {
    color:       MC.text,
    fontFamily:  "Inter_800ExtraBold",
    fontSize:    14,
    letterSpacing: 1.2,
  },
  sheetHeaderDate: {
    color:      MC.accent,
    fontFamily: "Inter_600SemiBold",
    fontSize:   12,
    marginTop:  3,
    letterSpacing: 0.4,
  },
  sheetScroll: {
    padding:       20,
    paddingBottom: 48,
    gap:           8,
  },

  // Content
  sectionHeading: {
    color:         MC.muted,
    fontFamily:    "Inter_700Bold",
    fontSize:      10,
    letterSpacing: 1.2,
    marginTop:     16,
    marginBottom:  8,
  },
  bodyText: {
    color:      "rgba(255,255,255,0.75)",
    fontFamily: "Inter_400Regular",
    fontSize:   14,
    lineHeight: 22,
  },

  // Metrics card
  metricsCard: {
    backgroundColor: MC.surface,
    borderRadius:    10,
    borderWidth:     1,
    borderColor:     MC.border,
    overflow:        "hidden",
  },
  metricRow: {
    flexDirection:     "row",
    justifyContent:    "space-between",
    alignItems:        "center",
    paddingHorizontal: 14,
    paddingVertical:   11,
    borderTopWidth:    1,
    borderTopColor:    MC.border,
    borderBottomWidth: 0,
  },
  metricLabel: {
    color:      MC.muted,
    fontFamily: "Inter_400Regular",
    fontSize:   13,
  },
  metricValue: {
    fontFamily: "Inter_700Bold",
    fontSize:   13,
  },

  // Recommendation card
  recommendationCard: {
    flexDirection:   "row",
    alignItems:      "flex-start",
    gap:             10,
    backgroundColor: MC.surface,
    borderRadius:    10,
    borderWidth:     1,
    borderColor:     MC.border,
    padding:         14,
  },
  recommendationIcon: {
    marginTop: 3,
  },
});
