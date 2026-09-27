import { useAuth } from "@clerk/expo";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Screen } from "@/components/ui/Screen";
import { useColors } from "@/hooks/useColors";
import {
  API_BASE,
  ApiError,
  BulkIngestMetadata,
  bulkIngestDataset,
  requestUploadUrl,
} from "@/lib/api";

// ── Taxonomy (mirrors INTELLIGENCE_TAXONOMY from the server) ──────────────────
const CATEGORIES = [
  { slug: "pest", label: "Pest", icon: "bug-outline" as const },
  { slug: "pest_evidence", label: "Pest Evidence", icon: "paw-outline" as const },
  { slug: "conducive_condition", label: "Conducive Condition", icon: "water-outline" as const },
  { slug: "entry_point", label: "Entry Point", icon: "enter-outline" as const },
  { slug: "structural_deficiency", label: "Structural Deficiency", icon: "construct-outline" as const },
  { slug: "treatment_verification", label: "Treatment Verification", icon: "checkmark-done-outline" as const },
] as const;

const SEVERITIES = [
  { value: "low", label: "Low", color: "#22c55e" },
  { value: "moderate", label: "Moderate", color: "#f59e0b" },
  { value: "high", label: "High", color: "#f97316" },
  { value: "critical", label: "Critical", color: "#ef4444" },
] as const;

type Phase = "compose" | "uploading" | "done";

interface UploadResult {
  created: number;
  failed: number;
}

// No hard limit exists elsewhere in the app for uploaded media size — this is
// a friendly, client-side-only guard so a technician doesn't sit through a
// multi-minute upload on cellular data before finding out it failed. It does
// not touch the shared presigned-upload endpoint, which stays unrestricted.
const MAX_VIDEO_BYTES = 250 * 1024 * 1024; // 250 MB

function isVideoAsset(asset: ImagePicker.ImagePickerAsset) {
  return asset.type === "video" || (asset.mimeType?.startsWith("video/") ?? false);
}

