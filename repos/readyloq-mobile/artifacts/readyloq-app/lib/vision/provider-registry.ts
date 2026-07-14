/**
 * Capture-provider registry — the runtime plug-in point for camera sources.
 *
 * A source is registered as a `CaptureProviderDefinition` (static metadata +
 * a `probe()` availability check + a `create()` factory). The capture screen
 * discovers sources through this registry instead of hardcoding constructors,
 * so adding a new camera means adding ONE definition — the screen, gallery,
 * provenance badges, and the persist → sync → analyze pipeline are untouched.
 *
 * This is the composition layer, so it may depend on platform types
 * (expo-camera, react); the pure contracts in ./types stay transport-neutral.
 */

import type { RefObject } from "react";
import type { CameraView } from "expo-camera";

import { createMediaImportProvider } from "./media-import-provider";
import { createNativeCameraProvider } from "./native-camera-provider";
import { FUTURE_PROVIDER_DEFINITIONS } from "./future-source-providers";
import type {
  CaptureCapabilities,
  CaptureProvider,
  CaptureSource,
  PreviewKind,
  ProviderAvailability,
  RequestCaptureProvider,
} from "./types";

/** Everything a provider might need to construct itself or probe availability. */
export type CaptureProviderContext = {
  /** For providers that render into the app's own <CameraView> (phone camera). */
  cameraRef?: RefObject<CameraView | null>;
};

export type CaptureProviderDefinition = {
  id: string;
  source: CaptureSource;
  label: string;
  description: string;
  capabilities: CaptureCapabilities;
  previewKind: PreviewKind;
  /** Cheap check: is this source usable on THIS device right now? */
  probe: (ctx: CaptureProviderContext) => Promise<ProviderAvailability>;
  /** Build a live provider instance. Only called for available sources. */
  create: (ctx: CaptureProviderContext) => CaptureProvider;
};

const REGISTRY = new Map<string, CaptureProviderDefinition>();

export function registerCaptureProvider(def: CaptureProviderDefinition): void {
  REGISTRY.set(def.id, def);
}

export function listCaptureProviders(): CaptureProviderDefinition[] {
  return [...REGISTRY.values()];
}

export function getCaptureProviderDefinition(
  id: string,
): CaptureProviderDefinition | undefined {
  return REGISTRY.get(id);
}

/** Probe every registered source — powers a "which cameras can I use?" picker. */
export async function probeCaptureProviders(
  ctx: CaptureProviderContext,
): Promise<
  { definition: CaptureProviderDefinition; availability: ProviderAvailability }[]
> {
  return Promise.all(
    listCaptureProviders().map(async (definition) => ({
      definition,
      availability: await definition.probe(ctx),
    })),
  );
}

/** Instantiate a request/response source by id (phone camera, library import). */
export function getRequestProvider(
  id: string,
  ctx: CaptureProviderContext,
): RequestCaptureProvider {
  const def = REGISTRY.get(id);
  if (!def) throw new Error(`Unknown capture provider: ${id}`);
  if (def.capabilities.mode !== "request_response") {
    throw new Error(`Capture provider "${id}" is not a request/response source`);
  }
  return def.create(ctx) as RequestCaptureProvider;
}

// ─── Built-in sources (Tier 1, shipping today) ──────────────────────────────

registerCaptureProvider({
  id: "native-camera",
  source: "phone_camera",
  label: "Phone camera",
  description: "The in-app camera with live AI preview.",
  capabilities: {
    mode: "request_response",
    transport: "on_device",
    hasLivePreview: true,
    producesVideo: false,
    requiresPairing: false,
  },
  previewKind: "native_camera",
  probe: async () => ({ available: true }),
  create: (ctx) => {
    if (!ctx.cameraRef) {
      throw new Error("native-camera requires a cameraRef in context");
    }
    return createNativeCameraProvider(ctx.cameraRef);
  },
});

registerCaptureProvider({
  id: "media-import",
  source: "media_import",
  label: "Import from device",
  description: "Pull existing footage (GoPro, drone, wearables) from the photo library.",
  capabilities: {
    mode: "request_response",
    transport: "on_device_library",
    hasLivePreview: false,
    producesVideo: false,
    requiresPairing: false,
  },
  previewKind: "none",
  probe: async () => ({ available: true }),
  create: () => createMediaImportProvider(),
});

// ─── Reserved future sources (metadata only, no driver yet) ─────────────────
// Registered so a source picker can list them as "coming soon"; wiring real
// hardware means replacing their `probe`/`create` — nothing else changes.
for (const def of FUTURE_PROVIDER_DEFINITIONS) registerCaptureProvider(def);
