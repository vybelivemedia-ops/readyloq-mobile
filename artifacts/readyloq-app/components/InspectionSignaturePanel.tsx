/**
 * InspectionSignaturePanel
 *
 * Two-slot signature capture for completed inspections:
 *   • Owner / Tenant  — optional; technician can mark "Not Available"
 *   • Technician      — required
 *
 * Signatures are stored locally (LocalInspection) and synced to the server
 * via the existing PATCH step in the sync engine.
 */
import React, { useCallback, useState } from "react";
import {
  Modal,
  Pressable,
  SafeAreaView,
  ScrollView,
  Text,
  View,
} from "react-native";
import { SvgXml } from "react-native-svg";
import { useColors } from "@/hooks/useColors";
import { updateLocalInspection } from "@/lib/local/inspection-store";
import { SignaturePad, strokesToSvgString } from "./SignaturePad";

type SlotKey = "owner" | "technician";

type Props = {
  localId: string;
  technicianName: string;
  technicianSignature: string | null;
  ownerSignature: string | null;
  ownerNotAvailable: boolean;
  /** Re-render parent when signatures change. */
  onUpdated?: () => void;
};

const PAD_WIDTH = 320;
const PAD_HEIGHT = 160;

export function InspectionSignaturePanel({
  localId,
  technicianName,
  technicianSignature,
  ownerSignature,
  ownerNotAvailable,
  onUpdated,
}: Props) {
  const colors = useColors();

  // Which slot the modal is capturing
  const [activeSlot, setActiveSlot] = useState<SlotKey | null>(null);
  // SVG being drawn before confirmation
  const [draftSvg, setDraftSvg] = useState<string | null>(null);
  const [draftEmpty, setDraftEmpty] = useState(true);

  const openModal = (slot: SlotKey) => {
    setDraftSvg(null);
    setDraftEmpty(true);
    setActiveSlot(slot);
  };

  const closeModal = () => {
    setActiveSlot(null);
    setDraftSvg(null);
    setDraftEmpty(true);
  };

  const handlePadChange = useCallback((svg: string, isEmpty: boolean) => {
    setDraftSvg(svg);
    setDraftEmpty(isEmpty);
  }, []);

  const handlePadClear = useCallback(() => {
    setDraftSvg(null);
    setDraftEmpty(true);
  }, []);

  const confirmSignature = async () => {
    if (!activeSlot || !draftSvg || draftEmpty) return;
    const signedAt = new Date().toISOString();
    await updateLocalInspection(localId, (r) => {
      if (activeSlot === "technician") {
        r.technicianSignature = draftSvg;
      } else {
        r.ownerSignature = draftSvg;
        r.ownerNotAvailable = false;
      }
      r.signedAt = r.signedAt ?? signedAt;
    });
    closeModal();
    onUpdated?.();
  };

  const markOwnerNotAvailable = async () => {
    await updateLocalInspection(localId, (r) => {
      r.ownerNotAvailable = true;
      r.ownerSignature = null;
    });
    onUpdated?.();
  };

  const clearOwnerNotAvailable = async () => {
    await updateLocalInspection(localId, (r) => {
      r.ownerNotAvailable = false;
    });
    onUpdated?.();
  };

  const clearSignature = async (slot: SlotKey) => {
    await updateLocalInspection(localId, (r) => {
      if (slot === "technician") r.technicianSignature = null;
      else r.ownerSignature = null;
    });
    onUpdated?.();
  };

  return (
    <>
      <View
        style={{
          borderRadius: 14,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.card,
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <View
          style={{
            paddingHorizontal: 16,
            paddingVertical: 12,
            borderBottomWidth: 1,
            borderBottomColor: colors.border,
          }}
        >
          <Text
            style={{
              color: colors.foreground,
              fontFamily: "Inter_700Bold",
              fontSize: 15,
            }}
          >
            Signatures
          </Text>
          <Text
            style={{
              color: colors.mutedForeground,
              fontFamily: "Inter_400Regular",
              fontSize: 12,
              marginTop: 2,
            }}
          >
            Both parties sign to acknowledge the inspection findings.
          </Text>
        </View>

        {/* Owner / Tenant slot */}
        <SignatureSlot
          label="Owner / Tenant"
          signature={ownerSignature}
          notAvailable={ownerNotAvailable}
          onSign={() => openModal("owner")}
          onClear={() => clearSignature("owner")}
          onNotAvailable={markOwnerNotAvailable}
          onResetNotAvailable={clearOwnerNotAvailable}
          colors={colors}
          hasDivider
        />

        {/* Technician slot */}
        <SignatureSlot
          label={`Technician${technicianName ? ` — ${technicianName}` : ""}`}
          signature={technicianSignature}
          notAvailable={false}
          onSign={() => openModal("technician")}
          onClear={() => clearSignature("technician")}
          colors={colors}
        />
      </View>

      {/* Signature capture modal */}
      <Modal
        visible={activeSlot != null}
        animationType="slide"
        presentationStyle="pageSheet"
        onRequestClose={closeModal}
      >
        <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
          {/* Toolbar */}
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              paddingHorizontal: 20,
              paddingVertical: 14,
              borderBottomWidth: 1,
              borderBottomColor: colors.border,
            }}
          >
            <Pressable onPress={closeModal}>
              <Text
                style={{
                  color: colors.mutedForeground,
                  fontFamily: "Inter_500Medium",
                  fontSize: 15,
                }}
              >
                Cancel
              </Text>
            </Pressable>
            <Text
              style={{
                color: colors.foreground,
                fontFamily: "Inter_700Bold",
                fontSize: 16,
              }}
            >
              {activeSlot === "owner" ? "Owner / Tenant" : "Technician"}
            </Text>
            <Pressable
              onPress={() => void confirmSignature()}
              disabled={draftEmpty}
            >
              <Text
                style={{
                  color: draftEmpty ? colors.mutedForeground : colors.primary,
                  fontFamily: "Inter_700Bold",
                  fontSize: 15,
                  opacity: draftEmpty ? 0.4 : 1,
                }}
              >
                Done
              </Text>
            </Pressable>
          </View>

          {/* Instruction */}
          <ScrollView
            contentContainerStyle={{
              padding: 24,
              gap: 20,
              alignItems: "center",
            }}
          >
            <Text
              style={{
                color: colors.mutedForeground,
                fontFamily: "Inter_400Regular",
                fontSize: 14,
                textAlign: "center",
              }}
            >
              {activeSlot === "owner"
                ? "Please sign below to acknowledge the inspection."
                : "Sign to confirm you performed this inspection."}
            </Text>

            <SignaturePad
              width={PAD_WIDTH}
              height={PAD_HEIGHT}
              onChange={handlePadChange}
              onClear={handlePadClear}
            />

            {/* Confirm button (alternative to the toolbar Done) */}
            <Pressable
              onPress={() => void confirmSignature()}
              disabled={draftEmpty}
              style={{
                width: PAD_WIDTH,
                paddingVertical: 14,
                borderRadius: 12,
                backgroundColor: draftEmpty
                  ? colors.muted
                  : colors.primary,
                alignItems: "center",
              }}
            >
              <Text
                style={{
                  color: draftEmpty
                    ? colors.mutedForeground
                    : colors.primaryForeground,
                  fontFamily: "Inter_700Bold",
                  fontSize: 15,
                }}
              >
                Confirm Signature
              </Text>
            </Pressable>
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </>
  );
}

