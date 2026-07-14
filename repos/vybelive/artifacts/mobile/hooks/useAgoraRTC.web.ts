import { useRef } from "react";
import type { AgoraCredentials } from "@/contexts/StreamContext";

// Always false on web — Expo Go is a native-only concept.
export const isExpoGo = false;

interface UseAgoraRTCResult {
  isSupported: boolean;
  isJoined: boolean;
  engineRef: React.MutableRefObject<null>;
  leaveChannel: () => void;
}

export function useAgoraRTC(
  _streamId: string | null,
  _credentials: AgoraCredentials | null,
  _enabled: boolean
): UseAgoraRTCResult {
  const engineRef = useRef(null);
  return {
    isSupported: false,
    isJoined: false,
    engineRef,
    leaveChannel: () => {},
  };
}
