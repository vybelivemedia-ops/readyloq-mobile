import { useAuth, useUser } from "@clerk/expo";
import { Ionicons } from "@expo/vector-icons";
import {
  getListAnalysisResultsQueryOptions,
  useAddInspectionMedia,
  useAnalyzeInspection,
  useCreateInspection,
  useGenerateReport,
  useGenerateReportNarrative,
  useUpdateInspection,
  type Report,
} from "@/lib/api-client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CameraView, useCameraPermissions } from "expo-camera";
import { type Href, useRouter } from "expo-router";
import { Image } from "expo-image";
import React, { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";

import { AiInsightsPanel } from "@/components/AiInsightsPanel";
import { Button } from "@/components/ui/Button";
import { Screen } from "@/components/ui/Screen";
import { TextField } from "@/components/ui/TextField";
import { useColors } from "@/hooks/useColors";
import { useWindowSizeClass } from "@/hooks/useWindowSizeClass";
import { PEST_TYPES, PROPERTY_TYPES } from "@/constants/inspection";
import { ApiError } from "@/lib/api";
import { uploadPhoto } from "@/lib/upload";

type Step = "setup" | "capture" | "review";
type Photo = { uri: string };

const ZOOM_LEVELS = [
  { label: "1×", value: 0 },
  { label: "2×", value: 0.25 },
  { label: "4×", value: 0.5 },
] as const;

export default function NewInspectionScreen() {
  const colors = useColors();
  const { isLandscape, isExpanded } = useWindowSizeClass();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { getToken } = useAuth();
  const { user: clerkUser } = useUser();

  const createInspection = useCreateInspection();
  const addMedia = useAddInspectionMedia();
  const analyze = useAnalyzeInspection();
  const updateInspection = useUpdateInspection();
  const generateReport = useGenerateReport();
  const generateNarrative = useGenerateReportNarrative();

  const [step, setStep] = useState<Step>("setup");
  const [siteAddress, setSiteAddress] = useState("");
  const [clientName, setClientName] = useState("");
  const [technicianName, setTechnicianName] = useState(clerkUser?.fullName ?? "");
  const [propertyType, setPropertyType] = useState<string>(PROPERTY_TYPES[0]);
  const [pestTypes, setPestTypes] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  const [photos, setPhotos] = useState<Photo[]>([]);

  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState<string | null>(null);

  const [permission, requestPermission] = useCameraPermissions();
  const cameraRef = useRef<CameraView>(null);
  const [capturing, setCapturing] = useState(false);
  const [zoom, setZoom] = useState(0);
  const [flash, setFlash] = useState<"off" | "on" | "auto">("off");

  // Expanded-workspace analysis state. Reuses the exact same APIs as submit —
  // photos are uploaded once and never re-uploaded or re-analyzed at submit.
  const [wsInspectionId, setWsInspectionId] = useState<number | null>(null);
  const [wsAnalyzing, setWsAnalyzing] = useState(false);
  const [wsError, setWsError] = useState<string | null>(null);
  const [uploadedCount, setUploadedCount] = useState(0);
  const analyzedCount = useRef(0);

  // Resume state so a retry after a mid-flight failure does not create a
  // duplicate inspection or re-upload photos that already succeeded.
  const createdInspectionId = useRef<number | null>(null);
  const uploadedUrls = useRef<string[]>([]);

  // Live report builder state. The report is created once per inspection and
  // its AI narrative regenerated (with a fresh findings snapshot) after every
  // analysis run, so the draft always reflects the latest real detections.
  const [wsReport, setWsReport] = useState<Report | null>(null);
  const [wsReportBuilding, setWsReportBuilding] = useState(false);
  const [wsReportError, setWsReportError] = useState<string | null>(null);
  const wsReportId = useRef<number | null>(null);
  const wsReportRunning = useRef(false);
  const wsReportStale = useRef(false);

  const wsAnalysisQ = useQuery({
    ...getListAnalysisResultsQueryOptions({ inspectionId: wsInspectionId ?? 0 }),
    enabled: wsInspectionId != null,
  });
  const wsAnalysis = wsInspectionId != null ? wsAnalysisQ.data?.[0] : undefined;

  const canContinueSetup = siteAddress.trim().length > 0 && technicianName.trim().length > 0;

  const togglePest = (p: string) =>
    setPestTypes((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));

  const takePhoto = async () => {
    if (!cameraRef.current || capturing) return;
    try {
      setCapturing(true);
      const pic = await cameraRef.current.takePictureAsync({ quality: 0.6 });
      if (pic?.uri) {
        setPhotos((prev) => [...prev, { uri: pic.uri }]);
        // A fresh capture re-arms auto-run analysis after a prior failure.
        setWsError(null);
      }
    } catch {
      setError("Couldn't capture photo. Please try again.");
    } finally {
      setCapturing(false);
    }
  };

  // Runs analysis from the expanded workspace while the camera stays live.
  // Creates the inspection once and uploads only new photos; submit() later
  // skips whatever this already did (same resume refs).
  const runWorkspaceAnalysis = async () => {
    if (wsAnalyzing || photos.length === 0) return;
    setWsError(null);
    setWsAnalyzing(true);
    try {
      const token = await getToken();
      const composedNotes = [`Property type: ${propertyType}`, notes.trim()]
        .filter(Boolean)
        .join("\n\n");

      let id = createdInspectionId.current;
      if (id == null) {
        const inspection = await createInspection.mutateAsync({
          data: {
            siteAddress: siteAddress.trim(),
            clientName: clientName.trim() || undefined,
            technicianName: technicianName.trim(),
            notes: composedNotes || undefined,
            pestTypes: pestTypes.length ? pestTypes : undefined,
          },
        });
        id = inspection.id;
        createdInspectionId.current = id;
      }
      setWsInspectionId(id);

      for (let i = uploadedUrls.current.length; i < photos.length; i++) {
        const path = await uploadPhoto(
          token,
          photos[i].uri,
          `inspection-${id}-${Date.now()}-${i}.jpg`,
        );
        await addMedia.mutateAsync({ id, data: { mediaType: "photo", url: path } });
        uploadedUrls.current.push(path);
        setUploadedCount(uploadedUrls.current.length);
      }

      await analyze.mutateAsync({
        data: {
          inspectionId: id,
          images: uploadedUrls.current.map((u) => ({ imageUrl: u })),
        },
      });
      analyzedCount.current = uploadedUrls.current.length;
      await queryClient.invalidateQueries();
      // New verified detections exist — rebuild the live report in the
      // background while the technician keeps capturing.
      void buildLiveReport(id);
    } catch (e) {
      setWsError(e instanceof ApiError ? e.message : (e as Error).message);
    } finally {
      setWsAnalyzing(false);
    }
  };

  // Auto-run: while the camera is open, analysis kicks off shortly after each
  // new photo so the AI Inspection Panel updates live — no button press
  // needed. The short delay batches rapid captures into one run; when a run
  // finishes and more photos arrived meanwhile, this re-fires for the rest.
  // After a failure (wsError set) auto-run pauses — a new capture or the
  // manual "Run analysis" button clears the error and re-arms it, so a
  // persistent failure never becomes an infinite retry loop.
  useEffect(() => {
    if (step !== "capture" || submitting || wsAnalyzing || wsError) return;
    if (photos.length === 0 || photos.length <= analyzedCount.current) return;
    const timer = setTimeout(() => {
      void runWorkspaceAnalysis();
    }, 2500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, submitting, wsAnalyzing, wsError, photos.length]);

  // Builds (or rebuilds) the live service report from the latest verified
  // data. Creates the report once, then regenerates its AI narrative with a
  // refreshed findings snapshot. If an analysis finishes while a build is in
  // flight, the stale flag queues exactly one more rebuild so the draft never
  // lags behind the newest detections.
  const buildLiveReport = async (inspectionId: number) => {
    if (wsReportRunning.current) {
      wsReportStale.current = true;
      return;
    }
    wsReportRunning.current = true;
    setWsReportBuilding(true);
    setWsReportError(null);
    try {
      do {
        wsReportStale.current = false;
        let reportId = wsReportId.current;
        if (reportId == null) {
          const created = await generateReport.mutateAsync({
            data: {
              inspectionId,
              title: `Service report — ${siteAddress.trim()}`,
              includeAiFindings: true,
            },
          });
          reportId = created.id;
          wsReportId.current = reportId;
          setWsReport(created);
        }
        const updated = await generateNarrative.mutateAsync({
          id: reportId,
          data: { refreshFindings: true },
        });
        setWsReport(updated);
      } while (wsReportStale.current);
      await queryClient.invalidateQueries();
    } catch (e) {
      setWsReportError(
        e instanceof ApiError ? e.message : (e as Error).message,
      );
    } finally {
      wsReportRunning.current = false;
      setWsReportBuilding(false);
    }
  };

  const submit = async () => {
    // Never run concurrently with a workspace analysis — both loops share the
    // same resume refs and would double-upload photos.
    if (wsAnalyzing || wsReportRunning.current) return;
    setError(null);
    setSubmitting(true);
    try {
      const token = await getToken();
      const composedNotes = [`Property type: ${propertyType}`, notes.trim()]
        .filter(Boolean)
        .join("\n\n");

      // Reuse an inspection created on a prior (failed) attempt or by the
      // expanded workspace instead of creating a duplicate.
      let id = createdInspectionId.current;
      if (id == null) {
        setProgress("Creating inspection…");
        const inspection = await createInspection.mutateAsync({
          data: {
            siteAddress: siteAddress.trim(),
            clientName: clientName.trim() || undefined,
            technicianName: technicianName.trim(),
            notes: composedNotes || undefined,
            pestTypes: pestTypes.length ? pestTypes : undefined,
          },
        });
        id = inspection.id;
        createdInspectionId.current = id;
      } else {
        // The inspection already exists — sync fields the API supports
        // updating in case they were edited after it was created.
        setProgress("Updating inspection…");
        await updateInspection.mutateAsync({
          id,
          data: {
            notes: composedNotes || undefined,
            pestTypes: pestTypes.length ? pestTypes : undefined,
          },
        });
      }

      // Resume uploads from where a prior attempt left off.
      for (let i = uploadedUrls.current.length; i < photos.length; i++) {
        setProgress(`Uploading photo ${i + 1} of ${photos.length}…`);
        const path = await uploadPhoto(
          token,
          photos[i].uri,
          `inspection-${id}-${Date.now()}-${i}.jpg`,
        );
        await addMedia.mutateAsync({ id, data: { mediaType: "photo", url: path } });
        uploadedUrls.current.push(path);
        setUploadedCount(uploadedUrls.current.length);
      }

      let analysisWarning: string | null = null;
      let ranNewAnalysis = false;
      // Skip re-analysis when the workspace already analyzed this exact photo set.
      if (uploadedUrls.current.length && analyzedCount.current !== uploadedUrls.current.length) {
        setProgress("Running AI analysis…");
        const result = await analyze.mutateAsync({
          data: {
            inspectionId: id,
            images: uploadedUrls.current.map((u) => ({ imageUrl: u })),
          },
        });
        ranNewAnalysis = true;
        if (result?.analysisErrors && result.analysisErrors > 0) {
          const n = result.analysisErrors;
          analysisWarning = `${n} photo${n > 1 ? "s" : ""} couldn't be analyzed.`;
        }
      }

      // If the live report was built earlier but new photos were analyzed at
      // submit, refresh its narrative so the report matches the final data.
      if (wsReportId.current != null && ranNewAnalysis) {
        setProgress("Updating service report…");
        try {
          await generateNarrative.mutateAsync({
            id: wsReportId.current,
            data: { refreshFindings: true },
          });
        } catch {
          analysisWarning = [
            analysisWarning,
            "The live report couldn't be refreshed — regenerate it from the report screen.",
          ]
            .filter(Boolean)
            .join(" ");
        }
      }

      await queryClient.invalidateQueries();

      // Success — clear resume state so the next inspection starts fresh.
      const targetId = id;
      createdInspectionId.current = null;
      uploadedUrls.current = [];
      analyzedCount.current = 0;
      setUploadedCount(0);
      setWsInspectionId(null);
      wsReportId.current = null;
      setWsReport(null);
      setWsReportError(null);

      if (analysisWarning) {
        setSubmitting(false);
        Alert.alert(
          "Analysis partially complete",
          `${analysisWarning} You can re-run AI analysis from the inspection.`,
          [{ text: "View inspection", onPress: () => router.replace(`/inspection/${targetId}` as Href) }],
        );
      } else {
        router.replace(`/inspection/${targetId}` as Href);
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message);
      setSubmitting(false);
    }
  };

  // ─── Submitting overlay ─────────────────────────────────────────────────────
  if (submitting) {
    return (
      <Screen edges={["top", "bottom"]}>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 16, padding: 24 }}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold", fontSize: 17 }}>
            {progress || "Working…"}
          </Text>
          <Text
            style={{
              color: colors.mutedForeground,
              fontFamily: "Inter_400Regular",
              fontSize: 14,
              textAlign: "center",
            }}
          >
            Keep the app open while we upload evidence and run AI analysis.
          </Text>
        </View>
      </Screen>
    );
  }

  // ─── Capture step (full camera) ─────────────────────────────────────────────
  if (step === "capture") {
    if (!permission) {
      return <Screen edges={["top", "bottom"]} />;
    }
    if (!permission.granted) {
      return (
        <Screen edges={["top", "bottom"]} padded>
          <Header title="Camera access" onClose={() => setStep("setup")} colors={colors} />
          <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 16 }}>
            <Ionicons name="camera-outline" size={48} color={colors.mutedForeground} />
            <Text
              style={{
                color: colors.foreground,
                fontFamily: "Inter_600SemiBold",
                fontSize: 17,
                textAlign: "center",
              }}
            >
              Allow camera access
            </Text>
            <Text
              style={{
                color: colors.mutedForeground,
                fontFamily: "Inter_400Regular",
                textAlign: "center",
              }}
            >
              ReadyLoq needs your camera to capture inspection evidence for AI analysis.
            </Text>
            <Button title="Grant camera access" onPress={requestPermission} />
          </View>
        </Screen>
      );
    }

    const isPhoneLandscape = isLandscape && !isExpanded;

    const thumbs =
      photos.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={isPhoneLandscape ? { position: "absolute", bottom: 16, left: 0, right: 116 } : undefined}
          contentContainerStyle={{ gap: 8, paddingHorizontal: 16 }}
        >
          {photos.map((p, i) => (
            <View key={`${p.uri}-${i}`}>
              <Image source={{ uri: p.uri }} style={{ width: 56, height: 56, borderRadius: 8 }} />
              {i >= uploadedCount ? (
                <Pressable
                  onPress={() => setPhotos((prev) => prev.filter((_, idx) => idx !== i))}
                  style={{
                    position: "absolute",
                    top: -6,
                    right: -6,
                    backgroundColor: colors.destructive,
                    borderRadius: 10,
                    width: 20,
                    height: 20,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Ionicons name="close" size={13} color="#fff" />
                </Pressable>
              ) : null}
            </View>
          ))}
        </ScrollView>
      ) : null;

    const captureButton = (
      <Pressable
        onPress={takePhoto}
        disabled={capturing}
        style={{
          width: 76,
          height: 76,
          borderRadius: 38,
          backgroundColor: "rgba(255,255,255,0.25)",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <View style={{ width: 62, height: 62, borderRadius: 31, backgroundColor: "#fff" }} />
      </Pressable>
    );

    const doneButton = (
      <Pressable
        onPress={() => setStep("review")}
        disabled={photos.length === 0}
        style={{ width: 64, alignItems: "center", opacity: photos.length === 0 ? 0.4 : 1 }}
      >
        <Text style={{ color: colors.primary, fontFamily: "Inter_600SemiBold", fontSize: 16 }}>
          Done
        </Text>
      </Pressable>
    );

    const flashButton = (
      <Pressable
        onPress={() => setFlash((f) => (f === "off" ? "auto" : f === "auto" ? "on" : "off"))}
        style={{
          width: 44,
          height: 44,
          borderRadius: 22,
          backgroundColor: "rgba(0,0,0,0.5)",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Ionicons
          name={flash === "off" ? "flash-off" : flash === "auto" ? "flash-outline" : "flash"}
          size={20}
          color="#fff"
        />
      </Pressable>
    );

    const zoomChips = (
      <View style={{ flexDirection: "row", gap: 8 }}>
        {ZOOM_LEVELS.map((z) => (
          <Pressable
            key={z.label}
            onPress={() => setZoom(z.value)}
            style={{
              paddingHorizontal: 12,
              paddingVertical: 6,
              borderRadius: 999,
              backgroundColor: zoom === z.value ? "rgba(255,255,255,0.9)" : "rgba(0,0,0,0.5)",
            }}
          >
            <Text
              style={{
                color: zoom === z.value ? "#000" : "#fff",
                fontFamily: "Inter_600SemiBold",
                fontSize: 13,
              }}
            >
              {z.label}
            </Text>
          </Pressable>
        ))}
      </View>
    );

    // ─── Expanded: AI Inspection Workspace (camera + live insights) ──────────
    if (isExpanded) {
      return (
        <Screen edges={["top", "bottom"]}>
          <View style={{ flex: 1, flexDirection: "row" }}>
            {/* Left: live camera pane — stays mounted while AI results update */}
            <View style={{ flex: 1.2, backgroundColor: "#000" }}>
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: 16,
                }}
              >
                <Pressable
                  onPress={() => setStep("setup")}
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: 20,
                    backgroundColor: "rgba(255,255,255,0.12)",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Ionicons name="chevron-back" size={24} color="#fff" />
                </Pressable>
                <View
                  style={{
                    backgroundColor: "rgba(255,255,255,0.12)",
                    paddingHorizontal: 12,
                    paddingVertical: 6,
                    borderRadius: 999,
                  }}
                >
                  <Text style={{ color: "#fff", fontFamily: "Inter_600SemiBold" }}>
                    {photos.length} captured
                  </Text>
                </View>
              </View>

              {/* Aspect-fitted preview: letterboxed, never stretched or cropped */}
              <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 12 }}>
                <CameraView
                  ref={cameraRef}
                  style={{ width: "100%", maxHeight: "100%", aspectRatio: isLandscape ? 4 / 3 : 3 / 4 }}
                  facing="back"
                  ratio="4:3"
                  zoom={zoom}
                  flash={flash}
                />
              </View>

              <View style={{ padding: 16, gap: 14, alignItems: "center" }}>
                {zoomChips}
                <View style={{ flexDirection: "row", alignItems: "center", gap: 28 }}>
                  {flashButton}
                  {captureButton}
                  {doneButton}
                </View>
                {thumbs}
              </View>
            </View>

            {/* Right: live AI insights panel */}
            <View style={{ flex: 1, maxWidth: 480, borderLeftWidth: 1, borderLeftColor: colors.border }}>
              <AiInsightsPanel
                siteAddress={siteAddress}
                propertyType={propertyType}
                pestTypes={pestTypes}
                photosCount={photos.length}
                pendingCount={Math.max(0, photos.length - analyzedCount.current)}
                analysis={wsAnalysis}
                analyzing={wsAnalyzing}
                error={wsError}
                report={wsReport}
                reportBuilding={wsReportBuilding}
                reportError={wsReportError}
                onRunAnalysis={runWorkspaceAnalysis}
                onReview={() => setStep("review")}
              />
            </View>
          </View>
        </Screen>
      );
    }

    return (
      <View style={{ flex: 1, backgroundColor: "#000" }}>
        <CameraView ref={cameraRef} style={{ flex: 1 }} facing="back" zoom={zoom} flash={flash} />
        <View style={{ position: "absolute", top: 0, left: 0, right: isLandscape ? 116 : 0 }}>
          <Screen edges={["top"]} style={{ backgroundColor: "transparent" }}>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                padding: 16,
              }}
            >
              <Pressable
                onPress={() => setStep("setup")}
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 20,
                  backgroundColor: "rgba(0,0,0,0.5)",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <Ionicons name="chevron-back" size={24} color="#fff" />
              </Pressable>
              <View
                style={{
                  backgroundColor: "rgba(0,0,0,0.5)",
                  paddingHorizontal: 12,
                  paddingVertical: 6,
                  borderRadius: 999,
                }}
              >
                <Text style={{ color: "#fff", fontFamily: "Inter_600SemiBold" }}>
                  {photos.length} captured
                </Text>
              </View>
            </View>
          </Screen>
        </View>

        {isLandscape ? (
          <>
            {/* Right-edge control rail: capture stays under the thumb in landscape */}
            <View
              style={{
                position: "absolute",
                right: 0,
                top: 0,
                bottom: 0,
                width: 116,
                backgroundColor: "rgba(0,0,0,0.4)",
                alignItems: "center",
                justifyContent: "center",
                gap: 28,
              }}
            >
              {flashButton}
              {captureButton}
              {doneButton}
            </View>
            <View
              style={{
                position: "absolute",
                bottom: photos.length > 0 ? 88 : 24,
                left: 0,
                right: 132,
                alignItems: "center",
              }}
            >
              {zoomChips}
            </View>
            {thumbs}
          </>
        ) : (
          <View
            style={{
              position: "absolute",
              bottom: 0,
              left: 0,
              right: 0,
              paddingBottom: 36,
              paddingTop: 16,
              backgroundColor: "rgba(0,0,0,0.4)",
              gap: 16,
            }}
          >
            {thumbs}
            <View style={{ alignItems: "center" }}>{zoomChips}</View>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                paddingHorizontal: 28,
              }}
            >
              <View style={{ width: 64, alignItems: "center" }}>{flashButton}</View>
              {captureButton}
              {doneButton}
            </View>
          </View>
        )}
      </View>
    );
  }

  // ─── Review step ────────────────────────────────────────────────────────────
  if (step === "review") {
    return (
      <Screen edges={["top", "bottom"]} padded>
        <Header title="Review & submit" onClose={() => setStep("capture")} colors={colors} />
        <ScrollView
          contentContainerStyle={{
            gap: 18,
            paddingVertical: 12,
            paddingBottom: 32,
            width: "100%",
            maxWidth: 640,
            alignSelf: "center",
          }}
        >
          <SummaryRow label="Site address" value={siteAddress} colors={colors} />
          {clientName ? <SummaryRow label="Client" value={clientName} colors={colors} /> : null}
          <SummaryRow label="Technician" value={technicianName} colors={colors} />
          <SummaryRow label="Property type" value={propertyType} colors={colors} />
          {pestTypes.length ? (
            <SummaryRow label="Pest types" value={pestTypes.join(", ")} colors={colors} />
          ) : null}
          {notes ? <SummaryRow label="Notes" value={notes} colors={colors} /> : null}

          <View style={{ gap: 8 }}>
            <Text style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold", fontSize: 15 }}>
              Evidence ({photos.length})
            </Text>
            <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
              {photos.map((p, i) => (
                <Image
                  key={`${p.uri}-${i}`}
                  source={{ uri: p.uri }}
                  style={{ width: 88, height: 88, borderRadius: 10 }}
                />
              ))}
            </View>
          </View>

          {error ? (
            <Text style={{ color: colors.destructive, fontSize: 14, textAlign: "center" }}>{error}</Text>
          ) : null}
        </ScrollView>

        <View style={{ gap: 10, paddingBottom: 8, width: "100%", maxWidth: 640, alignSelf: "center" }}>
          <Button
            title={photos.length ? "Submit & run AI analysis" : "Submit inspection"}
            size="lg"
            icon="sparkles"
            onPress={submit}
          />
          <Button title="Add more photos" variant="ghost" onPress={() => setStep("capture")} />
        </View>
      </Screen>
    );
  }

  // ─── Setup step ─────────────────────────────────────────────────────────────
  return (
    <Screen edges={["top", "bottom"]} padded>
      <Header title="New inspection" onClose={() => router.back()} colors={colors} />
      <ScrollView
        contentContainerStyle={{
          gap: 16,
          paddingVertical: 12,
          paddingBottom: 32,
          width: "100%",
          maxWidth: 640,
          alignSelf: "center",
        }}
        keyboardShouldPersistTaps="handled"
      >
        {wsInspectionId != null ? (
          <Text
            style={{
              color: colors.mutedForeground,
              fontFamily: "Inter_400Regular",
              fontSize: 13,
              lineHeight: 19,
            }}
          >
            AI analysis has started for this inspection, so site, client, and technician are
            locked. Notes and suspected pests can still be updated.
          </Text>
        ) : null}
        <TextField
          label="Site address *"
          placeholder="123 Main St, Suite 200"
          value={siteAddress}
          onChangeText={setSiteAddress}
          editable={wsInspectionId == null}
          style={wsInspectionId != null ? { opacity: 0.5 } : undefined}
        />
        <TextField
          label="Client name"
          placeholder="Acme Restaurant Group"
          value={clientName}
          onChangeText={setClientName}
          editable={wsInspectionId == null}
          style={wsInspectionId != null ? { opacity: 0.5 } : undefined}
        />
        <TextField
          label="Technician *"
          placeholder="Your name"
          value={technicianName}
          onChangeText={setTechnicianName}
          editable={wsInspectionId == null}
          style={wsInspectionId != null ? { opacity: 0.5 } : undefined}
        />

        <View style={{ gap: 8 }}>
          <Text style={{ color: colors.foreground, fontFamily: "Inter_500Medium", fontSize: 14 }}>
            Property type
          </Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {PROPERTY_TYPES.map((p) => (
              <Pill key={p} label={p} active={propertyType === p} onPress={() => setPropertyType(p)} colors={colors} />
            ))}
          </View>
        </View>

        <View style={{ gap: 8 }}>
          <Text style={{ color: colors.foreground, fontFamily: "Inter_500Medium", fontSize: 14 }}>
            Suspected pests
          </Text>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {PEST_TYPES.map((p) => (
              <Pill key={p} label={p} active={pestTypes.includes(p)} onPress={() => togglePest(p)} colors={colors} />
            ))}
          </View>
        </View>

        <TextField
          label="Notes"
          placeholder="Conditions observed, access notes, etc."
          value={notes}
          onChangeText={setNotes}
          multiline
        />
      </ScrollView>

      <View style={{ paddingBottom: 8, width: "100%", maxWidth: 640, alignSelf: "center" }}>
        <Button
          title="Continue to camera"
          size="lg"
          icon="camera"
          disabled={!canContinueSetup}
          onPress={() => setStep("capture")}
        />
      </View>
    </Screen>
  );
}

