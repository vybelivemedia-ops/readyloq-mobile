/**
 * Review tab — Manager role only.
 *
 * Rapid-review workflow designed to validate the previous day's work in
 * under 20 minutes without disrupting high-value priorities.
 *
 * Flow:
 *  1. Shows yesterday's completed inspections sorted by priority (high-risk first).
 *  2. Manager taps each card: Approve ✓ / Flag for callback ⚠ / Skip →
 *  3. Auto-advances to the next item after an action.
 *  4. Progress bar + estimated time remaining keep the session time-boxed.
 *  5. "All done" state celebrates completion and surfaces flagged items.
 */

import { Ionicons } from "@expo/vector-icons";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { type Href, useRouter } from "expo-router";
import React, { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";
import * as Haptics from "expo-haptics";

import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Screen } from "@/components/ui/Screen";
import { useColors } from "@/hooks/useColors";
import { useLicenseStatus } from "@/hooks/useLicenseStatus";
import { customFetch } from "@/lib/api-client/custom-fetch";
import { formatRelative } from "@/constants/inspection";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ReviewItem {
  id: number;
  inspectionId: number;
  siteAddress: string;
  technicianName: string;
  completedAt: string;
  findingsCount: number;
  qualityScore: number | null;
  riskLevel: "low" | "medium" | "high" | "critical";
  pestTypes: string[];
  photoCount: number;
}

type ReviewAction = "approved" | "flagged" | "skipped";

interface ReviewQueueResponse {
  items: ReviewItem[];
  date: string;
  totalCount: number;
}

// ─── API helpers ──────────────────────────────────────────────────────────────

async function fetchReviewQueue(): Promise<ReviewQueueResponse> {
  return customFetch<ReviewQueueResponse>("/api/review-queue");
}

