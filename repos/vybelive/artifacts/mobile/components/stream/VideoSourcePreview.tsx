/**
 * VideoSourcePreview
 *
 * Renders the appropriate full-screen preview for whatever IVideoSource is
 * currently active. The streaming pipeline is entirely source-agnostic —
 * this component is the only place that branches on source type.
 *
 * meta_glasses (Device Access Toolkit):
 *   → EMWDATStreamView when a DAT session is active and streaming
 *   → Connecting overlay while session is being created
 *   → CameraView (phone camera) as visual stand-in in simulation/Expo Go
 *
 * sdk_capture sources (phone, USB camera):
 *   → AgoraLocalView when Agora SDK is joined
 *   → CameraView (expo-camera) as fallback / Expo Go
 *   → Web placeholder on Platform.OS === 'web'
 *
 * rtmp_ingest sources (external_rtmp, GoPro, WebRTC):
 *   → Ingest URL + stream key display card
 *
 * Error / not_available states:
 *   → Full-screen error card with guidance text
 */

import { Feather } from "@expo/vector-icons";
import { CameraView } from "expo-camera";
import React from "react";
import { Platform, StyleSheet, Text, View } from "react-native";

import { AgoraLocalView } from "@/components/stream/AgoraLocalView";
import { GlassesStreamView, glassesStreamViewAvailable } from "@/components/stream/GlassesStreamView";
import { useColors } from "@/hooks/useColors";
import type { DATStreamState } from "@/contexts/MetaWearablesContext";
import type { IVideoSource } from "@/types/videoSource";

// ── Props ─────────────────────────────────────────────────────────────────────

interface VideoSourcePreviewProps {
  source: IVideoSource;
  /** Controlled by pov.tsx; only relevant for phone camera. */
  facing: "front" | "back";
  /** True when Agora SDK has joined the channel (dev build only). */
  agoraJoined: boolean;
  /**
   * Agora engine ref forwarded from useAgoraRTC.
   * Typed `any` to remain compatible with both the native IRtcEngine ref and
   * the web stub's MutableRefObject<null>.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  agoraEngine: React.MutableRefObject<any>;
  /** Local UID for the Agora channel. */
  agoraUid: number;
  /**
   * Active DAT session ID — provided by MetaWearablesContext when a Meta
   * Glasses session is running. Triggers EMWDATStreamView rendering.
   */
  datSessionId?: string | null;
  /**
   * Current DAT stream state — used to show connecting/starting/error UI
   * for the Meta Glasses source before frames start flowing.
   */
  datStreamState?: DATStreamState;
}

