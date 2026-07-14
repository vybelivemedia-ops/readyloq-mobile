/**
 * StreamActionSheet — long-press action sheet for a creator's own stream cards.
 *
 * Controlled by a `stream` prop (null = hidden). Exposes the six management
 * actions: Save Recording, Rename Stream, Generate AI Clips, Share Stream,
 * Delete Stream, and Cancel. Delete is confirmed first; rename reuses
 * useUpdateStream; AI clips reuse useGenerateClips; share uses the native
 * share sheet. All list queries are invalidated after mutations so the UI
 * updates immediately.
 */

import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { router } from "expo-router";
import React, { useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  Share,
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
  useUpdateStream,
  useDeleteStream,
  useGenerateClips,
} from "@workspace/api-client-react";
import type { Stream } from "@workspace/api-client-react";

interface StreamActionSheetProps {
  stream: Stream | null;
  onClose: () => void;
}

function getClipErrorMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : "Unknown error";
  const blocker = (err as { response?: { data?: { blocker?: string } } })?.response?.data?.blocker;
  if (blocker === "NO_RECORDING")
    return "This stream has no recording. End the stream and upload a recording first.";
  if (blocker === "AI_NOT_CONFIGURED")
    return "AI generation is not configured on this server.";
  if (blocker === "STORAGE_NOT_CONFIGURED")
    return "Storage is not configured. Contact support.";
  return `Failed to start clip extraction: ${msg}`;
}

