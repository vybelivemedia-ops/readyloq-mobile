import { Ionicons } from "@expo/vector-icons";
import {
  getGetCustomerSummaryForInspectionQueryOptions,
  getGetInspectionQueryOptions,
  getListAnalysisResultsQueryOptions,
  type Finding,
} from "@/lib/api-client";
import { useQuery } from "@tanstack/react-query";
import { Image } from "expo-image";
import { type Href, useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  Text,
  useWindowDimensions,
  View,
} from "react-native";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Screen } from "@/components/ui/Screen";
import { useColors } from "@/hooks/useColors";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useLocalInspection } from "@/hooks/useLocalInspections";
import { formatStatus, severityTone } from "@/constants/inspection";
import { API_BASE } from "@/lib/api";
import { generateReportPdf } from "@/lib/delivery/pdf";
import {
  getAvailableDeliveryMethods,
  type DeliveryMethod,
} from "@/lib/delivery/registry";
import type { LocalInspection, LocalSyncPhase } from "@/lib/local/inspection-store";
import { syncNow } from "@/lib/sync/engine";
import { describeCaptureSource, isLowQuality } from "@/lib/vision";

/**
 * Post-completion summary: shown immediately after "Complete Inspection",
 * online or offline. Renders entirely from the durable local record (photos
 * are local files), then layers in server results — findings, report, risk —
 * as the sync engine and the server finalization pipeline catch up.
 */
