import { useUser } from "@clerk/expo";
import { Ionicons } from "@expo/vector-icons";
import {
  deleteInspection,
  getListAnalysisResultsQueryOptions,
  useGenerateReport,
  useGenerateReportNarrative,
  type Report,
} from "@/lib/api-client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CameraView, useCameraPermissions } from "expo-camera";
import { type Href, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { Image } from "expo-image";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  BackHandler,
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
import {
  deleteLocalInspection,
  getLocalInspection,
  newLocalInspection,
  persistPhoto,
  saveLocalInspection,
  updateLocalInspection,
  type LocalInspection,
} from "@/lib/local/inspection-store";
import { requestSync, syncNow } from "@/lib/sync/engine";
import {
  assessEvidence,
  computeDHash,
  findNearDuplicate,
  getRequestProvider,
  loadGrayscaleImage,
  speechService,
  type EvidenceItem,
} from "@/lib/vision";

/** True when an error smells like a connectivity failure (not a server rejection). */
function isOfflineError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /network request failed|network error|failed to fetch|timeout|abort/i.test(msg);
}

const OFFLINE_NOTICE =
  "You're offline — everything is saved on this device and will sync automatically when you're back online.";

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
  const { user: clerkUser } = useUser();
  const params = useLocalSearchParams<{ resume?: string }>();

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
  const [importing, setImporting] = useState(false);
  // Advisory warning from the on-device quality gate — auto-clears; never
  // blocks capture (poor evidence of a real problem beats no evidence).
  const [qualityNotice, setQualityNotice] = useState<string | null>(null);
  // Vision Platform providers: every evidence source (live camera, imported
  // GoPro/glasses footage, future streams) funnels through the same
  // EvidenceItem contract into the same persist → sync → analyze pipeline.
  // Sourced from the capture-provider registry (lib/vision/provider-registry):
  // adding a new usable source registers there, not here.
  const cameraProvider = useMemo(() => getRequestProvider("native-camera", { cameraRef }), []);
  const importProvider = useMemo(() => getRequestProvider("media-import", {}), []);
  const [zoom, setZoom] = useState(0);
  const [flash, setFlash] = useState<"off" | "on" | "auto">("off");

  // ── Dictation state ────────────────────────────────────────────────────────
  // SpeechService is a singleton outside React, so recording survives foldable
  // screen-resize events that would otherwise unmount and remount this component.
  const [isDictating, setIsDictating] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const stopDictationRef = useRef<(() => void) | null>(null);

  // Clean up any live recording if the screen is dismissed mid-dictation.
  useEffect(() => {
    return () => {
      stopDictationRef.current?.();
      stopDictationRef.current = null;
    };
  }, []);

  const handleDictationPress = async () => {
    if (isDictating) {
      stopDictationRef.current?.();
      stopDictationRef.current = null;
      setIsDictating(false);
      // isTranscribing becomes true when onProgress('…') fires
      return;
    }
    try {
      const stop = await speechService.startDictation((transcript) => {
        if (transcript === "…") {
          setIsTranscribing(true);
          return;
        }
        setIsTranscribing(false);
        setNotes((prev) => {
          const trimmed = prev.trim();
          return trimmed.length > 0 ? `${trimmed} ${transcript}` : transcript;
        });
      });
      stopDictationRef.current = stop;
      setIsDictating(true);
    } catch (e) {
      Alert.alert(
        "Dictation unavailable",
        e instanceof Error ? e.message : "Could not start dictation.",
      );
    }
  };

  // Phone-size AI Inspection entry point. On expanded windows (tablets,
  // unfolded foldables) the AI panel renders side-by-side with the camera;
  // on compact/medium windows it opens as a full-screen overlay instead —
  // without this, phones have no way to reach the AI Inspection workflow.
  const [showInsights, setShowInsights] = useState(false);

  // Expanded-workspace analysis state. Reuses the exact same APIs as submit —
  // photos are uploaded once and never re-uploaded or re-analyzed at submit.
  const [wsInspectionId, setWsInspectionId] = useState<number | null>(null);
  const [wsAnalyzing, setWsAnalyzing] = useState(false);
  const [wsError, setWsError] = useState<string | null>(null);
  const [uploadedCount, setUploadedCount] = useState(0);
  const analyzedCount = useRef(0);

  // RLQ-008: tick incremented by useFocusEffect to re-read allFindingsReviewed on resume.
  const [reviewTick, setReviewTick] = useState(0);
  // RLQ-008: analysis query for the pending-findings review gate in the review step.
  const reviewAnalysisQ = useQuery({
    ...getListAnalysisResultsQueryOptions({ inspectionId: wsInspectionId ?? 0 }),
    enabled: wsInspectionId != null,
    staleTime: 10_000,
    refetchInterval: false,
  });

  // Local-first record: the single durable source of truth for this
  // inspection. Every capture and field edit is persisted to device storage
  // immediately, so a crash, fold, or dead zone never loses work. The sync
  // engine pushes it to the server whenever connectivity allows.
  const recordRef = useRef<LocalInspection | null>(null);
  const [hydrated, setHydrated] = useState(params.resume == null);

  // Resuming a draft after an app restart: rebuild all screen state from the
  // persisted record, including photos (durable file:// URIs) and how far the
  // server sync already got.
  useEffect(() => {
    const resumeId = params.resume;
    if (!resumeId || recordRef.current) return;
    void (async () => {
      const rec = await getLocalInspection(resumeId);
      if (rec) {
        recordRef.current = rec;
        setSiteAddress(rec.siteAddress);
        setClientName(rec.clientName);
        setTechnicianName(rec.technicianName || (clerkUser?.fullName ?? ""));
        setPropertyType(rec.propertyType || PROPERTY_TYPES[0]);
        setPestTypes(rec.pestTypes);
        setNotes(rec.notes);
        setPhotos(rec.photos.map((p) => ({ uri: p.localUri })));
        setUploadedCount(rec.photos.filter((p) => p.storagePath).length);
        analyzedCount.current = rec.analyzedCount;
        if (rec.serverId != null) setWsInspectionId(rec.serverId);
        setStep(rec.photos.length > 0 ? "capture" : "setup");
      }
      setHydrated(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.resume]);

  // Write-through persistence for field edits (debounced). The record itself
  // is created when the technician continues to the camera.
  useEffect(() => {
    if (!recordRef.current) return;
    const t = setTimeout(() => void persistDraft(), 600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteAddress, clientName, technicianName, propertyType, pestTypes, notes]);

  // RLQ-008: re-read allFindingsReviewed when the screen gains focus (e.g. after
  // returning from the findings-review screen).
  useFocusEffect(
    useCallback(() => {
      void (async () => {
        const rec = recordRef.current;
        if (!rec) return;
        const fresh = await getLocalInspection(rec.localId);
        if (fresh) recordRef.current = fresh;
        setReviewTick((t) => t + 1);
      })();
    }, []),
  );

  const persistDraft = async () => {
    const rec = recordRef.current;
    if (!rec) return;
    // Atomic merge — never clobbers fields the sync engine wrote mid-flight.
    const updated = await updateLocalInspection(rec.localId, (r) => {
      r.siteAddress = siteAddress;
      r.clientName = clientName;
      r.technicianName = technicianName;
      r.propertyType = propertyType;
      r.pestTypes = pestTypes;
      r.notes = notes;
    });
    if (updated) recordRef.current = updated;
  };

  // Entering the camera creates the durable local record (idempotent).
  const goToCapture = async () => {
    if (!recordRef.current) {
      recordRef.current = newLocalInspection({
        siteAddress,
        clientName,
        technicianName,
        propertyType,
        pestTypes,
        notes,
      });
      await saveLocalInspection(recordRef.current);
    }
    setStep("capture");
  };

  // Leaving mid-inspection: the draft is already persisted, so keeping it is
  // free — the resume prompt offers it again next time. Discarding removes
  // local files and best-effort deletes any partially synced server row.
  const confirmExit = () => {
    const rec = recordRef.current;
    if (!rec || (photos.length === 0 && rec.serverId == null)) {
      if (rec) void deleteLocalInspection(rec.localId);
      router.back();
      return;
    }
    Alert.alert(
      "Leave inspection?",
      "Your photos and details are saved on this device. You can resume this inspection later.",
      [
        { text: "Keep working", style: "cancel" },
        {
          text: "Discard",
          style: "destructive",
          onPress: () => {
            const serverId = rec.serverId;
            if (serverId != null) void deleteInspection(serverId).catch(() => {});
            void deleteLocalInspection(rec.localId);
            router.back();
          },
        },
        { text: "Save draft & exit", onPress: () => router.back() },
      ],
    );
  };

  // Android hardware back: never silently destroys an in-progress inspection.
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (step === "review") {
        setStep("capture");
        return true;
      }
      if (step === "capture") {
        if (photos.length > 0) {
          confirmExit();
        } else {
          setStep("setup");
        }
        return true;
      }
      if (recordRef.current) {
        confirmExit();
        return true;
      }
      return false;
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, photos.length]);

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

  // Shared ingest path for ALL vision providers: copy each file out of any
  // cache dir IMMEDIATELY (the OS can purge caches at any time — evidence must
  // survive an app restart), score it with the quality gate, and append it to
  // the local record with full provenance.
  const ingestEvidence = async (items: EvidenceItem[]) => {
    const rec = recordRef.current;
    if (!rec || items.length === 0) return;
    // Fast pass: persist each file and add it with the INSTANT metadata score
    // so the thumbnail appears immediately — the camera never waits on a decode.
    const warnings: string[] = [];
    const added: { localUri: string; item: EvidenceItem }[] = [];
    for (const item of items) {
      const durableUri = await persistPhoto(rec.localId, item.uri);
      const quality = assessEvidence(item);
      if (!quality.acceptable && quality.reasons.length > 0) warnings.push(quality.reasons[0]);
      const updated = await updateLocalInspection(rec.localId, (r) => {
        r.photos.push({
          localUri: durableUri,
          capturedAt: item.capturedAt,
          captureSource: item.source,
          qualityScore: quality.score,
          captureMetadata: {
            ...item.metadata,
            width: item.width,
            height: item.height,
            fileSize: item.fileSize,
          },
        });
      });
      if (updated) {
        recordRef.current = updated;
        setPhotos(updated.photos.map((p) => ({ uri: p.localUri })));
      }
      added.push({ localUri: durableUri, item });
    }
    setQualityNotice(warnings.length > 0 ? warnings[0] : null);
    // A fresh capture re-arms auto-run analysis after a prior failure.
    setWsError(null);
    // Deferred pass: decode pixels OFF the capture path to compute a perceptual
    // hash (duplicate detection) and a Laplacian sharpness score.
    void analyzeEvidencePixels(rec.localId, added);
  };

  // Sequential (one decode at a time, to bound memory) background pixel pass:
  // perceptual-hash de-duplication + sharpness refinement. Runs after the
  // thumbnails are already on screen. Each result patches its photo in place;
  // a detected duplicate or blur surfaces a gentle, non-blocking notice.
  // Advisory only — a failed/undecodable frame simply keeps its metadata score.
  const analyzeEvidencePixels = async (
    localId: string,
    added: { localUri: string; item: EvidenceItem }[],
  ) => {
    for (const { localUri, item } of added) {
      const pixels = await loadGrayscaleImage(localUri);
      if (!pixels) continue;
      const hash = computeDHash(pixels);
      const refined = assessEvidence(item, pixels);
      let duplicateOf: string | null = null;
      const updated = await updateLocalInspection(localId, (r) => {
        const photo = r.photos.find((p) => p.localUri === localUri);
        if (!photo) return;
        duplicateOf = findNearDuplicate(
          hash,
          r.photos.filter((p) => p.localUri !== localUri),
        );
        photo.perceptualHash = hash;
        if (duplicateOf) photo.duplicateOf = duplicateOf;
        photo.qualityScore = refined.score;
      });
      if (updated) recordRef.current = updated;
      if (duplicateOf) {
        setQualityNotice("This looks like a duplicate of an earlier photo");
      } else if (!refined.acceptable && refined.reasons.length > 0) {
        setQualityNotice(refined.reasons[0]);
      }
    }
  };

  const takePhoto = async () => {
    const rec = recordRef.current;
    if (!cameraRef.current || capturing || importing || !rec) return;
    try {
      setCapturing(true);
      await ingestEvidence(await cameraProvider.capture());
    } catch {
      setError("Couldn't capture photo. Please try again.");
    } finally {
      setCapturing(false);
    }
  };

  // Import existing footage (GoPro / smart-glasses / drone shots synced to the
  // camera roll) into this inspection — same pipeline as live captures.
  const importPhotos = async () => {
    const rec = recordRef.current;
    if (importing || capturing || !rec) return;
    try {
      setImporting(true);
      await ingestEvidence(await importProvider.capture());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't import photos. Please try again.");
    } finally {
      setImporting(false);
    }
  };

  // Quality warnings are transient nudges, not persistent errors.
  useEffect(() => {
    if (!qualityNotice) return;
    const timer = setTimeout(() => setQualityNotice(null), 6000);
    return () => clearTimeout(timer);
  }, [qualityNotice]);

  // Remove a not-yet-uploaded photo from both screen state and the record.
  const removePhoto = async (index: number) => {
    const rec = recordRef.current;
    const target = rec?.photos[index];
    // Refuse to delete a photo that is uploaded OR actively mid-upload.
    // The `uploading` flag is set by the sync engine before the network
    // request and cleared once the storagePath is written, preventing a
    // race where the file lands on storage but the local record still shows
    // storagePath === undefined.
    if (!rec || !target || target.storagePath || target.uploading) return;
    const updated = await updateLocalInspection(rec.localId, (r) => {
      const i = r.photos.findIndex((p) => p.localUri === target.localUri);
      // Re-check in the atomic context — engine may have set uploading or
      // storagePath between the outer guard and this callback.
      if (i !== -1 && !r.photos[i].storagePath && !r.photos[i].uploading) r.photos.splice(i, 1);
    });
    if (updated) {
      recordRef.current = updated;
      setPhotos(updated.photos.map((p) => ({ uri: p.localUri })));
    }
  };

  // Runs the sync pipeline from the workspace while the camera stays live:
  // create (idempotent) → upload photos → draft AI analysis. All progress is
  // checkpointed on the local record, so a drop mid-run resumes exactly where
  // it left off. Offline, this is a no-op with a friendly notice — photos are
  // already safe on the device.
  const runWorkspaceAnalysis = async () => {
    const rec = recordRef.current;
    if (wsAnalyzing || !rec || rec.photos.length === 0) return;
    setWsError(null);
    setWsAnalyzing(true);
    try {
      await persistDraft();
      const updated = await syncNow(rec.localId);
      if (updated) {
        recordRef.current = updated;
        if (updated.serverId != null) setWsInspectionId(updated.serverId);
        setUploadedCount(updated.photos.filter((p) => p.storagePath).length);
        analyzedCount.current = updated.analyzedCount;
        await queryClient.invalidateQueries();
        // New verified detections exist — rebuild the live report in the
        // background while the technician keeps capturing.
        if (updated.serverId != null) void buildLiveReport(updated.serverId);
      }
    } catch (e) {
      setWsError(
        isOfflineError(e)
          ? OFFLINE_NOTICE
          : e instanceof ApiError
            ? e.message
            : (e as Error).message,
      );
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
        isOfflineError(e)
          ? "You're offline — the draft is saved on this device and the report will finalize automatically when you're back online."
          : e instanceof ApiError
            ? e.message
            : (e as Error).message,
      );
    } finally {
      wsReportRunning.current = false;
      setWsReportBuilding(false);
    }
  };

  // Complete Inspection — the explicit end of the capture lifecycle.
  // Marks the local record complete (durable even if the app dies right
  // after), then attempts an immediate sync: create → upload photos → draft
  // analysis → server-side completion (report, narrative, summary,
  // opportunities, scorecard). Offline, completion still succeeds locally
  // and the engine finishes the push automatically when connectivity
  // returns — the summary screen shows live sync status either way.
  const completeNow = async () => {
    const rec = recordRef.current;
    if (!rec || submitting) return;
    setError(null);
    setSubmitting(true);
    setProgress("Saving inspection…");
    try {
      const updated = await updateLocalInspection(rec.localId, (r) => {
        r.siteAddress = siteAddress;
        r.clientName = clientName;
        r.technicianName = technicianName;
        r.propertyType = propertyType;
        r.pestTypes = pestTypes;
        r.notes = notes;
        r.completed = true;
        r.completedAt = new Date().toISOString();
      });
      if (updated) recordRef.current = updated;

      setProgress("Syncing evidence & running AI analysis…");
      try {
        await syncNow(rec.localId);
      } catch {
        // Offline or server hiccup — the record is safe on-device and the
        // sync engine retries automatically. Completion is NOT blocked.
        requestSync(0);
      }
      await queryClient.invalidateQueries();
      router.replace(`/inspection-summary/${rec.localId}` as Href);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : (e as Error).message);
      setSubmitting(false);
    }
  };

  // Wait for draft hydration when resuming, so we never render (or create)
  // fresh state on top of a half-loaded record.
  if (!hydrated) {
    return <Screen edges={["top", "bottom"]} />;
  }

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
                  onPress={() => void removePhoto(i)}
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

    // Vision Platform: pull GoPro / smart-glasses / drone footage off the
    // camera roll straight into this inspection.
    const importButton = (
      <Pressable
        onPress={() => void importPhotos()}
        disabled={importing || capturing}
        style={{
          width: 44,
          height: 44,
          borderRadius: 22,
          backgroundColor: "rgba(0,0,0,0.5)",
          alignItems: "center",
          justifyContent: "center",
          opacity: importing ? 0.5 : 1,
        }}
      >
        {importing ? (
          <ActivityIndicator size="small" color="#fff" />
        ) : (
          <Ionicons name="images-outline" size={20} color="#fff" />
        )}
      </Pressable>
    );

    const qualityBanner = qualityNotice ? (
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 8,
          backgroundColor: "rgba(202,138,4,0.92)",
          paddingHorizontal: 10,
          paddingVertical: 7,
          borderRadius: 10,
          maxWidth: 440,
        }}
      >
        <Ionicons name="warning-outline" size={16} color="#fff" />
        <Text
          style={{
            color: "#fff",
            fontFamily: "Inter_600SemiBold",
            fontSize: 12,
            flex: 1,
            flexShrink: 1,
          }}
        >
          {qualityNotice}
        </Text>
        {/* RLQ-007: Actionable retake button. Removes the just-captured photo so the
            technician can try a sharper or better-lit shot without accumulating poor evidence. */}
        {photos.length > 0 && (
          <Pressable
            onPress={() => {
              void removePhoto(photos.length - 1);
              setQualityNotice(null);
            }}
            style={{
              paddingHorizontal: 8,
              paddingVertical: 4,
              borderRadius: 6,
              backgroundColor: "rgba(255,255,255,0.28)",
            }}
          >
            <Text style={{ color: "#fff", fontFamily: "Inter_700Bold", fontSize: 11 }}>
              Retake
            </Text>
          </Pressable>
        )}
      </View>
    ) : null;

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
                {qualityBanner}
                {zoomChips}
                <View style={{ flexDirection: "row", alignItems: "center", gap: 28 }}>
                  {flashButton}
                  {importButton}
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
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
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
                <Pressable
                  onPress={() => setShowInsights(true)}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 6,
                    backgroundColor: "rgba(0,0,0,0.5)",
                    paddingHorizontal: 12,
                    paddingVertical: 8,
                    borderRadius: 999,
                    borderWidth: 1,
                    borderColor: "rgba(255,255,255,0.35)",
                  }}
                >
                  {wsAnalyzing ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Ionicons name="sparkles" size={15} color="#fff" />
                  )}
                  <Text style={{ color: "#fff", fontFamily: "Inter_600SemiBold", fontSize: 13 }}>
                    AI Insights
                    {(wsAnalysis?.findings?.length ?? 0) > 0
                      ? ` (${wsAnalysis?.findings?.length})`
                      : ""}
                  </Text>
                </Pressable>
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
              {importButton}
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
                gap: 10,
              }}
            >
              {qualityBanner}
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
            {qualityBanner ? (
              <View style={{ alignItems: "center", paddingHorizontal: 16 }}>{qualityBanner}</View>
            ) : null}
            <View style={{ alignItems: "center" }}>{zoomChips}</View>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                paddingHorizontal: 28,
              }}
            >
              <View style={{ width: 64, alignItems: "center", gap: 12 }}>
                {flashButton}
                {importButton}
              </View>
              {captureButton}
              {doneButton}
            </View>
          </View>
        )}

        {/* Full-screen AI Inspection overlay for compact/medium windows. The
            camera underneath stays mounted, so uploads and auto-run analysis
            continue while the technician reviews live insights. */}
        {showInsights ? (
          <View
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: colors.background,
            }}
          >
            <Screen edges={["top", "bottom"]}>
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  paddingHorizontal: 16,
                  paddingVertical: 12,
                  borderBottomWidth: 1,
                  borderBottomColor: colors.border,
                }}
              >
                <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                  <Ionicons name="sparkles" size={18} color={colors.primary} />
                  <Text
                    style={{
                      color: colors.foreground,
                      fontFamily: "Inter_700Bold",
                      fontSize: 18,
                    }}
                  >
                    AI Inspection
                  </Text>
                </View>
                <Pressable
                  onPress={() => setShowInsights(false)}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 6,
                    paddingHorizontal: 14,
                    paddingVertical: 8,
                    borderRadius: 999,
                    backgroundColor: colors.card,
                    borderWidth: 1,
                    borderColor: colors.border,
                  }}
                >
                  <Ionicons name="camera-outline" size={16} color={colors.foreground} />
                  <Text
                    style={{
                      color: colors.foreground,
                      fontFamily: "Inter_600SemiBold",
                      fontSize: 13,
                    }}
                  >
                    Back to camera
                  </Text>
                </Pressable>
              </View>
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
                onReview={() => {
                  setShowInsights(false);
                  setStep("review");
                }}
              />
            </Screen>
          </View>
        ) : null}
      </View>
    );
  }

  // ─── Review step ────────────────────────────────────────────────────────────
  if (step === "review") {
    // RLQ-008: derive findings review gate. reviewTick (from useFocusEffect) triggers
    // re-reads of recordRef so allFindingsReviewed is fresh after returning from review.
    void reviewTick;
    const allFindingsReviewed = recordRef.current?.allFindingsReviewed ?? false;
    const reviewFindings = (reviewAnalysisQ.data?.[0]?.findings ?? []) as Array<{
      reviewStatus?: string | null;
    }>;
    const unreviewedCount = reviewFindings.filter(
      (f) => !f.reviewStatus || f.reviewStatus === "pending",
    ).length;
    const hasReviewGate = wsInspectionId != null && !allFindingsReviewed && unreviewedCount > 0;
    const showReviewedBadge =
      wsInspectionId != null &&
      (allFindingsReviewed || unreviewedCount === 0) &&
      reviewFindings.length > 0;

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

          {/* RLQ-008: AI findings review gate */}
          {hasReviewGate ? (
            <View
              style={{
                gap: 10,
                borderWidth: 1,
                borderColor: colors.border,
                borderRadius: 10,
                padding: 14,
                backgroundColor: colors.card,
              }}
            >
              <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
                <Ionicons name="sparkles" size={20} color={colors.primary} />
                <View style={{ flex: 1 }}>
                  <Text
                    style={{
                      color: colors.foreground,
                      fontFamily: "Inter_600SemiBold",
                      fontSize: 15,
                    }}
                  >
                    Review AI Findings
                  </Text>
                  <Text
                    style={{
                      color: colors.mutedForeground,
                      fontFamily: "Inter_400Regular",
                      fontSize: 13,
                    }}
                  >
                    {unreviewedCount} finding{unreviewedCount !== 1 ? "s" : ""} need
                    {unreviewedCount === 1 ? "s" : ""} review before completing
                  </Text>
                </View>
              </View>
              <Button
                title={`Review Findings (${unreviewedCount})`}
                variant="outline"
                icon="sparkles"
                onPress={() => {
                  const rec = recordRef.current;
                  if (rec) router.push(`/findings-review/${rec.localId}` as Href);
                }}
              />
            </View>
          ) : showReviewedBadge ? (
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 8,
                padding: 12,
                borderRadius: 10,
                backgroundColor: (colors.success ?? "#22c55e") + "22",
                borderWidth: 1,
                borderColor: (colors.success ?? "#22c55e") + "55",
              }}
            >
              <Ionicons name="checkmark-circle" size={20} color={colors.success ?? "#22c55e"} />
              <Text
                style={{
                  color: colors.success ?? "#22c55e",
                  fontFamily: "Inter_600SemiBold",
                  fontSize: 14,
                }}
              >
                AI findings reviewed
              </Text>
            </View>
          ) : null}

          {error ? (
            <Text style={{ color: colors.destructive, fontSize: 14, textAlign: "center" }}>
              {error}
            </Text>
          ) : null}
        </ScrollView>

        <View style={{ gap: 10, paddingBottom: 8, width: "100%", maxWidth: 640, alignSelf: "center" }}>
          <Text
            style={{
              color: colors.mutedForeground,
              fontFamily: "Inter_400Regular",
              fontSize: 12,
              textAlign: "center",
            }}
          >
            {hasReviewGate
              ? "Review AI findings above before completing."
              : "Completing locks in your evidence and generates the report, summary, and insights. Works offline — everything syncs automatically."}
          </Text>
          <Button
            title="Complete Inspection"
            size="lg"
            icon="checkmark-circle"
            disabled={hasReviewGate}
            onPress={completeNow}
          />
          <Button title="Add more photos" variant="ghost" onPress={() => setStep("capture")} />
        </View>
      </Screen>
    );
  }

  // ─── Setup step ─────────────────────────────────────────────────────────────
  return (
    <Screen edges={["top", "bottom"]} padded>
      <Header
        title="New inspection"
        onClose={() => (recordRef.current ? confirmExit() : router.back())}
        colors={colors}
      />
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

        <View style={{ gap: 6 }}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <Text
              style={{
                color: colors.foreground,
                fontFamily: "Inter_500Medium",
                fontSize: 14,
              }}
            >
              Notes
            </Text>
            <Pressable
              onPress={() => void handleDictationPress()}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: 5,
                paddingHorizontal: 10,
                paddingVertical: 5,
                borderRadius: 999,
                backgroundColor: isDictating
                  ? "#ef444418"
                  : colors.card,
                borderWidth: 1,
                borderColor: isDictating ? "#ef4444" : colors.border,
              }}
            >
              {isTranscribing ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <Ionicons
                  name={isDictating ? "mic" : "mic-outline"}
                  size={14}
                  color={isDictating ? "#ef4444" : colors.mutedForeground}
                />
              )}
              <Text
                style={{
                  color: isDictating
                    ? "#ef4444"
                    : isTranscribing
                      ? colors.primary
                      : colors.mutedForeground,
                  fontFamily: "Inter_500Medium",
                  fontSize: 12,
                }}
              >
                {isDictating
                  ? "Stop"
                  : isTranscribing
                    ? "Transcribing…"
                    : "Dictate"}
              </Text>
            </Pressable>
          </View>
          <TextField
            placeholder="Conditions observed, access notes, etc."
            value={notes}
            onChangeText={setNotes}
            multiline
          />
        </View>
      </ScrollView>

      <View style={{ gap: 8, paddingBottom: 8, width: "100%", maxWidth: 640, alignSelf: "center" }}>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 }}>
          <Ionicons name="sparkles" size={13} color={colors.primary} />
          <Text
            style={{
              color: colors.mutedForeground,
              fontFamily: "Inter_400Regular",
              fontSize: 12,
            }}
          >
            AI Inspection runs live as you capture — open AI Insights from the camera.
          </Text>
        </View>
        <Button
          title="Continue to camera"
          size="lg"
          icon="camera"
          disabled={!canContinueSetup}
          onPress={() => void goToCapture()}
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
