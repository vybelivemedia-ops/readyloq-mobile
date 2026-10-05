/**
 * Pure state normalization for the Android Meta Wearables Device Access Toolkit
 * bridge. Keeping this separate from React Native lets us test permission,
 * device-absence, capture-delivery, and unsupported-build behavior without a
 * physical pair of glasses.
 */

export type MetaWearablesAvailability =
  | "unsupported_build"
  | "needs_registration"
  | "needs_permission"
  | "no_device"
  | "connecting"
  | "connected"
  | "paused"
  | "error";

export interface MetaWearablesNativeStatus {
  platform?: string;
  registrationState?: string;
  cameraPermission?: string;
  deviceCount?: number;
  sessionState?: string;
  streamState?: string;
  error?: string;
  canStartSession?: boolean;
  canCapture?: boolean;
}

export interface MetaWearablesState {
  availability: MetaWearablesAvailability;
  title: string;
  guidance: string;
  canRegister: boolean;
  canRequestPermission: boolean;
  canStartSession: boolean;
  canCapture: boolean;
  error: string | null;
}

const normalized = (value: string | undefined) => value?.toUpperCase() ?? "";

export function deriveMetaWearablesState(
  status: MetaWearablesNativeStatus | null,
  nativeModulePresent: boolean,
  platform: string,
): MetaWearablesState {
  if (platform !== "android" || !nativeModulePresent) {
    return {
      availability: "unsupported_build",
      title: platform === "android" ? "Meta access needs a ReadyLoq build" : "Meta glasses are Android-only",
      guidance:
        platform === "android"
          ? "Expo Go cannot load Meta’s Wearables toolkit. Install an authorized ReadyLoq development, preview, or production build."
          : "Meta Wearables Device Access Toolkit support is currently available on Android only.",
      canRegister: false,
      canRequestPermission: false,
      canStartSession: false,
      canCapture: false,
      error: null,
    };
  }

  const registration = normalized(status?.registrationState);
  const permission = normalized(status?.cameraPermission);
  const session = normalized(status?.sessionState);
  const stream = normalized(status?.streamState);
  const deviceCount = status?.deviceCount ?? 0;

  if (status?.error) {
    return {
      availability: "error",
      title: "Meta glasses unavailable",
      guidance: `${status.error} Phone camera remains available.`,
      canRegister: registration !== "REGISTERED",
      canRequestPermission: registration === "REGISTERED" && permission !== "GRANTED",
      canStartSession: false,
      canCapture: false,
      error: status.error,
    };
  }

  if (registration !== "REGISTERED") {
    return {
      availability: "needs_registration",
      title: "Connect ReadyLoq in Meta AI",
      guidance:
        "Open the Meta AI approval flow, then return here after ReadyLoq is registered. Your account must be in the approved Meta release channel.",
      canRegister: true,
      canRequestPermission: false,
      canStartSession: false,
      canCapture: false,
      error: null,
    };
  }

  if (permission !== "GRANTED") {
    return {
      availability: "needs_permission",
      title: "Allow Meta glasses camera access",
      guidance:
        "Grant camera access in the Meta AI app. ReadyLoq cannot read photos until Meta AI approves this permission.",
      canRegister: false,
      canRequestPermission: true,
      canStartSession: false,
      canCapture: false,
      error: null,
    };
  }

  if (deviceCount < 1) {
    return {
      availability: "no_device",
      title: "No supported Meta glasses available",
      guidance:
        "Turn on and unfold the glasses, keep them nearby, and confirm they are connected in Meta AI. Development builds also require Developer Mode.",
      canRegister: false,
      canRequestPermission: false,
      canStartSession: false,
      canCapture: false,
      error: null,
    };
  }

  if (stream === "STREAMING" && session === "STARTED" && status?.canCapture !== false) {
    return {
      availability: "connected",
      title: "Meta glasses connected",
      guidance: "Ready for a real glasses photo. Captures are saved as inspection evidence.",
      canRegister: false,
      canRequestPermission: false,
      canStartSession: false,
      canCapture: true,
      error: null,
    };
  }

  if (session === "PAUSED") {
    return {
      availability: "paused",
      title: "Meta glasses session paused",
      guidance: "Keep the glasses connected and wait for the session to resume, or start a new session.",
      canRegister: false,
      canRequestPermission: false,
      canStartSession: false,
      canCapture: false,
      error: null,
    };
  }

  return {
    availability: "connecting",
    title: "Meta glasses ready to connect",
    guidance: "Start a glasses session to make the camera available for this inspection.",
    canRegister: false,
    canRequestPermission: false,
    canStartSession: !["STARTING", "STOPPING"].includes(session) &&
      !["STARTING", "STARTED", "STOPPING", "STREAMING"].includes(stream),
    canCapture: false,
    error: null,
  };
}

export interface MetaWearablesCapture {
  uri: string;
  capturedAt: string;
  source: "meta_wearables_dat";
  mimeType: "image/jpeg";
}

/** Reject malformed/native-failure events so they can never create evidence. */
export function isDeliverableMetaWearablesCapture(value: unknown): value is MetaWearablesCapture {
  if (!value || typeof value !== "object") return false;
  const capture = value as Partial<MetaWearablesCapture>;
  return (
    typeof capture.uri === "string" &&
    capture.uri.startsWith("file://") &&
    capture.uri.length > "file://".length &&
    typeof capture.capturedAt === "string" &&
    Number.isFinite(Date.parse(capture.capturedAt)) &&
    capture.source === "meta_wearables_dat" &&
    capture.mimeType === "image/jpeg"
  );
}