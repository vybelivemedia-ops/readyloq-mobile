/**
 * Recordings & Archive screen — creator-facing management of past stream recordings.
 *
 * Lists ended streams with a recording status badge (archived / pending / unavailable),
 * lets the creator play back archived recordings (signed playback URL via expo-video),
 * download recordings to the device photo library, rename a recording, and delete it
 * (removes the recording file + associated clips).
 */

import { Feather } from "@expo/vector-icons";
import * as FileSystem from "expo-file-system/legacy";
import * as Haptics from "expo-haptics";
import type * as MediaLibraryType from "expo-media-library";

// Lazy-load so a missing native module (Expo Go, or build without the plugin)
// does not crash the screen at import time.  The plugin registers the native
// module in production APKs; this guard is a defence-in-depth safety net.
let MediaLibrary: typeof MediaLibraryType | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  MediaLibrary = require("expo-media-library") as typeof MediaLibraryType;
} catch {
  // Native module unavailable — Save-to-library calls will surface a clear error.
}
import { router } from "expo-router";
import { useFocusEffect } from "expo-router/build/useFocusEffect";
import { useVideoPlayer, VideoView } from "expo-video";
import React, { useCallback, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQueryClient } from "@tanstack/react-query";

import { useColors } from "@/hooks/useColors";
import {
  useListStreamRecordings,
  useUpdateStream,
  useDeleteStream,
  getStreamRecordingPlayUrl,
  getListStreamRecordingsQueryKey,
} from "@workspace/api-client-react";
import type { RecordingSummary, RecordingStatus } from "@workspace/api-client-react";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDuration(sec: number): string {
  if (!sec || sec <= 0) return "0:00";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.round(sec % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

const STATUS_META: Record<
  RecordingStatus,
  { label: string; color: string; icon: React.ComponentProps<typeof Feather>["name"] }
> = {
  archived: { label: "Archived", color: "#39FF14", icon: "check-circle" },
  pending: { label: "Finalizing", color: "#FFD700", icon: "clock" },
  unavailable: { label: "No Recording", color: "#5C5C7A", icon: "slash" },
  failed: { label: "Recording Failed", color: "#FF3B6C", icon: "alert-triangle" },
};

function getErrorMessage(err: unknown): string {
  const blocker = (err as { response?: { data?: { blocker?: string; error?: string } } })?.response
    ?.data;
  if (blocker?.error) return blocker.error;
  return err instanceof Error ? err.message : "Something went wrong";
}

// Sanitise a recording title into a safe filename.
function safeFilename(title: string): string {
  return title.replace(/[^a-zA-Z0-9_\-]/g, "_").slice(0, 80) || "recording";
}

interface SaveResult {
  title: string;
  message: string;
}

// Above this size, copying into Downloads via SAF (which requires reading the
// whole file as a Base64 string in JS) risks an out-of-memory crash, so we save
// such recordings to the gallery instead — MediaLibrary streams natively.
const MAX_SAF_COPY_BYTES = 200 * 1024 * 1024; // 200 MB

// Save a downloaded recording into the device's photo library (Movies),
// grouped under a "VYBE LIVE" album. Used on iOS, and as the Android fallback
// when the user declines the Downloads-folder picker.
async function saveToPhotoLibrary(localUri: string): Promise<void> {
  if (!MediaLibrary) {
    throw new Error("Photo library is not available on this device.");
  }
  const { status } = await MediaLibrary.requestPermissionsAsync(true);
  if (status !== "granted") {
    throw new Error("Permission to save to your photo library was denied.");
  }
  const asset = await MediaLibrary.createAssetAsync(localUri);
  // Best-effort: group saved recordings under a "VYBE LIVE" album.
  try {
    let album = await MediaLibrary.getAlbumAsync("VYBE LIVE");
    if (!album) {
      album = await MediaLibrary.createAlbumAsync("VYBE LIVE", asset, false);
    } else {
      await MediaLibrary.addAssetsToAlbumAsync([asset], album, false);
    }
  } catch {
    // Album placement is best-effort — the asset is already in the library.
  }
}

// Save into the Android Downloads folder via the Storage Access Framework.
// The picker opens at Downloads by default; the user can confirm or choose
// another folder. If they cancel, we fall back to the photo library so the
// download is never lost.
async function saveToDownloadsAndroid(
  localUri: string,
  baseName: string,
  displayTitle: string
): Promise<SaveResult> {
  const initialUri = FileSystem.StorageAccessFramework.getUriForDirectoryInRoot("Download");
  const perm = await FileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync(initialUri);

  if (!perm.granted) {
    // User dismissed the folder picker — keep the file by saving to the gallery.
    await saveToPhotoLibrary(localUri);
    return {
      title: "Saved to Gallery",
      message: `"${displayTitle}" was saved to your photo library (Movies › VYBE LIVE).`,
    };
  }

  // Large files can't be safely Base64-copied into Downloads — save to gallery.
  const info = await FileSystem.getInfoAsync(localUri);
  if (info.exists && info.size > MAX_SAF_COPY_BYTES) {
    await saveToPhotoLibrary(localUri);
    return {
      title: "Saved to Gallery",
      message: `"${displayTitle}" is too large to copy into Downloads, so it was saved to your photo library (Movies › VYBE LIVE).`,
    };
  }

  const destUri = await FileSystem.StorageAccessFramework.createFileAsync(
    perm.directoryUri,
    baseName, // SAF appends the extension from the MIME type
    "video/mp4"
  );
  const base64 = await FileSystem.readAsStringAsync(localUri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  await FileSystem.writeAsStringAsync(destUri, base64, {
    encoding: FileSystem.EncodingType.Base64,
  });

  return {
    title: "Saved to Device",
    message: `"${displayTitle}" was saved to the folder you selected (Downloads by default).`,
  };
}

// Persist a freshly downloaded recording to user-visible device storage.
// Android → Downloads (SAF); iOS → photo library.
async function persistToDevice(
  localUri: string,
  baseName: string,
  displayTitle: string
): Promise<SaveResult> {
  if (Platform.OS === "android") {
    return saveToDownloadsAndroid(localUri, baseName, displayTitle);
  }
  await saveToPhotoLibrary(localUri);
  return {
    title: "Saved to Photos",
    message: `"${displayTitle}" has been saved to your photo library.`,
  };
}

// ─── Playback modal ────────────────────────────────────────────────────────────

interface PlayerModalProps {
  url: string;
  title: string;
  onClose: () => void;
}

function PlayerModal({ url, title, onClose }: PlayerModalProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const player = useVideoPlayer(url, (p) => {
    p.loop = false;
    p.play();
  });

  return (
    <Modal visible animationType="slide" onRequestClose={onClose} presentationStyle="fullScreen">
      <View style={[styles.playerContainer, { backgroundColor: "#000", paddingTop: insets.top }]}>
        <View style={styles.playerHeader}>
          <TouchableOpacity onPress={onClose} style={styles.playerClose} hitSlop={12}>
            <Feather name="x" size={26} color="#FFF" />
          </TouchableOpacity>
          <Text style={[styles.playerTitle, { color: "#FFF" }]} numberOfLines={1}>
            {title}
          </Text>
          <View style={{ width: 40 }} />
        </View>
        <VideoView
          style={styles.player}
          player={player}
          contentFit="contain"
          nativeControls
          allowsFullscreen
        />
      </View>
    </Modal>
  );
}

// ─── Download progress modal ──────────────────────────────────────────────────

interface DownloadProgressProps {
  title: string;
  progress: number;
  onCancel: () => void;
}

function DownloadProgressModal({ title, progress, onCancel }: DownloadProgressProps) {
  const colors = useColors();
  const pct = Math.round(progress * 100);

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.modalOverlay}>
        <View style={[styles.modalCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
            <ActivityIndicator size="small" color={colors.primary} />
            <Text style={[styles.modalTitle, { color: colors.foreground, flex: 1 }]} numberOfLines={1}>
              Downloading…
            </Text>
          </View>
          <Text style={[{ color: colors.mutedForeground, fontSize: 13 }]} numberOfLines={1}>
            {title}
          </Text>
          <View style={[styles.progressTrack, { backgroundColor: colors.muted }]}>
            <View
              style={[
                styles.progressFill,
                { backgroundColor: colors.primary, width: `${pct}%` as unknown as number },
              ]}
            />
          </View>
          <Text style={[{ color: colors.mutedForeground, fontSize: 12, textAlign: "center" }]}>
            {pct}%
          </Text>
          <TouchableOpacity
            onPress={onCancel}
            style={[styles.modalBtn, { backgroundColor: colors.muted }]}
          >
            <Text style={[styles.modalBtnText, { color: colors.foreground }]}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

// ─── Recording card ─────────────────────────────────────────────────────────────

interface RecordingCardProps {
  item: RecordingSummary;
  onPlay: (item: RecordingSummary) => void;
  onDownload: (item: RecordingSummary) => void;
  onRename: (item: RecordingSummary) => void;
  onDelete: (item: RecordingSummary) => void;
  playLoading: boolean;
  downloadLoading: boolean;
  deleteLoading: boolean;
}

function RecordingCard({
  item,
  onPlay,
  onDownload,
  onRename,
  onDelete,
  playLoading,
  downloadLoading,
  deleteLoading,
}: RecordingCardProps) {
  const colors = useColors();
  const meta = STATUS_META[item.status];
  const canPlay = item.status === "archived";

  return (
    <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border }]}>
      {item.thumbnailUrl ? (
        <Image
          source={{ uri: item.thumbnailUrl }}
          style={[styles.thumb, { backgroundColor: colors.muted }]}
          resizeMode="cover"
        />
      ) : (
        <View style={[styles.thumb, styles.thumbFallback, { backgroundColor: colors.muted }]}>
          <Feather name="film" size={22} color={colors.mutedForeground} />
        </View>
      )}

      <View style={styles.cardHeader}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.cardTitle, { color: colors.foreground }]} numberOfLines={1}>
            {item.title}
          </Text>
          <Text style={[styles.cardMeta, { color: colors.mutedForeground }]}>
            {formatDate(item.endedAt ?? item.createdAt)} · {formatDuration(item.durationSeconds)}
            {item.clipsCount > 0 ? ` · ${item.clipsCount} clip${item.clipsCount === 1 ? "" : "s"}` : ""}
          </Text>
        </View>
        <View style={[styles.badge, { backgroundColor: meta.color + "22" }]}>
          <Feather name={meta.icon} size={12} color={meta.color} />
          <Text style={[styles.badgeText, { color: meta.color }]}>{meta.label}</Text>
        </View>
      </View>

      {item.status === "failed" && item.recordingError ? (
        <Text style={[styles.cardError, { color: "#FF3B6C" }]}>{item.recordingError}</Text>
      ) : null}

      <View style={styles.cardActions}>
        <TouchableOpacity
          onPress={() => onPlay(item)}
          disabled={!canPlay || playLoading}
          style={[
            styles.actionBtn,
            {
              backgroundColor: canPlay ? colors.primary : colors.muted,
              opacity: canPlay ? 1 : 0.5,
            },
          ]}
        >
          {playLoading ? (
            <ActivityIndicator size="small" color={colors.primaryForeground} />
          ) : (
            <>
              <Feather name="play" size={14} color={canPlay ? colors.primaryForeground : colors.mutedForeground} />
              <Text
                style={[
                  styles.actionText,
                  { color: canPlay ? colors.primaryForeground : colors.mutedForeground },
                ]}
              >
                Play
              </Text>
            </>
          )}
        </TouchableOpacity>

        {/* Download to device */}
        <TouchableOpacity
          onPress={() => onDownload(item)}
          disabled={!canPlay || downloadLoading}
          style={[
            styles.iconBtn,
            {
              backgroundColor: canPlay ? colors.primary + "22" : colors.muted,
              opacity: canPlay ? 1 : 0.4,
            },
          ]}
        >
          {downloadLoading ? (
            <ActivityIndicator size="small" color={colors.primary} />
          ) : (
            <Feather name="download" size={15} color={canPlay ? colors.primary : colors.mutedForeground} />
          )}
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => onRename(item)}
          style={[styles.iconBtn, { backgroundColor: colors.muted }]}
        >
          <Feather name="edit-2" size={15} color={colors.foreground} />
        </TouchableOpacity>

        <TouchableOpacity
          onPress={() => onDelete(item)}
          disabled={deleteLoading}
          style={[styles.iconBtn, { backgroundColor: colors.destructive + "22" }]}
        >
          {deleteLoading ? (
            <ActivityIndicator size="small" color={colors.destructive} />
          ) : (
            <Feather name="trash-2" size={15} color={colors.destructive} />
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ─── Rename modal ────────────────────────────────────────────────────────────

interface RenameModalProps {
  item: RecordingSummary;
  saving: boolean;
  onCancel: () => void;
  onSave: (title: string) => void;
}

function RenameModal({ item, saving, onCancel, onSave }: RenameModalProps) {
  const colors = useColors();
  const [title, setTitle] = useState(item.title);
  const trimmed = title.trim();

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.modalOverlay}>
        <View style={[styles.modalCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Text style={[styles.modalTitle, { color: colors.foreground }]}>Rename Recording</Text>
          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder="Recording title"
            placeholderTextColor={colors.mutedForeground}
            style={[
              styles.input,
              { backgroundColor: colors.input, color: colors.foreground, borderColor: colors.border },
            ]}
            autoFocus
            maxLength={120}
          />
          <View style={styles.modalActions}>
            <TouchableOpacity
              onPress={onCancel}
              style={[styles.modalBtn, { backgroundColor: colors.muted }]}
            >
              <Text style={[styles.modalBtnText, { color: colors.foreground }]}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => onSave(trimmed)}
              disabled={saving || trimmed.length === 0}
              style={[
                styles.modalBtn,
                { backgroundColor: colors.primary, opacity: saving || trimmed.length === 0 ? 0.5 : 1 },
              ]}
            >
              {saving ? (
                <ActivityIndicator size="small" color={colors.primaryForeground} />
              ) : (
                <Text style={[styles.modalBtnText, { color: colors.primaryForeground }]}>Save</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ─── Screen ────────────────────────────────────────────────────────────────────

export default function RecordingsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const topPad = Platform.OS === "web" ? 67 : insets.top;

  const { data, isLoading, refetch } = useListStreamRecordings({ limit: 50 });
  const updateStream = useUpdateStream();
  const deleteStream = useDeleteStream();

  const [refreshing, setRefreshing] = useState(false);
  const [playerState, setPlayerState] = useState<{ url: string; title: string } | null>(null);
  const [playLoadingId, setPlayLoadingId] = useState<string | null>(null);
  const [renameItem, setRenameItem] = useState<RecordingSummary | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Download state
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloadTitle, setDownloadTitle] = useState("");
  const [downloadProgress, setDownloadProgress] = useState(0);
  const downloadResumableRef = React.useRef<FileSystem.DownloadResumable | null>(null);
  const cancellingRef = React.useRef(false);

  useFocusEffect(
    useCallback(() => {
      refetch();
    }, [refetch])
  );

  const invalidate = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: getListStreamRecordingsQueryKey() });
  }, [queryClient]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  }, [refetch]);

  const handlePlay = useCallback(async (item: RecordingSummary) => {
    setPlayLoadingId(item.streamId);
    try {
      const res = await getStreamRecordingPlayUrl(item.streamId);
      setPlayerState({ url: res.url, title: item.title });
    } catch (err) {
      Alert.alert("Cannot play recording", getErrorMessage(err));
    } finally {
      setPlayLoadingId(null);
    }
  }, []);

  const handleDownload = useCallback(async (item: RecordingSummary) => {
    if (Platform.OS === "web") {
      Alert.alert("Not supported", "Download to device is only available on iOS and Android.");
      return;
    }

    // Fetch a fresh signed URL for the download
    let signedUrl: string;
    try {
      const res = await getStreamRecordingPlayUrl(item.streamId);
      signedUrl = res.url;
    } catch (err) {
      Alert.alert("Download failed", getErrorMessage(err));
      return;
    }

    const baseName = `${safeFilename(item.title)}_${item.streamId.slice(0, 8)}`;
    const localUri = `${FileSystem.cacheDirectory}${baseName}.mp4`;

    cancellingRef.current = false;
    setDownloadingId(item.streamId);
    setDownloadTitle(item.title);
    setDownloadProgress(0);

    const resumable = FileSystem.createDownloadResumable(
      signedUrl,
      localUri,
      {},
      (progressEvent) => {
        const { totalBytesWritten, totalBytesExpectedToWrite } = progressEvent;
        if (totalBytesExpectedToWrite > 0) {
          setDownloadProgress(totalBytesWritten / totalBytesExpectedToWrite);
        }
      }
    );
    downloadResumableRef.current = resumable;

    try {
      const result = await resumable.downloadAsync();
      if (!result?.uri) throw new Error("Download did not complete");

      // Persist to user-visible device storage (Android Downloads / iOS Photos).
      const saved = await persistToDevice(result.uri, baseName, item.title);

      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      Alert.alert(saved.title, saved.message);
    } catch (err) {
      // Suppress failure alerts for an explicit user cancellation.
      if (!cancellingRef.current) {
        const msg = err instanceof Error ? err.message : "Download failed";
        Alert.alert("Download failed", msg);
      }
    } finally {
      // Clean up the temp file regardless of outcome
      try { await FileSystem.deleteAsync(localUri, { idempotent: true }); } catch { /* ignore */ }
      downloadResumableRef.current = null;
      cancellingRef.current = false;
      setDownloadingId(null);
      setDownloadProgress(0);
      setDownloadTitle("");
    }
  }, []);

  const handleCancelDownload = useCallback(async () => {
    cancellingRef.current = true;
    try {
      await downloadResumableRef.current?.pauseAsync();
    } catch { /* ignore */ }
    downloadResumableRef.current = null;
    setDownloadingId(null);
    setDownloadProgress(0);
    setDownloadTitle("");
  }, []);

  const handleRenameSave = useCallback(
    async (title: string) => {
      if (!renameItem) return;
      try {
        await updateStream.mutateAsync({ streamId: renameItem.streamId, data: { title } });
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
        setRenameItem(null);
        invalidate();
      } catch (err) {
        Alert.alert("Rename failed", getErrorMessage(err));
      }
    },
    [renameItem, updateStream, invalidate]
  );

  const handleDelete = useCallback(
    (item: RecordingSummary) => {
      Alert.alert(
        "Delete recording?",
        item.clipsCount > 0
          ? `This permanently deletes the recording and its ${item.clipsCount} clip${item.clipsCount === 1 ? "" : "s"}. This cannot be undone.`
          : "This permanently deletes the recording. This cannot be undone.",
        [
          { text: "Cancel", style: "cancel" },
          {
            text: "Delete",
            style: "destructive",
            onPress: async () => {
              setDeletingId(item.streamId);
              try {
                await deleteStream.mutateAsync({ streamId: item.streamId });
                Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
                invalidate();
              } catch (err) {
                Alert.alert("Delete failed", getErrorMessage(err));
              } finally {
                setDeletingId(null);
              }
            },
          },
        ]
      );
    },
    [deleteStream, invalidate]
  );

  const items = data?.items ?? [];

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <ScrollView
        contentContainerStyle={[styles.content, { paddingTop: topPad + 16, paddingBottom: 40 }]}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} />
        }
      >
        {/* Header */}
        <View style={styles.topBar}>
          <TouchableOpacity onPress={() => router.back()} style={styles.backBtn}>
            <Feather name="arrow-left" size={22} color={colors.foreground} />
          </TouchableOpacity>
          <Text style={[styles.title, { color: colors.foreground }]}>Recordings & Archive</Text>
          <View style={{ width: 40 }} />
        </View>

        <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
          Browse, play back, download, rename, and delete your past stream recordings.
        </Text>

        {isLoading ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator size="large" color={colors.primary} />
          </View>
        ) : items.length === 0 ? (
          <View style={styles.emptyWrap}>
            <Feather name="film" size={40} color={colors.mutedForeground} />
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>No recordings yet</Text>
            <Text style={[styles.emptyText, { color: colors.mutedForeground }]}>
              When you end a stream, its recording will appear here.
            </Text>
          </View>
        ) : (
          <View style={styles.list}>
            {items.map((item) => (
              <RecordingCard
                key={item.streamId}
                item={item}
                onPlay={handlePlay}
                onDownload={handleDownload}
                onRename={setRenameItem}
                onDelete={handleDelete}
                playLoading={playLoadingId === item.streamId}
                downloadLoading={downloadingId === item.streamId}
                deleteLoading={deletingId === item.streamId}
              />
            ))}
          </View>
        )}
      </ScrollView>

      {playerState && (
        <PlayerModal
          url={playerState.url}
          title={playerState.title}
          onClose={() => setPlayerState(null)}
        />
      )}

      {renameItem && (
        <RenameModal
          item={renameItem}
          saving={updateStream.isPending}
          onCancel={() => setRenameItem(null)}
          onSave={handleRenameSave}
        />
      )}

      {downloadingId && (
        <DownloadProgressModal
          title={downloadTitle}
          progress={downloadProgress}
          onCancel={handleCancelDownload}
        />
      )}
    </View>
  );
}

