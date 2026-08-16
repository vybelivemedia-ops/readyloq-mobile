/**
 * GlassesCalibrationModal
 *
 * Guides the technician through a one-time camera calibration for the
 * connected Meta Ray-Ban glasses.  The tech holds a credit card in front
 * of the GLASSES camera, requests a snapshot via BLE, taps the four corners
 * of the card on the received frame, and optionally adjusts the holding
 * distance.  The focal length is then back-solved and stored against the
 * glasses device ID in SecureStore.
 *
 * ─── Why glasses frames, not the phone camera ──────────────────────────────
 * Phone and glasses cameras have different sensor sizes and focal lengths.
 * Calibrating with the phone camera produces a focal length that is valid
 * only for phone-camera measurements; applying it to glasses-sourced frames
 * would introduce systematic error of up to 30%.  This modal always captures
 * the reference image from the actual glasses via the BLE snapshot command.
 *
 * ─── Flow ──────────────────────────────────────────────────────────────────
 *  Step 1 – Instructions: explain the process and the glasses-camera requirement.
 *  Step 2 – Capture: send REQUEST_SNAPSHOT to glasses; wait up to 12 s for
 *             the frame to arrive over BLE.
 *  Step 3 – Corner selection: display the received frame; user taps 4 corners
 *             in order TL → TR → BR → BL.
 *  Step 4 – Distance: user confirms/adjusts the holding distance (default 0.6 m).
 *  Step 5 – Result: show the derived focal length and a Save button.
 *
 * ─── Formula ───────────────────────────────────────────────────────────────
 *  focalLengthPx = pixelWidth × depthMeters × 1000 / knownWidthMm
 *  where pixelWidth is the mean Euclidean distance (√Δx²+Δy²) of the top
 *  and bottom card edges (TL→TR and BL→BR tapped corners), which correctly
 *  accounts for a card rotated in the frame unlike horizontal x-span alone.
 *  knownWidthMm = 85.6 mm (ISO 7810 ID-1), depthMeters is tech-supplied.
 */

import { Ionicons } from "@expo/vector-icons";
import * as FileSystem from "expo-file-system/legacy";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { useColors } from "@/hooks/useColors";
import { smartGlassesBle } from "@/lib/ble";
import {
  backSolveFocalLength,
  buildCalibrationProfile,
  saveCalibrationProfile,
} from "@/lib/meta-glasses/calibration";
import type { BasicCalibrationProfile } from "@platform/measurement-core";

// ─── Constants ────────────────────────────────────────────────────────────────

/** Maximum seconds to wait for a BLE frame after sending REQUEST_SNAPSHOT. */
const SNAPSHOT_TIMEOUT_MS = 12_000;

// ─── Types ────────────────────────────────────────────────────────────────────

interface Corner {
  x: number; // native pixel coord in the received glasses frame
  y: number;
}

type Step = "instructions" | "capturing" | "corners" | "distance" | "result";

const CORNER_LABELS = ["Top-left", "Top-right", "Bottom-right", "Bottom-left"];