// ─── Slot sub-component ───────────────────────────────────────────────────────

type SlotProps = {
  label: string;
  signature: string | null;
  notAvailable: boolean;
  onSign: () => void;
  onClear: () => void;
  onNotAvailable?: () => void;
  onResetNotAvailable?: () => void;
  colors: ReturnType<typeof useColors>;
  hasDivider?: boolean;
};

function SignatureSlot({
  label,
  signature,
  notAvailable,
  onSign,
  onClear,
  onNotAvailable,
  onResetNotAvailable,
  colors,
  hasDivider,
}: SlotProps) {
  return (
    <View
      style={{
        borderTopWidth: hasDivider ? 0 : 0,
        borderBottomWidth: hasDivider ? 1 : 0,
        borderColor: colors.border,
        padding: 16,
        gap: 10,
      }}
    >
      {/* Row: label + status pill */}
      <View
        style={{
          flexDirection: "row",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <Text
          style={{
            color: colors.foreground,
            fontFamily: "Inter_600SemiBold",
            fontSize: 13,
          }}
          numberOfLines={1}
        >
          {label}
        </Text>
        {signature ? (
          <StatusPill label="Signed" tone="success" />
        ) : notAvailable ? (
          <StatusPill label="Not Available" tone="muted" />
        ) : (
          <StatusPill label="Pending" tone="warning" />
        )}
      </View>

      {/* Signed: show preview + re-sign option */}
      {signature ? (
        <View style={{ gap: 8 }}>
          <View
            style={{
              borderRadius: 8,
              borderWidth: 1,
              borderColor: colors.border,
              overflow: "hidden",
              backgroundColor: "#fff",
              height: 80,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <SvgXml xml={signature} width="100%" height="100%" />
          </View>
          <Pressable onPress={onClear}>
            <Text
              style={{
                color: colors.mutedForeground,
                fontFamily: "Inter_400Regular",
                fontSize: 12,
                textAlign: "right",
              }}
            >
              Re-sign
            </Text>
          </Pressable>
        </View>
      ) : notAvailable ? (
        // Not Available: show message + undo option
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            backgroundColor: colors.muted,
            borderRadius: 8,
            padding: 10,
          }}
        >
          <Text
            style={{
              color: colors.mutedForeground,
              fontFamily: "Inter_400Regular",
              fontSize: 12,
            }}
          >
            Technician signed on behalf
          </Text>
          <Pressable onPress={onResetNotAvailable}>
            <Text
              style={{
                color: colors.primary,
                fontFamily: "Inter_500Medium",
                fontSize: 12,
              }}
            >
              Undo
            </Text>
          </Pressable>
        </View>
      ) : (
        // Unsigned: sign button + (owner only) "not available" option
        <View style={{ gap: 8 }}>
          <Pressable
            onPress={onSign}
            style={{
              borderRadius: 10,
              borderWidth: 1.5,
              borderColor: colors.primary,
              borderStyle: "dashed",
              height: 70,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Text
              style={{
                color: colors.primary,
                fontFamily: "Inter_600SemiBold",
                fontSize: 14,
              }}
            >
              Tap to sign
            </Text>
          </Pressable>
          {onNotAvailable && (
            <Pressable
              onPress={onNotAvailable}
              style={{ alignSelf: "flex-start" }}
            >
              <Text
                style={{
                  color: colors.mutedForeground,
                  fontFamily: "Inter_400Regular",
                  fontSize: 12,
                  textDecorationLine: "underline",
                }}
              >
                Owner / tenant not available — technician sign only
              </Text>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

function StatusPill({
  label,
  tone,
}: {
  label: string;
  tone: "success" | "warning" | "muted";
}) {
  const colors = useColors();
  const bg =
    tone === "success"
      ? "rgba(34,197,94,0.12)"
      : tone === "warning"
        ? "rgba(245,158,11,0.12)"
        : colors.muted;
  const fg =
    tone === "success"
      ? "#16a34a"
      : tone === "warning"
        ? "#d97706"
        : colors.mutedForeground;
  return (
    <View
      style={{
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: 999,
        backgroundColor: bg,
      }}
    >
      <Text style={{ color: fg, fontFamily: "Inter_600SemiBold", fontSize: 11 }}>
        {label}
      </Text>
    </View>
  );
}