// ─── Styles ─────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { paddingHorizontal: 16 },
  topBar: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  backBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 18, fontWeight: "700" },
  subtitle: { fontSize: 13, marginTop: 8, marginBottom: 20, lineHeight: 18 },
  loadingWrap: { paddingVertical: 60, alignItems: "center" },
  emptyWrap: { paddingVertical: 60, alignItems: "center", gap: 10 },
  emptyTitle: { fontSize: 16, fontWeight: "600", marginTop: 6 },
  emptyText: { fontSize: 13, textAlign: "center", paddingHorizontal: 30, lineHeight: 18 },
  list: { gap: 12 },
  card: { borderRadius: 16, borderWidth: 1, padding: 14, gap: 14 },
  thumb: { width: "100%", aspectRatio: 16 / 9, borderRadius: 12 },
  thumbFallback: { alignItems: "center", justifyContent: "center" },
  cardHeader: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  cardTitle: { fontSize: 15, fontWeight: "600" },
  cardMeta: { fontSize: 12, marginTop: 4 },
  cardError: { fontSize: 12, marginTop: 8, lineHeight: 17 },
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  badgeText: { fontSize: 11, fontWeight: "600" },
  cardActions: { flexDirection: "row", alignItems: "center", gap: 10 },
  actionBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    height: 40,
    borderRadius: 10,
  },
  actionText: { fontSize: 14, fontWeight: "600" },
  iconBtn: { width: 40, height: 40, alignItems: "center", justifyContent: "center", borderRadius: 10 },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  modalCard: { width: "100%", borderRadius: 16, borderWidth: 1, padding: 20, gap: 16 },
  modalTitle: { fontSize: 16, fontWeight: "700" },
  input: { height: 46, borderRadius: 10, borderWidth: 1, paddingHorizontal: 14, fontSize: 15 },
  modalActions: { flexDirection: "row", gap: 12 },
  modalBtn: { flex: 1, height: 44, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  modalBtnText: { fontSize: 15, fontWeight: "600" },
  progressTrack: { height: 6, borderRadius: 3, overflow: "hidden" },
  progressFill: { height: 6, borderRadius: 3 },
  playerContainer: { flex: 1 },
  playerHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  playerClose: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  playerTitle: { flex: 1, fontSize: 16, fontWeight: "600", textAlign: "center" },
  player: { flex: 1, width: "100%" },
});
