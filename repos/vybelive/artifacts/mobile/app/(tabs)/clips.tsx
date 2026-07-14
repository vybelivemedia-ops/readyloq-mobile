import { Feather } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import { useFocusEffect } from "expo-router/build/useFocusEffect";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQueryClient } from "@tanstack/react-query";

import { useColors } from "@/hooks/useColors";
import {
  useListClips,
  usePublishClip,
  useDeleteClip,
  useGenerateClips,
  useGetClipJob,
  useGenerateClipCaptions,
  useApproveClip,
  useRejectClip,
  useTrimClip,
  useListStreams,
  getListClipsQueryKey,
} from "@workspace/api-client-react";
import type { Clip, Stream } from "@workspace/api-client-react";

// ─── Constants ───────────────────────────────────────────────────────────────

/**
 * Platforms that support real content publishing via OAuth.
 * TikTok and Twitch are excluded — no public content-upload API.
 */
const PUBLISH_PLATFORMS = [
  { id: "youtube_shorts", label: "YouTube Shorts", color: "#FF0000", textColor: "#FFF" },
  { id: "instagram",      label: "Instagram Reels", color: "#E1306C", textColor: "#FFF" },
  { id: "facebook",       label: "Facebook Reels",  color: "#1877F2", textColor: "#FFF" },
] as const;

type PublishPlatformId = (typeof PUBLISH_PLATFORMS)[number]["id"];

const FILTER_OPTIONS = ["All", "AI Ready", "Published", "Processing"] as const;
type FilterOption = (typeof FILTER_OPTIONS)[number];

const ASPECT_ICONS: Record<string, React.ComponentProps<typeof Feather>["name"]> = {
  vertical:   "smartphone",
  horizontal: "monitor",
  square:     "square",
};

const PLATFORM_DOT_COLORS: Record<string, string> = {
  youtube_shorts: "#FF0000",
  instagram:      "#E1306C",
  facebook:       "#1877F2",
};

// Map platform id to the AI caption field on the Clip object
const CAPTION_FIELD: Record<PublishPlatformId, keyof Clip> = {
  youtube_shorts: "aiCaptionYoutube",
  instagram:      "aiCaptionInstagram",
  facebook:       "aiCaptionFacebook",
};

const FORMAT_LABELS: Record<string, string> = {
  highlight: "Highlight",
  reel:      "Reel",
  short:     "Short",
  story:     "Story",
};

const REVIEW_META: Record<string, { label: string; color: string }> = {
  pending:  { label: "Needs review", color: "#FFD700" },
  approved: { label: "Approved",     color: "#39FF14" },
  rejected: { label: "Rejected",     color: "#FF3B6C" },
};

