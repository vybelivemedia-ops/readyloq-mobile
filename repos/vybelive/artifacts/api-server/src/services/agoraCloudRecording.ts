/**
 * agoraCloudRecording — Agora Cloud Recording REST API v1 client.
 *
 * Agora Cloud Recording joins the RTC channel as a subscriber and records
 * the composite stream to the operator's configured storage (S3/GCS/OSS).
 *
 * Required env vars:
 *   AGORA_APP_ID           — Agora project App ID
 *   AGORA_CUSTOMER_ID      — REST API credentials (Console → RESTful API)
 *   AGORA_CUSTOMER_SECRET  — REST API credentials
 *
 * Required Agora Console configuration (one-time, per project):
 *   In Agora Console → Cloud Recording → Storage Configuration:
 *   Set a storage provider (S3/GCS/OSS) with write access.
 *   The recorded files are delivered to that bucket.
 *   The file URLs are returned from stopRecording().
 *
 * If any required env var is missing, every function throws
 * AgoraCloudRecordingNotConfiguredError — never silently skips.
 */

const BASE_URL = "https://api.agora.io/v1/apps";

export class AgoraCloudRecordingNotConfiguredError extends Error {
  constructor(missing: string) {
    super(
      `Agora Cloud Recording is not configured — ${missing} is missing. ` +
        "Set AGORA_APP_ID, AGORA_CUSTOMER_ID, and AGORA_CUSTOMER_SECRET in Replit Secrets. " +
        "Also configure a storage provider in Agora Console → Cloud Recording."
    );
    this.name = "AgoraCloudRecordingNotConfiguredError";
    Object.setPrototypeOf(this, AgoraCloudRecordingNotConfiguredError.prototype);
  }
}

function getCredentials() {
  const appId = process.env["AGORA_APP_ID"];
  const customerId = process.env["AGORA_CUSTOMER_ID"];
  const customerSecret = process.env["AGORA_CUSTOMER_SECRET"];
  if (!appId) throw new AgoraCloudRecordingNotConfiguredError("AGORA_APP_ID");
  if (!customerId) throw new AgoraCloudRecordingNotConfiguredError("AGORA_CUSTOMER_ID");
  if (!customerSecret) throw new AgoraCloudRecordingNotConfiguredError("AGORA_CUSTOMER_SECRET");
  const auth = Buffer.from(`${customerId}:${customerSecret}`).toString("base64");
  return { appId, auth };
}

