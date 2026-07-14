/**
 * Agora Media Push (RTMP Converter) service.
 *
 * The Agora cloud joins the RTC channel as a subscriber, transcodes, and
 * pushes to RTMP destinations (YouTube Live, Facebook Live, Twitch).
 *
 * Required Replit Secrets:
 *   AGORA_APP_ID            — Agora Console > Project Management
 *   AGORA_APP_CERTIFICATE   — Agora Console > Project Management
 *   AGORA_CUSTOMER_ID       — Agora Console > RESTful API
 *   AGORA_CUSTOMER_SECRET   — Agora Console > RESTful API
 *
 * Docs: https://docs.agora.io/en/media-push/develop/push-rtmp
 */

import { RtcTokenBuilder, RtcRole } from "agora-token";
import { logger } from "../lib/logger";

export interface RtmpDestination {
  platform: string;
  rtmpUrl: string;
  streamKey: string;
}

export interface PushStatus {
  taskId: string;
  platform: string;
  status: "connecting" | "live" | "reconnecting" | "failed" | "offline";
  bitrateKbps: number;
  errorMessage?: string;
}

function getRestAuth(): string {
  const id = process.env["AGORA_CUSTOMER_ID"];
  const secret = process.env["AGORA_CUSTOMER_SECRET"];
  if (!id || !secret) {
    throw new Error(
      "AGORA_CUSTOMER_ID and AGORA_CUSTOMER_SECRET required. Get from Agora Console > RESTful API.",
    );
  }
  return "Basic " + Buffer.from(`${id}:${secret}`).toString("base64");
}

function getAppId(): string {
  const id = process.env["AGORA_APP_ID"];
  if (!id) throw new Error("AGORA_APP_ID is not set.");
  return id;
}

function getAppCertificate(): string {
  const cert = process.env["AGORA_APP_CERTIFICATE"];
  if (!cert) throw new Error("AGORA_APP_CERTIFICATE is not set.");
  return cert;
}

/** Push region — path segment in the Media Push REST URL. Must be lowercase. */
function getPushRegion(): string {
  return (process.env["AGORA_PUSH_REGION"] ?? "na").toLowerCase();
}

function baseUrl(): string {
  return `https://api.agora.io/${getPushRegion()}/v1/projects/${getAppId()}/rtmp-converters`;
}

/**
 * Dedicated converter (subscriber) UID. Must be:
 *   - non-zero (UID 0 blocks CDN push), and
 *   - distinct from every host UID in the channel — a duplicate UID evicts the
 *     colliding client — so it lives above the creator range (1–100 000).
 * The converter joins the channel under this UID (carried inside the token)
 * and forwards the host named by rawOptions.rtcStreamUid.
 */
const CONVERTER_UID = 999999;

/** Token authenticating the converter's subscriber join, built for the given UID. */
function buildPushToken(channelName: string, uid: number): string {
  const expireTs = Math.floor(Date.now() / 1000) + 7200;
  return RtcTokenBuilder.buildTokenWithUid(
    getAppId(),
    getAppCertificate(),
    channelName,
    uid,
    RtcRole.SUBSCRIBER,
    expireTs,
    expireTs,
  );
}

function buildFullRtmpUrl(dest: RtmpDestination): string {
  if (!dest.streamKey) return dest.rtmpUrl;
  return `${dest.rtmpUrl}/${dest.streamKey}`;
}

/**
 * Start one push task per RTMP destination.
 * Returns Agora task ID (needed for stop/status calls).
 */
