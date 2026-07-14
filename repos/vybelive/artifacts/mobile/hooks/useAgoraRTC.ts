import { useCallback, useEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import Constants from "expo-constants";
import type {
  IRtcEngine,
  RtcStats,
  RtcConnection,
  LocalVideoStats,
  LocalAudioStats,
  ChannelMediaOptions,
} from "react-native-agora";
import { useGetAgoraToken } from "@workspace/api-client-react";
import type { AgoraCredentials } from "@/contexts/StreamContext";
import { useStream } from "@/contexts/StreamContext";

// True when running inside Expo Go (storeClient). Agora native modules are
// not bundled in Expo Go so we must never call createAgoraRtcEngine() there.
export const isExpoGo = Constants.appOwnership === "expo";

export interface UseAgoraRTCResult {
  isSupported: boolean;
  isJoined: boolean;
  engineRef: React.MutableRefObject<IRtcEngine | null>;
  leaveChannel: () => void;
}

export function useAgoraRTC(
  streamId: string | null,
  credentials: AgoraCredentials | null,
  enabled: boolean
): UseAgoraRTCResult {
  const engineRef = useRef<IRtcEngine | null>(null);
  // Supported = native + not Expo Go
  const [isSupported, setIsSupported] = useState<boolean>(
    Platform.OS !== "web" && !isExpoGo
  );
  const [isJoined, setIsJoined] = useState(false);
  const streamIdRef = useRef(streamId);
  streamIdRef.current = streamId;

  const {
    setBitrate,
    setDroppedFrames,
    setSignalStrength,
    setIsReconnecting,
    setIsLive,
    setIsConnecting,
    setViewerCount,
  } = useStream();

  const getAgoraToken = useGetAgoraToken();

  const leaveChannel = useCallback(() => {
    try {
      engineRef.current?.leaveChannel();
    } catch {
    }
    setIsJoined(false);
  }, []);

  useEffect(() => {
    // Never attempt Agora on web or inside Expo Go
    if (Platform.OS === "web" || isExpoGo) return;
    if (!credentials || !enabled || !streamId) return;

    let engine: IRtcEngine;

    try {
      // Dynamic require so the module is only loaded at call-time, never at
      // module-parse time.  This prevents crashes in environments where the
      // native side of react-native-agora is not registered (Expo Go).
      const Agora = require("react-native-agora") as typeof import("react-native-agora");

      engine = Agora.createAgoraRtcEngine();
      engineRef.current = engine;

      // Log the App ID prefix so it can be cross-checked against the Agora
      // Console project and the App ID used by the Media Push REST API.
      console.log(
        "[Agora] Initializing RTC engine",
        JSON.stringify({
          appIdPrefix: credentials.appId.slice(0, 8) + "...",
          channelName: credentials.channelName,
          uid: credentials.uid,
        })
      );

      engine.initialize({
        appId: credentials.appId,
        logConfig: { filePath: "" },
      });

      engine.enableAudio();
      engine.enableVideo();

      // [TEMP AUDIO DIAGNOSTIC] Explicitly ensure the local mic stream is not
      // muted and the capture volume is at full, then log the audio state.
      try {
        engine.muteLocalAudioStream(false);
        engine.adjustRecordingSignalVolume(100);
      } catch (e) {
        console.warn("[Agora][AUDIO] failed to set mic mute/volume", e);
      }
      console.log(
        "[Agora][AUDIO] enableAudio() called",
        JSON.stringify({
          audioEnabled: true,
          localAudioMuted: false,
          recordingSignalVolume: 100,
          publishMicrophoneTrackIntended: true,
        })
      );

      engine.setChannelProfile(
        Agora.ChannelProfileType.ChannelProfileLiveBroadcasting
      );
      engine.setClientRole(Agora.ClientRoleType.ClientRoleBroadcaster);
      engine.startPreview();
      setIsSupported(true);
      setIsConnecting(true);
    } catch {
      setIsSupported(false);
      return;
    }

    // Re-require for enums used in the event handlers / join options below.
    // Same cached module — require() is synchronous and memoised by Node/Metro.
    const {
      ChannelProfileType,
      ClientRoleType,
    } = require("react-native-agora") as typeof import("react-native-agora");

    const eventHandler = {
      onJoinChannelSuccess(conn: RtcConnection, elapsed: number) {
        console.log(
          "[Agora] ✅ joinChannel SUCCESS",
          JSON.stringify({
            channelId: conn.channelId,
            localUid: conn.localUid,
            elapsedMs: elapsed,
          })
        );
        setIsJoined(true);
        setIsConnecting(false);
        setIsLive(true);
      },

      onLeaveChannel(_conn: RtcConnection, _stats: RtcStats) {
        setIsJoined(false);
        setIsLive(false);
        setIsConnecting(false);
      },

      onRtcStats(_conn: RtcConnection, stats: RtcStats) {
        if (stats.txKBitRate !== undefined) {
          setBitrate(stats.txKBitRate * 1000);
        }
        if (stats.txPacketLossRate !== undefined) {
          setDroppedFrames(Math.round((stats.txPacketLossRate / 100) * 300));
        }
        if (stats.userCount !== undefined) {
          setViewerCount(Math.max(0, stats.userCount - 1));
        }
      },

      // [TEMP AUDIO DIAGNOSTIC] Fires when the local audio publish state
      // changes. StreamPublishState: 0=Idle 1=NoPublished 2=Publishing 3=Published.
      // If this never reaches 3 (Published), the mic track is not being sent.
      onAudioPublishStateChanged(
        channel: string,
        oldState: number,
        newState: number,
        _elapse: number
      ) {
        const stateNames: Record<number, string> = {
          0: "idle",
          1: "noPublished",
          2: "publishing",
          3: "published",
        };
        console.log(
          "[Agora][AUDIO] local audio publish state changed",
          JSON.stringify({
            channel,
            from: stateNames[oldState] ?? oldState,
            to: stateNames[newState] ?? newState,
          })
        );
      },

      // [TEMP AUDIO DIAGNOSTIC] Periodic local audio stats. If sentBitrate is 0
      // while published, the mic is captured but carrying silence (e.g. no
      // RECORD_AUDIO permission or a muted hardware mic).
      onLocalAudioStats(_conn: RtcConnection, stats: LocalAudioStats) {
        console.log(
          "[Agora][AUDIO] local audio stats",
          JSON.stringify({
            sentBitrateKbps: stats.sentBitrate,
            sentSampleRate: stats.sentSampleRate,
            numChannels: stats.numChannels,
            txPacketLossRate: stats.txPacketLossRate,
          })
        );
      },

      onLocalVideoStats(_conn: RtcConnection, stats: LocalVideoStats) {
        if (
          stats.encodedFrameCount !== undefined &&
          stats.captureFrameRate !== undefined
        ) {
          const dropped = Math.max(
            0,
            stats.captureFrameRate -
              (stats.encodedFrameCount ?? stats.captureFrameRate)
          );
          setDroppedFrames(dropped);
        }
      },

      onNetworkQuality(
        _conn: RtcConnection,
        _uid: number,
        txQuality: number,
        _rxQuality: number
      ) {
        const signalMap: Record<number, number> = {
          0: 3, 1: 4, 2: 3, 3: 2, 4: 1, 5: 0, 6: 0,
        };
        setSignalStrength(signalMap[txQuality] ?? 2);
      },

      onConnectionStateChanged(
        _conn: RtcConnection,
        state: number,
        _reason: number
      ) {
        const ConnectionStateReconnecting = 4;
        const ConnectionStateConnected = 3;
        const ConnectionStateDisconnected = 1;
        const ConnectionStateFailed = 5;

        setIsReconnecting(state === ConnectionStateReconnecting);
        if (state === ConnectionStateConnected) {
          setIsConnecting(false);
          setIsJoined(true);
        }
        if (
          state === ConnectionStateDisconnected ||
          state === ConnectionStateFailed
        ) {
          setIsJoined(false);
        }
      },

      onTokenPrivilegeWillExpire(_conn: RtcConnection, _token: string) {
        const sid = streamIdRef.current;
        if (!sid) return;
        getAgoraToken
          .mutateAsync({ streamId: sid })
          .then((newCreds) => {
            engineRef.current?.renewToken(newCreds.token);
          })
          .catch(() => {});
      },

      onError(err: number, msg: string) {
        console.warn("[Agora] RTC error:", err, msg);
      },
    };

    engine.registerEventHandler(eventHandler);

    const joinOptions: ChannelMediaOptions = {
      channelProfile: ChannelProfileType.ChannelProfileLiveBroadcasting,
      clientRoleType: ClientRoleType.ClientRoleBroadcaster,
      publishMicrophoneTrack: true,
      publishCameraTrack: true,
      autoSubscribeAudio: false,
      autoSubscribeVideo: false,
    };

    // Log exactly what we hand to Agora so we can cross-check against the
    // Media Push task (which also uses streamId as channelName).
    console.log(
      "[Agora] Calling joinChannel",
      JSON.stringify({
        channelName: credentials.channelName,
        uid: credentials.uid,
        appIdPrefix: credentials.appId.slice(0, 8) + "...",
        tokenPrefix: credentials.token.slice(0, 20) + "...",
      })
    );

    engine.joinChannel(
      credentials.token,
      credentials.channelName,
      credentials.uid,
      joinOptions
    );

    return () => {
      try {
        engine.unregisterEventHandler(eventHandler);
        engine.leaveChannel();
        engine.release();
      } catch {
      }
      setIsJoined(false);
      engineRef.current = null;
    };
  }, [credentials?.token, enabled, streamId]);

  return { isSupported, isJoined, engineRef, leaveChannel };
}
