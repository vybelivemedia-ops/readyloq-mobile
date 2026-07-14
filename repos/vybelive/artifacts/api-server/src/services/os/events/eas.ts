// ─── OS Event Bus — EAS (Expo Application Services) Domain Events ─────────────
// Build, submit, and OTA-update lifecycle events from the Expo / EAS pipeline.
// Consumed primarily by the Release Manager executive.

export type EASPlatform = "android" | "ios" | "all";
export type EASBuildProfile = "development" | "preview" | "production";

export interface EASBuildPayload {
  /** EAS-assigned build ID */
  buildId: string;
  platform: EASPlatform;
  profile: EASBuildProfile;
  /** App version string, e.g. "0.9.20" */
  appVersion: string;
  /** Android versionCode / iOS buildNumber */
  buildNumber: number;
  /** Branch or channel the build targets */
  channel: string;
  /** EAS project slug */
  projectSlug: string;
}

export interface EASBuildCompletedPayload extends EASBuildPayload {
  /** Duration from queue to finish */
  durationMs: number;
  /** Direct download / install URL */
  artifactUrl: string;
}

export interface EASBuildFailedPayload extends EASBuildPayload {
  /** High-level failure reason */
  reason: string;
  /** Logfile URL on EAS servers */
  logUrl: string;
}

export interface EASSubmitPayload {
  buildId: string;
  platform: EASPlatform;
  /** "app_store" | "google_play" | "firebase" */
  store: "app_store" | "google_play" | "firebase";
  appVersion: string;
}

export interface EASUpdatePayload {
  /** EAS update group ID */
  updateId: string;
  /** Runtime version this update targets */
  runtimeVersion: string;
  /** Branch / channel */
  branch: string;
  platform: EASPlatform;
  /** Commit message used as the update description */
  message: string;
  /** Fingerprint hash for reproducibility */
  fingerprint: string;
}

export interface EASEventMap {
  "eas.build.queued": EASBuildPayload;
  "eas.build.started": EASBuildPayload;
  "eas.build.completed": EASBuildCompletedPayload;
  "eas.build.failed": EASBuildFailedPayload;
  "eas.submit.completed": EASSubmitPayload;
  "eas.update.published": EASUpdatePayload;
}