async function submitReviewAction(inspectionId: number, action: ReviewAction, note?: string) {
  return customFetch(`/api/review-queue/${inspectionId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, note }),
  });
}

const REVIEW_QUERY_KEY = ["review-queue"];

// ─── Helpers ──────────────────────────────────────────────────────────────────

const RISK_COLORS: Record<string, string> = {
  critical: "#dc2626",
  high:     "#ea580c",
  medium:   "#d97706",
  low:      "#16a34a",
};

function qualityColor(score: number | null): string {
  if (score == null) return "#6b7280";
  if (score >= 80)   return "#16a34a";
  if (score >= 60)   return "#d97706";
  return "#dc2626";
}

// Estimated 2 min per inspection, capped display at 20 min
function estimatedMinutes(remaining: number): number {
  return Math.min(remaining * 2, 20);
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function ReviewScreen() {
  const colors  = useColors();
  const router  = useRouter();
  const qc      = useQueryClient();
  const license = useLicenseStatus();

  const { data, isLoading } = useQuery({
    queryKey: REVIEW_QUERY_KEY,
    queryFn: fetchReviewQueue,
    staleTime: 60_000,
  });

  const [currentIdx, setCurrentIdx] = useState(0);
  const [actioned, setActioned] = useState<Map<number, ReviewAction>>(new Map());
  const [flagNote, setFlagNote] = useState<string | null>(null);
  const slideAnim = useRef(new Animated.Value(0)).current;

  const mutation = useMutation({
    mutationFn: ({ id, action, note }: { id: number; action: ReviewAction; note?: string }) =>
      submitReviewAction(id, action, note),
    onSuccess: () => qc.invalidateQueries({ queryKey: REVIEW_QUERY_KEY }),
  });

  const items = data?.items ?? [];
  const total = items.length;
  const reviewedCount = actioned.size;
  const remaining = total - reviewedCount;
  const allDone = total > 0 && remaining === 0;

  const currentItem = items[currentIdx] ?? null;

  const animateOut = useCallback(
    (toValue: number, onDone: () => void) => {
      Animated.timing(slideAnim, {
        toValue,
        duration: 220,
        useNativeDriver: true,
      }).start(() => {
        slideAnim.setValue(0);
        onDone();
      });
    },
    [slideAnim],
  );

  const handleAction = useCallback(
    (action: ReviewAction) => {
      if (!currentItem) return;
      void Haptics.impactAsync(
        action === "approved"
          ? Haptics.ImpactFeedbackStyle.Light
          : Haptics.ImpactFeedbackStyle.Medium,
      );
      animateOut(action === "approved" ? -400 : 400, () => {
        setActioned((prev) => new Map(prev).set(currentItem.inspectionId, action));
        mutation.mutate({ id: currentItem.inspectionId, action });
        // Advance to next unactioned item
        const nextIdx = items.findIndex(
          (item, i) => i > currentIdx && !actioned.has(item.inspectionId),
        );
        setCurrentIdx(nextIdx === -1 ? currentIdx + 1 : nextIdx);
      });
    },
    [currentItem, currentIdx, items, actioned, animateOut, mutation],
  );

  // ── #81 — Subscription gate ──────────────────────────────────────────────────
  if (!license.isLoading && license.data != null && !license.data.isActive) {
    return (
      <Screen>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 32 }}>
          <Ionicons name="lock-closed-outline" size={48} color={colors.mutedForeground} />
          <Text style={{
            color: colors.foreground, fontFamily: "Inter_700Bold",
            fontSize: 20, marginTop: 16, textAlign: "center",
          }}>
            Subscription required
          </Text>
          <Text style={{
            color: colors.mutedForeground, fontFamily: "Inter_400Regular",
            fontSize: 14, marginTop: 8, textAlign: "center", lineHeight: 20,
          }}>
            Daily review is a Growth plan feature.
            {license.data.status === "past_due"
              ? " Your payment is overdue — update billing to restore access."
              : " Renew or upgrade your subscription to continue."}
          </Text>
          <Pressable
            onPress={() => router.push("/(app)/billing" as unknown as Parameters<typeof router.push>[0])}
            style={({ pressed }) => ({
              marginTop: 24, backgroundColor: colors.primary, borderRadius: 10,
              paddingHorizontal: 24, paddingVertical: 12, opacity: pressed ? 0.8 : 1,
            })}
          >
            <Text style={{ color: colors.primaryForeground, fontFamily: "Inter_600SemiBold", fontSize: 15 }}>
              {license.data.status === "past_due" ? "Update billing" : "View plans"}
            </Text>
          </Pressable>
        </View>
      </Screen>
    );
  }

  // ── Loading ─────────────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <Screen>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={colors.primary} size="large" />
          <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", marginTop: 12 }}>
            Loading yesterday's work…
          </Text>
        </View>
      </Screen>
    );
  }

  // ── Empty state ──────────────────────────────────────────────────────────────
  if (total === 0) {
    return (
      <Screen>
        <View style={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: 4 }}>
          <Text style={{ color: colors.foreground, fontFamily: "Inter_700Bold", fontSize: 24 }}>
            Daily Review
          </Text>
        </View>
        <EmptyState
          icon="checkmark-done-circle-outline"
          title="Nothing to review"
          subtitle="No inspections were completed yesterday. Check back after your team's next shift."
        />
      </Screen>
    );
  }

  // ── All done ─────────────────────────────────────────────────────────────────
  if (allDone) {
    const flagged = [...actioned.entries()].filter(([, a]) => a === "flagged");
    return (
      <Screen>
        <ScrollView contentContainerStyle={{ padding: 24, gap: 20, alignItems: "center" }}>
          <View
            style={{
              width: 72,
              height: 72,
              borderRadius: 36,
              backgroundColor: colors.primary + "22",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Ionicons name="checkmark-circle" size={44} color={colors.primary} />
          </View>
          <Text style={{ color: colors.foreground, fontFamily: "Inter_700Bold", fontSize: 22, textAlign: "center" }}>
            Review complete
          </Text>
          <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 15, textAlign: "center" }}>
            {total} inspection{total !== 1 ? "s" : ""} reviewed · {flagged.length} flagged for callback
          </Text>

          {flagged.length > 0 ? (
            <View style={{ width: "100%", gap: 10 }}>
              <Text style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold", fontSize: 16 }}>
                Callback queue ({flagged.length})
              </Text>
              {items
                .filter((item) => actioned.get(item.inspectionId) === "flagged")
                .map((item) => (
                  <Card
                    key={item.inspectionId}
                    onPress={() => router.push(`/inspection/${item.inspectionId}` as Href)}
                  >
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                      <Ionicons name="call-outline" size={18} color={colors.warning} />
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold", fontSize: 14 }}>
                          {item.technicianName}
                        </Text>
                        <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 12 }}>
                          {item.siteAddress}
                        </Text>
                      </View>
                      <Ionicons name="chevron-forward" size={16} color={colors.mutedForeground} />
                    </View>
                  </Card>
                ))}
            </View>
          ) : (
            <Card style={{ width: "100%", alignItems: "center", gap: 6 }}>
              <Ionicons name="shield-checkmark-outline" size={28} color={colors.success} />
              <Text style={{ color: colors.success, fontFamily: "Inter_600SemiBold", fontSize: 15 }}>
                All clear — no callbacks needed
              </Text>
            </Card>
          )}
        </ScrollView>
      </Screen>
    );
  }

  // ── Main review card ──────────────────────────────────────────────────────────
  const progress = reviewedCount / total;

  return (
    <Screen>
      {/* Header */}
      <View style={{ paddingHorizontal: 16, paddingTop: 16, paddingBottom: 12 }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <Text style={{ color: colors.foreground, fontFamily: "Inter_700Bold", fontSize: 24 }}>
            Daily Review
          </Text>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Ionicons name="time-outline" size={14} color={colors.mutedForeground} />
            <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_500Medium", fontSize: 13 }}>
              ~{estimatedMinutes(remaining)} min left
            </Text>
          </View>
        </View>

        {/* Progress bar */}
        <View style={{ height: 4, borderRadius: 2, backgroundColor: colors.border, marginTop: 12, overflow: "hidden" }}>
          <View
            style={{
              height: "100%",
              borderRadius: 2,
              backgroundColor: colors.primary,
              width: `${progress * 100}%`,
            }}
          />
        </View>
        <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 12, marginTop: 4 }}>
          {reviewedCount} of {total} reviewed
        </Text>
      </View>

      {currentItem ? (
        <Animated.View
          style={{
            flex: 1,
            transform: [{ translateX: slideAnim }],
            paddingHorizontal: 16,
          }}
        >
          {/* Risk badge */}
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <View
              style={{
                paddingHorizontal: 10,
                paddingVertical: 5,
                borderRadius: 999,
                backgroundColor: RISK_COLORS[currentItem.riskLevel] + "22",
              }}
            >
              <Text style={{ color: RISK_COLORS[currentItem.riskLevel], fontFamily: "Inter_600SemiBold", fontSize: 12 }}>
                {currentItem.riskLevel.toUpperCase()} RISK
              </Text>
            </View>
            <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 12 }}>
              {formatRelative(currentItem.completedAt)}
            </Text>
          </View>

          {/* Main card */}
          <Card style={{ gap: 14 }}>
            {/* Tech + address */}
            <View style={{ gap: 4 }}>
              <Text style={{ color: colors.foreground, fontFamily: "Inter_700Bold", fontSize: 18 }}>
                {currentItem.siteAddress}
              </Text>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Ionicons name="person-outline" size={13} color={colors.mutedForeground} />
                <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 14 }}>
                  {currentItem.technicianName}
                </Text>
              </View>
            </View>

            {/* Stats row */}
            <View style={{ flexDirection: "row", gap: 16 }}>
              <View style={{ flex: 1, alignItems: "center", gap: 4 }}>
                <Text style={{ color: qualityColor(currentItem.qualityScore), fontFamily: "Inter_700Bold", fontSize: 24 }}>
                  {currentItem.qualityScore ?? "—"}
                </Text>
                <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 11 }}>
                  Quality score
                </Text>
              </View>
              <View style={{ width: 1, backgroundColor: colors.border }} />
              <View style={{ flex: 1, alignItems: "center", gap: 4 }}>
                <Text style={{ color: colors.foreground, fontFamily: "Inter_700Bold", fontSize: 24 }}>
                  {currentItem.findingsCount}
                </Text>
                <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 11 }}>
                  Findings
                </Text>
              </View>
              <View style={{ width: 1, backgroundColor: colors.border }} />
              <View style={{ flex: 1, alignItems: "center", gap: 4 }}>
                <Text style={{ color: colors.foreground, fontFamily: "Inter_700Bold", fontSize: 24 }}>
                  {currentItem.photoCount}
                </Text>
                <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 11 }}>
                  Photos
                </Text>
              </View>
            </View>

            {/* Pest types */}
            {currentItem.pestTypes.length > 0 ? (
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
                {currentItem.pestTypes.map((p) => (
                  <View
                    key={p}
                    style={{
                      paddingHorizontal: 10,
                      paddingVertical: 4,
                      borderRadius: 999,
                      backgroundColor: colors.primary + "18",
                    }}
                  >
                    <Text style={{ color: colors.primary, fontFamily: "Inter_500Medium", fontSize: 12 }}>
                      {p}
                    </Text>
                  </View>
                ))}
              </View>
            ) : null}

            {/* View full inspection link */}
            <Pressable
              onPress={() => router.push(`/inspection/${currentItem.inspectionId}` as Href)}
              style={{ flexDirection: "row", alignItems: "center", gap: 4 }}
            >
              <Text style={{ color: colors.primary, fontFamily: "Inter_500Medium", fontSize: 13 }}>
                View full inspection
              </Text>
              <Ionicons name="open-outline" size={13} color={colors.primary} />
            </Pressable>
          </Card>

          {/* Action buttons */}
          <View style={{ flexDirection: "row", gap: 10, marginTop: 16 }}>
            <Pressable
              onPress={() => handleAction("flagged")}
              style={({ pressed }) => ({
                flex: 1,
                paddingVertical: 16,
                borderRadius: 14,
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                backgroundColor: colors.card,
                borderWidth: 2,
                borderColor: "#f59e0b",
                opacity: pressed ? 0.8 : 1,
              })}
            >
              <Ionicons name="call-outline" size={22} color="#f59e0b" />
              <Text style={{ color: "#f59e0b", fontFamily: "Inter_700Bold", fontSize: 14 }}>
                Flag callback
              </Text>
            </Pressable>

            <Pressable
              onPress={() => handleAction("approved")}
              style={({ pressed }) => ({
                flex: 1.5,
                paddingVertical: 16,
                borderRadius: 14,
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                backgroundColor: colors.primary,
                opacity: pressed ? 0.85 : 1,
              })}
            >
              <Ionicons name="checkmark-circle" size={24} color={colors.primaryForeground} />
              <Text style={{ color: colors.primaryForeground, fontFamily: "Inter_700Bold", fontSize: 16 }}>
                Approve
              </Text>
            </Pressable>

            <Pressable
              onPress={() => handleAction("skipped")}
              style={({ pressed }) => ({
                flex: 0.7,
                paddingVertical: 16,
                borderRadius: 14,
                alignItems: "center",
                justifyContent: "center",
                gap: 6,
                backgroundColor: colors.card,
                borderWidth: 1,
                borderColor: colors.border,
                opacity: pressed ? 0.8 : 1,
              })}
            >
              <Ionicons name="arrow-forward-outline" size={20} color={colors.mutedForeground} />
              <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_500Medium", fontSize: 12 }}>
                Skip
              </Text>
            </Pressable>
          </View>

          {/* Swipe hint */}
          <Text
            style={{
              color: colors.mutedForeground,
              fontFamily: "Inter_400Regular",
              fontSize: 12,
              textAlign: "center",
              marginTop: 12,
            }}
          >
            {currentIdx + 1} of {total} · Approve = quality confirmed · Flag = needs a call
          </Text>
        </Animated.View>
      ) : null}
    </Screen>
  );
}