export async function startPushTask(
  channelName: string,
  destination: RtmpDestination,
  rtcStreamUid: number,
): Promise<string> {
  const auth = getRestAuth();
  const token = buildPushToken(channelName, CONVERTER_UID);
  const appId = getAppId();

  // Log the App ID prefix and channelName so they can be cross-checked
  // against the mobile joinChannel call and the Agora Console project.
  logger.info(
    {
      appIdPrefix: appId.slice(0, 8) + "...",
      channelName,
      platform: destination.platform,
      rtmpUrlPrefix: destination.rtmpUrl.slice(0, 40),
    },
    "Agora Media Push startPushTask — App ID and channelName being used",
  );

  const body = {
    converter: {
      name: `vybe-${channelName}-${destination.platform}`.slice(0, 64),
      idleTimeout: 300,
      // Non-transcoding (raw) forward — correct for a single-publisher POV
      // stream. The converter forwards the single host named by rtcStreamUid
      // directly to RTMP without transcoding (no canvas / layout / codec
      // options). The token carries the converter's own subscriber UID
      // (CONVERTER_UID), which must differ from rtcStreamUid to avoid a
      // channel UID collision.
      rawOptions: {
        rtcChannel: channelName,
        rtcStreamUid,
        token,
      },
      rtmpUrl: buildFullRtmpUrl(destination),
    },
  };

  // Required UID/mode trace — the three distinct identities involved:
  //   creatorUid    — the host publishing the source stream (== rtcStreamUid)
  //   converterUid  — the converter's own subscriber identity (carried in token)
  //   rtcStreamUid  — the source host the converter forwards
  logger.info(
    {
      mode: "raw",
      channelName,
      creatorUid: rtcStreamUid,
      converterUid: CONVERTER_UID,
      rtcStreamUid,
      platform: destination.platform,
    },
    "Agora Media Push — converter config (raw/non-transcoding mode)",
  );

  // [TEMP AUDIO DIAGNOSTIC] Media Push audio configuration.
  // In raw (non-transcoding) mode the converter forwards the host's native RTC
  // audio + video together; there is no per-stream audio toggle and no audio
  // codec to set — Agora transcodes the RTC Opus audio to AAC for RTMP using
  // its defaults. So audio inclusion here depends entirely on the host actually
  // publishing a non-silent mic track on the RTC side.
  logger.info(
    {
      mode: "raw",
      channelName,
      rtcStreamUid,
      audioForwarding: "enabled (raw mode forwards host audio+video as-is)",
      explicitAudioCodec: "none — raw mode uses Agora defaults (Opus → AAC)",
      platform: destination.platform,
    },
    "[AUDIO] Media Push audio configuration being sent to Agora",
  );

  // Full trace of the EXACT serialized request body that goes to fetch(),
  // with only the RTC token and RTMP stream key redacted. This is the
  // authoritative view of what Agora receives. Deep-clone, redact, then
  // JSON.stringify so the logged string matches the wire body byte-for-byte
  // (modulo the redacted secret values).
  const redactedBody = JSON.parse(JSON.stringify(body)) as typeof body;
  redactedBody.converter.rawOptions.token = "[REDACTED_TOKEN]";
  redactedBody.converter.rtmpUrl = body.converter.rtmpUrl.replace(
    /\/[^/]+$/,
    "/[REDACTED_STREAM_KEY]",
  );
  logger.info(
    { fullSerializedPayload: JSON.stringify(redactedBody) },
    "Agora Media Push — FULL serialized request body immediately before fetch (token + stream keys redacted)",
  );

  const res = await fetch(baseUrl(), {
    method: "POST",
    headers: {
      Authorization: auth,
      "Content-Type": "application/json",
      "X-Request-ID": `${channelName}-${destination.platform}-${Date.now()}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(
      `Agora Push start failed [${destination.platform}]: ${res.status} — ${await res.text()}`,
    );
  }
  const data = (await res.json()) as Record<string, unknown>;
  const converter = data["converter"] as Record<string, unknown> | undefined;
  const taskId = String(converter?.["id"] ?? data["converterId"] ?? "");
  if (!taskId) throw new Error("Agora returned no task ID for push converter");
  return taskId;
}

/** Stop a push task. 404 treated as success. */
export async function stopPushTask(taskId: string): Promise<void> {
  const auth = getRestAuth();
  const res = await fetch(`${baseUrl()}/${taskId}`, {
    method: "DELETE",
    headers: { Authorization: auth },
  });
  if (!res.ok && res.status !== 404) {
    throw new Error(
      `Agora Push stop failed [${taskId}]: ${res.status} — ${await res.text()}`,
    );
  }
}

/** Poll status of a running push task. */
export async function getPushTaskStatus(
  taskId: string,
  platform: string,
): Promise<PushStatus> {
  const auth = getRestAuth();
  const res = await fetch(`${baseUrl()}/${taskId}`, {
    headers: { Authorization: auth },
  });

  if (res.status === 404)
    return { taskId, platform, status: "offline", bitrateKbps: 0 };
  if (!res.ok)
    return {
      taskId,
      platform,
      status: "failed",
      bitrateKbps: 0,
      errorMessage: `HTTP ${res.status}`,
    };

  const data = (await res.json()) as Record<string, unknown>;
  const converter = data["converter"] as Record<string, unknown> | undefined;
  const state = String(converter?.["state"] ?? "idle").toLowerCase();
  const statusMap: Record<string, PushStatus["status"]> = {
    running: "live",
    idle: "offline",
    failure: "failed",
    connecting: "connecting",
    recovering: "reconnecting",
  };
  return {
    taskId,
    platform,
    status: statusMap[state] ?? "offline",
    bitrateKbps: Number(converter?.["videoRate"] ?? 0),
  };
}

export function isAgoraPushConfigured(): boolean {
  return !!(
    process.env["AGORA_APP_ID"] &&
    process.env["AGORA_APP_CERTIFICATE"] &&
    process.env["AGORA_CUSTOMER_ID"] &&
    process.env["AGORA_CUSTOMER_SECRET"]
  );
}
