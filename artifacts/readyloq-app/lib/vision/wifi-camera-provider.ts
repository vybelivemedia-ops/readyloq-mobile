/**
 * Wi-Fi camera capture provider.
 *
 * Supports GoPro cameras (via their local HTTP API) and any generic camera
 * that serves a JPEG still at a configurable URL (e.g. /snapshot.jpg,
 * /capture, /photo). The configured URL is stored in-memory for the session.
 *
 * Usage pattern:
 *   1. Call `configureWifiCamera({ baseUrl })` before use.
 *   2. Call `probeWifiCamera()` to verify the camera is reachable.
 *   3. The provider is registered in the registry and capture works normally.
 */

import * as Crypto from "expo-crypto";
import type { EvidenceItem, VisionProvider } from "./types";

interface WifiCameraConfig {
  baseUrl: string;
  capturePath?: string;
  label?: string;
}

let _config: WifiCameraConfig | null = null;

export function configureWifiCamera(config: WifiCameraConfig): void {
  _config = {
    ...config,
    baseUrl: config.baseUrl.replace(/\/$/, ""),
    capturePath: config.capturePath ?? detectCapturePath(config.baseUrl),
  };
}

export function getWifiCameraConfig(): WifiCameraConfig | null {
  return _config;
}

export function clearWifiCameraConfig(): void {
  _config = null;
}

/** Try to detect camera type from URL and return the right capture path. */
function detectCapturePath(baseUrl: string): string {
  if (baseUrl.includes("10.5.5.9") || baseUrl.includes("gopro")) {
    return "/gp/gpControl/execute?p1=gpStream&a1=proto_v2&c1=restart";
  }
  return "/snapshot.jpg";
}

/**
 * Build a JPEG capture URL for GoPro or generic cameras.
 * GoPro: GET /gp/gpMediaList then fetch first item, or use keepalive URL.
 * Generic: GET <baseUrl>/snapshot.jpg or custom path.
 */
function buildCaptureUrl(config: WifiCameraConfig): string {
  const base = config.baseUrl;
  if (base.includes("10.5.5.9")) {
    return `${base}/gp/gpMediaList`;
  }
  return `${base}${config.capturePath ?? "/snapshot.jpg"}`;
}

type ProbeResult = { available: true } | { available: false; reason: string };

/**
 * Probe the camera for availability.
 * Returns { available: true } if the camera responds to HTTP within 3 s.
 */
export async function probeWifiCamera(): Promise<ProbeResult> {
  if (!_config) return { available: false, reason: "No Wi-Fi camera configured." };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);

  try {
    const probeUrl = `${_config.baseUrl}/`;
    const res = await fetch(probeUrl, {
      method: "GET",
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (res.ok || res.status === 404) {
      return { available: true };
    }
    return { available: false, reason: `Camera responded with HTTP ${res.status}.` };
  } catch {
    clearTimeout(timeout);
    return { available: false, reason: "Camera not reachable — check Wi-Fi and IP address." };
  }
}

/**
 * Capture a still from the Wi-Fi camera.
 * Fetches the configured snapshot URL and converts the Blob to a local URI.
 */
async function captureFromWifiCamera(): Promise<EvidenceItem[]> {
  if (!_config) throw new Error("Wi-Fi camera is not configured.");

  const url = buildCaptureUrl(_config);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  let blob: Blob;
  try {
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) throw new Error(`Camera returned HTTP ${res.status}`);
    blob = await res.blob();
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }

  const fileReader = new FileReader();
  const dataUrl: string = await new Promise((resolve, reject) => {
    fileReader.onload = () => resolve(fileReader.result as string);
    fileReader.onerror = reject;
    fileReader.readAsDataURL(blob);
  });

  return [
    {
      id: Crypto.randomUUID(),
      uri: dataUrl,
      source: "wifi_stream",
      capturedAt: new Date().toISOString(),
    },
  ];
}

/** Create a VisionProvider backed by the configured Wi-Fi camera. */
export function createWifiCameraProvider(): VisionProvider {
  const config = _config;
  if (!config) throw new Error("Wi-Fi camera is not configured.");

  return {
    id: "wifi-camera",
    source: "wifi_stream",
    label: config.label ?? "Wi-Fi camera",
    capabilities: {
      mode: "request_response",
      transport: "wifi",
      hasLivePreview: false,
      producesVideo: false,
      requiresPairing: false,
    },
    capture: captureFromWifiCamera,
  };
}
