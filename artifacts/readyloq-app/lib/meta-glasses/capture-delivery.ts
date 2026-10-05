import type { EvidenceItem } from "@/lib/vision/types";
import { isDeliverableMetaWearablesCapture, type MetaWearablesCapture } from "./native-session-state";

/** DAT is a capture adapter, not a second evidence/upload pipeline. */
export function metaCaptureToEvidence(capture: MetaWearablesCapture): EvidenceItem {
  if (!isDeliverableMetaWearablesCapture(capture)) {
    throw new Error("Meta glasses returned an invalid capture; no evidence was added.");
  }
  return {
    id: `meta_dat_${capture.uri}`,
    uri: capture.uri,
    source: "smart_glasses",
    capturedAt: capture.capturedAt,
    metadata: {
      captureTransport: "meta_wearables_device_access_toolkit",
      nativeCaptureSource: capture.source,
      mimeType: capture.mimeType,
    },
  };
}

/** Deduplicate native events; retain cache evidence when durable intake fails. */
export function createMetaCaptureDelivery(
  consume: (capture: MetaWearablesCapture) => Promise<void> | void,
  removeCache: (uri: string) => Promise<void>,
) {
  const deliveries = new Map<string, Promise<void>>();
  return (value: unknown): Promise<void> => {
    if (!isDeliverableMetaWearablesCapture(value)) {
      return Promise.reject(new Error("Meta glasses returned an invalid capture; no evidence was added."));
    }
    const existing = deliveries.get(value.uri);
    if (existing) return existing;
    const delivery = Promise.resolve().then(async () => {
      await consume(value);
      // A cache-cleanup failure must not turn a committed photo into failed intake.
      await removeCache(value.uri).catch(() => undefined);
    }).catch((error) => {
      deliveries.delete(value.uri);
      throw error;
    });
    deliveries.set(value.uri, delivery);
    return delivery;
  };
}