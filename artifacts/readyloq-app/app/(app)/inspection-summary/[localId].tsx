import { Ionicons } from "@expo/vector-icons";
import {
  getGetCustomerSummaryForInspectionQueryOptions,
  getGetInspectionQueryOptions,
  getListAnalysisResultsQueryOptions,
  type Finding,
} from "@/lib/api-client";
import { useQuery } from "@tanstack/react-query";
import * as Clipboard from "expo-clipboard";
import { Image } from "expo-image";
import * as MediaLibrary from "expo-media-library";
import { type Href, useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useMemo, useState } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from "react-native";

import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Screen } from "@/components/ui/Screen";
import { useAuth } from "@clerk/expo";
import { useColors } from "@/hooks/useColors";
import { useCurrentUser } from "@/hooks/useCurrentUser";
import { useLocalInspection } from "@/hooks/useLocalInspections";
import { formatStatus, severityTone } from "@/constants/inspection";
import {
  API_BASE,
  fetchIntegrationConfig,
  triggerIntegrationSync,
  fetchPlaybookCompliance,
  type FieldIntegrationSystem,
  type IntegrationConfigResponse,
  type ComplianceViolation,
} from "@/lib/api";
import { generateReportPdf } from "@/lib/delivery/pdf";
import {
  getAvailableDeliveryMethods,
  type DeliveryMethod,
} from "@/lib/delivery/registry";
import type { LocalInspection, LocalSyncPhase } from "@/lib/local/inspection-store";
import { enqueueDelivery, updateLocalInspection, updatePhotoDescription } from "@/lib/local/inspection-store";
import { InspectionSignaturePanel } from "@/components/InspectionSignaturePanel";
import { syncNow } from "@/lib/sync/engine";
import { describeCaptureSource, isLowQuality } from "@/lib/vision";
import {
  resolveAnalysisCardVariant,
  resolveDeliveryCardVariant,
  resolveSyncStatusVariant,
} from "./inspection-summary-logic";

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
    enabled: serverId != null,
    refetchInterval: (q) => {
      const status = q.state.data?.[0]?.status?.toLowerCase();
      return status === "complete" || status === "failed" ? false : 4000;
    },
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
  const [analyzing, setAnalyzing] = useState(false);

  // ── Field-service platform integration ──────────────────────────────────────
  const { getToken } = useAuth();
  const [integrationConfig, setIntegrationConfig] = useState<IntegrationConfigResponse | null>(null);
  // Explicit cast so TS doesn't complain about `token` param below.
  const [isSyncing, setIsSyncing] = useState(false);

  useEffect(() => {
    if (!finalized || !isManager) return;
    getToken()
      .then((token: string | null) => fetchIntegrationConfig(token))
      .then(setIntegrationConfig)
      .catch(() => { /* non-blocking — button just won't show */ });
  }, [finalized, isManager, getToken]);

  // ── Company Playbook compliance (Learning Engine) ───────────────────────────
  const [complianceViolations, setComplianceViolations] = useState<ComplianceViolation[]>([]);

  useEffect(() => {
    if (!finalized || serverId == null) return;
    getToken()
      .then((token: string | null) => fetchPlaybookCompliance(token, serverId))
      .then((r) => setComplianceViolations(r.violations))
      .catch(() => { /* non-blocking — banner simply won't show */ });
  }, [finalized, serverId, getToken]);

  const systemLabel: Record<FieldIntegrationSystem, string> = {
    pestpac: "PestPac",
    fieldroutes: "FieldRoutes",
  };

  const handlePushToDispatch = async () => {
    if (!serverId || isSyncing) return;
    setIsSyncing(true);
    try {
      const token = await getToken();
      const result = await triggerIntegrationSync(token, serverId);
      const totalPhotos = record?.photos.length ?? 0;
      const attached = result.attachmentsPosted;
      const allAttached = attached >= totalPhotos;
      Alert.alert(
        "Pushed to dispatch",
        allAttached
          ? "Inspection report, photos, and conditions were successfully sent."
          : `Report and conditions sent. ${attached} of ${totalPhotos} photo${totalPhotos !== 1 ? "s" : ""} attached — you can push again to retry the remaining photos.`,
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      Alert.alert(
        "Sync failed",
        `Could not push to dispatch software. ${msg}`,
      );
    } finally {
      setIsSyncing(false);
    }
  };

  // Imported photos that haven't gone through server AI yet.
  const hasUnanalyzed =
    record != null &&
    record.photos.some((p) => p.captureSource === "media_import") &&
    record.photos.length > record.analyzedCount;

  const handleAnalyze = async () => {
    if (!record || analyzing) return;
    setAnalyzing(true);
    try {
      await syncNow(record.localId);
    } finally {
      setAnalyzing(false);
    }
  };

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

        {/* AI results — appear as the server finishes finalization.
            Rendering is driven by resolveAnalysisCardVariant() (inspection-summary-logic.ts)
            so the same decision function is exercised by unit tests and by this component. */}
        {(() => {
          const aiVariant = resolveAnalysisCardVariant({
            finalized,
            analysisInProgress:
              phase === "syncing" &&
              record.photos.length > 0 &&
              record.photos.every((photo) => photo.storagePath && photo.mediaRowId != null) &&
              record.analyzedCount < record.photos.length,
            isError: analysisQ.isError,
            isSuccess: analysisQ.isSuccess,
            analysis: analysis ?? (analysisQ.isSuccess ? null : undefined),
            photoCount: record.photos.length,
          });

          switch (aiVariant.kind) {
            case "ai-queued":
              return (
                <Card style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <Ionicons name="cloud-upload-outline" size={20} color={colors.mutedForeground} />
                  <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 13, flex: 1 }}>
                    AI queued — analysis will start automatically after the evidence is synchronized.
                  </Text>
                </Card>
              );

            case "query-error":
            case "pipeline-incomplete":
            case "ai-failed":
              return (
                <Card style={{ gap: 8 }}>
                  <SectionTitle icon="sparkles" title="AI failed" />
                  <SectionNotGenerated {...aiVariant.placeholder} />
                </Card>
              );

            case "ai-partial":
              return (
                <Card style={{ gap: 8 }}>
                  <SectionTitle icon="sparkles" title={`AI partial · findings (${aiVariant.findingsCount})`} />
                  {findings.slice(0, 5).map((f) => <FindingRow key={f.id} finding={f} />)}
                  <SectionNotGenerated {...aiVariant.placeholder} />
                </Card>
              );

            case "analysis-errors-no-findings":
              return (
                <Card style={{ gap: 8 }}>
                  <SectionTitle icon="sparkles" title="AI findings (0)" />
                  <SectionNotGenerated {...aiVariant.placeholder} />
                </Card>
              );

            case "no-photos":
              return (
                <Card style={{ gap: 8 }}>
                  <SectionTitle icon="sparkles" title="AI findings" />
                  <SectionNotGenerated {...aiVariant.placeholder} />
                </Card>
              );

            case "no-analysis-record":
              return (
                <Card style={{ gap: 8 }}>
                  <SectionTitle icon="sparkles" title="AI findings" />
                  <SectionNotGenerated {...aiVariant.placeholder} />
                </Card>
              );

            case "clean":
              return (
                <Card style={{ gap: 8 }}>
                  <SectionTitle icon="sparkles" title={`AI complete · findings (${findings.length})`} />
                  <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 13 }}>
                    No pest activity or conducive conditions detected in the evidence.
                  </Text>
                </Card>
              );

            case "findings": {
              const errCount = aiVariant.analysisErrors;
              return (
                <Card style={{ gap: 8 }}>
                  <SectionTitle
                    icon="sparkles"
                    title={`${errCount > 0 ? "AI partial" : "AI complete"} · findings (${findings.length})`}
                  />
                  {findings.slice(0, 5).map((f) => <FindingRow key={f.id} finding={f} />)}
                  {errCount > 0 ? (
                    // Completed with some errors but still produced findings — warn without hiding.
                    <SectionNotGenerated
                      reason={`${errCount} photo${errCount !== 1 ? "s" : ""} couldn't be processed — findings above may be incomplete.`}
                      icon="alert-circle-outline"
                      tone="error"
                    />
                  ) : null}
                  {findings.length > 5 ? (
                    <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 12 }}>
                      +{findings.length - 5} more — view the full inspection for everything.
                    </Text>
                  ) : null}
                </Card>
              );
            }

            case "ai-analyzing":
            default:
              return (
                <Card style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                  <ActivityIndicator size="small" color={colors.primary} />
                  <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 13, flex: 1 }}>
                    AI analyzing — the inspection is complete and you may leave this screen.
                  </Text>
                </Card>
              );
          }
        })()}

        {/* Photo gallery — capture order, straight from durable local files. */}
        <Card style={{ gap: 10 }}>
          <SectionTitle icon="images-outline" title={`Evidence (${record.photos.length})`} />
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {record.photos.map((photo, i) => {
              const photoFindings = findingsByPhoto.get(i) ?? [];
              const sourceInfo = describeCaptureSource(photo.captureSource);
              const lowQ = isLowQuality(photo.qualityScore);
              const hasNote = !!photo.description;
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
                  {/* Note badge — bottom-right when no AI findings, else stacked above findings badge */}
                  {hasNote && photoFindings.length === 0 ? (
                    <View
                      style={{
                        position: "absolute",
                        bottom: 4,
                        right: 4,
                        backgroundColor: "#0f766e",
                        borderRadius: 999,
                        padding: 3,
                      }}
                    >
                      <Ionicons name="create-outline" size={10} color="#fff" />
                    </View>
                  ) : null}
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
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 3,
                      }}
                    >
                      {hasNote ? <Ionicons name="create-outline" size={9} color={colors.primaryForeground} /> : null}
                      <Text style={{ color: colors.primaryForeground, fontFamily: "Inter_600SemiBold", fontSize: 10 }}>
                        {photoFindings.length}
                      </Text>
                    </View>
                  ) : null}
                </Pressable>
              );
            })}
          </View>
          {/* Analyze imported photos with AI */}
          {hasUnanalyzed ? (
            <Pressable
              onPress={() => { void handleAnalyze(); }}
              disabled={analyzing}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
                backgroundColor: analyzing ? colors.muted : colors.primary,
                borderRadius: 10,
                paddingVertical: 10,
                paddingHorizontal: 14,
                marginTop: 2,
              }}
            >
              {analyzing ? (
                <ActivityIndicator size="small" color={colors.primaryForeground} />
              ) : (
                <Ionicons name="sparkles-outline" size={16} color={colors.primaryForeground} />
              )}
              <Text style={{ color: colors.primaryForeground, fontFamily: "Inter_600SemiBold", fontSize: 14 }}>
                {analyzing ? "Analyzing photos…" : "Analyze photos with AI"}
              </Text>
            </Pressable>
          ) : null}
        </Card>

        <DeliverySection
          record={record}
          findings={findings}
          recommendations={analysis?.recommendations ?? []}
          riskLevel={analysis?.riskLevel ?? null}
          analysisComplete={finalized && analysis !== undefined}
          companyName={user?.company?.name ?? null}
          customerSummaryUrl={customerSummaryUrl}
          photosReady={loaded}
        />

        {/* ── Company Playbook Compliance Warning ────────────────────────── */}
        {complianceViolations.length > 0 && (
          <View
            style={{
              flexDirection: "row",
              alignItems: "flex-start",
              gap: 10,
              backgroundColor: "#F8511408",
              borderWidth: 1,
              borderColor: "#F85114",
              borderRadius: 10,
              padding: 14,
            }}
          >
            <Ionicons name="alert-circle" size={20} color="#F85114" style={{ marginTop: 1 }} />
            <View style={{ flex: 1, gap: 6 }}>
              <Text
                style={{
                  color: "#F85114",
                  fontFamily: "Inter_700Bold",
                  fontSize: 13,
                }}
              >
                Company Playbook Warning
              </Text>
              {complianceViolations.map((v, i) => (
                <Text
                  key={i}
                  style={{
                    color: "#c0392b",
                    fontFamily: "Inter_400Regular",
                    fontSize: 12,
                    lineHeight: 17,
                  }}
                >
                  {"• "}{v.message}
                </Text>
              ))}
            </View>
          </View>
        )}

        {/* ── Signature panel ─────────────────────────────────────────────
             Shown for all inspections (in-progress and completed).
             The panel saves directly to the local store; because
             useLocalInspection subscribes to the store, the parent
             re-renders automatically and the updated record is passed
             back through props — no extra state needed here. */}
        <InspectionSignaturePanel
          localId={record.localId}
          technicianName={record.technicianName}
          technicianSignature={record.technicianSignature ?? null}
          ownerSignature={record.ownerSignature ?? null}
          ownerNotAvailable={record.ownerNotAvailable ?? false}
          unitNumber={record.unitNumber ?? null}
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

          {/* Push to dispatch — shown when the company has a PestPac / FieldRoutes integration configured. */}
          {serverId != null &&
            finalized &&
            integrationConfig?.configured === true &&
            integrationConfig.integration.enabled ? (
            <Button
              title={
                isSyncing
                  ? "Pushing to dispatch…"
                  : `Push to ${systemLabel[integrationConfig.integration.systemType]}`
              }
              size="lg"
              icon="cloud-upload-outline"
              variant="outline"
              disabled={isSyncing}
              onPress={() => void handlePushToDispatch()}
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

      {/* Full-screen photo viewer with per-photo AI findings + description editor. */}
      <PhotoViewer
        visible={viewerIndex != null}
        photos={record.photos.map((p) => p.localUri)}
        meta={record.photos.map((p) => ({
          source: p.captureSource,
          quality: p.qualityScore ?? null,
          uri: p.localUri,
          description: p.description,
        }))}
        initialIndex={viewerIndex ?? 0}
        findingsByPhoto={findingsByPhoto}
        onDescriptionChange={(photoUri, text) => {
          void updatePhotoDescription(record.localId, photoUri, text);
        }}
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
 *
 * Failed delivery attempts are persisted in `record.pendingDeliveries` so
 * technicians don't lose sends made on poor signal. A banner shows the queued
 * count and lets the technician retry once connectivity returns.
 */
function DeliverySection({
  record,
  findings,
  recommendations,
  riskLevel,
  analysisComplete,
  companyName,
  customerSummaryUrl,
  photosReady,
}: {
  record: LocalInspection;
  findings: Finding[];
  recommendations: string[];
  riskLevel: string | null;
  analysisComplete: boolean;
  companyName: string | null;
  customerSummaryUrl: string | null;
  /** True once the local record has fully loaded from AsyncStorage and photos
   *  are readable from disk. Delivery is blocked until this is true — generating
   *  a PDF before the record is ready produces a blank or incomplete file. */
  photosReady: boolean;
}) {
  const colors = useColors();
  const [methods, setMethods] = useState<DeliveryMethod[]>([]);
  // Track whether the async registry probe has finished so we never show
  // "unavailable" during the brief window before the Promise resolves.
  const [methodsLoaded, setMethodsLoaded] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Cache the generated PDF URI so subsequent Print / Share / Email taps reuse
  // the same file instead of re-rendering from scratch.
  const [cachedPdf, setCachedPdf] = useState<{ uri: string; serverId: number | null } | null>(null);

  // Invalidate the cache whenever the underlying data changes so stale PDFs
  // are never delivered. We track a stable key derived from the fields that
  // affect PDF content: photo count + descriptions + findings count + analysis.
  const cacheKey = useMemo(
    () =>
      [
        record.localId,
        record.serverId ?? "pending-sync",
        record.photos.length,
        record.photos.map((p) => p.description ?? "").join("|"),
        findings.length,
        analysisComplete ? "complete" : "pending",
      ].join("::"),
    [record.localId, record.serverId, record.photos, findings.length, analysisComplete],
  );
  const prevCacheKeyRef = React.useRef(cacheKey);
  useEffect(() => {
    if (prevCacheKeyRef.current !== cacheKey) {
      prevCacheKeyRef.current = cacheKey;
      setCachedPdf(null);
    }
  }, [cacheKey]);

  // Also clear on unmount so a stale URI is never picked up if the component
  // is remounted with different data.
  useEffect(() => {
    return () => {
      setCachedPdf(null);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void getAvailableDeliveryMethods().then((m) => {
      if (!cancelled) {
        // Always show preview first, then the outbound delivery channels.
        const preview = m.filter((x) => x.id === "preview");
        const rest = m.filter((x) => x.id !== "preview");
        setMethods([...preview, ...rest]);
        setMethodsLoaded(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Delegate the loading/no-methods/has-methods decision to the shared logic
  // function so unit tests can exercise the same branch without rendering.
  const deliveryVariant = resolveDeliveryCardVariant(methodsLoaded, methods.length);
  if (deliveryVariant.kind === "loading") return null;
  if (deliveryVariant.kind === "no-methods") {
    return (
      <Card style={{ gap: 8 }}>
        <SectionTitle icon="paper-plane-outline" title="Deliver report" />
        <SectionNotGenerated {...deliveryVariant.placeholder} />
      </Card>
    );
  }

  // Soft context (no pdfUri) — used both for delivery and for queueing failures.
  const buildSoftContext = () => ({
    subject: `Inspection report — ${record.siteAddress || "your property"}`,
    body:
      `Hi${record.clientName ? ` ${record.clientName}` : ""},\n\n` +
      `Please find your inspection report attached` +
      `${companyName ? ` from ${companyName}` : ""}. ` +
      `It covers the full photo evidence${analysisComplete ? " and our findings" : ""} from the visit.\n\n` +
      `Thank you!`,
    customerSummaryUrl,
  });

  const buildDeliveryContext = async () => {
    // Reuse the cached URI when available — avoids a second render + copy for
    // every Print / Share / Email tap after the technician has already previewed.
    const pdfUri = cachedPdf?.serverId === record.serverId ? cachedPdf.uri : await (async () => {
      const uri = await generateReportPdf({
        record,
        findings,
        recommendations,
        riskLevel,
        analysisComplete,
        companyName,
      });
      setCachedPdf({ uri, serverId: record.serverId });
      return uri;
    })();
    return { pdfUri, ...buildSoftContext() };
  };

  /**
   * Attempt delivery for `method`. On success, stamp `lastDeliveredAt` and
   * remove any queued entry for this channel. On failure for an outbound
   * (non-preview) channel, persist the intent to `pendingDeliveries` so it
   * survives app restarts and surfaces a retry indicator on this screen.
   *
   * @param clearFromQueue When true, a successful delivery also removes this
   *   method's entry from `pendingDeliveries` (used when retrying a queued send).
   */
  const deliver = async (method: DeliveryMethod, clearFromQueue = false) => {
    if (busyId || !photosReady) return;
    setBusyId(method.id);
    try {
      const ctx = await buildDeliveryContext();
      await method.deliver(ctx);
      // Stamp lastDeliveredAt for every outbound channel; preview is not a delivery.
      if (method.id !== "preview") {
        void updateLocalInspection(record.localId, (r) => {
          r.lastDeliveredAt = new Date().toISOString();
          if (clearFromQueue) {
            r.pendingDeliveries = r.pendingDeliveries.filter(
              (d) => d.methodId !== method.id,
            );
          }
        });
      }
    } catch (err) {
      if (method.id === "preview") {
        // Preview failures are ephemeral — the PDF viewer opens/closes locally.
        Alert.alert(
          "Preview failed",
          err instanceof Error ? err.message : "Something went wrong. Please try again.",
        );
      } else {
        // Queue the intent so the technician can retry after connectivity returns.
        // enqueueDelivery deduplicates by methodId so tapping Send twice while
        // offline never creates two entries for the same channel.
        void updateLocalInspection(record.localId, (r) => {
          r.pendingDeliveries = enqueueDelivery(r.pendingDeliveries, {
            methodId: method.id,
            label: method.label,
            queuedAt: new Date().toISOString(),
            context: buildSoftContext(),
          });
        });
        Alert.alert(
          "Delivery queued",
          `Couldn't send via ${method.label} right now. It's been saved — tap Retry on the banner when you're back online.`,
        );
      }
    } finally {
      setBusyId(null);
    }
  };

  const previewMethod = methods.find((m) => m.id === "preview");
  const deliveryMethods = methods.filter((m) => m.id !== "preview");
  const pendingDeliveries = record.pendingDeliveries ?? [];

  return (
    <Card style={{ gap: 10 }}>
      <SectionTitle icon="paper-plane-outline" title="Deliver report" />
      {!photosReady ? (
        <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 12 }}>
          Loading report data…
        </Text>
      ) : !analysisComplete ? (
        <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 12 }}>
          The PDF includes all photos now; AI findings are added automatically once syncing
          and analysis finish.
        </Text>
      ) : null}

      {/* Queued-delivery indicator — shown when one or more sends failed and
          were persisted for retry. Each pending entry gets a Retry button that
          re-invokes the full deliver flow and clears the entry on success.
          The header copy distinguishes auto-retry channels (server-push, future
          SMS / CRM) from interactive channels (email, share, print) which
          require the technician to tap Retry manually. */}
      {pendingDeliveries.length > 0 ? (() => {
        const hasAutoRetry = pendingDeliveries.some(
          (d) => methods.find((m) => m.id === d.methodId)?.supportsAutoRetry,
        );
        const headerText = hasAutoRetry
          ? "Delivery pending — will send when back online"
          : "Delivery queued — tap Retry to resend";
        return (
        <View
          style={{
            backgroundColor: colors.warning + "22",
            borderWidth: 1,
            borderColor: colors.warning + "66",
            borderRadius: 10,
            padding: 12,
            gap: 10,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Ionicons name="time-outline" size={17} color={colors.warning} />
            <Text style={{ color: colors.warning, fontFamily: "Inter_600SemiBold", fontSize: 13, flex: 1 }}>
              {headerText}
            </Text>
          </View>
          {pendingDeliveries.map((entry) => {
            const retryMethod = methods.find((m) => m.id === entry.methodId);
            const retryBusy = busyId === entry.methodId;
            return (
              <View
                key={entry.methodId}
                style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
              >
                <Ionicons
                  name={(retryMethod?.icon ?? "alert-circle-outline") as keyof typeof Ionicons.glyphMap}
                  size={14}
                  color={colors.mutedForeground}
                />
                <Text style={{ color: colors.foreground, fontFamily: "Inter_400Regular", fontSize: 13, flex: 1 }}>
                  {entry.label}
                </Text>
                {retryMethod ? (
                  <Pressable
                    disabled={busyId != null || !photosReady}
                    onPress={() => void deliver(retryMethod, true)}
                    style={{
                      paddingHorizontal: 12,
                      paddingVertical: 6,
                      borderRadius: 999,
                      backgroundColor: colors.primary,
                      opacity: busyId != null && !retryBusy ? 0.5 : 1,
                    }}
                  >
                    {retryBusy ? (
                      <ActivityIndicator size="small" color={colors.primaryForeground} />
                    ) : (
                      <Text style={{ color: colors.primaryForeground, fontFamily: "Inter_600SemiBold", fontSize: 12 }}>
                        Retry
                      </Text>
                    )}
                  </Pressable>
                ) : null}
                {/* Dismiss button — removes this entry after a confirmation prompt. */}
                <Pressable
                  disabled={busyId != null}
                  onPress={() => {
                    Alert.alert(
                      `Remove queued ${entry.label}?`,
                      "The report will not be sent. You can still deliver it manually using the buttons below.",
                      [
                        { text: "Cancel", style: "cancel" },
                        {
                          text: "Remove",
                          style: "destructive",
                          onPress: () => {
                            void updateLocalInspection(record.localId, (r) => {
                              r.pendingDeliveries = r.pendingDeliveries.filter(
                                (d) => d.methodId !== entry.methodId,
                              );
                            });
                          },
                        },
                      ],
                    );
                  }}
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: 14,
                    backgroundColor: colors.muted,
                    alignItems: "center",
                    justifyContent: "center",
                    opacity: busyId != null ? 0.4 : 1,
                  }}
                >
                  <Ionicons name="close" size={15} color={colors.mutedForeground} />
                </Pressable>
              </View>
            );
          })}
        </View>
        );
      })() : null}

      {/* Preview button — full-width, primary style, shown above delivery buttons */}
      {previewMethod ? (() => {
        const busy = busyId === previewMethod.id;
        const disabled = busyId != null || !photosReady;
        return (
          <Pressable
            disabled={disabled}
            onPress={() => void deliver(previewMethod)}
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "center",
              gap: 8,
              paddingHorizontal: 14,
              paddingVertical: 12,
              borderRadius: 10,
              backgroundColor: disabled && !busy ? colors.muted : colors.primary,
              opacity: disabled && !busy ? 0.6 : 1,
            }}
          >
            {busy ? (
              <ActivityIndicator size="small" color={colors.primaryForeground} />
            ) : (
              <Ionicons name={previewMethod.icon} size={18} color={colors.primaryForeground} />
            )}
            <Text style={{ color: colors.primaryForeground, fontFamily: "Inter_600SemiBold", fontSize: 14 }}>
              {busy ? "Generating preview…" : previewMethod.label}
            </Text>
          </Pressable>
        );
      })() : null}

      {/* Outbound delivery buttons — print / share / email */}
      {deliveryMethods.length > 0 ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {deliveryMethods.map((m) => {
            const busy = busyId === m.id;
            const disabled = busyId != null || !photosReady;
            return (
              <Pressable
                key={m.id}
                disabled={disabled}
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
                  opacity: disabled && !busy ? 0.5 : 1,
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
      ) : null}

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
  // Delegate the null-phase decision to the shared logic function so unit
  // tests can exercise the "Sync status unavailable" branch without rendering.
  const syncVariant = resolveSyncStatusVariant(phase);
  if (syncVariant.kind === "unavailable") {
    return (
      <Card style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <Ionicons name="cloud-offline-outline" size={22} color={colors.mutedForeground} />
        <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 13, flex: 1 }}>
          {syncVariant.label}
        </Text>
      </Card>
    );
  }

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
  // syncVariant is narrowed to { kind: "phase"; phase: LocalSyncPhase } here
  // because the "unavailable" branch returned above.  Use syncVariant.phase so
  // TypeScript sees a non-null LocalSyncPhase for the Record<> indexing below.
  const c = config[syncVariant.phase];

  return (
    <Card style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
      {syncVariant.phase === "syncing" ? (
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
      {syncVariant.phase === "failed" || syncVariant.phase === "waiting" ? (
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
  onDescriptionChange,
  onClose,
}: {
  visible: boolean;
  photos: string[];
  meta?: { source?: string; quality?: number | null; uri?: string; description?: string }[];
  initialIndex: number;
  findingsByPhoto: Map<number, Finding[]>;
  onDescriptionChange?: (photoUri: string, text: string) => void;
  onClose: () => void;
}) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [index, setIndex] = useState(initialIndex);
  // Local draft for the description TextInput — reset when the viewed photo changes.
  const [descDraft, setDescDraft] = useState("");

  // Reset paging position each time the viewer opens on a new photo.
  const [openKey, setOpenKey] = useState(0);
  React.useEffect(() => {
    if (visible) {
      setIndex(initialIndex);
      setOpenKey((k) => k + 1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, initialIndex]);

  // Sync description draft whenever we land on a new photo.
  React.useEffect(() => {
    setDescDraft(meta?.[index]?.description ?? "");
  }, [index, meta]);

  const [saving,  setSaving]  = useState(false);
  const [copying, setCopying] = useState(false);

  const currentUri = photos[index];

  const handleSaveImage = async () => {
    setSaving(true);
    try {
      const { status } = await MediaLibrary.requestPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("Permission required", "Please grant permission to save photos to your gallery.");
        return;
      }
      await MediaLibrary.saveToLibraryAsync(currentUri);
      Alert.alert("Saved", "Photo saved to your gallery.");
    } catch {
      Alert.alert("Error", "Failed to save photo.");
    } finally {
      setSaving(false);
    }
  };

  const handleCopyImage = async () => {
    setCopying(true);
    try {
      await Clipboard.setImageAsync(currentUri);
      Alert.alert("Copied", "Photo copied to clipboard.");
    } catch {
      Alert.alert("Error", "Failed to copy photo.");
    } finally {
      setCopying(false);
    }
  };

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

        {/* ── Save / Copy button row ───────────────────────────────────────── */}
        <View style={{ flexDirection: "row", gap: 12, paddingHorizontal: 16, paddingVertical: 12, backgroundColor: "rgba(0,0,0,0.85)" }}>
          <TouchableOpacity
            onPress={handleSaveImage}
            disabled={saving}
            activeOpacity={0.7}
            style={{
              flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
              backgroundColor: "rgba(255,255,255,0.15)", borderRadius: 10, paddingVertical: 12,
              opacity: saving ? 0.5 : 1,
            }}
          >
            {saving
              ? <ActivityIndicator size="small" color="#fff" />
              : <Ionicons name="download-outline" size={16} color="#fff" />}
            <Text style={{ color: "#fff", fontFamily: "Inter_600SemiBold", fontSize: 14 }}>
              {saving ? "Saving…" : "Save to Phone"}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={handleCopyImage}
            disabled={copying}
            activeOpacity={0.7}
            style={{
              flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
              backgroundColor: "rgba(255,255,255,0.15)", borderRadius: 10, paddingVertical: 12,
              opacity: copying ? 0.5 : 1,
            }}
          >
            {copying
              ? <ActivityIndicator size="small" color="#fff" />
              : <Ionicons name="copy-outline" size={16} color="#fff" />}
            <Text style={{ color: "#fff", fontFamily: "Inter_600SemiBold", fontSize: 14 }}>
              {copying ? "Copying…" : "Copy Image"}
            </Text>
          </TouchableOpacity>
        </View>

        <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"}>
          <ScrollView
            style={{ maxHeight: 280, backgroundColor: "rgba(0,0,0,0.88)" }}
            contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: Math.max(insets.bottom, 16) }}
            keyboardShouldPersistTaps="handled"
          >
            {/* Technician description editor */}
            <View style={{ gap: 6 }}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <Ionicons name="create-outline" size={13} color="rgba(255,255,255,0.6)" />
                <Text style={{ color: "rgba(255,255,255,0.6)", fontFamily: "Inter_500Medium", fontSize: 12 }}>
                  Technician notes
                </Text>
              </View>
              <TextInput
                value={descDraft}
                onChangeText={setDescDraft}
                onBlur={() => {
                  if (current?.uri) {
                    onDescriptionChange?.(current.uri, descDraft);
                  }
                }}
                placeholder="Describe what this photo shows — location, concern, context…"
                placeholderTextColor="rgba(255,255,255,0.3)"
                multiline
                style={{
                  color: "#fff",
                  fontFamily: "Inter_400Regular",
                  fontSize: 13,
                  lineHeight: 20,
                  backgroundColor: "rgba(255,255,255,0.1)",
                  borderRadius: 8,
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                  minHeight: 60,
                  borderWidth: 1,
                  borderColor: descDraft ? "rgba(20,184,166,0.6)" : "rgba(255,255,255,0.12)",
                }}
                returnKeyType="done"
                blurOnSubmit
                onSubmitEditing={() => {
                  Keyboard.dismiss();
                  if (current?.uri) {
                    onDescriptionChange?.(current.uri, descDraft);
                  }
                }}
              />
            </View>

            {/* AI findings */}
            {findings.length > 0 ? (
              <View style={{ gap: 8 }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                  <Ionicons name="sparkles-outline" size={13} color="rgba(255,255,255,0.6)" />
                  <Text style={{ color: "rgba(255,255,255,0.6)", fontFamily: "Inter_500Medium", fontSize: 12 }}>
                    AI findings on this photo
                  </Text>
                </View>
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
              </View>
            ) : (
              <Text
                style={{
                  color: "rgba(255,255,255,0.4)",
                  fontFamily: "Inter_400Regular",
                  fontSize: 12,
                  textAlign: "center",
                }}
              >
                No AI findings on this photo yet.
              </Text>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );
}

// ─── Small pieces ────────────────────────────────────────────────────────────

/**
 * Lightweight "not generated" placeholder for report sections that couldn't
 * be produced. Distinguishes between three causes so technicians know whether
 * to recapture, wait, or report a bug:
 *   - no photos captured          → icon "camera-outline"
 *   - AI skipped / no data        → icon "sparkles-outline" (default)
 *   - generation / retrieval error → icon "alert-circle-outline", tone "error"
 */
function SectionNotGenerated({
  reason,
  icon = "sparkles-outline",
  tone = "muted",
}: {
  reason: string;
  icon?: keyof typeof Ionicons.glyphMap;
  /** "muted" = neutral grey; "error" = destructive red */
  tone?: "muted" | "error";
}) {
  const colors = useColors();
  const iconColor = tone === "error" ? colors.destructive : colors.mutedForeground;
  return (
    <View style={{ flexDirection: "row", alignItems: "flex-start", gap: 8, paddingVertical: 2 }}>
      <Ionicons name={icon} size={15} color={iconColor} style={{ marginTop: 1 }} />
      <Text
        style={{
          color: tone === "error" ? colors.destructive : colors.mutedForeground,
          fontFamily: "Inter_400Regular",
          fontSize: 13,
          lineHeight: 19,
          flex: 1,
        }}
      >
        {reason}
      </Text>
    </View>
  );
}

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
