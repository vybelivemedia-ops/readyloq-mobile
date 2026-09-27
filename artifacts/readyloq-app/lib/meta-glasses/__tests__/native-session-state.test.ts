import { describe, expect, it } from "vitest";
import {
  deriveMetaWearablesState,
  isDeliverableMetaWearablesCapture,
} from "../native-session-state";

describe("Meta Wearables Device Access Toolkit state", () => {
  it("keeps Expo Go on an honest unsupported-build state", () => {
    const state = deriveMetaWearablesState(null, false, "android");
    expect(state.availability).toBe("unsupported_build");
    expect(state.canStartSession).toBe(false);
    expect(state.guidance).toContain("Expo Go");
  });

  it("requires Meta AI registration before a session can start", () => {
    const state = deriveMetaWearablesState(
      { registrationState: "UNREGISTERED", cameraPermission: "UNKNOWN" },
      true,
      "android",
    );
    expect(state.availability).toBe("needs_registration");
    expect(state.canRegister).toBe(true);
  });

  it("surfaces a denied Meta AI camera permission without creating a session", () => {
    const state = deriveMetaWearablesState(
      { registrationState: "REGISTERED", cameraPermission: "DENIED", deviceCount: 1 },
      true,
      "android",
    );
    expect(state.availability).toBe("needs_permission");
    expect(state.canRequestPermission).toBe(true);
    expect(state.canStartSession).toBe(false);
  });

  it("shows a truthful device-absence state after registration and permission", () => {
    const state = deriveMetaWearablesState(
      { registrationState: "REGISTERED", cameraPermission: "GRANTED", deviceCount: 0 },
      true,
      "android",
    );
    expect(state.availability).toBe("no_device");
    expect(state.canCapture).toBe(false);
  });

  it("allows capture only once the native camera stream is actually streaming", () => {
    const state = deriveMetaWearablesState(
      {
        registrationState: "REGISTERED",
        cameraPermission: "GRANTED",
        deviceCount: 1,
        sessionState: "STARTED",
        streamState: "STREAMING",
      },
      true,
      "android",
    );
    expect(state.availability).toBe("connected");
    expect(state.canCapture).toBe(true);
  });

  it("accepts only a real native file capture and rejects malformed delivery", () => {
    expect(
      isDeliverableMetaWearablesCapture({
        uri: "file:///cache/meta.jpg",
        capturedAt: "2026-08-21T12:00:00.000Z",
        source: "meta_wearables_dat",
        mimeType: "image/jpeg",
      }),
    ).toBe(true);
    expect(isDeliverableMetaWearablesCapture({ uri: "", source: "meta_wearables_dat" })).toBe(false);
  });
});