function Header({
  title,
  onClose,
  colors,
}: {
  title: string;
  onClose: () => void;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingVertical: 12,
      }}
    >
      <Text style={{ color: colors.foreground, fontFamily: "Inter_700Bold", fontSize: 20 }}>{title}</Text>
      <Pressable
        onPress={onClose}
        style={{
          width: 38,
          height: 38,
          borderRadius: 19,
          backgroundColor: colors.card,
          borderWidth: 1,
          borderColor: colors.border,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Ionicons name="close" size={20} color={colors.mutedForeground} />
      </Pressable>
    </View>
  );
}

function Pill({
  label,
  active,
  onPress,
  colors,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        paddingHorizontal: 14,
        paddingVertical: 9,
        borderRadius: 999,
        backgroundColor: active ? colors.primary : colors.card,
        borderWidth: 1,
        borderColor: active ? colors.primary : colors.border,
      }}
    >
      <Text
        style={{
          color: active ? colors.primaryForeground : colors.mutedForeground,
          fontFamily: "Inter_500Medium",
          fontSize: 13,
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function SummaryRow({
  label,
  value,
  colors,
}: {
  label: string;
  value: string;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={{ gap: 3 }}>
      <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_500Medium", fontSize: 13 }}>
        {label}
      </Text>
      <Text style={{ color: colors.foreground, fontFamily: "Inter_400Regular", fontSize: 15 }}>
        {value}
      </Text>
    </View>
  );
}