export function StreamActionSheet({ stream, onClose }: StreamActionSheetProps) {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();

  const [mode, setMode] = useState<"menu" | "rename">("menu");
  const [renameValue, setRenameValue] = useState("");

  const updateStream = useUpdateStream();
  const deleteStream = useDeleteStream();
  const generateClips = useGenerateClips();

  const visible = stream !== null;

  // Reset transient state whenever a new stream is opened/closed.
  useEffect(() => {
    if (stream) {
      setMode("menu");
      setRenameValue(stream.title);
    }
  }, [stream]);

  const invalidateStreamLists = () => {
    void queryClient.invalidateQueries({ queryKey: ["/api/streams"] });
    void queryClient.invalidateQueries({ queryKey: ["/api/streams/recordings"] });
  };

  const handleSaveRecording = () => {
    onClose();
    router.push("/recordings");
  };

  const handleStartRename = () => {
    Haptics.selectionAsync();
    setMode("rename");
  };

  const handleConfirmRename = async () => {
    if (!stream) return;
    const title = renameValue.trim();
    if (!title || title === stream.title) {
      setMode("menu");
      return;
    }
    try {
      await updateStream.mutateAsync({ streamId: stream.id, data: { title } });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      invalidateStreamLists();
      onClose();
    } catch (err: unknown) {
      Alert.alert("Rename Failed", err instanceof Error ? err.message : "Something went wrong");
    }
  };

  const handleGenerateClips = async () => {
    if (!stream) return;
    try {
      await generateClips.mutateAsync({
        streamId: stream.id,
        data: { maxClips: 3, clipDurationSeconds: 30 },
      });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      invalidateStreamLists();
      onClose();
      Alert.alert(
        "Generating Clips",
        "AI is extracting highlight clips from this stream. They'll appear in your Clips tab shortly.",
        [
          { text: "OK" },
          { text: "View Clips", onPress: () => router.push("/(tabs)/clips") },
        ],
      );
    } catch (err: unknown) {
      Alert.alert("Cannot Generate Clips", getClipErrorMessage(err));
    }
  };

  const handleShare = async () => {
    if (!stream) return;
    onClose();
    try {
      await Share.share({
        message: `Check out my stream "${stream.title}" on VYBE LIVE`,
      });
    } catch {
      // User dismissed the share sheet — nothing to do.
    }
  };

  const handleDelete = () => {
    if (!stream) return;
    const target = stream;
    Alert.alert(
      "Delete Stream",
      `"${target.title}" and its recording and generated clips will be permanently deleted. This cannot be undone.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: async () => {
            try {
              await deleteStream.mutateAsync({ streamId: target.id });
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              invalidateStreamLists();
              onClose();
            } catch (err: unknown) {
              Alert.alert(
                "Delete Failed",
                err instanceof Error ? err.message : "Something went wrong",
              );
            }
          },
        },
      ],
    );
  };

  const actions: {
    key: string;
    label: string;
    icon: React.ComponentProps<typeof Feather>["name"];
    onPress: () => void;
    destructive?: boolean;
  }[] = [
    { key: "save", label: "Save Recording", icon: "download", onPress: handleSaveRecording },
    { key: "rename", label: "Rename Stream", icon: "edit-2", onPress: handleStartRename },
    { key: "clips", label: "Generate AI Clips", icon: "zap", onPress: handleGenerateClips },
    { key: "share", label: "Share Stream", icon: "share-2", onPress: handleShare },
    { key: "delete", label: "Delete Stream", icon: "trash-2", onPress: handleDelete, destructive: true },
  ];

  const busy = generateClips.isPending;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <Pressable style={styles.backdrop} onPress={busy ? undefined : onClose}>
        <Pressable
          style={[
            styles.sheet,
            {
              backgroundColor: colors.background,
              borderColor: colors.border,
              paddingBottom: insets.bottom + 12,
            },
          ]}
          onPress={(e) => e.stopPropagation()}
        >
          <View style={[styles.grabber, { backgroundColor: colors.border }]} />

          {stream && (
            <Text style={[styles.sheetTitle, { color: colors.foreground }]} numberOfLines={1}>
              {stream.title}
            </Text>
          )}

          {mode === "menu" ? (
            <>
              {actions.map((a) => {
                const tint = a.destructive ? colors.destructive : colors.foreground;
                const isClipsBusy = a.key === "clips" && busy;
                return (
                  <TouchableOpacity
                    key={a.key}
                    onPress={a.onPress}
                    disabled={busy}
                    activeOpacity={0.7}
                    style={[styles.row, { borderColor: colors.border }, busy && styles.rowDisabled]}
                  >
                    {isClipsBusy ? (
                      <ActivityIndicator size="small" color={colors.primary} />
                    ) : (
                      <Feather name={a.icon} size={20} color={tint} />
                    )}
                    <Text style={[styles.rowLabel, { color: tint }]}>{a.label}</Text>
                  </TouchableOpacity>
                );
              })}

              <TouchableOpacity
                onPress={onClose}
                disabled={busy}
                activeOpacity={0.7}
                style={[styles.cancelRow, { backgroundColor: colors.card, borderColor: colors.border }]}
              >
                <Text style={[styles.cancelLabel, { color: colors.foreground }]}>Cancel</Text>
              </TouchableOpacity>
            </>
          ) : (
            <View style={styles.renameWrap}>
              <Text style={[styles.renameLabel, { color: colors.mutedForeground }]}>
                Stream title
              </Text>
              <TextInput
                value={renameValue}
                onChangeText={setRenameValue}
                placeholder="Stream title"
                placeholderTextColor={colors.mutedForeground}
                maxLength={100}
                autoFocus
                style={[
                  styles.input,
                  { color: colors.foreground, backgroundColor: colors.card, borderColor: colors.border },
                ]}
              />
              <View style={styles.renameBtns}>
                <TouchableOpacity
                  onPress={() => setMode("menu")}
                  disabled={updateStream.isPending}
                  style={[styles.renameCancel, { borderColor: colors.border }]}
                >
                  <Text style={[styles.renameCancelText, { color: colors.mutedForeground }]}>
                    Back
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handleConfirmRename}
                  disabled={updateStream.isPending || !renameValue.trim()}
                  style={[
                    styles.renameSave,
                    { backgroundColor: colors.primary },
                    (updateStream.isPending || !renameValue.trim()) && styles.rowDisabled,
                  ]}
                  activeOpacity={0.8}
                >
                  {updateStream.isPending ? (
                    <ActivityIndicator size="small" color="#FFF" />
                  ) : (
                    <Text style={styles.renameSaveText}>Save</Text>
                  )}
                </TouchableOpacity>
              </View>
            </View>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "flex-end",
  },
  sheet: {
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderWidth: 1,
    paddingHorizontal: 16,
    paddingTop: 10,
    gap: 8,
  },
  grabber: {
    width: 38,
    height: 4,
    borderRadius: 2,
    alignSelf: "center",
    marginBottom: 8,
  },
  sheetTitle: {
    fontSize: 15,
    fontFamily: "Inter_600SemiBold",
    textAlign: "center",
    marginBottom: 6,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    paddingVertical: 15,
    paddingHorizontal: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  rowDisabled: { opacity: 0.5 },
  rowLabel: { fontSize: 16, fontFamily: "Inter_500Medium" },
  cancelRow: {
    marginTop: 8,
    height: 50,
    borderRadius: 14,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  cancelLabel: { fontSize: 16, fontFamily: "Inter_600SemiBold" },
  renameWrap: { gap: 10, paddingTop: 4 },
  renameLabel: {
    fontSize: 12,
    fontFamily: "Inter_600SemiBold",
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  input: {
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    fontSize: 15,
    fontFamily: "Inter_500Medium",
  },
  renameBtns: { flexDirection: "row", gap: 10, marginTop: 4 },
  renameCancel: {
    flex: 1,
    height: 48,
    borderRadius: 12,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  renameCancelText: { fontSize: 15, fontFamily: "Inter_500Medium" },
  renameSave: {
    flex: 2,
    height: 48,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  renameSaveText: { color: "#FFF", fontSize: 15, fontFamily: "Inter_600SemiBold" },
});