interface GlassesCalibrationModalProps {
  visible: boolean;
  /** BLE device ID (MAC address / UUID) to key the profile on. */
  deviceId: string;
  onClose: () => void;
  /** Called after the profile is saved — parent can refresh its local copy. */
  onSaved: (profile: BasicCalibrationProfile) => void;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function GlassesCalibrationModal({
  visible,
  deviceId,
  onClose,
  onSaved,
}: GlassesCalibrationModalProps) {
  const colors = useColors();

  const [step, setStep] = useState<Step>("instructions");
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [imageNativeW, setImageNativeW] = useState(1);
  const [imageNativeH, setImageNativeH] = useState(1);

  // Pixel-space corners (in native pixel coords of the glasses frame)
  const [corners, setCorners] = useState<Corner[]>([]);

  // Holding distance in metres
  const [distanceText, setDistanceText] = useState("0.6");
  const [saving, setSaving] = useState(false);

  // Derived focal length from back-solve
  const [derivedFocal, setDerivedFocal] = useState<number | null>(null);

  // Temp file URI written during capture; deleted when modal closes / resets
  const tempUriRef = useRef<string | null>(null);

  // ── BLE snapshot in-flight cleanup refs ───────────────────────────────────
  // These hold the live unsubscribe function and timeout ID for any snapshot
  // request that is currently waiting for a frame.  Stored at component scope
  // (not inside handleRequestSnapshot) so that handleClose and the unmount
  // effect can always cancel an in-flight capture, regardless of whether
  // handleRequestSnapshot's local cleanup closure is still reachable.
  const snapshotUnsubRef = useRef<(() => void) | null>(null);
  const snapshotTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Monotonically-increasing capture generation counter.
   *
   * Incremented at the START of each handleRequestSnapshot call.  The async
   * onFrame callback captures the generation number synchronously; after every
   * await it checks whether the captured value still equals the current
   * generation.  If the modal was closed or a new capture was started in the
   * meantime (bumping the generation), the stale callback skips all state
   * mutations and deletes any temp file it may have written.  This is safer
   * than closing over the `visible` prop, which is a render-cycle snapshot and
   * may be stale by the time the await resolves.
   */
  const captureGenerationRef = useRef(0);

  /**
   * Removes the BLE frame listener and cancels the timeout WITHOUT bumping
   * the capture generation.  Call this when a capture completes normally
   * (frame received, request error handled) so that subsequent generation
   * checks in the same async chain still see the expected value.
   */
  const unregisterSnapshot = useCallback(() => {
    snapshotUnsubRef.current?.();
    snapshotUnsubRef.current = null;
    if (snapshotTimerRef.current !== null) {
      clearTimeout(snapshotTimerRef.current);
      snapshotTimerRef.current = null;
    }
  }, []);

  /**
   * Aborts any in-flight capture.  Bumps the capture generation so that any
   * post-`await` continuation still running from a previous request sees a
   * stale generation check and exits without touching state or files.  Then
   * calls unregisterSnapshot() to remove the listener and timer.
   *
   * Only call from external abort paths (modal close, recapture, unmount).
   * Do NOT call from within the frame callback itself — use unregisterSnapshot()
   * there to avoid bumping the generation while the same request is still live.
   */
  const cancelSnapshot = useCallback(() => {
    captureGenerationRef.current += 1;
    unregisterSnapshot();
  }, [unregisterSnapshot]);

  // Cleanup temp file
  const deleteTempFile = useCallback(async () => {
    const uri = tempUriRef.current;
    if (uri) {
      tempUriRef.current = null;
      try {
        await FileSystem.deleteAsync(uri, { idempotent: true });
      } catch { /* best-effort */ }
    }
  }, []);

  // ── Reset all state ────────────────────────────────────────────────────────
  const reset = useCallback(async () => {
    cancelSnapshot(); // abort + bump generation so any in-flight awaits bail
    await deleteTempFile();
    setStep("instructions");
    setImageUri(null);
    setCorners([]);
    setDistanceText("0.6");
    setDerivedFocal(null);
    setSaving(false);
  }, [cancelSnapshot, deleteTempFile]);

  const handleClose = useCallback(async () => {
    cancelSnapshot(); // abort before reset so no frame write races with close
    await reset();
    onClose();
  }, [cancelSnapshot, reset, onClose]);

  // Cleanup on unmount or when modal becomes invisible
  useEffect(() => {
    if (!visible) {
      cancelSnapshot();
      void deleteTempFile();
    }
  }, [visible, cancelSnapshot, deleteTempFile]);

  // Hard cleanup on unmount (covers the case where visible is still true
  // when the parent unmounts the component)
  useEffect(() => {
    return () => {
      cancelSnapshot();
      void deleteTempFile();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Step 1 → 2: Request BLE snapshot ──────────────────────────────────────
  const handleRequestSnapshot = useCallback(async () => {
    const bleState = smartGlassesBle.getState();
    if (bleState.connectionState !== "connected") {
      Alert.alert(
        "Glasses not connected",
        "Connect your Meta Ray-Ban glasses in the Connections tab first, then return here to calibrate.",
      );
      return;
    }

    // Abort any previous in-flight capture.  cancelSnapshot() bumps the
    // generation so callbacks from the old request exit at their next await.
    cancelSnapshot();

    // Allocate this request's generation AFTER cancelSnapshot has bumped the
    // counter — so this request owns the current value.
    const myGeneration = captureGenerationRef.current;
    setStep("capturing");

    // ── Timeout ────────────────────────────────────────────────────────────
    // If no frame arrives within SNAPSHOT_TIMEOUT_MS, abort the wait.
    // The timeout captures myGeneration before scheduling so it can verify
    // the request hasn't been superseded when it fires.
    snapshotTimerRef.current = setTimeout(() => {
      snapshotTimerRef.current = null;
      // Only act if this request is still the active one
      if (captureGenerationRef.current === myGeneration) {
        // Unsubscribe the listener (no frame will come)
        snapshotUnsubRef.current?.();
        snapshotUnsubRef.current = null;
        // Bump generation to prevent a very late frame from restoring state
        captureGenerationRef.current += 1;
        setStep("instructions");
        Alert.alert(
          "No frame received",
          "The glasses did not send a frame within 12 seconds. Make sure the glasses are awake and in range, then try again.",
        );
      }
    }, SNAPSHOT_TIMEOUT_MS);

    // ── One-shot frame listener ────────────────────────────────────────────
    // Receives the first JPEG frame for this request.
    // Uses unregisterSnapshot() (NOT cancelSnapshot()) to remove itself and
    // the timer WITHOUT bumping the generation, so post-write generation checks
    // in the same async chain still see myGeneration and pass correctly.
    snapshotUnsubRef.current = smartGlassesBle.onFrame(async (jpeg: Uint8Array) => {
      // Remove listener + timer without bumping generation
      unregisterSnapshot();

      try {
        const base = FileSystem.cacheDirectory ?? FileSystem.documentDirectory ?? "";
        const uri = `${base}glasses_calib_${Date.now()}.jpg`;
        await FileSystem.writeAsStringAsync(uri, uint8ArrayToBase64(jpeg), {
          encoding: FileSystem.EncodingType.Base64,
        });

        // Post-write generation check: the modal may have been closed or a new
        // capture started while writeAsStringAsync was running.  cancelSnapshot()
        // bumps the generation; if it no longer equals myGeneration, this
        // callback is stale — delete the file and bail without touching state.
        if (captureGenerationRef.current !== myGeneration) {
          void FileSystem.deleteAsync(uri, { idempotent: true }).catch(() => {});
          return;
        }

        tempUriRef.current = uri;
        const { width, height } = decodeJpegDimensions(jpeg);
        setImageUri(uri);
        setImageNativeW(width > 0 ? width : 1280);
        setImageNativeH(height > 0 ? height : 960);
        setCorners([]);
        setStep("corners");
      } catch {
        if (captureGenerationRef.current === myGeneration) {
          setStep("instructions");
          Alert.alert(
            "Frame write failed",
            "Could not save the glasses frame. Please try again.",
          );
        }
      }
    });

    // ── Send snapshot command ──────────────────────────────────────────────
    // requestSnapshot() is async (BLE write).  On failure, only abort and
    // show the error if this request is still the active one.  If the modal
    // was closed or a new capture started while the BLE write was pending,
    // the generation will no longer match myGeneration; in that case the
    // rejection is stale and must be silently ignored — calling cancelSnapshot()
    // here would disrupt the live request's listener/timer.
    try {
      await smartGlassesBle.requestSnapshot();
    } catch {
      if (captureGenerationRef.current === myGeneration) {
        // This request is still active — abort it cleanly
        cancelSnapshot(); // bumps generation + removes listener/timer
        setStep("instructions");
        Alert.alert(
          "Snapshot request failed",
          "Could not send the snapshot command to the glasses. Check the BLE connection and try again.",
        );
      }
      // If generation doesn't match, silently exit — another request is now live
    }
  }, [cancelSnapshot, unregisterSnapshot]);

  // ── Step 3: Corner tap ─────────────────────────────────────────────────────
  const displayedImageRef = useRef<{ w: number; h: number }>({ w: 1, h: 1 });

  const handleImageTap = useCallback(
    (evt: import("react-native").GestureResponderEvent) => {
      if (corners.length >= 4) return;
      const { locationX, locationY } = evt.nativeEvent;
      const displayW = displayedImageRef.current.w;
      const displayH = displayedImageRef.current.h;

      // Convert displayed coords → native pixel coords
      const nativeX = (locationX / displayW) * imageNativeW;
      const nativeY = (locationY / displayH) * imageNativeH;
      const next = [...corners, { x: nativeX, y: nativeY }];
      setCorners(next);

      if (next.length === 4) {
        setStep("distance");
      }
    },
    [corners, imageNativeW, imageNativeH],
  );

  const onImageLayout = useCallback(
    (e: import("react-native").LayoutChangeEvent) => {
      const { width, height } = e.nativeEvent.layout;
      displayedImageRef.current = { w: width, h: height };
    },
    [],
  );

  // ── Step 4 → 5: Back-solve ────────────────────────────────────────────────
  const handleCalculate = useCallback(() => {
    if (corners.length < 4) return;
    const depthMeters = parseFloat(distanceText);
    if (isNaN(depthMeters) || depthMeters <= 0 || depthMeters > 10) {
      Alert.alert("Invalid distance", "Please enter a distance between 0.1 and 10 metres.");
      return;
    }

    // Top edge: Euclidean distance TL(0) → TR(1)
    // Bottom edge: Euclidean distance BL(3) → BR(2)
    // Using Euclidean rather than horizontal x-span so that a card rotated
    // in the frame is measured correctly — the actual projected card width is
    // the 2-D distance between the tapped corner points.
    const euclidean = (a: Corner, b: Corner) =>
      Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);
    const topWidthPx = euclidean(corners[0], corners[1]);
    const botWidthPx = euclidean(corners[3], corners[2]);
    const pixelWidth = (topWidthPx + botWidthPx) / 2;

    if (pixelWidth < 10) {
      Alert.alert(
        "Card too small in frame",
        "The detected card width is very small. Please re-capture with the card closer and more prominent in frame.",
      );
      return;
    }

    const focal = backSolveFocalLength(pixelWidth, depthMeters, "credit_card");
    setDerivedFocal(focal);
    setStep("result");
  }, [corners, distanceText]);

  // ── Step 5: Save ──────────────────────────────────────────────────────────
  const handleSave = useCallback(async () => {
    if (derivedFocal === null) return;
    setSaving(true);
    try {
      const depthMeters = parseFloat(distanceText);
      const profile = buildCalibrationProfile(
        deviceId,
        derivedFocal,
        imageNativeW,
        depthMeters,
      );
      await saveCalibrationProfile(deviceId, profile);
      onSaved(profile);
      await reset();
      onClose();
    } catch {
      Alert.alert("Save failed", "Could not write the calibration profile. Please try again.");
    } finally {
      setSaving(false);
    }
  }, [derivedFocal, deviceId, distanceText, imageNativeW, reset, onClose, onSaved]);

  // ── Layout helpers ─────────────────────────────────────────────────────────
  const { width: screenW } = Dimensions.get("window");
  const imageDisplayW = screenW - 48;
  const imageDisplayH = imageNativeH > 0
    ? imageDisplayW * (imageNativeH / imageNativeW)
    : imageDisplayW * 0.75;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="pageSheet"
      onRequestClose={handleClose}
    >
      <View style={[styles.root, { backgroundColor: colors.background }]}>
        {/* Header */}
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <Text style={[styles.headerTitle, { color: colors.foreground }]}>
            Calibrate Glasses Camera
          </Text>
          <Pressable onPress={handleClose} hitSlop={8}>
            <Ionicons name="close" size={24} color={colors.mutedForeground} />
          </Pressable>
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
        >
          {/* ── Step: Instructions ───────────────────────────────────────── */}
          {step === "instructions" && (
            <View style={styles.section}>
              <View style={[styles.iconCircle, { backgroundColor: "#17c4d322" }]}>
                <Ionicons name="glasses-outline" size={36} color="#17c4d3" />
              </View>
              <Text style={[styles.headline, { color: colors.foreground }]}>
                One-time glasses camera calibration
              </Text>
              <Text style={[styles.body, { color: colors.mutedForeground }]}>
                Meta Ray-Ban glasses use a camera with undisclosed sensor specs.
                Calibrating with a reference object lets the app derive the actual
                focal length so measurements from glasses frames are accurate.
              </Text>
              <View style={[styles.infoBox, { backgroundColor: "#17c4d310", borderColor: "#17c4d340" }]}>
                <Ionicons name="information-circle-outline" size={16} color="#17c4d3" />
                <Text style={[styles.infoText, { color: "#17c4d3" }]}>
                  The calibration image is captured by the glasses camera, not the phone camera.
                  Both cameras have different optics; using the phone would produce incorrect results.
                </Text>
              </View>
              <Text style={[styles.stepLabel, { color: colors.mutedForeground }]}>
                What you'll need
              </Text>
              <BulletRow icon="card-outline" colors={colors}
                text="A credit card (or any ISO 7810 ID-1 card — 85.6 × 54 mm)" />
              <BulletRow icon="glasses-outline" colors={colors}
                text="Glasses connected via BLE" />
              <BulletRow icon="hand-right-outline" colors={colors}
                text="Hold the card at arm's length in front of the glasses (~60 cm)" />
              <BulletRow icon="finger-print-outline" colors={colors}
                text="Tap the four corners on the preview frame the glasses send" />

              <Pressable
                onPress={() => void handleRequestSnapshot()}
                style={[styles.primaryBtn, { backgroundColor: "#17c4d3" }]}
              >
                <Ionicons name="camera-outline" size={18} color="#fff" />
                <Text style={styles.primaryBtnText}>Capture from glasses</Text>
              </Pressable>
            </View>
          )}

          {/* ── Step: Capturing (waiting for BLE frame) ──────────────────── */}
          {step === "capturing" && (
            <View style={styles.section}>
              <View style={[styles.iconCircle, { backgroundColor: "#17c4d322" }]}>
                <ActivityIndicator size="large" color="#17c4d3" />
              </View>
              <Text style={[styles.headline, { color: colors.foreground }]}>
                Waiting for glasses frame…
              </Text>
              <Text style={[styles.body, { color: colors.mutedForeground }]}>
                Hold a credit card at arm's length in front of the glasses camera,
                then press the glasses hardware button or wait for the snapshot to arrive.
              </Text>
              <Text style={[styles.body, { color: colors.mutedForeground }]}>
                The frame will appear automatically when the glasses send it (up to 12 s).
              </Text>
            </View>
          )}

          {/* ── Step: Corner selection ───────────────────────────────────── */}
          {step === "corners" && imageUri && (
            <View style={styles.section}>
              <Text style={[styles.headline, { color: colors.foreground }]}>
                Tap the four corners
              </Text>
              <Text style={[styles.body, { color: colors.mutedForeground }]}>
                Tap in order:{" "}
                <Text style={{ fontFamily: "Inter_600SemiBold", color: colors.foreground }}>
                  {CORNER_LABELS[corners.length] ?? "Done"}
                </Text>
              </Text>

              {/* Corner progress chips */}
              <View style={styles.chipRow}>
                {CORNER_LABELS.map((label, i) => (
                  <View
                    key={label}
                    style={[
                      styles.chip,
                      {
                        backgroundColor:
                          i < corners.length
                            ? "#22c55e22"
                            : i === corners.length
                              ? "#17c4d322"
                              : colors.muted,
                        borderColor:
                          i < corners.length
                            ? "#22c55e"
                            : i === corners.length
                              ? "#17c4d3"
                              : colors.border,
                      },
                    ]}
                  >
                    <Text
                      style={{
                        fontFamily: "Inter_500Medium",
                        fontSize: 11,
                        color:
                          i < corners.length
                            ? "#22c55e"
                            : i === corners.length
                              ? "#17c4d3"
                              : colors.mutedForeground,
                      }}
                    >
                      {i < corners.length ? "✓ " : ""}
                      {label}
                    </Text>
                  </View>
                ))}
              </View>

              {/* Tappable frame */}
              <Pressable
                onPress={handleImageTap}
                style={[
                  styles.imageWrapper,
                  { width: imageDisplayW, height: imageDisplayH },
                ]}
              >
                <Image
                  source={{ uri: imageUri }}
                  style={{ width: imageDisplayW, height: imageDisplayH, borderRadius: 10 }}
                  onLayout={onImageLayout}
                  resizeMode="contain"
                />
                {/* Overlay dots for placed corners */}
                {corners.map((c, i) => {
                  const displayX = (c.x / imageNativeW) * imageDisplayW;
                  const displayY = (c.y / imageNativeH) * imageDisplayH;
                  return (
                    <View
                      key={i}
                      style={[styles.cornerDot, { left: displayX - 8, top: displayY - 8 }]}
                    >
                      <Text style={styles.cornerDotText}>{i + 1}</Text>
                    </View>
                  );
                })}
              </Pressable>

              <Pressable onPress={() => setCorners([])} style={styles.secondaryBtn}>
                <Text style={[styles.secondaryBtnText, { color: colors.mutedForeground }]}>
                  Reset corners
                </Text>
              </Pressable>
              <Pressable
                onPress={() => { setCorners([]); void handleRequestSnapshot(); }}
                style={styles.secondaryBtn}
              >
                <Text style={[styles.secondaryBtnText, { color: colors.mutedForeground }]}>
                  Re-capture from glasses
                </Text>
              </Pressable>
            </View>
          )}

          {/* ── Step: Distance entry ──────────────────────────────────────── */}
          {step === "distance" && (
            <View style={styles.section}>
              <View style={[styles.iconCircle, { backgroundColor: "#f59e0b22" }]}>
                <Ionicons name="resize-outline" size={36} color="#f59e0b" />
              </View>
              <Text style={[styles.headline, { color: colors.foreground }]}>
                Confirm holding distance
              </Text>
              <Text style={[styles.body, { color: colors.mutedForeground }]}>
                How far (in metres) was the credit card from the glasses camera
                when you captured the frame? The default is 0.6 m (arm's length).
              </Text>

              <View style={[styles.inputRow, { borderColor: colors.border, backgroundColor: colors.muted }]}>
                <TextInput
                  value={distanceText}
                  onChangeText={setDistanceText}
                  keyboardType="decimal-pad"
                  style={[styles.distanceInput, { color: colors.foreground }]}
                  placeholder="0.60"
                  placeholderTextColor={colors.mutedForeground}
                  selectTextOnFocus
                />
                <Text style={[styles.inputUnit, { color: colors.mutedForeground }]}>
                  metres
                </Text>
              </View>

              <Pressable
                onPress={handleCalculate}
                style={[styles.primaryBtn, { backgroundColor: "#17c4d3" }]}
              >
                <Text style={styles.primaryBtnText}>Calculate focal length</Text>
              </Pressable>
              <Pressable onPress={() => setStep("corners")} style={styles.secondaryBtn}>
                <Text style={[styles.secondaryBtnText, { color: colors.mutedForeground }]}>
                  Back
                </Text>
              </Pressable>
            </View>
          )}

          {/* ── Step: Result ──────────────────────────────────────────────── */}
          {step === "result" && derivedFocal !== null && (
            <View style={styles.section}>
              <View style={[styles.iconCircle, { backgroundColor: "#22c55e22" }]}>
                <Ionicons name="checkmark-circle-outline" size={36} color="#22c55e" />
              </View>
              <Text style={[styles.headline, { color: colors.foreground }]}>
                Calibration complete
              </Text>
              <Text style={[styles.body, { color: colors.mutedForeground }]}>
                The glasses camera focal length has been calculated from your
                credit-card reference captured by the glasses. Save it to apply
                automatically to all future measurements from these glasses.
              </Text>

              <View style={[styles.resultCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
                <ResultRow label="Derived focal length" value={`${Math.round(derivedFocal)} px`} colors={colors} />
                <ResultRow label="Reference object" value="Credit card (85.6 × 54 mm)" colors={colors} />
                <ResultRow label="Holding distance" value={`${parseFloat(distanceText).toFixed(2)} m`} colors={colors} />
                <ResultRow label="Device" value={deviceId.slice(-17)} colors={colors} isLast />
              </View>

              {(derivedFocal < 300 || derivedFocal > 3000) && (
                <View style={[styles.warningBox, { backgroundColor: "#f59e0b18", borderColor: "#f59e0b55" }]}>
                  <Ionicons name="warning-outline" size={15} color="#f59e0b" />
                  <Text style={styles.warningText}>
                    Focal length is outside the typical range (300–3000 px).
                    Consider re-calibrating with a more accurate distance or
                    a card that fills more of the frame.
                  </Text>
                </View>
              )}

              <Pressable
                onPress={() => void handleSave()}
                disabled={saving}
                style={[styles.primaryBtn, { backgroundColor: "#22c55e", opacity: saving ? 0.7 : 1 }]}
              >
                {saving ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <>
                    <Ionicons name="save-outline" size={16} color="#fff" />
                    <Text style={styles.primaryBtnText}>Save calibration</Text>
                  </>
                )}
              </Pressable>
              <Pressable
                onPress={() => { setCorners([]); void handleRequestSnapshot(); }}
                style={styles.secondaryBtn}
              >
                <Text style={[styles.secondaryBtnText, { color: colors.mutedForeground }]}>
                  Re-calibrate
                </Text>
              </Pressable>
            </View>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

// ─── Small helper components ──────────────────────────────────────────────────

function BulletRow({
  icon,
  text,
  colors,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  text: string;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <View style={bulletStyles.row}>
      <Ionicons name={icon} size={17} color="#17c4d3" style={{ marginTop: 1 }} />
      <Text style={[bulletStyles.text, { color: colors.mutedForeground }]}>{text}</Text>
    </View>
  );
}

function ResultRow({
  label,
  value,
  colors,
  isLast,
}: {
  label: string;
  value: string;
  colors: ReturnType<typeof useColors>;
  isLast?: boolean;
}) {
  return (
    <View
      style={[
        resultStyles.row,
        !isLast && { borderBottomWidth: 1, borderBottomColor: colors.border },
      ]}
    >
      <Text style={[resultStyles.label, { color: colors.mutedForeground }]}>{label}</Text>
      <Text style={[resultStyles.value, { color: colors.foreground }]}>{value}</Text>
    </View>
  );
}

// ─── Utility: encode Uint8Array → base64 ────────────────────────────────────

function uint8ArrayToBase64(bytes: Uint8Array): string {
  const CHUNK = 8192;
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + CHUNK, bytes.byteLength)));
  }
  return btoa(binary);
}

/**
 * Extract width/height from a JPEG SOF0/SOF1 marker.
 * Returns { width: 0, height: 0 } when the header cannot be parsed.
 */
function decodeJpegDimensions(jpeg: Uint8Array): { width: number; height: number } {
  try {
    let i = 2; // skip SOI marker (FF D8)
    while (i < jpeg.byteLength - 8) {
      if (jpeg[i] !== 0xff) break;
      const marker = jpeg[i + 1];
      const segLen = (jpeg[i + 2] << 8) | jpeg[i + 3];
      // SOF0 = 0xC0, SOF1 = 0xC1, SOF2 = 0xC2
      if (marker >= 0xc0 && marker <= 0xc2) {
        const height = (jpeg[i + 5] << 8) | jpeg[i + 6];
        const width  = (jpeg[i + 7] << 8) | jpeg[i + 8];
        return { width, height };
      }
      i += 2 + segLen;
    }
  } catch { /* ignore */ }
  return { width: 0, height: 0 };
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
  },
  headerTitle: { fontFamily: "Inter_600SemiBold", fontSize: 16 },
  scroll: { flex: 1 },
  scrollContent: { padding: 24, paddingBottom: 48 },
  section: { gap: 14, alignItems: "center" },
  iconCircle: {
    width: 72, height: 72, borderRadius: 36,
    alignItems: "center", justifyContent: "center", marginBottom: 4,
  },
  headline: { fontFamily: "Inter_700Bold", fontSize: 20, textAlign: "center" },
  body: { fontFamily: "Inter_400Regular", fontSize: 14, lineHeight: 21, textAlign: "center" },
  stepLabel: {
    fontFamily: "Inter_600SemiBold", fontSize: 12,
    letterSpacing: 0.5, textTransform: "uppercase",
    alignSelf: "flex-start", marginTop: 4,
  },
  infoBox: {
    flexDirection: "row", gap: 8, alignSelf: "stretch",
    borderRadius: 8, borderWidth: 1, padding: 10, alignItems: "flex-start",
  },
  infoText: { fontFamily: "Inter_400Regular", fontSize: 12, flex: 1, lineHeight: 17 },
  primaryBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center",
    gap: 8, borderRadius: 10, paddingVertical: 13, paddingHorizontal: 20,
    alignSelf: "stretch", marginTop: 4,
  },
  primaryBtnText: { color: "#fff", fontFamily: "Inter_600SemiBold", fontSize: 15 },
  secondaryBtn: { alignItems: "center", paddingVertical: 6 },
  secondaryBtnText: { fontFamily: "Inter_400Regular", fontSize: 13 },
  chipRow: {
    flexDirection: "row", flexWrap: "wrap", gap: 6,
    alignSelf: "stretch", justifyContent: "center",
  },
  chip: { borderRadius: 6, borderWidth: 1, paddingVertical: 4, paddingHorizontal: 8 },
  imageWrapper: { position: "relative", borderRadius: 10, overflow: "visible" },
  cornerDot: {
    position: "absolute", width: 24, height: 24, borderRadius: 12,
    backgroundColor: "#17c4d3", alignItems: "center", justifyContent: "center",
    borderWidth: 2, borderColor: "#fff",
  },
  cornerDotText: { color: "#fff", fontFamily: "Inter_700Bold", fontSize: 11 },
  inputRow: {
    flexDirection: "row", alignItems: "center",
    borderWidth: 1, borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 10,
    alignSelf: "stretch", gap: 8,
  },
  distanceInput: { fontFamily: "Inter_600SemiBold", fontSize: 20, flex: 1 },
  inputUnit: { fontFamily: "Inter_400Regular", fontSize: 14 },
  resultCard: { borderRadius: 12, borderWidth: 1, overflow: "hidden", alignSelf: "stretch" },
  warningBox: {
    flexDirection: "row", gap: 8, alignSelf: "stretch",
    borderRadius: 8, borderWidth: 1, padding: 10, alignItems: "flex-start",
  },
  warningText: {
    fontFamily: "Inter_400Regular", fontSize: 12, color: "#f59e0b", flex: 1, lineHeight: 17,
  },
});

const bulletStyles = StyleSheet.create({
  row: { flexDirection: "row", gap: 10, alignSelf: "stretch", alignItems: "flex-start" },
  text: { fontFamily: "Inter_400Regular", fontSize: 14, lineHeight: 20, flex: 1 },
});

const resultStyles = StyleSheet.create({
  row: {
    flexDirection: "row", justifyContent: "space-between",
    alignItems: "center", paddingVertical: 11, paddingHorizontal: 14, gap: 8,
  },
  label: { fontFamily: "Inter_400Regular", fontSize: 13, flex: 1 },
  value: { fontFamily: "Inter_600SemiBold", fontSize: 13 },
});
