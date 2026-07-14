// ─── OS Event Bus — VYBE Live Product Domain Events ───────────────────────────
// Events from the VYBE Live platform itself: streams, multistream destinations,
// AI clips, and creator milestones. These are the business-level signals the
// executive team monitors to assess product health.

export type VYBEPlatform =
  | "youtube"
  | "twitch"
  | "kick"
  | "facebook"
  | "instagram"
  | "tiktok"
  | "custom_rtmp";

export interface VYBEStreamPayload {
  streamId: string;
  userId: string;
  creatorUsername: string;
  title: string;
  /** "phone" | "gopro" | "meta_glasses" | "external_rtmp" */
  sourceDevice: string;
  /** Live platforms receiving the stream */
  platforms: VYBEPlatform[];
  ingestUrl: string;
}

export interface VYBEStreamEndedPayload extends VYBEStreamPayload {
  durationMs: number;
  peakViewers: number;
  avgViewers: number;
  totalViews: number;
  clipsGenerated: number;
}

export interface VYBEViewerSpikePayload {
  streamId: string;
  userId: string;
  currentViewers: number;
  previousViewers: number;
  /** Percentage change (can be negative for sudden drop) */
  changePercent: number;
  /** "spike" (>+50%) | "drop" (>-30%) */
  direction: "spike" | "drop";
}

export interface VYBEMultistreamPlatformPayload {
  streamId: string;
  userId: string;
  platform: VYBEPlatform;
  /** Agora Media Push channel or RTMP destination label */
  destinationLabel: string;
}

export interface VYBEMultistreamErrorPayload extends VYBEMultistreamPlatformPayload {
  errorCode: string;
  errorMessage: string;
  /** True if the platform was auto-reconnected */
  reconnected: boolean;
}

export interface VYBEClipPayload {
  clipId: string;
  streamId: string;
  userId: string;
  title: string;
  /** "highlight" | "reel" | "short" | "story" */
  format: "highlight" | "reel" | "short" | "story";
  durationSeconds: number;
  /** "vertical" | "horizontal" | "square" */
  aspectRatio: "vertical" | "horizontal" | "square";
  /** "pending" | "approved" | "rejected" */
  reviewStatus: "pending" | "approved" | "rejected";
}

export interface VYBEClipPublishedPayload extends VYBEClipPayload {
  platforms: VYBEPlatform[];
  /** AI-generated caption used for the publish */
  caption: string;
}

export interface VYBECreatorMilestonePayload {
  userId: string;
  creatorUsername: string;
  /** "first_stream" | "100_followers" | "1k_followers" | "10k_followers" | "pro_subscriber" | ... */
  milestone: string;
  value: number | null;
  /** Context about what triggered the milestone */
  context: string;
}

export interface VYBELiveEventMap {
  "vybe.stream.started": VYBEStreamPayload;
  "vybe.stream.ended": VYBEStreamEndedPayload;
  "vybe.stream.viewer_spike": VYBEViewerSpikePayload;
  "vybe.multistream.platform_connected": VYBEMultistreamPlatformPayload;
  "vybe.multistream.platform_error": VYBEMultistreamErrorPayload;
  "vybe.clip.generated": VYBEClipPayload;
  "vybe.clip.published": VYBEClipPublishedPayload;
  "vybe.creator.milestone": VYBECreatorMilestonePayload;
}