export default function InspectionSummaryScreen() {
  const colors = useColors();
  const router = useRouter();
  const params = useLocalSearchParams<{ localId: string }>();
  const { record, phase, loaded } = useLocalInspection(params.localId);

  const serverId = record?.serverId ?? null;
  const finalized = record?.serverCompleted === true;

  // Poll while the server-side finalization pipeline (report, narrative,
  // summary, opportunities, scorecard) is still running.
  const inspectionQ = useQuery({
    ...getGetInspectionQueryOptions(serverId ?? 0),
    enabled: serverId != null,
    refetchInterval: (q) =>
      q.state.data?.status === "complete" || q.state.data?.status === "completed" ? false : 4000,
  });
  const analysisQ = useQuery({
    ...getListAnalysisResultsQueryOptions({ inspectionId: serverId ?? 0 }),
    enabled: serverId != null && finalized,
  });

  const inspection = serverId != null ? inspectionQ.data : undefined;
  const analysis = serverId != null ? analysisQ.data?.[0] : undefined;
  const findings = useMemo(() => analysis?.findings ?? [], [analysis]);

  // Customer summary share link — the endpoint is manager+ only on the
  // server, so the query is role-gated here too (never fires a doomed 403).
  const { user } = useCurrentUser();
  const isManager = user?.role === "manager" || user?.role === "owner";
  const summaryQ = useQuery({
    ...getGetCustomerSummaryForInspectionQueryOptions(serverId ?? 0),
    enabled: serverId != null && finalized && isManager,
    retry: false, // 404 = no summary yet; don't hammer.
  });
  const customerSummaryUrl = useMemo(() => {
    const s = summaryQ.data;
    if (!s || s.status !== "approved" || !s.shareToken) return null;
    if (s.shareExpiresAt && new Date(s.shareExpiresAt).getTime() < Date.now()) return null;
    return `${API_BASE}/share/summary/${s.shareToken}`;
  }, [summaryQ.data]);

  // Per-photo findings: the AI reports each finding against the storage path
  // of the photo it came from. Keyed by capture order via the local record.
  const findingsByPhoto = useMemo(() => {
    const map = new Map<number, Finding[]>();
    if (!record) return map;
    record.photos.forEach((photo, i) => {
      if (!photo.storagePath) return;
      map.set(
        i,
        findings.filter((f) => f.imageUrl && f.imageUrl === photo.storagePath),
      );
    });
    return map;
  }, [record, findings]);

  const [viewerIndex, setViewerIndex] = useState<number | null>(null);

  if (!loaded) {
    return <Screen edges={["top", "bottom"]} />;
  }

  if (!record) {
    return (
      <Screen edges={["top", "bottom"]} padded>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 12 }}>
          <Ionicons name="alert-circle-outline" size={40} color={colors.mutedForeground} />
          <Text style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold", fontSize: 16 }}>
            Inspection not found on this device
          </Text>
          <Button title="Back to inspections" onPress={() => router.replace("/(tabs)/inspections" as Href)} />
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
          justifyContent: "space-between",
          paddingHorizontal: 16,
          paddingVertical: 12,
        }}
      >
        <Text style={{ color: colors.foreground, fontFamily: "Inter_700Bold", fontSize: 22 }}>
          Inspection complete
        </Text>
        <Pressable
          onPress={() => router.replace("/(tabs)/inspections" as Href)}
          style={{
            width: 40,
            height: 40,
            borderRadius: 20,
            backgroundColor: colors.card,
            borderWidth: 1,
            borderColor: colors.border,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Ionicons name="close" size={22} color={colors.foreground} />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={{
          padding: 16,
          paddingTop: 4,
          gap: 14,
          paddingBottom: 40,
          width: "100%",
          maxWidth: 720,
          alignSelf: "center",
        }}
      >
        <SyncStatusCard
          phase={phase}
          error={record.syncError}
          localId={record.localId}
          syncAttempts={record.syncAttempts}
        />

        <Card style={{ gap: 10 }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <View
              style={{
                width: 44,
                height: 44,
                borderRadius: 22,
                backgroundColor: colors.primary + "22",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Ionicons name="checkmark-circle" size={26} color={colors.primary} />
            </View>
            <View style={{ flex: 1 }}>
              <Text
                numberOfLines={2}
                style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold", fontSize: 16 }}
              >
                {record.siteAddress || "Untitled inspection"}
              </Text>
              {record.clientName ? (
                <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 13 }}>
                  {record.clientName}
                </Text>
              ) : null}
            </View>
          </View>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 14 }}>
            <Meta icon="camera-outline" text={`${record.photos.length} photos`} />
            <Meta icon="person-outline" text={record.technicianName || "—"} />
            {record.completedAt ? (
              <Meta
                icon="time-outline"
                text={new Date(record.completedAt).toLocaleString(undefined, {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
              />
            ) : null}
            {inspection?.severity ? (
              <Badge label={formatStatus(inspection.severity)} tone={severityTone(inspection.severity)} />
            ) : null}
          </View>
        </Card>

        {/* AI results — appear as the server finishes finalization. */}
        {finalized ? (
          findings.length > 0 || analysisQ.isSuccess ? (
            <Card style={{ gap: 8 }}>
              <SectionTitle icon="sparkles" title={`AI findings (${findings.length})`} />
              {findings.length === 0 ? (
                <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 13 }}>
                  No pest activity or conducive conditions detected in the evidence.
                </Text>
              ) : (
                findings.slice(0, 5).map((f) => <FindingRow key={f.id} finding={f} />)
              )}
              {findings.length > 5 ? (
                <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 12 }}>
                  +{findings.length - 5} more — view the full inspection for everything.
                </Text>
              ) : null}
            </Card>
          ) : (
            <Card style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              <ActivityIndicator size="small" color={colors.primary} />
              <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 13, flex: 1 }}>
                Generating report, customer summary, and business insights…
              </Text>
            </Card>
          )
        ) : (
          <Card style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <Ionicons name="cloud-upload-outline" size={20} color={colors.mutedForeground} />
            <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 13, flex: 1 }}>
              AI analysis, the service report, and insights will generate automatically once
              this inspection syncs.
            </Text>
          </Card>
        )}

        {/* Photo gallery — capture order, straight from durable local files. */}
        <Card style={{ gap: 10 }}>
          <SectionTitle icon="images-outline" title={`Evidence (${record.photos.length})`} />
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {record.photos.map((photo, i) => {
              const photoFindings = findingsByPhoto.get(i) ?? [];
              const sourceInfo = describeCaptureSource(photo.captureSource);
              const lowQ = isLowQuality(photo.qualityScore);
              return (
                <Pressable key={photo.localUri} onPress={() => setViewerIndex(i)}>
                  <Image
                    source={{ uri: photo.localUri }}
                    style={{
                      width: 92,
                      height: 92,
                      borderRadius: 10,
                      borderWidth: lowQ ? 2 : 0,
                      borderColor: lowQ ? colors.warning : "transparent",
                    }}
                  />
                  {!sourceInfo.isDefault ? (
                    <View
                      style={{
                        position: "absolute",
                        top: 4,
                        right: 4,
                        backgroundColor: "rgba(0,0,0,0.6)",
                        borderRadius: 6,
                        padding: 3,
                      }}
                    >
                      <Ionicons
                        name={sourceInfo.icon as keyof typeof Ionicons.glyphMap}
                        size={12}
                        color="#fff"
                      />
                    </View>
                  ) : null}
                  {lowQ ? (
                    <View
                      style={{
                        position: "absolute",
                        bottom: 4,
                        left: 4,
                        backgroundColor: colors.warning,
                        borderRadius: 999,
                        padding: 2,
                      }}
                    >
                      <Ionicons name="warning" size={11} color="#fff" />
                    </View>
                  ) : null}
                  <View
                    style={{
                      position: "absolute",
                      top: 4,
                      left: 4,
                      backgroundColor: "rgba(0,0,0,0.6)",
                      borderRadius: 6,
                      paddingHorizontal: 5,
                      paddingVertical: 1,
                    }}
                  >
                    <Text style={{ color: "#fff", fontFamily: "Inter_600SemiBold", fontSize: 10 }}>
                      {i + 1}
                    </Text>
                  </View>
                  {photoFindings.length > 0 ? (
                    <View
                      style={{
                        position: "absolute",
                        bottom: 4,
                        right: 4,
                        backgroundColor: colors.primary,
                        borderRadius: 999,
                        paddingHorizontal: 6,
                        paddingVertical: 1,
                      }}
                    >
                      <Text style={{ color: colors.primaryForeground, fontFamily: "Inter_600SemiBold", fontSize: 10 }}>
                        {photoFindings.length}
                      </Text>
                    </View>
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        </Card>

        <DeliverySection
          record={record}
          findings={findings}
          recommendations={analysis?.recommendations ?? []}
          riskLevel={analysis?.riskLevel ?? null}
          analysisComplete={finalized && analysis !== undefined}
          companyName={user?.company?.name ?? null}
          customerSummaryUrl={customerSummaryUrl}
        />

        <View style={{ gap: 10 }}>
          {serverId != null && finalized ? (
            <Button
              title="View full inspection"
              size="lg"
              icon="clipboard-outline"
              onPress={() => router.replace(`/inspection/${serverId}` as Href)}
            />
          ) : null}
          <Button
            title="Back to inspections"
            variant={serverId != null && finalized ? "ghost" : "primary"}
            size="lg"
            onPress={() => router.replace("/(tabs)/inspections" as Href)}
          />
        </View>
      </ScrollView>

      {/* Full-screen photo viewer with per-photo AI findings. */}
      <PhotoViewer
        visible={viewerIndex != null}
        photos={record.photos.map((p) => p.localUri)}
        meta={record.photos.map((p) => ({
          source: p.captureSource,
          quality: p.qualityScore ?? null,
        }))}
        initialIndex={viewerIndex ?? 0}
        findingsByPhoto={findingsByPhoto}
        onClose={() => setViewerIndex(null)}
      />
    </Screen>
  );
}

// ─── Report delivery ─────────────────────────────────────────────────────────

/**
 * "Deliver report" — renders one button per delivery channel the registry
 * says is usable on this device (print / share / email today; new channels
 * appear here automatically when registered). The PDF is generated fresh from
 * LOCAL data on each delivery, so it works fully offline and always reflects
 * the latest synced findings.
 */
function DeliverySection({
  record,
  findings,
  recommendations,
  riskLevel,
  analysisComplete,
  companyName,
  customerSummaryUrl,
}: {
  record: LocalInspection;
  findings: Finding[];
  recommendations: string[];
  riskLevel: string | null;
  analysisComplete: boolean;
  companyName: string | null;
  customerSummaryUrl: string | null;
}) {
  const colors = useColors();
  const [methods, setMethods] = useState<DeliveryMethod[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getAvailableDeliveryMethods().then((m) => {
      if (!cancelled) setMethods(m);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (methods.length === 0) return null;

  const deliver = async (method: DeliveryMethod) => {
    if (busyId) return;
    setBusyId(method.id);
    try {
      const pdfUri = await generateReportPdf({
        record,
        findings,
        recommendations,
        riskLevel,
        analysisComplete,
        companyName,
      });
      await method.deliver({
        pdfUri,
        subject: `Inspection report — ${record.siteAddress || "your property"}`,
        body:
          `Hi${record.clientName ? ` ${record.clientName}` : ""},\n\n` +
          `Please find your inspection report attached` +
          `${companyName ? ` from ${companyName}` : ""}. ` +
          `It covers the full photo evidence${analysisComplete ? " and our findings" : ""} from the visit.\n\n` +
          `Thank you!`,
        customerSummaryUrl,
      });
    } catch (err) {
      Alert.alert(
        "Delivery failed",
        err instanceof Error ? err.message : "Something went wrong. Please try again.",
      );
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Card style={{ gap: 10 }}>
      <SectionTitle icon="paper-plane-outline" title="Deliver report" />
      {!analysisComplete ? (
        <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 12 }}>
          The PDF includes all photos now; AI findings are added automatically once syncing
          and analysis finish.
        </Text>
      ) : null}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {methods.map((m) => {
          const busy = busyId === m.id;
          return (
            <Pressable
              key={m.id}
              disabled={busyId != null}
              onPress={() => void deliver(m)}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 6,
                paddingHorizontal: 14,
                paddingVertical: 10,
                borderRadius: 10,
                backgroundColor: colors.card,
                borderWidth: 1,
                borderColor: colors.border,
                opacity: busyId != null && !busy ? 0.5 : 1,
              }}
            >
              {busy ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <Ionicons name={m.icon} size={17} color={colors.primary} />
              )}
              <Text style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold", fontSize: 13 }}>
                {m.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      {customerSummaryUrl ? (
        <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 12 }}>
          Emails include the approved customer summary link.
        </Text>
      ) : null}
    </Card>
  );
}

// ─── Sync status ─────────────────────────────────────────────────────────────

function SyncStatusCard({
  phase,
  error,
  localId,
  syncAttempts,
}: {
  phase: LocalSyncPhase | null;
  error: string | null;
  localId: string;
  syncAttempts?: number;
}) {
  const colors = useColors();
  if (!phase) return null;

  const failedDetail = [
    error ?? "Something went wrong. We'll keep retrying automatically.",
    syncAttempts && syncAttempts > 1 ? `(attempt ${syncAttempts})` : null,
  ]
    .filter(Boolean)
    .join(" ");

  const config: Record<
    LocalSyncPhase,
    { icon: keyof typeof Ionicons.glyphMap; label: string; detail: string; color: string }
  > = {
    synced: {
      icon: "cloud-done-outline",
      label: "Synced",
      detail: "All evidence and results are safely on the server.",
      color: colors.success ?? "#22c55e",
    },
    syncing: {
      icon: "sync-outline",
      label: "Syncing…",
      detail: "Uploading evidence and running AI analysis.",
      color: colors.primary,
    },
    waiting: {
      icon: "cloud-offline-outline",
      label: "Waiting to sync",
      detail: "Saved on this device. Syncs automatically when you're back online.",
      color: colors.mutedForeground,
    },
    failed: {
      icon: "alert-circle-outline",
      label: syncAttempts && syncAttempts > 1 ? `Sync failed (attempt ${syncAttempts})` : "Sync failed",
      detail: failedDetail,
      color: colors.destructive,
    },
  };
  const c = config[phase];

  return (
    <Card style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
      {phase === "syncing" ? (
        <ActivityIndicator size="small" color={c.color} />
      ) : (
        <Ionicons name={c.icon} size={22} color={c.color} />
      )}
      <View style={{ flex: 1 }}>
        <Text style={{ color: c.color, fontFamily: "Inter_600SemiBold", fontSize: 14 }}>
          {c.label}
        </Text>
        <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 12 }}>
          {c.detail}
        </Text>
      </View>
      {phase === "failed" || phase === "waiting" ? (
        <Pressable
          onPress={() => void syncNow(localId).catch(() => {})}
          style={{
            paddingHorizontal: 12,
            paddingVertical: 8,
            borderRadius: 999,
            backgroundColor: colors.primary,
          }}
        >
          <Text style={{ color: colors.primaryForeground, fontFamily: "Inter_600SemiBold", fontSize: 12 }}>
            Retry
          </Text>
        </Pressable>
      ) : null}
    </Card>
  );
}

// ─── Full-screen viewer ──────────────────────────────────────────────────────

function PhotoViewer({
  visible,
  photos,
  meta,
  initialIndex,
  findingsByPhoto,
  onClose,
}: {
  visible: boolean;
  photos: string[];
  meta?: { source?: string; quality?: number | null }[];
  initialIndex: number;
  findingsByPhoto: Map<number, Finding[]>;
  onClose: () => void;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [index, setIndex] = useState(initialIndex);

  // Reset paging position each time the viewer opens on a new photo.
  const [openKey, setOpenKey] = useState(0);
  React.useEffect(() => {
    if (visible) {
      setIndex(initialIndex);
      setOpenKey((k) => k + 1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, initialIndex]);

  const findings = findingsByPhoto.get(index) ?? [];
  const current = meta?.[index];
  const sourceInfo = describeCaptureSource(current?.source);
  const lowQ = isLowQuality(current?.quality);

  return (
    <Modal visible={visible} animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: "#000" }}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            paddingHorizontal: 16,
            paddingTop: Math.max(insets.top, 16),
            paddingBottom: 10,
          }}
        >
          <View style={{ gap: 3 }}>
            <Text style={{ color: "#fff", fontFamily: "Inter_600SemiBold", fontSize: 15 }}>
              Photo {index + 1} of {photos.length}
            </Text>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
              <Ionicons
                name={sourceInfo.icon as keyof typeof Ionicons.glyphMap}
                size={12}
                color="rgba(255,255,255,0.7)"
              />
              <Text style={{ color: "rgba(255,255,255,0.7)", fontFamily: "Inter_500Medium", fontSize: 12 }}>
                {sourceInfo.label}
              </Text>
              {lowQ ? (
                <>
                  <Ionicons name="warning" size={12} color={colors.warning} style={{ marginLeft: 4 }} />
                  <Text style={{ color: colors.warning, fontFamily: "Inter_500Medium", fontSize: 12 }}>
                    Low quality
                  </Text>
                </>
              ) : null}
            </View>
          </View>
          <Pressable
            onPress={onClose}
            style={{
              width: 40,
              height: 40,
              borderRadius: 20,
              backgroundColor: "rgba(255,255,255,0.15)",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Ionicons name="close" size={22} color="#fff" />
          </Pressable>
        </View>

        <FlatList
          key={`viewer-${openKey}`}
          data={photos}
          horizontal
          pagingEnabled
          initialScrollIndex={initialIndex}
          getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
          onMomentumScrollEnd={(e) =>
            setIndex(Math.round(e.nativeEvent.contentOffset.x / width))
          }
          keyExtractor={(uri) => uri}
          renderItem={({ item }) => (
            <View style={{ width, flex: 1, alignItems: "center", justifyContent: "center" }}>
              <Image
                source={{ uri: item }}
                style={{ width: "100%", height: "100%" }}
                contentFit="contain"
              />
            </View>
          )}
        />

        {findings.length > 0 ? (
          <ScrollView
            style={{ maxHeight: 220, backgroundColor: "rgba(0,0,0,0.85)" }}
            contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 32 }}
          >
            <Text style={{ color: "#fff", fontFamily: "Inter_600SemiBold", fontSize: 14 }}>
              AI findings on this photo
            </Text>
            {findings.map((f) => (
              <View key={f.id} style={{ gap: 2 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Badge label={formatStatus(f.category)} tone={severityTone(f.severity)} />
                  {f.severity ? (
                    <Text style={{ color: "rgba(255,255,255,0.7)", fontFamily: "Inter_500Medium", fontSize: 12 }}>
                      {formatStatus(f.severity)}
                    </Text>
                  ) : null}
                </View>
                <Text style={{ color: "#fff", fontFamily: "Inter_400Regular", fontSize: 13, lineHeight: 19 }}>
                  {f.description}
                </Text>
              </View>
            ))}
          </ScrollView>
        ) : (
          <View style={{ padding: 16, paddingBottom: 32, backgroundColor: "rgba(0,0,0,0.85)" }}>
            <Text
              style={{
                color: "rgba(255,255,255,0.6)",
                fontFamily: "Inter_400Regular",
                fontSize: 13,
                textAlign: "center",
              }}
            >
              No AI findings on this photo.
            </Text>
          </View>
        )}
      </View>
    </Modal>
  );
}

// ─── Small pieces ────────────────────────────────────────────────────────────

function SectionTitle({ icon, title }: { icon: keyof typeof Ionicons.glyphMap; title: string }) {
  const colors = useColors();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
      <Ionicons name={icon} size={17} color={colors.primary} />
      <Text style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold", fontSize: 15 }}>
        {title}
      </Text>
    </View>
  );
}

function FindingRow({ finding }: { finding: Finding }) {
  const colors = useColors();
  return (
    <View style={{ gap: 3, paddingVertical: 4 }}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <Badge label={formatStatus(finding.category)} tone={severityTone(finding.severity)} />
        {finding.location ? (
          <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 12 }}>
            {finding.location}
          </Text>
        ) : null}
      </View>
      <Text style={{ color: colors.foreground, fontFamily: "Inter_400Regular", fontSize: 13, lineHeight: 19 }}>
        {finding.description}
      </Text>
    </View>
  );
}

function Meta({ icon, text }: { icon: keyof typeof Ionicons.glyphMap; text: string }) {
  const colors = useColors();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
      <Ionicons name={icon} size={14} color={colors.mutedForeground} />
      <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 12 }}>
        {text}
      </Text>
    </View>
  );
}
