/**
 * Capture-provider registry — the runtime plug-in point for camera sources.
 *
 * A source is registered as a `CaptureProviderDefinition` (static metadata +
 * a `probe()` availability check + a `create()` factory). The capture screen
 * discovers sources through this registry instead of hardcoding constructors,
 * so adding a new camera means adding ONE definition — the screen, gallery,
 * provenance badges, and the persist → sync → analyze pipeline are untouched.
 *
 * PLATFORM WIRING:
 *   `captureProviderRegistry` implements @platform/provider-registry's
 *   Registry<CaptureProviderDefinition> contract. CaptureProviderDefinition
 *   satisfies Provider (has id + name) so it fits the generic constraint.
 *
 *   The extra methods (probeCaptureProviders, getRequestProvider) are domain-
 *   specific helpers that sit above the platform registry abstraction.
 *
 * DEPENDENCY NOTE:
 *   This file may depend on platform types and expo-camera / react because it
 *   is the composition layer. Pure contracts live in ./types (transport-neutral).
 */

import type { Registry } from "@platform/provider-registry";
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

/**
 * Static metadata + factory for a single capture source.
 *
 * Satisfies @platform/provider-registry's Provider constraint via `id` + `name`.
 * `name` is the human-readable display label (shown in source pickers).
 */
export type CaptureProviderDefinition = {
  id: string;
  /** Human-readable display label. Satisfies Provider.name. */
  name: string;
  source: CaptureSource;
  description: string;
  capabilities: CaptureCapabilities;
  previewKind: PreviewKind;
  /** Cheap check: is this source usable on THIS device right now? */
  probe: (ctx: CaptureProviderContext) => Promise<ProviderAvailability>;
  /** Build a live provider instance. Only called for available sources. */
  create: (ctx: CaptureProviderContext) => CaptureProvider;
};

// ─── Internal registry Map ───────────────────────────────────────────────────

const REGISTRY = new Map<string, CaptureProviderDefinition>();

// ─── @platform/provider-registry — Registry<CaptureProviderDefinition> ───────

/**
 * Platform-standard registry interface for capture provider definitions.
 *
 * Implements Registry<CaptureProviderDefinition> from @platform/provider-registry.
 * Use this when working with generic registry utilities or when the platform
 * registry contract is required.
 *
 * The module-level helpers (registerCaptureProvider, listCaptureProviders, etc.)
 * are thin aliases over this object and remain available for existing callers.
 */
export const captureProviderRegistry: Registry<CaptureProviderDefinition> = {
  register(def: CaptureProviderDefinition): void {
    REGISTRY.set(def.id, def);
  },
  unregister(id: string): void {
    REGISTRY.delete(id);
  },
  get(id: string): CaptureProviderDefinition | undefined {
    return REGISTRY.get(id);
  },
  list(): CaptureProviderDefinition[] {
    return [...REGISTRY.values()];
  },
  has(id: string): boolean {
    return REGISTRY.has(id);
  },
};

// ─── Module-level aliases (backward-compatible) ───────────────────────────────

export function registerCaptureProvider(def: CaptureProviderDefinition): void {
  captureProviderRegistry.register(def);
}

export function unregisterCaptureProvider(id: string): void {
  captureProviderRegistry.unregister(id);
}

export function listCaptureProviders(): CaptureProviderDefinition[] {
  return captureProviderRegistry.list();
}

export function getCaptureProviderDefinition(
  id: string,
): CaptureProviderDefinition | undefined {
  return captureProviderRegistry.get(id);
}

export function hasCaptureProvider(id: string): boolean {
  return captureProviderRegistry.has(id);
}

// ─── Domain-specific helpers (above the Registry abstraction) ────────────────

/** Probe every registered source — powers a "which cameras can I use?" picker. */
export async function probeCaptureProviders(
  ctx: CaptureProviderContext,
): Promise<
  { definition: CaptureProviderDefinition; availability: ProviderAvailability }[]
> {
  return Promise.all(
    captureProviderRegistry.list().map(async (definition) => ({
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
  const def = captureProviderRegistry.get(id);
  if (!def) throw new Error(`Unknown capture provider: ${id}`);
  if (def.capabilities.mode !== "request_response") {
    throw new Error(`Capture provider "${id}" is not a request/response source`);
  }
  return def.create(ctx) as RequestCaptureProvider;
}

// ─── Built-in sources (Tier 1, shipping today) ───────────────────────────────

registerCaptureProvider({
  id: "native-camera",
  source: "phone_camera",
  name: "Phone camera",
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
  name: "Import from device",
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

// ─── Reserved future sources (metadata only, no driver yet) ──────────────────
// Registered so a source picker can list them as "coming soon"; wiring real
// hardware means replacing their `probe`/`create` — nothing else changes.
for (const def of FUTURE_PROVIDER_DEFINITIONS) registerCaptureProvider(def);
