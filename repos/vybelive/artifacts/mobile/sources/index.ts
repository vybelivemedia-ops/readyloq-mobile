/**
 * Video Source Registry
 *
 * To add a new wearable or video source:
 *  1. Create `<YourDevice>Source.ts` extending BaseVideoSource.
 *  2. Add a case to createVideoSource() below.
 *  3. Add an entry to VIDEO_SOURCE_CATALOG.
 *  4. Add the type to DeviceType in lib/db/src/schema/index.ts.
 *  5. Add the type to the OpenAPI DeviceType enum and run codegen.
 *
 * Zero changes to pov.tsx, the streaming pipeline, or the clip processor
 * are needed — the architecture is source-agnostic.
 */

import { ExternalRTMPSource } from "./ExternalRTMPSource";
import { GoProSource } from "./GoProSource";
import { MetaGlassesSource } from "./MetaGlassesSource";
import { PhoneCameraSource } from "./PhoneCameraSource";
import { USBCameraSource } from "./USBCameraSource";
import { WebRTCSource } from "./WebRTCSource";
import type { IVideoSource, VideoSourceType } from "@/types/videoSource";

export type { VideoSourceType } from "@/types/videoSource";
export { VideoSourceError } from "@/types/videoSource";
export type {
  IVideoSource,
  VideoSourceCapabilities,
  VideoSourceConfig,
  VideoSourceMode,
  VideoSourceState,
  VideoSourceStatus,
} from "@/types/videoSource";

/**
 * Factory — creates a fresh IVideoSource instance for the given type.
 * Always returns a new instance; callers should cache via useVideoSource().
 */
export function createVideoSource(type: VideoSourceType): IVideoSource {
  switch (type) {
    case "phone":        return new PhoneCameraSource();
    case "meta_glasses": return new MetaGlassesSource();
    case "gopro":        return new GoProSource();
    case "external_rtmp": return new ExternalRTMPSource();
    case "usb_camera":   return new USBCameraSource();
    case "webrtc":       return new WebRTCSource();
  }
}

/** Display order for the source picker UI in stream/setup.tsx. */
export const VIDEO_SOURCE_CATALOG: ReadonlyArray<{
  type: VideoSourceType;
  icon: string;
  available: boolean; // false = roadmap; shown dimmed in UI
}> = [
  { type: "phone",        icon: "smartphone", available: true  },
  { type: "meta_glasses", icon: "eye",        available: true  },
  { type: "gopro",        icon: "camera",     available: true  },
  { type: "external_rtmp",icon: "wifi",       available: true  },
  { type: "usb_camera",   icon: "video",      available: false },
  { type: "webrtc",       icon: "globe",      available: false },
];
