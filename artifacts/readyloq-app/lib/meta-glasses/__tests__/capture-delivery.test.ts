import { describe, expect, it, vi } from "vitest";
import { createMetaCaptureDelivery, metaCaptureToEvidence } from "../capture-delivery";
import type { MetaWearablesCapture } from "../native-session-state";

const capture: MetaWearablesCapture = {
  uri: "file:///cache/meta-wearables/meta_real.jpg",
  capturedAt: "2026-10-04T12:00:00.000Z",
  source: "meta_wearables_dat",
  mimeType: "image/jpeg",
};

describe("DAT evidence delivery", () => {
  it("preserves source, timestamp and transport for the existing evidence intake", () => {
    expect(metaCaptureToEvidence(capture)).toMatchObject({
      uri: capture.uri,
      capturedAt: capture.capturedAt,
      source: "smart_glasses",
      metadata: {
        captureTransport: "meta_wearables_device_access_toolkit",
        nativeCaptureSource: "meta_wearables_dat",
        mimeType: "image/jpeg",
      },
    });
    expect(metaCaptureToEvidence(capture).id).toBe(metaCaptureToEvidence(capture).id);
  });

  it("cleans the native cache only after durable intake acknowledges the file", async () => {
    let acknowledge!: () => void;
    const durableSave = new Promise<void>((resolve) => { acknowledge = resolve; });
    const consume = vi.fn(() => durableSave);
    const remove = vi.fn(async () => {});
    const deliver = createMetaCaptureDelivery(consume, remove);
    const pending = deliver(capture);
    await Promise.resolve();
    expect(consume).toHaveBeenCalledOnce();
    expect(remove).not.toHaveBeenCalled();
    acknowledge();
    await pending;
    expect(remove).toHaveBeenCalledWith(capture.uri);
  });

  it("deduplicates repeated native events before and after commitment", async () => {
    const consume = vi.fn(async () => {});
    const remove = vi.fn(async () => {});
    const deliver = createMetaCaptureDelivery(consume, remove);
    await Promise.all([deliver(capture), deliver(capture)]);
    await deliver(capture);
    expect(consume).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledOnce();
  });

  it("retains cache evidence on failed intake and permits retry", async () => {
    const consume = vi.fn().mockRejectedValueOnce(new Error("durable save failed")).mockResolvedValueOnce(undefined);
    const remove = vi.fn(async () => {});
    const deliver = createMetaCaptureDelivery(consume, remove);
    await expect(deliver(capture)).rejects.toThrow("durable save failed");
    expect(remove).not.toHaveBeenCalled();
    await deliver(capture);
    expect(consume).toHaveBeenCalledTimes(2);
    expect(remove).toHaveBeenCalledOnce();
  });

  it("does not re-ingest committed evidence when optional cache cleanup fails", async () => {
    const consume = vi.fn(async () => {});
    const deliver = createMetaCaptureDelivery(consume, vi.fn().mockRejectedValue(new Error("cache locked")));
    await deliver(capture);
    await deliver(capture);
    expect(consume).toHaveBeenCalledOnce();
  });

  it.each([
    { ...capture, uri: "https://example.invalid/photo.jpg" },
    { ...capture, capturedAt: "not a date" },
    { ...capture, source: "ble" },
  ])("rejects malformed captures without invoking intake", async (value) => {
    const consume = vi.fn();
    const remove = vi.fn();
    await expect(createMetaCaptureDelivery(consume, remove)(value)).rejects.toThrow("invalid capture");
    expect(consume).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });
});