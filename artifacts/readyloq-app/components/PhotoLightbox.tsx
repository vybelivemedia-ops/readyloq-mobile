import type { PhotoMeta } from "../../../lib/api-client-react/src/photo-meta";
import { Ionicons } from "@expo/vector-icons";
import React, { useEffect, useRef, useState } from "react";
import { Modal, PanResponder, Pressable, ScrollView, Text, View } from "react-native";
import { AuthedImage } from "@/components/AuthedImage";
import { useColors } from "@/hooks/useColors";

export interface PhotoLightboxProps {
  photos: PhotoMeta[];
  initialIndex: number;
  visible: boolean;
  onClose: () => void;
}

function formatCaptureTime(value: string | null): string {
  if (!value) return "Timestamp unavailable";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function PhotoLightbox({ photos, initialIndex, visible, onClose }: PhotoLightboxProps) {
  const colors = useColors();
  const [index, setIndex] = useState(initialIndex);
  const move = (delta: number) => {
    setIndex((value) => Math.max(0, Math.min(value + delta, photos.length - 1)));
  };
  const moveRef = useRef(move);
  moveRef.current = move;

  useEffect(() => {
    if (visible && photos.length) {
      setIndex(Math.max(0, Math.min(initialIndex, photos.length - 1)));
    }
  }, [initialIndex, photos.length, visible]);

  const swipeResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dx) > 12,
      onPanResponderRelease: (_, gesture) => {
        if (gesture.dx < -50) moveRef.current(1);
        if (gesture.dx > 50) moveRef.current(-1);
      },
    }),
  ).current;

  const current = photos[index];
  if (!current) return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
      accessibilityViewIsModal
    >
      <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.96)" }}>
        <View
          {...swipeResponder.panHandlers}
          style={{ flex: 1, justifyContent: "center", alignItems: "center" }}
        >
          <AuthedImage path={current.url} contentFit="contain" style={{ width: "100%", height: "68%" }} />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close photo viewer"
            onPress={onClose}
            hitSlop={12}
            style={{
              position: "absolute",
              top: 48,
              right: 16,
              padding: 9,
              borderRadius: 999,
              backgroundColor: "rgba(255,255,255,0.16)",
            }}
          >
            <Ionicons name="close" size={24} color="#fff" />
          </Pressable>
          {index > 0 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Previous photo"
              onPress={() => move(-1)}
              style={{ position: "absolute", left: 12, top: "35%", padding: 10 }}
            >
              <Ionicons name="chevron-back-circle" size={42} color="#fff" />
            </Pressable>
          ) : null}
          {index < photos.length - 1 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Next photo"
              onPress={() => move(1)}
              style={{ position: "absolute", right: 12, top: "35%", padding: 10 }}
            >
              <Ionicons name="chevron-forward-circle" size={42} color="#fff" />
            </Pressable>
          ) : null}
          <Text style={{ color: "#fff", fontSize: 12, marginTop: 8 }}>
            {index + 1} of {photos.length} · Swipe to navigate
          </Text>
        </View>

        <ScrollView
          style={{
            maxHeight: "32%",
            backgroundColor: colors.card,
            borderTopLeftRadius: 18,
            borderTopRightRadius: 18,
          }}
          contentContainerStyle={{ padding: 18, gap: 10 }}
          accessibilityLabel="Photo metadata"
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Text style={{ flex: 1, color: colors.foreground, fontSize: 18, fontFamily: "Inter_700Bold" }}>
              {current.classificationTag}
            </Text>
            {current.unitNumber ? (
              <View style={{ backgroundColor: colors.primary, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 4 }}>
                <Text style={{ color: "#fff", fontSize: 11, fontFamily: "Inter_700Bold" }}>
                  Unit {current.unitNumber}
                </Text>
              </View>
            ) : null}
          </View>
          <Text style={{ color: colors.mutedForeground, fontSize: 12 }}>
            Captured {formatCaptureTime(current.capturedAt)}
          </Text>
          {current.technicianCorrectionLabel ? (
            <Text style={{ color: colors.warning, fontFamily: "Inter_600SemiBold", fontSize: 13 }}>
              Technician correction: {current.technicianCorrectionLabel}
            </Text>
          ) : (
            <Text style={{ color: colors.mutedForeground, fontSize: 13 }}>
              AI confidence: {current.confidenceScore == null ? "Unavailable" : `${Math.round(current.confidenceScore * 100)}%`}
            </Text>
          )}
          {current.structuredDescription ? (
            <Text style={{ color: colors.foreground, fontSize: 13 }}>{current.structuredDescription}</Text>
          ) : null}
          {current.chemicalLogReference ? (
            <View style={{ borderTopWidth: 1, borderTopColor: colors.border, paddingTop: 10 }}>
              <Text style={{ color: colors.mutedForeground, fontSize: 11, textTransform: "uppercase" }}>
                Treatment log
              </Text>
              <Text style={{ color: colors.foreground, fontSize: 13 }}>{current.chemicalLogReference}</Text>
            </View>
          ) : null}
        </ScrollView>
      </View>
    </Modal>
  );
}