async function agoraFetch(
  appId: string,
  auth: string,
  path: string,
  options: RequestInit = {},
  timeoutMs = 8_000
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const url = `${BASE_URL}/${appId}/cloud_recording${path}`;
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
        ...(options.headers ?? {}),
      },
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Agora Cloud Recording API error ${res.status}: ${body}`);
    }
    return res.json() as Promise<unknown>;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Step 1: Acquire a resourceId for the recording session.
 * resourceId is valid for 5 minutes — must start recording within that window.
 */
export async function acquireResourceId(channelName: string, uid: string): Promise<string> {
  const { appId, auth } = getCredentials();
  const body = await agoraFetch(appId, auth, "/acquire", {
    method: "POST",
    body: JSON.stringify({
      cname: channelName,
      uid,
      clientRequest: { resourceExpiredHour: 24, scene: 0 },
    }),
  });
  return (body as { resourceId: string }).resourceId;
}

/**
 * Build the GCS storage config for Agora Cloud Recording.
 *
 * When AGORA_STORAGE_GCS_BUCKET, AGORA_STORAGE_GCS_SERVICE_ACCOUNT_EMAIL, and
 * AGORA_STORAGE_GCS_PRIVATE_KEY are all set, Agora writes directly to that GCS bucket.
 * The recorded files land at: gs://<bucket>/<prefix>/<agora-generated-filename>
 *
 * Required env vars for GCS storage config:
 *   AGORA_STORAGE_GCS_BUCKET               — GCS bucket name (default: DEFAULT_OBJECT_STORAGE_BUCKET_ID)
 *   AGORA_STORAGE_GCS_SERVICE_ACCOUNT_EMAIL — Google service account email with write access
 *   AGORA_STORAGE_GCS_PRIVATE_KEY           — Service account private key PEM (base64-encoded)
 *   AGORA_RECORDING_FILE_PREFIX             — Object path prefix (default: "recordings/agora")
 *
 * Without these, Agora uses whatever storage was configured in Agora Console. You must then
 * set AGORA_RECORDING_EXTERNAL_BASE_URL to the full HTTPS URL prefix for those files so
 * the pipeline can construct a downloadable recording URL.
 */
function buildStorageConfig(): object | null {
  const bucket =
    process.env["AGORA_STORAGE_GCS_BUCKET"] ??
    process.env["DEFAULT_OBJECT_STORAGE_BUCKET_ID"];
  const saEmail = process.env["AGORA_STORAGE_GCS_SERVICE_ACCOUNT_EMAIL"];
  const saKeyB64 = process.env["AGORA_STORAGE_GCS_PRIVATE_KEY"];

  if (!bucket || !saEmail || !saKeyB64) return null;

  const prefix = (process.env["AGORA_RECORDING_FILE_PREFIX"] ?? "recordings/agora")
    .split("/")
    .filter(Boolean);

  return {
    vendor: 6,       // Google Cloud Storage
    region: 0,       // us-east1 (default)
    bucket,
    accessKey: saEmail,
    secretKey: Buffer.from(saKeyB64, "base64").toString("utf-8"),
    fileNamePrefix: prefix,
  };
}

/**
 * Construct the GCS object path from an Agora-returned filename.
 *
 * Agora returns filenames like "channelName_uid_timestamp_av.mp4".
 * The full object path is: <AGORA_RECORDING_FILE_PREFIX>/<filename>
 *
 * Returns null if AGORA_RECORDING_FILE_PREFIX is not configured,
 * meaning callers must fall back to AGORA_RECORDING_EXTERNAL_BASE_URL.
 */
export function buildRecordingObjectPath(agoraFilename: string): string | null {
  const prefix = process.env["AGORA_RECORDING_FILE_PREFIX"];
  if (!prefix) return null;
  return `${prefix.replace(/\/$/, "")}/${agoraFilename}`;
}

/**
 * Construct a full HTTPS recording URL from an Agora-returned filename.
 * Used when Agora is configured to write to an external storage (not Replit App Storage).
 *
 * Requires AGORA_RECORDING_EXTERNAL_BASE_URL (e.g. "https://storage.googleapis.com/my-bucket/recordings/agora").
 * Returns null if the env var is not set.
 */
export function buildRecordingExternalUrl(agoraFilename: string): string | null {
  const base = process.env["AGORA_RECORDING_EXTERNAL_BASE_URL"];
  if (!base) return null;
  return `${base.replace(/\/$/, "")}/${agoraFilename}`;
}

/**
 * Step 2: Start composite recording of the RTC channel.
 * Returns { resourceId, sid } — store both in the stream record.
 *
 * When GCS credentials are configured via AGORA_STORAGE_GCS_* env vars, Agora writes
 * directly to that bucket. Otherwise, Agora uses the storage configured in Agora Console.
 *
 * Recording config: 720×1280 portrait layout, H.264, 30fps, 2Mbps — optimised for POV.
 */
export async function startRecording(
  channelName: string,
  uid: string,
  resourceId: string,
  agoraToken: string
): Promise<{ resourceId: string; sid: string }> {
  const { appId, auth } = getCredentials();
  const storageConfig = buildStorageConfig();

  const clientRequest: Record<string, unknown> = {
    token: agoraToken,
    recordingConfig: {
      maxIdleTime: 120,
      streamTypes: 2,
      channelType: 0,
      videoStreamType: 1,
      transcodingConfig: {
        width: 720,
        height: 1280,
        fps: 30,
        bitrate: 2000,
        mixedVideoLayout: 1,
      },
      subscribeAudioUids: ["#allstream#"],
      subscribeVideoUids: ["#allstream#"],
    },
  };

  if (storageConfig) {
    clientRequest["storageConfig"] = storageConfig;
  }

  const body = await agoraFetch(
    appId,
    auth,
    `/resourceid/${encodeURIComponent(resourceId)}/mode/mix/start`,
    {
      method: "POST",
      body: JSON.stringify({ cname: channelName, uid, clientRequest }),
    }
  );
  const result = body as { resourceId: string; sid: string };
  return { resourceId: result.resourceId, sid: result.sid };
}

/**
 * Step 3: Stop the recording session.
 * Returns the list of recorded file URLs on success.
 * These URLs point to the operator's configured storage (S3/GCS/OSS).
 */
export async function stopRecording(
  channelName: string,
  uid: string,
  resourceId: string,
  sid: string
): Promise<string[]> {
  const { appId, auth } = getCredentials();
  const body = await agoraFetch(
    appId,
    auth,
    `/resourceid/${encodeURIComponent(resourceId)}/sid/${encodeURIComponent(sid)}/mode/mix/stop`,
    {
      method: "POST",
      body: JSON.stringify({
        cname: channelName,
        uid,
        clientRequest: {},
      }),
    }
  );
  const result = body as {
    serverResponse?: {
      fileList?: Array<{ fileName: string; trackType: string; uid: string; mixedAllUser: boolean; isPlayable: boolean; sliceStartTime: number }>;
      fileListMode?: string;
      uploadingStatus?: string;
    };
  };
  const fileList = result.serverResponse?.fileList ?? [];
  return fileList.filter((f) => f.isPlayable).map((f) => f.fileName);
}

/**
 * Query the status of an in-progress recording.
 * Useful for health checks or verifying that recording started successfully.
 */
export async function queryRecording(
  resourceId: string,
  sid: string
): Promise<{ status: number; fileList: string[] }> {
  const { appId, auth } = getCredentials();
  const body = await agoraFetch(
    appId,
    auth,
    `/resourceid/${encodeURIComponent(resourceId)}/sid/${encodeURIComponent(sid)}/mode/mix/query`
  );
  const result = body as {
    serverResponse?: {
      status?: number;
      fileList?: string;
    };
  };
  return {
    status: result.serverResponse?.status ?? -1,
    fileList: result.serverResponse?.fileList
      ? JSON.parse(result.serverResponse.fileList) as string[]
      : [],
  };
}

/**
 * Returns true only when Cloud Recording is explicitly opted in.
 *
 * Cloud Recording is a separate Agora product that must be activated per-project
 * in Agora Console → Cloud Recording → Enable. Having AGORA_APP_ID,
 * AGORA_CUSTOMER_ID, and AGORA_CUSTOMER_SECRET set is NOT sufficient — those are
 * also required by Media Push and must not auto-enable Cloud Recording.
 *
 * To enable Cloud Recording, set AGORA_CLOUD_RECORDING_ENABLED=true in
 * Replit Secrets after activating it in the Agora Console.
 */
export function isConfigured(): boolean {
  return !!(
    process.env["AGORA_CLOUD_RECORDING_ENABLED"] === "true" &&
    process.env["AGORA_APP_ID"] &&
    process.env["AGORA_CUSTOMER_ID"] &&
    process.env["AGORA_CUSTOMER_SECRET"]
  );
}
