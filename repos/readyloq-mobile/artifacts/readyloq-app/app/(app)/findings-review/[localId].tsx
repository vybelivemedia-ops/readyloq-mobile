import { useAuth } from "@clerk/expo";
import { Ionicons } from "@expo/vector-icons";
import { getListAnalysisResultsQueryOptions, type Finding } from "@/lib/api-client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Image } from "expo-image";
import { type Href, useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  Text,
  TextInput,
  View,
} from "react-native";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Screen } from "@/components/ui/Screen";
import { useColors } from "@/hooks/useColors";
import { useLocalInspection } from "@/hooks/useLocalInspections";
import { API_BASE } from "@/lib/api";
import { updateLocalInspection } from "@/lib/local/inspection-store";

type ReviewAction = "accepted" | "corrected" | "dismissed";

interface LocalReview {
  action: ReviewAction;
  technicianSpecies?: string;
}

export default function FindingsReviewScreen() {
  const colors = useColors();
  const router = useRouter();
  const { getToken } = useAuth();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ localId: string }>();
  const { record, loaded } = useLocalInspection(params.localId);

  const serverId = record?.serverId ?? null;

  const analysisQ = useQuery({
    ...getListAnalysisResultsQueryOptions({ inspectionId: serverId ?? 0 }),
    enabled: serverId != null,
    refetchInterval: false,
  });

  const analysis = analysisQ.data?.[0];
  const findings = useMemo(() => (analysis?.findings ?? []) as Finding[], [analysis]);

  const [reviews, setReviews] = useState<Record<number, LocalReview>>({});
  const [correcting, setCorrecting] = useState<Finding | null>(null);
  const [customSpecies, setCustomSpecies] = useState("");
  const [saving, setSaving] = useState(false);

  const allReviewed = useMemo(
    () => findings.length > 0 && findings.every((f) => f.id in reviews),
    [findings, reviews],
  );
  const reviewedCount = Object.keys(reviews).length;

  const applyReview = useCallback(
    (finding: Finding, action: ReviewAction, technicianSpecies?: string) => {
      setReviews((prev) => ({ ...prev, [finding.id]: { action, technicianSpecies } }));
    },
    [],
  );

  const handleSaveCorrection = useCallback(() => {
    if (!correcting) return;
    const species = customSpecies.trim();
    if (!species) return;
    applyReview(correcting, "corrected", species);
    setCorrecting(null);
    setCustomSpecies("");
  }, [correcting, customSpecies, applyReview]);

  const handleDone = async () => {
    if (!analysis?.id || saving) return;
    setSaving(true);
    try {
      const token = await getToken();
      await Promise.allSettled(
        Object.entries(reviews).map(([findingId, review]) =>
          fetch(`${API_BASE}/api/analysis/${analysis.id}/findings/correct`, {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify({
              findingId: parseInt(findingId),
              action:
                review.action === "accepted"
                  ? "accept"
                  : review.action === "dismissed"
                    ? "dismiss"
                    : "correct",
              technicianSpecies: review.technicianSpecies,
            }),
          }),
        ),
      );
    } catch {
      // best-effort; corrections are stored server-side
    }
    try {
      await updateLocalInspection(params.localId, (r) => {
        r.allFindingsReviewed = true;
      });
      await queryClient.invalidateQueries();
    } catch {}
    setSaving(false);
    router.back();
  };

  const confidenceColor = (label?: string | null) => {
    if (label === "identified") return colors.success ?? "#22c55e";
    if (label === "possible") return "#f59e0b";
    return colors.mutedForeground;
  };
  const confidenceText = (f: Finding) => {
    if (f.technicianSpecies) return `Corrected: ${f.technicianSpecies}`;
    if (f.confidenceLabel === "identified") return f.species ?? "Identified";
    if (f.confidenceLabel === "possible") return f.species ?? `Possible: ${f.species}`;
    return "Unable to identify";
  };

  if (!loaded) return <Screen edges={["top", "bottom"]} />;

  if (!serverId || analysisQ.isLoading) {
    return (
      <Screen edges={["top", "bottom"]} padded>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 20 }}>
          <Pressable onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={24} color={colors.foreground} />
          </Pressable>
          <Text style={{ color: colors.foreground, fontFamily: "Inter_700Bold", fontSize: 20 }}>
            AI Findings Review
          </Text>
        </View>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 14 }}>
          {analysisQ.isLoading ? (
            <ActivityIndicator size="large" color={colors.primary} />
          ) : (
            <>
              <Ionicons
                name="checkmark-circle-outline"
                size={52}
                color={colors.success ?? "#22c55e"}
              />
              <Text
                style={{
                  color: colors.foreground,
                  fontFamily: "Inter_600SemiBold",
                  fontSize: 16,
                  textAlign: "center",
                }}
              >
                {!serverId ? "Awaiting sync…" : "No findings to review"}
              </Text>
              <Text
                style={{
                  color: colors.mutedForeground,
                  fontFamily: "Inter_400Regular",
                  fontSize: 14,
                  textAlign: "center",
                }}
              >
                {!serverId
                  ? "AI findings appear here once the inspection syncs to the server."
                  : "The AI found no notable evidence in these photos."}
              </Text>
              <Button
                title="Done"
                onPress={async () => {
                  await updateLocalInspection(params.localId, (r) => {
                    r.allFindingsReviewed = true;
                  });
                  router.back();
                }}
              />
            </>
          )}
        </View>
      </Screen>
    );
  }

  if (findings.length === 0) {
    return (
      <Screen edges={["top", "bottom"]} padded>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginBottom: 20 }}>
          <Pressable onPress={() => router.back()}>
            <Ionicons name="arrow-back" size={24} color={colors.foreground} />
          </Pressable>
          <Text style={{ color: colors.foreground, fontFamily: "Inter_700Bold", fontSize: 20 }}>
            AI Findings Review
          </Text>
        </View>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 14 }}>
          <Ionicons name="checkmark-circle-outline" size={52} color={colors.success ?? "#22c55e"} />
          <Text
            style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold", fontSize: 16 }}
          >
            No findings to review
          </Text>
          <Text
            style={{
              color: colors.mutedForeground,
              fontFamily: "Inter_400Regular",
              fontSize: 14,
              textAlign: "center",
            }}
          >
            The AI found no notable evidence in these photos.
          </Text>
          <Button
            title="Done"
            onPress={async () => {
              await updateLocalInspection(params.localId, (r) => {
                r.allFindingsReviewed = true;
              });
              router.back();
            }}
          />
        </View>
      </Screen>
    );
  }

  return (
    <Screen edges={["top", "bottom"]}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          paddingHorizontal: 16,
          paddingVertical: 12,
        }}
      >
        <Pressable onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color={colors.foreground} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.foreground, fontFamily: "Inter_700Bold", fontSize: 20 }}>
            AI Findings Review
          </Text>
          <Text
            style={{
              color: colors.mutedForeground,
              fontFamily: "Inter_400Regular",
              fontSize: 13,
            }}
          >
            {reviewedCount} of {findings.length} reviewed
          </Text>
        </View>
      </View>

      <FlatList
        data={findings}
        keyExtractor={(f) => String(f.id)}
        contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 100 }}
        renderItem={({ item: finding }) => {
          const review = reviews[finding.id];
          const isReviewed = !!review;
          const correctedSpecies = review?.action === "corrected" ? review.technicianSpecies : null;
          const displayLabel = correctedSpecies
            ? `Corrected: ${correctedSpecies}`
            : confidenceText(finding);
          const cc = confidenceColor(finding.confidenceLabel);

          return (
            <Card
              style={{
                gap: 10,
                borderWidth: 1.5,
                borderColor: isReviewed
                  ? review.action === "dismissed"
                    ? colors.border
                    : (colors.success ?? "#22c55e")
                  : colors.border,
              }}
            >
              <View style={{ flexDirection: "row", gap: 10 }}>
                {finding.imageUrl ? (
                  <Image
                    source={{
                      uri: finding.imageUrl.startsWith("/objects")
                        ? `${API_BASE}/api/storage${finding.imageUrl.replace(/^\/objects/, "")}`
                        : finding.imageUrl,
                    }}
                    style={{ width: 68, height: 68, borderRadius: 8 }}
                    contentFit="cover"
                  />
                ) : (
                  <View
                    style={{
                      width: 68,
                      height: 68,
                      borderRadius: 8,
                      backgroundColor: colors.muted,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <Ionicons name="image-outline" size={26} color={colors.mutedForeground} />
                  </View>
                )}
                <View style={{ flex: 1, gap: 4 }}>
                  <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 6 }}>
                    <Text
                      numberOfLines={2}
                      style={{
                        color: colors.foreground,
                        fontFamily: "Inter_600SemiBold",
                        fontSize: 14,
                        flex: 1,
                      }}
                    >
                      {displayLabel}
                    </Text>
                    {isReviewed && (
                      <Ionicons
                        name={review.action === "dismissed" ? "close-circle" : "checkmark-circle"}
                        size={18}
                        color={
                          review.action === "dismissed"
                            ? colors.mutedForeground
                            : (colors.success ?? "#22c55e")
                        }
                      />
                    )}
                  </View>
                  <Text
                    numberOfLines={2}
                    style={{
                      color: colors.mutedForeground,
                      fontFamily: "Inter_400Regular",
                      fontSize: 12,
                    }}
                  >
                    {finding.description}
                  </Text>
                  <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
                    <View
                      style={{
                        paddingHorizontal: 6,
                        paddingVertical: 2,
                        borderRadius: 4,
                        backgroundColor: cc + "33",
                      }}
                    >
                      <Text
                        style={{
                          color: cc,
                          fontFamily: "Inter_600SemiBold",
                          fontSize: 11,
                        }}
                      >
                        {Math.round((finding.confidence ?? 0) * 100)}% conf
                      </Text>
                    </View>
                    {finding.location ? (
                      <View
                        style={{
                          paddingHorizontal: 6,
                          paddingVertical: 2,
                          borderRadius: 4,
                          backgroundColor: colors.muted,
                        }}
                      >
                        <Text
                          style={{
                            color: colors.mutedForeground,
                            fontFamily: "Inter_400Regular",
                            fontSize: 11,
                          }}
                        >
                          {finding.location}
                        </Text>
                      </View>
                    ) : null}
                  </View>
                  {(finding.candidates ?? []).length > 1 ? (
                    <View style={{ flexDirection: "row", gap: 4, flexWrap: "wrap", marginTop: 2 }}>
                      {(finding.candidates ?? []).slice(1).map((c, i) => (
                        <Pressable
                          key={i}
                          onPress={() => applyReview(finding, "corrected", c.species)}
                          style={{
                            paddingHorizontal: 6,
                            paddingVertical: 2,
                            borderRadius: 4,
                            borderWidth: 1,
                            borderColor: colors.border,
                            backgroundColor: colors.card,
                          }}
                        >
                          <Text
                            style={{
                              color: colors.mutedForeground,
                              fontFamily: "Inter_400Regular",
                              fontSize: 11,
                            }}
                          >
                            {c.species} ({Math.round(c.confidence * 100)}%)
                          </Text>
                        </Pressable>
                      ))}
                    </View>
                  ) : null}
                </View>
              </View>

              <View style={{ flexDirection: "row", gap: 8 }}>
                <Pressable
                  onPress={() => applyReview(finding, "accepted")}
                  style={{
                    flex: 1,
                    paddingVertical: 8,
                    borderRadius: 8,
                    alignItems: "center",
                    backgroundColor:
                      review?.action === "accepted"
                        ? (colors.success ?? "#22c55e") + "22"
                        : colors.muted,
                    borderWidth: 1,
                    borderColor:
                      review?.action === "accepted"
                        ? (colors.success ?? "#22c55e")
                        : colors.border,
                  }}
                >
                  <Text
                    style={{
                      color:
                        review?.action === "accepted"
                          ? (colors.success ?? "#22c55e")
                          : colors.mutedForeground,
                      fontFamily: "Inter_600SemiBold",
                      fontSize: 13,
                    }}
                  >
                    Accept
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => {
                    setCorrecting(finding);
                    setCustomSpecies(
                      finding.species?.replace(/^Possible:\s*/i, "") ?? "",
                    );
                  }}
                  style={{
                    flex: 1,
                    paddingVertical: 8,
                    borderRadius: 8,
                    alignItems: "center",
                    backgroundColor:
                      review?.action === "corrected" ? colors.primary + "22" : colors.muted,
                    borderWidth: 1,
                    borderColor:
                      review?.action === "corrected" ? colors.primary : colors.border,
                  }}
                >
                  <Text
                    style={{
                      color:
                        review?.action === "corrected"
                          ? colors.primary
                          : colors.mutedForeground,
                      fontFamily: "Inter_600SemiBold",
                      fontSize: 13,
                    }}
                  >
                    Correct
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => applyReview(finding, "dismissed")}
                  style={{
                    flex: 1,
                    paddingVertical: 8,
                    borderRadius: 8,
                    alignItems: "center",
                    backgroundColor:
                      review?.action === "dismissed"
                        ? colors.destructive + "22"
                        : colors.muted,
                    borderWidth: 1,
                    borderColor:
                      review?.action === "dismissed" ? colors.destructive : colors.border,
                  }}
                >
                  <Text
                    style={{
                      color:
                        review?.action === "dismissed"
                          ? colors.destructive
                          : colors.mutedForeground,
                      fontFamily: "Inter_600SemiBold",
                      fontSize: 13,
                    }}
                  >
                    Dismiss
                  </Text>
                </Pressable>
              </View>
            </Card>
          );
        }}
      />

      <View
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          padding: 16,
          paddingBottom: 24,
          backgroundColor: colors.background,
          borderTopWidth: 1,
          borderTopColor: colors.border,
        }}
      >
        <Button
          title={
            saving
              ? "Saving…"
              : allReviewed
                ? "Done — All Reviewed"
                : `Review All (${reviewedCount} / ${findings.length})`
          }
          icon={allReviewed && !saving ? "checkmark-circle" : undefined}
          disabled={!allReviewed || saving}
          onPress={() => void handleDone()}
          size="lg"
        />
      </View>

      <Modal
        visible={correcting !== null}
        transparent
        animationType="slide"
        onRequestClose={() => setCorrecting(null)}
      >
        <View
          style={{ flex: 1, justifyContent: "flex-end", backgroundColor: "rgba(0,0,0,0.5)" }}
        >
          <View
            style={{
              backgroundColor: colors.background,
              borderTopLeftRadius: 20,
              borderTopRightRadius: 20,
              padding: 20,
              gap: 14,
            }}
          >
            <Text
              style={{ color: colors.foreground, fontFamily: "Inter_700Bold", fontSize: 18 }}
            >
              Correct Species ID
            </Text>

            {(correcting?.candidates ?? []).length > 0 ? (
              <View style={{ gap: 8 }}>
                <Text
                  style={{
                    color: colors.mutedForeground,
                    fontFamily: "Inter_600SemiBold",
                    fontSize: 12,
                    textTransform: "uppercase",
                    letterSpacing: 0.5,
                  }}
                >
                  AI Candidates
                </Text>
                {(correcting?.candidates ?? []).map((c, i) => (
                  <Pressable
                    key={i}
                    onPress={() => setCustomSpecies(c.species)}
                    style={{
                      paddingHorizontal: 14,
                      paddingVertical: 10,
                      borderRadius: 8,
                      borderWidth: 1,
                      borderColor:
                        customSpecies === c.species ? colors.primary : colors.border,
                      backgroundColor:
                        customSpecies === c.species ? colors.primary + "11" : colors.card,
                      flexDirection: "row",
                      justifyContent: "space-between",
                      alignItems: "center",
                    }}
                  >
                    <Text
                      style={{
                        color: colors.foreground,
                        fontFamily: "Inter_500Medium",
                        fontSize: 15,
                      }}
                    >
                      {c.species}
                    </Text>
                    <Text
                      style={{
                        color: colors.mutedForeground,
                        fontFamily: "Inter_400Regular",
                        fontSize: 14,
                      }}
                    >
                      {Math.round(c.confidence * 100)}%
                    </Text>
                  </Pressable>
                ))}
              </View>
            ) : null}

            <View style={{ gap: 6 }}>
              <Text
                style={{
                  color: colors.mutedForeground,
                  fontFamily: "Inter_600SemiBold",
                  fontSize: 12,
                  textTransform: "uppercase",
                  letterSpacing: 0.5,
                }}
              >
                Or Type Species
              </Text>
              <TextInput
                value={customSpecies}
                onChangeText={setCustomSpecies}
                placeholder="e.g. German Cockroach, Bed Bug…"
                placeholderTextColor={colors.mutedForeground}
                autoFocus
                style={{
                  borderWidth: 1,
                  borderColor: colors.border,
                  borderRadius: 8,
                  padding: 12,
                  color: colors.foreground,
                  fontFamily: "Inter_400Regular",
                  fontSize: 15,
                  backgroundColor: colors.card,
                }}
              />
            </View>

            <View style={{ flexDirection: "row", gap: 10 }}>
              <Button
                title="Cancel"
                variant="outline"
                onPress={() => setCorrecting(null)}
                style={{ flex: 1 }}
              />
              <Button
                title="Save"
                disabled={!customSpecies.trim()}
                onPress={handleSaveCorrection}
                style={{ flex: 1 }}
              />
            </View>
          </View>
        </View>
      </Modal>
    </Screen>
  );
}
