import { useAuth, useUser } from "@clerk/expo";
import { Ionicons } from "@expo/vector-icons";
import {
  useAddInspectionMedia,
  useAnalyzeInspection,
  useCreateInspection,
} from "@/lib/api-client";
import { useQueryClient } from "@tanstack/react-query";
import { CameraView, useCameraPermissions } from "expo-camera";
import { type Href, useRouter } from "expo-router";
import { Image } from "expo-image";
import React, { useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Text,
  View,
} from "react-native";

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

export default function NewInspectionScreen() {
  const colors = useColors();
  const { isLandscape } = useWindowSizeClass();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { getToken } = useAuth();
  const { user: clerkUser } = useUser();

  const createInspection = useCreateInspection();
  const addMedia = useAddInspectionMedia();
  const analyze = useAnalyzeInspection();

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

  // Resume state so a retry after a mid-flight failure does not create a
  // duplicate inspection or re-upload photos that already succeeded.
  const createdInspectionId = useRef<number | null>(null);
  const uploadedUrls = useRef<string[]>([]);

  const canContinueSetup = siteAddress.trim().length > 0 && technicianName.trim().length > 0;

  const togglePest = (p: string) =>
    setPestTypes((prev) => (prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p]));

  const takePhoto = async () => {
    if (!cameraRef.current || capturing) return;
    try {
      setCapturing(true);
      const pic = await cameraRef.current.takePictureAsync({ quality: 0.6 });
      if (pic?.uri) setPhotos((prev) => [...prev, { uri: pic.uri }]);
    } catch {
      setError("Couldn't capture photo. Please try again.");
    } finally {
      setCapturing(false);
    }
  };

  const submit = async () => {
    setError(null);
    setSubmitting(true);
    try {
      const token = await getToken();
      const composedNotes = [`Property type: ${propertyType}`, notes.trim()]
        .filter(Boolean)
        .join("\n\n");

      // Reuse an inspection created on a prior (failed) attempt instead of
      // creating a duplicate.
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
      }

      let analysisWarning: string | null = null;
      if (uploadedUrls.current.length) {
        setProgress("Running AI analysis…");
        const result = await analyze.mutateAsync({
          data: {
            inspectionId: id,
            images: uploadedUrls.current.map((u) => ({ imageUrl: u })),
          },
        });
        if (result?.analysisErrors && result.analysisErrors > 0) {
          const n = result.analysisErrors;
          analysisWarning = `${n} photo${n > 1 ? "s" : ""} couldn't be analyzed.`;
        }
      }

      await queryClient.invalidateQueries();

      // Success — clear resume state so the next inspection starts fresh.
      const targetId = id;
      createdInspectionId.current = null;
      uploadedUrls.current = [];

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

    const thumbs =
      photos.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={isLandscape ? { position: "absolute", bottom: 16, left: 0, right: 116 } : undefined}
          contentContainerStyle={{ gap: 8, paddingHorizontal: 16 }}
        >
          {photos.map((p, i) => (
            <View key={`${p.uri}-${i}`}>
              <Image source={{ uri: p.uri }} style={{ width: 56, height: 56, borderRadius: 8 }} />
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

    return (
      <View style={{ flex: 1, backgroundColor: "#000" }}>
        <CameraView ref={cameraRef} style={{ flex: 1 }} facing="back" />
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
              {captureButton}
              {doneButton}
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
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "space-between",
                paddingHorizontal: 28,
              }}
            >
              <View style={{ width: 64 }} />
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
        <TextField
          label="Site address *"
          placeholder="123 Main St, Suite 200"
          value={siteAddress}
          onChangeText={setSiteAddress}
        />
        <TextField
          label="Client name"
          placeholder="Acme Restaurant Group"
          value={clientName}
          onChangeText={setClientName}
        />
        <TextField
          label="Technician *"
          placeholder="Your name"
          value={technicianName}
          onChangeText={setTechnicianName}
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
