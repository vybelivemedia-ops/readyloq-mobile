/**
 * AgoraLocalView
 *
 * Renders the local camera feed via Agora's RtcSurfaceView.
 *
 * Guard pattern (same as GlassesStreamView / useAgoraRTC):
 *   react-native-agora must NEVER be statically imported at module scope.
 *   A bare `import { RtcSurfaceView } from "react-native-agora"` is evaluated
 *   at Hermes parse-time in release builds, before the native side has
 *   registered the module.  If the native module is missing or fails to
 *   initialise (New-Arch mismatch, missing SO, etc.) the process crashes
 *   before React mounts — which is the root cause of standalone Android
 *   release build failures.
 *
 *   Solution: lazy require() inside a module-level try/catch, identical to
 *   the guard already used by useAgoraRTC.ts and GlassesStreamView.tsx.
 *   The `import type` lines are erased at compile time and are safe to keep.
 */

import React from "react";
import { StyleSheet, View } from "react-native";
import Constants from "expo-constants";
import type { IRtcEngine } from "react-native-agora";

const IS_EXPO_GO = Constants.appOwnership === "expo";

type RtcSurfaceViewType = React.ComponentType<{
  style?: object;
  canvas: { uid: number; sourceType: number };
}>;

interface AgoraModuleShape {
  RtcSurfaceView: RtcSurfaceViewType;
  VideoSourceType: { VideoSourceCamera: number };
}

let AgoraViews: AgoraModuleShape | null = null;

if (!IS_EXPO_GO) {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("react-native-agora") as AgoraModuleShape;
    if (mod.RtcSurfaceView && mod.VideoSourceType) {
      AgoraViews = mod;
    }
  } catch {
    // Native module unavailable — AgoraLocalView will render null.
  }
}

interface AgoraLocalViewProps {
  engineRef: React.MutableRefObject<IRtcEngine | null>;
  uid: number;
  style?: object;
}

export function AgoraLocalView({ uid, style }: AgoraLocalViewProps) {
  if (!AgoraViews) return null;

  const { RtcSurfaceView, VideoSourceType } = AgoraViews;

  return (
    <View style={[StyleSheet.absoluteFill, style]}>
      <RtcSurfaceView
        style={StyleSheet.absoluteFill}
        canvas={{ uid, sourceType: VideoSourceType.VideoSourceCamera }}
      />
    </View>
  );
}