function formatDuration(ms: number | null | undefined) {
  if (!ms || ms <= 0) return null;
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export default function BulkUploadScreen() {
  const colors = useColors();
  const router = useRouter();
  const { getToken } = useAuth();

  // ── Selected media (photos and/or videos) ───────────────────────────────────
  const [assets, setAssets] = useState<ImagePicker.ImagePickerAsset[]>([]);

  // ── Metadata form ───────────────────────────────────────────────────────────
  const [category, setCategory] = useState("");
  const [possiblePest, setPossiblePest] = useState("");
  const [conduciveCondition, setConduciveCondition] = useState("");
  const [entryPoint, setEntryPoint] = useState("");
  const [severity, setSeverity] = useState<BulkIngestMetadata["severity"] | "">("");
  const [locationType, setLocationType] = useState("");
  const [notes, setNotes] = useState("");

  // ── Upload state ────────────────────────────────────────────────────────────
  const [phase, setPhase] = useState<Phase>("compose");
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [result, setResult] = useState<UploadResult | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const pickMedia = async () => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Permission required", "Please allow access to your photo library to upload training photos and videos.");
      return;
    }
    const picked = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images", "videos"],
      allowsMultipleSelection: true,
      quality: 0.85,
      exif: false,
    });
    if (!picked.canceled && picked.assets.length > 0) {
      const oversizedVideos = picked.assets.filter(
        (a) => isVideoAsset(a) && (a.fileSize ?? 0) > MAX_VIDEO_BYTES,
      ).length;
      const withinLimit = picked.assets.filter(
        (a) => !isVideoAsset(a) || (a.fileSize ?? 0) <= MAX_VIDEO_BYTES,
      );
      if (oversizedVideos > 0) {
        Alert.alert(
          "Video too large",
          `${oversizedVideos} video${oversizedVideos !== 1 ? "s were" : " was"} skipped for exceeding the 250 MB limit.`,
        );
      }
      setAssets((prev) => {
        const combined = [...prev, ...withinLimit];
        // Cap at 50 per batch
        return combined.slice(0, 50);
      });
    }
  };

  const removeAsset = (index: number) => {
    setAssets((prev) => prev.filter((_, i) => i !== index));
  };

  const canUpload = assets.length > 0 && category.length > 0;

  const handleUpload = async () => {
    if (!canUpload) return;
    setPhase("uploading");
    setProgress({ done: 0, total: assets.length });
    setUploadError(null);

    const token = await getToken();
    const uploadedItems: Array<{ objectPath: string; filename: string; mediaType: "photo" | "video" }> = [];
    let failedCount = 0;

    for (let i = 0; i < assets.length; i++) {
      const asset = assets[i];
      const isVideo = isVideoAsset(asset);
      try {
        // Step 1: Request a presigned PUT URL from the server.
        const filename = asset.fileName ?? (isVideo ? `video_${i + 1}.mp4` : `photo_${i + 1}.jpg`);
        const contentType = asset.mimeType ?? (isVideo ? "video/mp4" : "image/jpeg");
        const { uploadURL, objectPath } = await requestUploadUrl(token, {
          name: filename,
          size: asset.fileSize,
          contentType,
        });

        // Step 2: Read the local file as a Blob, then PUT directly to GCS
        // via the presigned URL. fetch() handles file:// URIs natively in
        // React Native (Hermes), making this the most portable upload path
        // for both photos and videos.
        const fileResponse = await fetch(asset.uri);
        const blob = await fileResponse.blob();
        const putResponse = await fetch(uploadURL, {
          method: "PUT",
          body: blob,
          headers: { "Content-Type": contentType },
        });

        if (putResponse.ok) {
          uploadedItems.push({ objectPath, filename, mediaType: isVideo ? "video" : "photo" });
        } else {
          failedCount++;
        }
      } catch {
        failedCount++;
      }
      setProgress({ done: i + 1, total: assets.length });
    }

    if (uploadedItems.length === 0) {
      setUploadError("All uploads failed. Check your connection and try again.");
      setPhase("compose");
      return;
    }

    // Step 3: Register all successfully-uploaded media into the training dataset.
    try {
      const meta: BulkIngestMetadata = {
        category,
        ...(possiblePest.trim() ? { possiblePest: possiblePest.trim() } : {}),
        ...(conduciveCondition.trim() ? { possibleConduciveCondition: conduciveCondition.trim() } : {}),
        ...(entryPoint.trim() ? { possibleEntryPoint: entryPoint.trim() } : {}),
        ...(severity ? { severity } : {}),
        ...(locationType.trim() ? { locationType: locationType.trim() } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      };
      const ingestResult = await bulkIngestDataset(token, uploadedItems, meta);
      setResult({
        created: ingestResult.created,
        failed: failedCount + ingestResult.failed,
      });
    } catch (e) {
      setResult({
        created: uploadedItems.length,
        failed: failedCount,
      });
      setUploadError(e instanceof ApiError ? e.message : "Failed to register media in dataset");
    }
    setPhase("done");
  };

  const handleReset = () => {
    setAssets([]);
    setCategory("");
    setPossiblePest("");
    setConduciveCondition("");
    setEntryPoint("");
    setSeverity("");
    setLocationType("");
    setNotes("");
    setResult(null);
    setUploadError(null);
    setPhase("compose");
  };

  const inputStyle = {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: colors.foreground,
    fontFamily: "Inter_400Regular" as const,
    fontSize: 15,
    backgroundColor: colors.card,
  };

  if (phase === "uploading") {
    return (
      <Screen edges={["top", "bottom"]} padded>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 24, padding: 32 }}>
          <ActivityIndicator size="large" color={colors.primary} />
          <Text style={{ color: colors.foreground, fontFamily: "Inter_700Bold", fontSize: 20, textAlign: "center" }}>
            Uploading…
          </Text>
          <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 15, textAlign: "center" }}>
            {progress.done} of {progress.total} items
          </Text>
          <View
            style={{
              width: "100%",
              height: 6,
              backgroundColor: colors.muted,
              borderRadius: 3,
              overflow: "hidden",
            }}
          >
            <View
              style={{
                height: 6,
                width: `${progress.total > 0 ? (progress.done / progress.total) * 100 : 0}%`,
                backgroundColor: colors.primary,
                borderRadius: 3,
              }}
            />
          </View>
        </View>
      </Screen>
    );
  }

  if (phase === "done" && result) {
    return (
      <Screen edges={["top", "bottom"]} padded>
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 20, padding: 24 }}>
          <View
            style={{
              width: 72,
              height: 72,
              borderRadius: 36,
              backgroundColor: result.created > 0 ? (colors.success ?? "#22c55e") + "22" : colors.destructive + "22",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Ionicons
              name={result.created > 0 ? "checkmark-circle" : "close-circle"}
              size={44}
              color={result.created > 0 ? (colors.success ?? "#22c55e") : colors.destructive}
            />
          </View>
          <Text style={{ color: colors.foreground, fontFamily: "Inter_700Bold", fontSize: 22, textAlign: "center" }}>
            {result.created > 0 ? "Media Ingested" : "Upload Failed"}
          </Text>
          {result.created > 0 ? (
            <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 15, textAlign: "center", lineHeight: 22 }}>
              <Text style={{ color: colors.foreground, fontFamily: "Inter_700Bold" }}>{result.created}</Text>
              {" item" + (result.created !== 1 ? "s" : "") + " added to the training dataset."}
              {result.failed > 0
                ? `\n\n${result.failed} item${result.failed !== 1 ? "s" : ""} could not be uploaded.`
                : ""}
            </Text>
          ) : null}
          {uploadError ? (
            <Text style={{ color: colors.destructive, fontFamily: "Inter_400Regular", fontSize: 14, textAlign: "center" }}>
              {uploadError}
            </Text>
          ) : null}
          <Card style={{ width: "100%", gap: 8 }}>
            <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 13, lineHeight: 19, textAlign: "center" }}>
              These photos and videos are now stored in your training dataset with the metadata you provided. A manager can review and approve them for model training.
            </Text>
          </Card>
          <View style={{ width: "100%", gap: 10 }}>
            <Button title="Upload More Media" variant="outline" icon="cloud-upload-outline" onPress={handleReset} />
            <Button title="Done" onPress={() => router.back()} />
          </View>
        </View>
      </Screen>
    );
  }

  return (
    <Screen edges={["top", "bottom"]}>
      {/* Header */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          paddingHorizontal: 16,
          paddingVertical: 12,
          borderBottomWidth: 1,
          borderBottomColor: colors.border,
        }}
      >
        <Pressable onPress={() => router.back()}>
          <Ionicons name="arrow-back" size={24} color={colors.foreground} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.foreground, fontFamily: "Inter_700Bold", fontSize: 19 }}>
            Upload Training Photos & Videos
          </Text>
          <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 13 }}>
            Add historical photos and videos to the dataset
          </Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={{ padding: 16, gap: 20, paddingBottom: 100 }}>

        {/* Media Picker */}
        <View style={{ gap: 12 }}>
          <SectionLabel label="Photos & Videos" required />
          <Pressable
            onPress={pickMedia}
            style={{
              borderWidth: 2,
              borderColor: assets.length > 0 ? colors.primary : colors.border,
              borderStyle: "dashed",
              borderRadius: 12,
              padding: 20,
              alignItems: "center",
              gap: 10,
              backgroundColor: assets.length > 0 ? colors.primary + "08" : colors.card,
            }}
          >
            <Ionicons
              name="images-outline"
              size={36}
              color={assets.length > 0 ? colors.primary : colors.mutedForeground}
            />
            <Text
              style={{
                color: assets.length > 0 ? colors.primary : colors.mutedForeground,
                fontFamily: "Inter_600SemiBold",
                fontSize: 15,
              }}
            >
              {assets.length > 0 ? `${assets.length} item${assets.length !== 1 ? "s" : ""} selected` : "Select photos or videos from library"}
            </Text>
            {assets.length === 0 ? (
              <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 13, textAlign: "center" }}>
                Multi-select up to 50 photos or videos at once
              </Text>
            ) : (
              <Text style={{ color: colors.primary, fontFamily: "Inter_400Regular", fontSize: 13 }}>
                Tap to add more (max 50)
              </Text>
            )}
          </Pressable>

          {assets.length > 0 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -16 }} contentContainerStyle={{ paddingHorizontal: 16, gap: 8 }}>
              {assets.map((asset, idx) => {
                const isVideo = isVideoAsset(asset);
                const duration = isVideo ? formatDuration(asset.duration) : null;
                return (
                  <View key={`${asset.uri}-${idx}`} style={{ position: "relative" }}>
                    {isVideo ? (
                      <View
                        style={{
                          width: 72,
                          height: 72,
                          borderRadius: 8,
                          backgroundColor: colors.foreground + "CC",
                          alignItems: "center",
                          justifyContent: "center",
                          gap: 2,
                        }}
                      >
                        <Ionicons name="videocam" size={22} color={colors.background} />
                        {duration ? (
                          <Text style={{ color: colors.background, fontFamily: "Inter_600SemiBold", fontSize: 11 }}>
                            {duration}
                          </Text>
                        ) : null}
                      </View>
                    ) : (
                      <Image
                        source={{ uri: asset.uri }}
                        style={{ width: 72, height: 72, borderRadius: 8 }}
                        contentFit="cover"
                      />
                    )}
                    <Pressable
                      onPress={() => removeAsset(idx)}
                      style={{
                        position: "absolute",
                        top: -6,
                        right: -6,
                        width: 22,
                        height: 22,
                        borderRadius: 11,
                        backgroundColor: colors.destructive,
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Ionicons name="close" size={13} color="#fff" />
                    </Pressable>
                  </View>
                );
              })}
            </ScrollView>
          ) : null}
        </View>

        {/* Category */}
        <View style={{ gap: 10 }}>
          <SectionLabel label="Issue Category" required />
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
            {CATEGORIES.map((cat) => {
              const active = category === cat.slug;
              return (
                <Pressable
                  key={cat.slug}
                  onPress={() => setCategory(cat.slug)}
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: 6,
                    paddingHorizontal: 12,
                    paddingVertical: 8,
                    borderRadius: 8,
                    borderWidth: 1.5,
                    borderColor: active ? colors.primary : colors.border,
                    backgroundColor: active ? colors.primary + "15" : colors.card,
                  }}
                >
                  <Ionicons
                    name={cat.icon}
                    size={15}
                    color={active ? colors.primary : colors.mutedForeground}
                  />
                  <Text
                    style={{
                      color: active ? colors.primary : colors.foreground,
                      fontFamily: active ? "Inter_600SemiBold" : "Inter_400Regular",
                      fontSize: 13,
                    }}
                  >
                    {cat.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* Species / Pest name — shown for pest or pest_evidence */}
        {(category === "pest" || category === "pest_evidence") ? (
          <View style={{ gap: 8 }}>
            <SectionLabel label="Target Pest / Species" />
            <TextInput
              value={possiblePest}
              onChangeText={setPossiblePest}
              placeholder="e.g. German Cockroach, House Mouse"
              placeholderTextColor={colors.mutedForeground}
              style={inputStyle}
              autoCapitalize="words"
            />
          </View>
        ) : null}

        {/* Conducive condition detail */}
        {category === "conducive_condition" ? (
          <View style={{ gap: 8 }}>
            <SectionLabel label="Conducive Condition Detail" />
            <TextInput
              value={conduciveCondition}
              onChangeText={setConduciveCondition}
              placeholder="e.g. Standing water, Moisture leak"
              placeholderTextColor={colors.mutedForeground}
              style={inputStyle}
              autoCapitalize="sentences"
            />
          </View>
        ) : null}

        {/* Entry point detail */}
        {category === "entry_point" ? (
          <View style={{ gap: 8 }}>
            <SectionLabel label="Entry Point Detail" />
            <TextInput
              value={entryPoint}
              onChangeText={setEntryPoint}
              placeholder="e.g. Foundation crack, Door gap"
              placeholderTextColor={colors.mutedForeground}
              style={inputStyle}
              autoCapitalize="sentences"
            />
          </View>
        ) : null}

        {/* Severity */}
        <View style={{ gap: 10 }}>
          <SectionLabel label="Severity" />
          <View style={{ flexDirection: "row", gap: 8 }}>
            {SEVERITIES.map((s) => {
              const active = severity === s.value;
              return (
                <Pressable
                  key={s.value}
                  onPress={() => setSeverity(active ? "" : s.value)}
                  style={{
                    flex: 1,
                    paddingVertical: 8,
                    borderRadius: 8,
                    alignItems: "center",
                    borderWidth: 1.5,
                    borderColor: active ? s.color : colors.border,
                    backgroundColor: active ? s.color + "22" : colors.card,
                  }}
                >
                  <Text
                    style={{
                      color: active ? s.color : colors.mutedForeground,
                      fontFamily: "Inter_600SemiBold",
                      fontSize: 12,
                    }}
                  >
                    {s.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* Location / zone */}
        <View style={{ gap: 8 }}>
          <SectionLabel label="Location Type" />
          <TextInput
            value={locationType}
            onChangeText={setLocationType}
            placeholder="e.g. Kitchen, Crawlspace, Exterior, Basement"
            placeholderTextColor={colors.mutedForeground}
            style={inputStyle}
            autoCapitalize="words"
          />
        </View>

        {/* Notes */}
        <View style={{ gap: 8 }}>
          <SectionLabel label="Additional Notes" />
          <TextInput
            value={notes}
            onChangeText={setNotes}
            placeholder="Context about the media, inspection conditions, date range, etc."
            placeholderTextColor={colors.mutedForeground}
            style={[inputStyle, { minHeight: 80, textAlignVertical: "top", paddingTop: 10 }]}
            multiline
            numberOfLines={3}
            autoCapitalize="sentences"
          />
        </View>

        {uploadError ? (
          <Text style={{ color: colors.destructive, fontFamily: "Inter_400Regular", fontSize: 14 }}>
            {uploadError}
          </Text>
        ) : null}

        <Card style={{ gap: 6, backgroundColor: colors.accent }}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Ionicons name="shield-checkmark-outline" size={16} color={colors.primary} />
            <Text style={{ color: colors.primary, fontFamily: "Inter_600SemiBold", fontSize: 13 }}>
              Secure & private
            </Text>
          </View>
          <Text style={{ color: colors.mutedForeground, fontFamily: "Inter_400Regular", fontSize: 12, lineHeight: 18 }}>
            Photos and videos are stored in your company's private storage, scoped only to your account. They are added to your training dataset as confirmed examples for manager review.
          </Text>
        </Card>
      </ScrollView>

      {/* Sticky upload button */}
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
          gap: 0,
        }}
      >
        <Button
          title={
            !canUpload
              ? assets.length === 0
                ? "Select photos or videos to continue"
                : "Select a category to continue"
              : `Upload ${assets.length} Item${assets.length !== 1 ? "s" : ""} to Dataset`
          }
          icon="cloud-upload-outline"
          disabled={!canUpload}
          onPress={() => void handleUpload()}
          size="lg"
        />
      </View>
    </Screen>
  );
}

function SectionLabel({ label, required }: { label: string; required?: boolean }) {
  const colors = useColors();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
      <Text style={{ color: colors.foreground, fontFamily: "Inter_600SemiBold", fontSize: 14 }}>
        {label}
      </Text>
      {required ? (
        <Text style={{ color: colors.destructive, fontFamily: "Inter_600SemiBold", fontSize: 14 }}>
          *
        </Text>
      ) : null}
    </View>
  );
}