function confidenceColor(c: number): string {
  if (c >= 0.75) return "#39FF14";
  if (c >= 0.55) return "#7B61FF";
  if (c >= 0.4)  return "#FFD700";
  return "#9AA0A6";
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatViews(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`;
  return n.toString();
}

function getPlatformDotColor(p: string): string {
  return PLATFORM_DOT_COLORS[p] ?? "#888";
}

// ─── GenerateFromStreamForm ───────────────────────────────────────────────────

interface GenerateFromStreamFormProps {
  onCancel: () => void;
  onJobStarted: (jobId: string, streamId: string) => void;
}

function GenerateFromStreamForm({ onCancel, onJobStarted }: GenerateFromStreamFormProps) {
  const colors = useColors();
  const [selectedStreamId, setSelectedStreamId] = useState<string | null>(null);

  const { data: streamsData, isLoading } = useListStreams({ status: "ended", limit: 20 });
  const generateClips = useGenerateClips();

  const endedStreams = (streamsData?.items ?? []).filter(
    (s: Stream) => !s.clipsCount || s.clipsCount === 0
  );

  const handleGenerate = async () => {
    if (!selectedStreamId) return;
    try {
      const job = await generateClips.mutateAsync({
        streamId: selectedStreamId,
        data: { maxClips: 3, clipDurationSeconds: 30 },
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onJobStarted(job.id, selectedStreamId);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      const blocker = (err as { response?: { data?: { blocker?: string } } })?.response?.data?.blocker;

      const displayMsg =
        blocker === "NO_RECORDING"
          ? "This stream has no recording. End the stream and upload a recording first."
          : blocker === "AI_NOT_CONFIGURED"
          ? "AI generation is not configured on this server."
          : blocker === "STORAGE_NOT_CONFIGURED"
          ? "Storage is not configured. Contact support."
          : `Failed to start clip extraction: ${msg}`;

      Alert.alert("Cannot Generate Clips", displayMsg);
    }
  };

  return (
    <View style={[formStyles.wrap, { backgroundColor: colors.card, borderColor: colors.border }]}>
      <View style={formStyles.headerRow}>
        <Feather name="zap" size={15} color={colors.primary} />
        <Text style={[formStyles.heading, { color: colors.foreground }]}>
          Generate AI Clips
        </Text>
      </View>

      <Text style={[formStyles.hint, { color: colors.mutedForeground }]}>
        Select a completed stream to extract highlight clips with AI titles and captions.
      </Text>

      {isLoading ? (
        <ActivityIndicator color={colors.primary} style={{ marginVertical: 12 }} />
      ) : endedStreams.length === 0 ? (
        <View style={[formStyles.emptyBox, { borderColor: colors.border }]}>
          <Text style={[formStyles.emptyText, { color: colors.mutedForeground }]}>
            No eligible streams found. Complete a stream and upload its recording first.
          </Text>
        </View>
      ) : (
        <ScrollView style={formStyles.streamList} showsVerticalScrollIndicator={false}>
          {endedStreams.map((stream: Stream) => (
            <TouchableOpacity
              key={stream.id}
              onPress={() => {
                Haptics.selectionAsync();
                setSelectedStreamId(stream.id === selectedStreamId ? null : stream.id);
              }}
              style={[
                formStyles.streamRow,
                {
                  backgroundColor:
                    selectedStreamId === stream.id
                      ? colors.primary + "20"
                      : colors.muted,
                  borderColor:
                    selectedStreamId === stream.id ? colors.primary : colors.border,
                },
              ]}
              activeOpacity={0.8}
            >
              <Feather
                name="video"
                size={14}
                color={
                  selectedStreamId === stream.id
                    ? colors.primary
                    : colors.mutedForeground
                }
              />
              <Text
                style={[
                  formStyles.streamTitle,
                  {
                    color:
                      selectedStreamId === stream.id
                        ? colors.primary
                        : colors.foreground,
                  },
                ]}
                numberOfLines={1}
              >
                {stream.title}
              </Text>
              {selectedStreamId === stream.id && (
                <Feather name="check" size={14} color={colors.primary} />
              )}
            </TouchableOpacity>
          ))}
        </ScrollView>
      )}

      <View style={formStyles.btns}>
        <TouchableOpacity
          onPress={onCancel}
          style={[formStyles.cancelBtn, { borderColor: colors.border }]}
        >
          <Text style={[formStyles.cancelText, { color: colors.mutedForeground }]}>Cancel</Text>
        </TouchableOpacity>
        <TouchableOpacity
          onPress={handleGenerate}
          disabled={!selectedStreamId || generateClips.isPending}
          style={[
            formStyles.createBtn,
            { backgroundColor: colors.primary },
            (!selectedStreamId || generateClips.isPending) && formStyles.disabledBtn,
          ]}
          activeOpacity={0.8}
        >
          {generateClips.isPending ? (
            <ActivityIndicator size="small" color="#FFF" />
          ) : (
            <>
              <Feather name="zap" size={13} color="#FFF" />
              <Text style={formStyles.createText}>Extract Clips</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const formStyles = StyleSheet.create({
  wrap:       { borderRadius: 16, borderWidth: 1, padding: 14, gap: 12 },
  headerRow:  { flexDirection: "row", alignItems: "center", gap: 8 },
  heading:    { fontSize: 14, fontFamily: "Inter_600SemiBold" },
  hint:       { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 18 },
  emptyBox:   { borderWidth: 1, borderRadius: 10, padding: 12 },
  emptyText:  { fontSize: 12, fontFamily: "Inter_400Regular", textAlign: "center", lineHeight: 18 },
  streamList: { maxHeight: 180 },
  streamRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 6,
  },
  streamTitle:  { flex: 1, fontSize: 13, fontFamily: "Inter_500Medium" },
  btns:         { flexDirection: "row", gap: 8 },
  cancelBtn:    { flex: 1, height: 40, borderRadius: 10, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  cancelText:   { fontSize: 13, fontFamily: "Inter_500Medium" },
  createBtn:    { flex: 2, height: 40, borderRadius: 10, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6 },
  disabledBtn:  { opacity: 0.5 },
  createText:   { color: "#FFF", fontSize: 13, fontFamily: "Inter_600SemiBold" },
});

// ─── ActiveJobBanner ─────────────────────────────────────────────────────────

interface ActiveJobBannerProps {
  jobId: string;
  onComplete: () => void;
}

function ActiveJobBanner({ jobId, onComplete }: ActiveJobBannerProps) {
  const colors = useColors();
  const { data: job, refetch } = useGetClipJob(jobId);

  const prevStatus = useRef<string | null>(null);

  // Poll every 2.5 s while the job is running
  useEffect(() => {
    const id = setInterval(() => { void refetch(); }, 2500);
    return () => clearInterval(id);
  }, [refetch]);

  useEffect(() => {
    if (!job) return;
    if (job.status === "completed" && prevStatus.current !== "completed") {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      onComplete();
    }
    prevStatus.current = job.status;
  }, [job?.status, onComplete]);

  if (!job || job.status === "completed") return null;

  const isRunning = job.status === "running" || job.status === "pending";
  const isFailed  = job.status === "failed";

  return (
    <View
      style={[
        bannerStyles.banner,
        {
          backgroundColor: isFailed ? "#FF3B6C18" : colors.primary + "15",
          borderColor:     isFailed ? "#FF3B6C55" : colors.primary + "45",
        },
      ]}
    >
      {isRunning ? (
        <ActivityIndicator size="small" color={colors.primary} />
      ) : (
        <Feather name="alert-circle" size={16} color="#FF3B6C" />
      )}
      <Text style={[bannerStyles.text, { color: isFailed ? "#FF3B6C" : colors.foreground }]}>
        {isFailed
          ? `Clip extraction failed: ${job.error ?? "Unknown error"}`
          : "Extracting clips and generating AI captions…"}
      </Text>
    </View>
  );
}

const bannerStyles = StyleSheet.create({
  banner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
  },
  text: { flex: 1, fontSize: 13, fontFamily: "Inter_500Medium", lineHeight: 18 },
});

// ─── TrimStepper ──────────────────────────────────────────────────────────────

interface TrimStepperProps {
  label: string;
  valueMs: number;
  onChange: (valueMs: number) => void;
  colors: ReturnType<typeof useColors>;
}

function TrimStepper({ label, valueMs, onChange, colors }: TrimStepperProps) {
  const step = 1000;
  const adjust = (delta: number) => {
    Haptics.selectionAsync();
    onChange(valueMs + delta);
  };
  return (
    <View style={styles.stepperRow}>
      <Text style={[styles.stepperLabel, { color: colors.mutedForeground }]}>{label}</Text>
      <View style={styles.stepperControls}>
        <TouchableOpacity
          onPress={() => adjust(-step)}
          activeOpacity={0.7}
          style={[styles.stepperBtn, { borderColor: colors.border }]}
        >
          <Feather name="minus" size={14} color={colors.foreground} />
        </TouchableOpacity>
        <Text style={[styles.stepperValue, { color: colors.foreground }]}>
          {formatDuration(valueMs / 1000)}
        </Text>
        <TouchableOpacity
          onPress={() => adjust(step)}
          activeOpacity={0.7}
          style={[styles.stepperBtn, { borderColor: colors.border }]}
        >
          <Feather name="plus" size={14} color={colors.foreground} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ─── ClipRow ──────────────────────────────────────────────────────────────────

interface ClipRowProps {
  clip: Clip;
  publishingPlatform: string | null;
  reviewActionPending: boolean;
  onRepost: (platform: PublishPlatformId) => void;
  onDelete: () => void;
  onRegenerateCaptions: () => void;
  onShare: () => void;
  onApprove: () => void;
  onReject: () => void;
  onTrim: (startTimeMs: number, endTimeMs: number) => void;
}

const ClipRow = React.memo(function ClipRow({
  clip,
  publishingPlatform,
  reviewActionPending,
  onRepost,
  onDelete,
  onRegenerateCaptions,
  onShare,
  onApprove,
  onReject,
  onTrim,
}: ClipRowProps) {
  const colors   = useColors();
  const [expanded, setExpanded]       = useState(false);
  const [activePlatform, setActivePlatform] = useState<PublishPlatformId>("youtube_shorts");
  const [showTrim, setShowTrim]       = useState(false);

  const isPublished  = clip.status === "published";
  const isReady      = clip.status === "ready";
  const isProcessing = clip.status === "processing";

  const reviewStatus = clip.reviewStatus ?? "pending";
  const isApproved   = reviewStatus === "approved";
  const canPublish   = isApproved || isPublished;
  const confidence   = clip.confidence ?? null;
  const format       = clip.clipFormat ?? null;

  // Source-recording window for trimming (falls back to a 0..duration window).
  const baseStartMs = clip.startTimeMs ?? 0;
  const baseEndMs   = clip.endTimeMs ?? baseStartMs + (clip.durationSeconds ?? 30) * 1000;
  const [trimStartMs, setTrimStartMs] = useState(baseStartMs);
  const [trimEndMs, setTrimEndMs]     = useState(baseEndMs);

  const statusColor =
    clip.status === "published"  ? "#39FF14" :
    clip.status === "ready"      ? "#7B61FF" :
    clip.status === "processing" ? "#FFD700" : "#FF3B6C";

  const activeCaption = clip[CAPTION_FIELD[activePlatform]] as string | null | undefined;

  const handleCopyCaption = async () => {
    if (!activeCaption) return;
    await Clipboard.setStringAsync(activeCaption);
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  return (
    <View style={[styles.clipCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
      {/* Header row */}
      <TouchableOpacity
        onPress={() => { Haptics.selectionAsync(); setExpanded((v) => !v); }}
        onLongPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy); onDelete(); }}
        activeOpacity={0.85}
        delayLongPress={500}
        style={styles.clipCardHeader}
      >
        {/* Thumbnail */}
        <View style={[styles.thumbnail, { backgroundColor: colors.muted }]}>
          <Feather name="film" size={22} color={colors.mutedForeground} />
          {clip.aiGenerated && (
            <View style={styles.aiTag}>
              <Feather name="zap" size={9} color="#7B61FF" />
              <Text style={styles.aiTagText}>AI</Text>
            </View>
          )}
          {isProcessing && (
            <View style={styles.processingOverlay}>
              <ActivityIndicator size="small" color="#FFD700" />
            </View>
          )}
          {(clip.durationSeconds ?? 0) > 0 && (
            <View style={styles.durationTag}>
              <Text style={styles.durationTagText}>
                {formatDuration(clip.durationSeconds ?? 0)}
              </Text>
            </View>
          )}
        </View>

        {/* Clip info */}
        <View style={styles.clipInfo}>
          <Text style={[styles.clipTitle, { color: colors.foreground }]} numberOfLines={2}>
            {clip.aiTitle ?? clip.title}
          </Text>

          <View style={styles.clipMeta}>
            <View style={[styles.statusChip, { backgroundColor: statusColor + "22" }]}>
              <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
              <Text style={[styles.statusText, { color: statusColor }]}>
                {clip.status.charAt(0).toUpperCase() + clip.status.slice(1)}
              </Text>
            </View>

            {format && (
              <View style={[styles.aspectChip, { borderColor: colors.border }]}>
                <Feather name={ASPECT_ICONS[clip.aspectRatio ?? "vertical"] ?? "square"} size={10} color={colors.mutedForeground} />
                <Text style={[styles.aspectText, { color: colors.mutedForeground }]}>
                  {FORMAT_LABELS[format] ?? format}
                </Text>
              </View>
            )}

            {confidence !== null && (
              <View style={[styles.confChip, { backgroundColor: confidenceColor(confidence) + "22" }]}>
                <Feather name="bar-chart-2" size={10} color={confidenceColor(confidence)} />
                <Text style={[styles.confText, { color: confidenceColor(confidence) }]}>
                  {Math.round(confidence * 100)}%
                </Text>
              </View>
            )}

            {!isPublished && (
              <View style={[styles.reviewChip, { backgroundColor: (REVIEW_META[reviewStatus]?.color ?? "#888") + "22" }]}>
                <Text style={[styles.reviewChipText, { color: REVIEW_META[reviewStatus]?.color ?? "#888" }]}>
                  {REVIEW_META[reviewStatus]?.label ?? reviewStatus}
                </Text>
              </View>
            )}

            {(clip.views ?? 0) > 0 && (
              <View style={styles.viewsRow}>
                <Feather name="eye" size={10} color={colors.mutedForeground} />
                <Text style={[styles.viewsText, { color: colors.mutedForeground }]}>
                  {formatViews(clip.views ?? 0)}
                </Text>
              </View>
            )}
          </View>

          {/* Hashtags */}
          {(clip.aiHashtags?.length ?? 0) > 0 && (
            <Text style={[styles.hashtags, { color: colors.primary }]} numberOfLines={1}>
              {clip.aiHashtags!.slice(0, 4).map((h) => `#${h}`).join(" ")}
            </Text>
          )}

          {(clip.publishedPlatforms?.length ?? 0) > 0 && (
            <View style={styles.pubPlatforms}>
              {clip.publishedPlatforms!.map((p) => (
                <View key={p} style={[styles.pubDot, { backgroundColor: getPlatformDotColor(p) }]} />
              ))}
              <Text style={[styles.pubText, { color: colors.mutedForeground }]}>
                Published to {clip.publishedPlatforms!.length} platform
                {clip.publishedPlatforms!.length > 1 ? "s" : ""}
              </Text>
            </View>
          )}
        </View>

        <Feather
          name={expanded ? "chevron-up" : "chevron-down"}
          size={16}
          color={colors.mutedForeground}
        />
      </TouchableOpacity>

      {/* Expanded: why-this-clip + review gate */}
      {expanded && (isReady || isPublished) && clip.confidenceReason && (
        <View style={[styles.reasonRow, { borderTopColor: colors.border }]}>
          <Feather name="info" size={13} color={colors.mutedForeground} />
          <Text style={[styles.reasonText, { color: colors.mutedForeground }]}>
            {clip.confidenceReason}
          </Text>
        </View>
      )}

      {/* Expanded: review actions (only until approved) */}
      {expanded && isReady && !canPublish && (
        <View style={[styles.reviewSection, { borderTopColor: colors.border }]}>
          <Text style={[styles.reviewHeading, { color: colors.foreground }]}>
            Review before publishing
          </Text>
          <Text style={[styles.reviewHint, { color: colors.mutedForeground }]}>
            Approve to unlock publishing, trim the window, or reject this clip.
          </Text>

          {showTrim && (
            <View style={[styles.trimBox, { backgroundColor: colors.muted, borderColor: colors.border }]}>
              <TrimStepper
                label="Start"
                valueMs={trimStartMs}
                onChange={(v) => setTrimStartMs(Math.max(0, Math.min(v, trimEndMs - 1000)))}
                colors={colors}
              />
              <TrimStepper
                label="End"
                valueMs={trimEndMs}
                onChange={(v) => setTrimEndMs(Math.max(trimStartMs + 1000, v))}
                colors={colors}
              />
              <Text style={[styles.trimLen, { color: colors.mutedForeground }]}>
                New length: {formatDuration((trimEndMs - trimStartMs) / 1000)}
              </Text>
              <TouchableOpacity
                onPress={() => { setShowTrim(false); onTrim(trimStartMs, trimEndMs); }}
                disabled={reviewActionPending}
                activeOpacity={0.85}
                style={[styles.trimApplyBtn, { backgroundColor: colors.primary }, reviewActionPending && styles.publishBtnDim]}
              >
                <Feather name="scissors" size={13} color="#FFF" />
                <Text style={styles.trimApplyText}>Apply trim & re-cut</Text>
              </TouchableOpacity>
            </View>
          )}

          <View style={styles.reviewBtns}>
            <TouchableOpacity
              onPress={onApprove}
              disabled={reviewActionPending}
              activeOpacity={0.85}
              style={[styles.approveBtn, { backgroundColor: "#39FF14" }, reviewActionPending && styles.publishBtnDim]}
            >
              {reviewActionPending ? (
                <ActivityIndicator size="small" color="#0A0A0A" />
              ) : (
                <>
                  <Feather name="check" size={14} color="#0A0A0A" />
                  <Text style={styles.approveText}>Approve</Text>
                </>
              )}
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => { Haptics.selectionAsync(); setShowTrim((v) => !v); }}
              disabled={reviewActionPending}
              activeOpacity={0.85}
              style={[styles.reviewSecondaryBtn, { borderColor: colors.border }]}
            >
              <Feather name="scissors" size={13} color={colors.foreground} />
              <Text style={[styles.reviewSecondaryText, { color: colors.foreground }]}>Trim</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={onReject}
              disabled={reviewActionPending}
              activeOpacity={0.85}
              style={[styles.reviewSecondaryBtn, { borderColor: "#FF3B6C55" }]}
            >
              <Feather name="x" size={13} color="#FF3B6C" />
              <Text style={[styles.reviewSecondaryText, { color: "#FF3B6C" }]}>Reject</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Expanded: publish section (approved or already published) */}
      {expanded && canPublish && (
        <View style={[styles.repostSection, { borderTopColor: colors.border }]}>
          {/* Platform tabs */}
          <View style={styles.platformTabs}>
            {PUBLISH_PLATFORMS.map((p) => (
              <TouchableOpacity
                key={p.id}
                onPress={() => { Haptics.selectionAsync(); setActivePlatform(p.id); }}
                style={[
                  styles.platformTab,
                  {
                    backgroundColor: activePlatform === p.id ? p.color + "22" : "transparent",
                    borderColor: activePlatform === p.id ? p.color : colors.border,
                  },
                ]}
              >
                <Text style={[styles.platformTabText, { color: activePlatform === p.id ? p.color : colors.mutedForeground }]}>
                  {p.label.split(" ")[0]}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* AI Caption for active platform */}
          {activeCaption ? (
            <View style={[styles.captionBox, { backgroundColor: colors.muted, borderColor: colors.border }]}>
              <View style={styles.captionHeader}>
                <Text style={[styles.captionLabel, { color: colors.mutedForeground }]}>AI CAPTION</Text>
                <TouchableOpacity onPress={handleCopyCaption} style={styles.copyBtn}>
                  <Feather name="copy" size={12} color={colors.mutedForeground} />
                  <Text style={[styles.copyText, { color: colors.mutedForeground }]}>Copy</Text>
                </TouchableOpacity>
              </View>
              <Text style={[styles.captionText, { color: colors.foreground }]}>
                {activeCaption}
              </Text>
            </View>
          ) : (
            <TouchableOpacity
              onPress={onRegenerateCaptions}
              style={[styles.captionBox, styles.captionBoxEmpty, { backgroundColor: colors.muted, borderColor: colors.border }]}
            >
              <Feather name="zap" size={13} color={colors.mutedForeground} />
              <Text style={[styles.captionEmptyText, { color: colors.mutedForeground }]}>
                Tap to generate AI captions
              </Text>
            </TouchableOpacity>
          )}

          {/* Publish button */}
          <View style={styles.repostBtns}>
            {PUBLISH_PLATFORMS.map((p) => {
              if (p.id !== activePlatform) return null;
              const isThisPublishing = publishingPlatform === p.id;
              return (
                <TouchableOpacity
                  key={p.id}
                  onPress={() => onRepost(p.id)}
                  disabled={publishingPlatform !== null}
                  activeOpacity={0.8}
                  style={[
                    styles.publishBtn,
                    { backgroundColor: p.color },
                    publishingPlatform !== null && !isThisPublishing && styles.publishBtnDim,
                  ]}
                >
                  {isThisPublishing ? (
                    <ActivityIndicator size="small" color={p.textColor} />
                  ) : (
                    <>
                      <Feather name="send" size={13} color={p.textColor} />
                      <Text style={[styles.publishBtnText, { color: p.textColor }]}>
                        {isPublished ? "Repost to" : "Post to"} {p.label}
                      </Text>
                    </>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>

          {/* Share to chat */}
          <TouchableOpacity
            onPress={onShare}
            activeOpacity={0.8}
            style={[styles.shareToChatBtn, { borderColor: colors.border, backgroundColor: colors.muted }]}
          >
            <Feather name="message-circle" size={13} color={colors.foreground} />
            <Text style={[styles.shareToChatText, { color: colors.foreground }]}>Share to chat</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Expanded: processing state */}
      {expanded && isProcessing && (
        <View style={[styles.processingRow, { borderTopColor: colors.border }]}>
          <ActivityIndicator size="small" color="#FFD700" />
          <Text style={[styles.processingText, { color: colors.mutedForeground }]}>
            AI is processing your clip — check back in a moment
          </Text>
        </View>
      )}
    </View>
  );
});

// ─── ClipsScreen ──────────────────────────────────────────────────────────────

export default function ClipsScreen() {
  const colors     = useColors();
  const insets     = useSafeAreaInsets();
  const qc         = useQueryClient();

  const topPad    = Platform.OS === "web" ? 67 : insets.top;
  const bottomPad = Platform.OS === "web" ? 34 : 0;

  const [filter,       setFilter]       = useState<FilterOption>("All");
  const [showGenerate, setShowGenerate] = useState(false);
  const [activeJobId,  setActiveJobId]  = useState<string | null>(null);
  const [publishing,   setPublishing]   = useState<{ clipId: string; platform: string } | null>(null);
  const [reviewActionClipId, setReviewActionClipId] = useState<string | null>(null);

  // ── Queries ────────────────────────────────────────────────────────────────

  const {
    data: clipsData,
    isLoading,
    isError,
    refetch,
    isFetching,
  } = useListClips({ limit: 50 });

  // ── Mutations ──────────────────────────────────────────────────────────────

  const publishClip           = usePublishClip();
  const deleteClip            = useDeleteClip();
  const generateClipCaptions  = useGenerateClipCaptions();
  const approveClip           = useApproveClip();
  const rejectClip            = useRejectClip();
  const trimClip              = useTrimClip();

  // ── Derived state ──────────────────────────────────────────────────────────

  const allClips = clipsData?.items ?? [];

  const clips: Clip[] = allClips.filter((clip) => {
    if (filter === "All")        return true;
    if (filter === "AI Ready")   return clip.aiGenerated && clip.status === "ready";
    if (filter === "Published")  return clip.status === "published";
    if (filter === "Processing") return clip.status === "processing";
    return true;
  });

  const aiReadyCount  = allClips.filter((c) => c.aiGenerated && c.status === "ready").length;
  const hasProcessing = allClips.some((c) => c.status === "processing");

  // ── Side effects ───────────────────────────────────────────────────────────

  useFocusEffect(
    useCallback(() => { refetch(); }, [refetch])
  );

  // Auto-poll while any clip is processing
  useEffect(() => {
    if (!hasProcessing) return;
    const id = setInterval(() => refetch(), 3000);
    return () => clearInterval(id);
  }, [hasProcessing, refetch]);

  // ── Handlers ──────────────────────────────────────────────────────────────

  const invalidateClips = useCallback(() => {
    qc.invalidateQueries({ queryKey: getListClipsQueryKey() });
  }, [qc]);

  const handleJobStarted = useCallback(
    (jobId: string) => {
      setActiveJobId(jobId);
      setShowGenerate(false);
      setFilter("Processing");
    },
    []
  );

  const handleJobComplete = useCallback(() => {
    setActiveJobId(null);
    invalidateClips();
    setFilter("AI Ready");
  }, [invalidateClips]);

  const handleRepost = useCallback(
    (clip: Clip, platform: PublishPlatformId) => {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      const label = PUBLISH_PLATFORMS.find((p) => p.id === platform)?.label ?? platform;
      const caption = clip[CAPTION_FIELD[platform]] as string | null | undefined;

      Alert.alert(
        `Post to ${label}?`,
        caption
          ? `Caption preview:\n"${caption.slice(0, 80)}${caption.length > 80 ? "…" : ""}"`
          : "Post this clip without a caption.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Post",
            onPress: async () => {
              setPublishing({ clipId: clip.id, platform });
              try {
                await publishClip.mutateAsync({
                  clipId: clip.id,
                  data: { platforms: [platform], caption: caption ?? undefined },
                });
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                invalidateClips();
              } catch (err: unknown) {
                const blocker = (err as { response?: { data?: { blocker?: string } } })?.response?.data?.blocker;
                const msg =
                  blocker === "NO_OAUTH_CONNECTION"
                    ? `Connect your ${label} account in Settings → Connected Accounts first.`
                    : blocker === "NO_VIDEO_URL"
                    ? "This clip has no video file yet."
                    : "Failed to publish clip. Please try again.";
                Alert.alert("Publish Failed", msg);
              } finally {
                setPublishing(null);
              }
            },
          },
        ]
      );
    },
    [publishClip, invalidateClips]
  );

  const handleDelete = useCallback(
    (clip: Clip) => {
      Alert.alert(
        "Delete clip?",
        `"${clip.title}" will be permanently deleted.`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Delete",
            style: "destructive",
            onPress: async () => {
              try {
                await deleteClip.mutateAsync({ clipId: clip.id });
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
                invalidateClips();
              } catch {
                Alert.alert("Error", "Failed to delete clip.");
              }
            },
          },
        ]
      );
    },
    [deleteClip, invalidateClips]
  );

  const handleRegenerateCaptions = useCallback(
    async (clip: Clip) => {
      try {
        await generateClipCaptions.mutateAsync({ clipId: clip.id });
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        invalidateClips();
      } catch {
        Alert.alert("Error", "Failed to generate captions. Check that OpenAI is configured.");
      }
    },
    [generateClipCaptions, invalidateClips]
  );

  const handleApprove = useCallback(
    async (clip: Clip) => {
      setReviewActionClipId(clip.id);
      try {
        await approveClip.mutateAsync({ clipId: clip.id });
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        invalidateClips();
      } catch {
        Alert.alert("Error", "Failed to approve clip.");
      } finally {
        setReviewActionClipId(null);
      }
    },
    [approveClip, invalidateClips]
  );

  const handleReject = useCallback(
    (clip: Clip) => {
      Alert.alert(
        "Reject clip?",
        "This clip will be blocked from publishing. You can still delete it later.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Reject",
            style: "destructive",
            onPress: async () => {
              setReviewActionClipId(clip.id);
              try {
                await rejectClip.mutateAsync({ clipId: clip.id });
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
                invalidateClips();
              } catch {
                Alert.alert("Error", "Failed to reject clip.");
              } finally {
                setReviewActionClipId(null);
              }
            },
          },
        ]
      );
    },
    [rejectClip, invalidateClips]
  );

  const handleTrim = useCallback(
    async (clip: Clip, startTimeMs: number, endTimeMs: number) => {
      setReviewActionClipId(clip.id);
      try {
        await trimClip.mutateAsync({ clipId: clip.id, data: { startTimeMs, endTimeMs } });
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setFilter("Processing");
        invalidateClips();
      } catch (err: unknown) {
        const blocker = (err as { response?: { data?: { blocker?: string } } })?.response?.data?.blocker;
        Alert.alert(
          "Trim Failed",
          blocker === "NO_VIDEO_URL"
            ? "This clip has no source recording to re-cut."
            : "Failed to trim clip. Please try again."
        );
      } finally {
        setReviewActionClipId(null);
      }
    },
    [trimClip, invalidateClips]
  );

  const handleShareClip = useCallback((clip: Clip) => {
    Haptics.selectionAsync();
    const qs = new URLSearchParams({
      shareType: "clip",
      shareId: clip.id,
      shareLabel: clip.aiTitle ?? clip.title,
    }).toString();
    router.push(`/(tabs)/messages?${qs}` as never);
  }, []);

  const handleFilterPress = (f: FilterOption) => {
    Haptics.selectionAsync();
    setFilter(f);
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <ScrollView
      style={[styles.root, { backgroundColor: colors.background }]}
      contentContainerStyle={[
        styles.content,
        { paddingTop: topPad + 16, paddingBottom: bottomPad + 100 },
      ]}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl
          refreshing={isFetching && !isLoading}
          onRefresh={refetch}
          tintColor={colors.primary}
          colors={[colors.primary]}
        />
      }
    >
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={[styles.title, { color: colors.foreground }]}>Clips</Text>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
            {clipsData?.total ?? 0} clip{clipsData?.total !== 1 ? "s" : ""}
            {hasProcessing && <Text style={{ color: "#FFD700" }}> · processing…</Text>}
          </Text>
        </View>

        <TouchableOpacity
          onPress={() => {
            Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
            setShowGenerate((v) => !v);
          }}
          style={[
            styles.addBtn,
            {
              backgroundColor: showGenerate ? colors.primary : colors.card,
              borderColor:     showGenerate ? colors.primary : colors.border,
            },
          ]}
          activeOpacity={0.8}
        >
          <Feather
            name={showGenerate ? "x" : "plus"}
            size={18}
            color={showGenerate ? "#FFF" : colors.foreground}
          />
        </TouchableOpacity>
      </View>

      {/* ── Generate form ────────────────────────────────────────────────── */}
      {showGenerate && (
        <GenerateFromStreamForm
          onCancel={() => setShowGenerate(false)}
          onJobStarted={handleJobStarted}
        />
      )}

      {/* ── Active job banner ────────────────────────────────────────────── */}
      {activeJobId && (
        <ActiveJobBanner jobId={activeJobId} onComplete={handleJobComplete} />
      )}

      {/* ── AI ready CTA ────────────────────────────────────────────────── */}
      {!showGenerate && !activeJobId && aiReadyCount > 0 && (
        <TouchableOpacity
          onPress={() => handleFilterPress("AI Ready")}
          activeOpacity={0.85}
          style={[
            styles.aiCta,
            {
              backgroundColor: colors.primary + "15",
              borderColor:     colors.primary + "45",
              shadowColor:     colors.primary,
            },
          ]}
        >
          <View style={[styles.aiCtaIcon, { backgroundColor: colors.primary + "25" }]}>
            <Feather name="zap" size={20} color={colors.primary} />
          </View>
          <View style={styles.aiCtaContent}>
            <Text style={[styles.aiCtaTitle, { color: colors.foreground }]}>
              {aiReadyCount} AI clip{aiReadyCount > 1 ? "s" : ""} ready
            </Text>
            <Text style={[styles.aiCtaSubtitle, { color: colors.mutedForeground }]}>
              Review and post to YouTube Shorts, Instagram, or Facebook
            </Text>
          </View>
          <Feather name="chevron-right" size={16} color={colors.primary} />
        </TouchableOpacity>
      )}

      {/* ── Filters ─────────────────────────────────────────────────────── */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filterRow}
      >
        {FILTER_OPTIONS.map((f) => (
          <TouchableOpacity
            key={f}
            onPress={() => handleFilterPress(f)}
            style={[
              styles.filterChip,
              {
                backgroundColor: filter === f ? colors.primary : colors.card,
                borderColor:     filter === f ? colors.primary : colors.border,
              },
            ]}
            activeOpacity={0.8}
          >
            <Text
              style={[
                styles.filterText,
                { color: filter === f ? "#FFF" : colors.mutedForeground },
              ]}
            >
              {f}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* ── Content ─────────────────────────────────────────────────────── */}
      {isLoading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
      ) : isError ? (
        <View style={styles.emptyState}>
          <Feather name="alert-circle" size={40} color="#FF3B6C" />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>Failed to load clips</Text>
          <TouchableOpacity onPress={() => refetch()}>
            <Text style={[styles.emptySubtitle, { color: colors.primary }]}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : clips.length === 0 ? (
        <View style={styles.emptyState}>
          <Feather name="film" size={48} color={colors.mutedForeground} />
          <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
            {filter === "All" ? "No clips yet" : `No ${filter.toLowerCase()} clips`}
          </Text>
          {filter === "All" && (
            <Text style={[styles.emptySubtitle, { color: colors.mutedForeground }]}>
              Tap + to extract AI highlights from a completed stream
            </Text>
          )}
        </View>
      ) : (
        <View style={styles.clipList}>
          {clips.map((clip) => (
            <ClipRow
              key={clip.id}
              clip={clip}
              publishingPlatform={
                publishing?.clipId === clip.id ? publishing.platform : null
              }
              reviewActionPending={reviewActionClipId === clip.id}
              onRepost={(platform) => handleRepost(clip, platform)}
              onDelete={() => handleDelete(clip)}
              onRegenerateCaptions={() => handleRegenerateCaptions(clip)}
              onShare={() => handleShareClip(clip)}
              onApprove={() => handleApprove(clip)}
              onReject={() => handleReject(clip)}
              onTrim={(s, e) => handleTrim(clip, s, e)}
            />
          ))}
        </View>
      )}
    </ScrollView>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root:    { flex: 1 },
  content: { paddingHorizontal: 16, gap: 12 },

  header:     { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" },
  headerLeft: { gap: 2 },
  title:      { fontSize: 28, fontFamily: "Inter_700Bold" },
  subtitle:   { fontSize: 13, fontFamily: "Inter_400Regular" },
  addBtn: {
    width: 40, height: 40, borderRadius: 12, borderWidth: 1,
    alignItems: "center", justifyContent: "center",
  },

  aiCta: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
  },
  aiCtaIcon:     { width: 40, height: 40, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  aiCtaContent:  { flex: 1, gap: 2 },
  aiCtaTitle:    { fontSize: 15, fontFamily: "Inter_600SemiBold" },
  aiCtaSubtitle: { fontSize: 12, fontFamily: "Inter_400Regular" },

  filterRow:  { paddingVertical: 4, gap: 8 },
  filterChip: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: 20, borderWidth: 1 },
  filterText: { fontSize: 13, fontFamily: "Inter_500Medium" },

  clipList: { gap: 10 },

  clipCard:       { borderRadius: 16, borderWidth: 1, overflow: "hidden" },
  clipCardHeader: { flexDirection: "row", alignItems: "center", gap: 12, padding: 12 },

  thumbnail: {
    width: 72, height: 72, borderRadius: 10,
    alignItems: "center", justifyContent: "center", position: "relative",
  },
  aiTag: {
    position: "absolute", top: 4, right: 4,
    flexDirection: "row", alignItems: "center",
    backgroundColor: "#7B61FF22", borderRadius: 4,
    paddingHorizontal: 4, paddingVertical: 2, gap: 2,
  },
  aiTagText:       { fontSize: 8, fontFamily: "Inter_700Bold", color: "#7B61FF" },
  processingOverlay: {
    position: "absolute", inset: 0, borderRadius: 10,
    backgroundColor: "rgba(0,0,0,0.5)", alignItems: "center", justifyContent: "center",
  },
  durationTag: {
    position: "absolute", bottom: 4, left: 4,
    backgroundColor: "rgba(0,0,0,0.65)", borderRadius: 4,
    paddingHorizontal: 4, paddingVertical: 1,
  },
  durationTagText: { fontSize: 9, fontFamily: "Inter_600SemiBold", color: "#FFF" },

  clipInfo:   { flex: 1, gap: 6 },
  clipTitle:  { fontSize: 14, fontFamily: "Inter_600SemiBold", lineHeight: 19 },
  clipMeta:   { flexDirection: "row", flexWrap: "wrap", gap: 6 },

  statusChip:  { flexDirection: "row", alignItems: "center", gap: 4, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6 },
  statusDot:   { width: 5, height: 5, borderRadius: 3 },
  statusText:  { fontSize: 10, fontFamily: "Inter_600SemiBold" },

  aspectChip:  { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 5, paddingVertical: 2, borderRadius: 5, borderWidth: 1 },
  aspectText:  { fontSize: 10, fontFamily: "Inter_400Regular" },

  viewsRow:    { flexDirection: "row", alignItems: "center", gap: 3 },
  viewsText:   { fontSize: 10, fontFamily: "Inter_400Regular" },

  hashtags:    { fontSize: 11, fontFamily: "Inter_500Medium" },

  pubPlatforms: { flexDirection: "row", alignItems: "center", gap: 4 },
  pubDot:       { width: 6, height: 6, borderRadius: 3 },
  pubText:      { fontSize: 10, fontFamily: "Inter_400Regular" },

  repostSection:  { borderTopWidth: 1, padding: 12, gap: 10 },
  platformTabs:   { flexDirection: "row", gap: 6 },
  platformTab: {
    flex: 1, paddingVertical: 6, borderRadius: 8, borderWidth: 1,
    alignItems: "center",
  },
  platformTabText: { fontSize: 11, fontFamily: "Inter_600SemiBold" },

  captionBox: { borderRadius: 10, borderWidth: 1, padding: 10, gap: 6 },
  captionBoxEmpty: { flexDirection: "row", alignItems: "center", gap: 8 },
  captionHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  captionLabel: { fontSize: 10, fontFamily: "Inter_700Bold", letterSpacing: 0.5 },
  copyBtn: { flexDirection: "row", alignItems: "center", gap: 4 },
  copyText: { fontSize: 10, fontFamily: "Inter_500Medium" },
  captionText: { fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 18 },
  captionEmptyText: { fontSize: 12, fontFamily: "Inter_400Regular" },

  repostBtns:  { gap: 8 },
  publishBtn: {
    height: 42, borderRadius: 10, flexDirection: "row",
    alignItems: "center", justifyContent: "center", gap: 7,
  },
  publishBtnDim:  { opacity: 0.4 },
  publishBtnText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },

  confChip:   { flexDirection: "row", alignItems: "center", gap: 3, paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5 },
  confText:   { fontSize: 10, fontFamily: "Inter_700Bold" },
  reviewChip: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 5 },
  reviewChipText: { fontSize: 10, fontFamily: "Inter_600SemiBold" },

  reasonRow:  { flexDirection: "row", alignItems: "flex-start", gap: 7, borderTopWidth: 1, paddingHorizontal: 12, paddingVertical: 10 },
  reasonText: { flex: 1, fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 17 },

  reviewSection: { borderTopWidth: 1, padding: 12, gap: 8 },
  reviewHeading: { fontSize: 13, fontFamily: "Inter_700Bold" },
  reviewHint:    { fontSize: 11, fontFamily: "Inter_400Regular", lineHeight: 16 },
  reviewBtns:    { flexDirection: "row", gap: 8, marginTop: 2 },
  approveBtn: {
    flex: 1, height: 40, borderRadius: 10, flexDirection: "row",
    alignItems: "center", justifyContent: "center", gap: 6,
  },
  approveText: { fontSize: 13, fontFamily: "Inter_700Bold", color: "#0A0A0A" },
  reviewSecondaryBtn: {
    height: 40, borderRadius: 10, borderWidth: 1, flexDirection: "row",
    alignItems: "center", justifyContent: "center", gap: 5, paddingHorizontal: 14,
  },
  reviewSecondaryText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },

  trimBox:   { borderRadius: 10, borderWidth: 1, padding: 12, gap: 10 },
  trimLen:   { fontSize: 11, fontFamily: "Inter_500Medium", textAlign: "center" },
  trimApplyBtn: {
    height: 38, borderRadius: 9, flexDirection: "row",
    alignItems: "center", justifyContent: "center", gap: 6,
  },
  trimApplyText: { fontSize: 12, fontFamily: "Inter_600SemiBold", color: "#FFF" },

  stepperRow:      { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  stepperLabel:    { fontSize: 12, fontFamily: "Inter_500Medium" },
  stepperControls: { flexDirection: "row", alignItems: "center", gap: 10 },
  stepperBtn:      { width: 30, height: 30, borderRadius: 8, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  stepperValue:    { fontSize: 13, fontFamily: "Inter_600SemiBold", minWidth: 52, textAlign: "center" },
  shareToChatBtn: {
    height: 40, borderRadius: 10, borderWidth: 1, flexDirection: "row",
    alignItems: "center", justifyContent: "center", gap: 7, marginTop: 8,
  },
  shareToChatText: { fontSize: 13, fontFamily: "Inter_600SemiBold" },

  processingRow: { flexDirection: "row", alignItems: "center", gap: 10, borderTopWidth: 1, padding: 12 },
  processingText: { flex: 1, fontSize: 12, fontFamily: "Inter_400Regular", lineHeight: 18 },

  emptyState:    { alignItems: "center", paddingTop: 60, gap: 12 },
  emptyTitle:    { fontSize: 18, fontFamily: "Inter_600SemiBold" },
  emptySubtitle: { fontSize: 14, fontFamily: "Inter_400Regular", textAlign: "center" },
});