export function VideoSourcePreview({
  source,
  facing,
  agoraJoined,
  agoraEngine,
  agoraUid,
  datSessionId,
  datStreamState,
}: VideoSourcePreviewProps) {
  const colors = useColors();
  const { capabilities, state, displayName } = source;

  // ── Error / not-available states ─────────────────────────────────────────
  if (state.status === "error" || state.status === "not_available") {
    return (
      <View
        style={[styles.infoView, { backgroundColor: colors.background }]}
        pointerEvents="none"
      >
        <View style={[styles.infoIcon, { backgroundColor: "rgba(255,59,108,0.15)" }]}>
          <Feather name="alert-circle" size={36} color="#FF3B6C" />
        </View>
        <Text style={[styles.infoTitle, { color: colors.foreground }]}>
          {displayName} Unavailable
        </Text>
        {state.error ? (
          <Text style={[styles.infoSub, { color: colors.mutedForeground }]}>
            {state.error}
          </Text>
        ) : null}
        {state.guidance ? (
          <View style={[styles.guidanceBox, { backgroundColor: "rgba(255,255,255,0.06)" }]}>
            <Text style={[styles.guidanceText, { color: colors.mutedForeground }]}>
              {state.guidance}
            </Text>
          </View>
        ) : null}
      </View>
    );
  }

  // ── Connecting state (non-meta-glasses) ──────────────────────────────────
  if (state.status === "connecting" && source.type !== "meta_glasses") {
    return (
      <View
        style={[styles.infoView, { backgroundColor: colors.background }]}
        pointerEvents="none"
      >
        <View style={[styles.infoIcon, { backgroundColor: colors.primary + "20" }]}>
          <Feather name="loader" size={36} color={colors.primary} />
        </View>
        <Text style={[styles.infoTitle, { color: colors.foreground }]}>
          Connecting to {displayName}…
        </Text>
      </View>
    );
  }

  // ── RTMP ingest mode: show URL card ──────────────────────────────────────
  if (capabilities.mode === "rtmp_ingest") {
    const isStreaming = state.status === "streaming";
    return (
      <View style={[styles.infoView, { backgroundColor: "#09090F" }]} pointerEvents="none">
        <View
          style={[
            styles.infoIcon,
            { backgroundColor: isStreaming ? colors.primary + "20" : "rgba(255,255,255,0.06)" },
          ]}
        >
          <Feather
            name="wifi"
            size={36}
            color={isStreaming ? colors.primary : colors.mutedForeground}
          />
        </View>
        <Text style={[styles.infoTitle, { color: colors.foreground }]}>
          {isStreaming ? `${displayName} Connected` : displayName}
        </Text>
        {isStreaming && state.rtmpIngestUrl ? (
          <>
            <View style={[styles.rtmpRow, { backgroundColor: "rgba(255,255,255,0.06)" }]}>
              <Text style={[styles.rtmpLabel, { color: colors.mutedForeground }]}>RTMP INGEST</Text>
              <Text
                style={[styles.rtmpValue, { color: "#00D4FF" }]}
                selectable
                numberOfLines={2}
              >
                {state.rtmpIngestUrl}
              </Text>
            </View>
            {state.streamKey ? (
              <View style={[styles.rtmpRow, { backgroundColor: "rgba(255,255,255,0.06)", marginTop: 8 }]}>
                <Text style={[styles.rtmpLabel, { color: colors.mutedForeground }]}>STREAM KEY</Text>
                <Text
                  style={[styles.rtmpValue, { color: colors.foreground }]}
                  selectable
                  numberOfLines={1}
                >
                  {state.streamKey}
                </Text>
              </View>
            ) : null}
            <Text style={[styles.infoSub, { color: colors.mutedForeground, marginTop: 16 }]}>
              Point your encoder at the URL above and stream key to go live.
            </Text>
          </>
        ) : (
          <Text style={[styles.infoSub, { color: colors.mutedForeground }]}>
            Start your stream to generate an ingest URL and stream key.
          </Text>
        )}
      </View>
    );
  }

  // ── Meta Glasses (Device Access Toolkit) ─────────────────────────────────
  if (source.type === "meta_glasses") {
    // Session is live — render the glasses feed (native DAT view on a dev build,
    // phone camera stand-in in Expo Go).
    if (datStreamState === "streaming" || datStreamState === "paused") {
      return <GlassesStreamView isActive facing={facing} style={StyleSheet.absoluteFill} />;
    }

    // Session starting / waiting for the glasses to come online — show spinner.
    if (
      datStreamState === "starting" ||
      datStreamState === "waitingForDevice" ||
      state.status === "connecting"
    ) {
      return (
        <View style={[styles.infoView, { backgroundColor: "#09090F" }]} pointerEvents="none">
          <View style={[styles.infoIcon, { backgroundColor: colors.primary + "20" }]}>
            <Feather name="loader" size={36} color={colors.primary} />
          </View>
          <Text style={[styles.infoTitle, { color: colors.foreground }]}>
            {datStreamState === "waitingForDevice"
              ? "Waiting for glasses…"
              : "Starting glasses stream…"}
          </Text>
          <Text style={[styles.infoSub, { color: colors.mutedForeground }]}>
            {glassesStreamViewAvailable
              ? "Opening a Device Access Toolkit session"
              : "Simulated session (dev build required for live glasses)"}
          </Text>
        </View>
      );
    }

    // No native SDK (Expo Go) — use the phone camera as a visual stand-in.
    if (!glassesStreamViewAvailable && Platform.OS !== "web") {
      return <GlassesStreamView isActive={false} facing={facing} style={StyleSheet.absoluteFill} />;
    }

    // Connected, session not yet started (brief gap before startGlassesStream).
    return (
      <View style={[styles.infoView, { backgroundColor: "#09090F" }]} pointerEvents="none">
        <View style={[styles.infoIcon, { backgroundColor: colors.primary + "20" }]}>
          <Feather name="eye" size={36} color={colors.primary} />
        </View>
        <Text style={[styles.infoTitle, { color: colors.foreground }]}>Meta Glasses Ready</Text>
        <Text style={[styles.infoSub, { color: colors.mutedForeground }]}>Starting session…</Text>
      </View>
    );
  }

  // ── SDK capture mode — web placeholder ──────────────────────────────────
  if (Platform.OS === "web") {
    return (
      <View style={[StyleSheet.absoluteFill, styles.webCamera]}>
        <Feather name="video" size={72} color="rgba(255,255,255,0.08)" />
        <Text style={styles.webCameraText}>Camera preview</Text>
      </View>
    );
  }

  // ── SDK capture mode — Agora local view (dev build) ───────────────────
  if (agoraJoined) {
    return (
      <AgoraLocalView
        engineRef={agoraEngine}
        uid={agoraUid}
        style={StyleSheet.absoluteFill}
      />
    );
  }

  // ── SDK capture mode — expo-camera fallback (Expo Go / simulation) ────
  return <CameraView style={StyleSheet.absoluteFill} facing={facing} />;
}

const styles = StyleSheet.create({
  infoView: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
    gap: 12,
  },
  infoIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  infoTitle: {
    fontSize: 18,
    fontFamily: "Inter_700Bold",
    textAlign: "center",
  },
  infoSub: {
    fontSize: 14,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    lineHeight: 20,
  },
  guidanceBox: {
    borderRadius: 10,
    padding: 14,
    marginTop: 8,
    maxWidth: 320,
  },
  guidanceText: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    textAlign: "center",
    lineHeight: 19,
  },
  rtmpRow: {
    borderRadius: 10,
    padding: 12,
    width: "100%",
    maxWidth: 320,
    gap: 4,
  },
  rtmpLabel: {
    fontSize: 10,
    fontFamily: "Inter_700Bold",
    letterSpacing: 0.8,
  },
  rtmpValue: {
    fontSize: 13,
    fontFamily: "Inter_400Regular",
    lineHeight: 18,
  },
  webCamera: {
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    backgroundColor: "#09090F",
  },
  webCameraText: {
    color: "rgba(255,255,255,0.18)",
    fontSize: 15,
    fontFamily: "Inter_400Regular",
  },
});
