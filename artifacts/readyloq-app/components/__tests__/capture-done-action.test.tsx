// @vitest-environment jsdom
import React from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const safe = vi.hoisted(() => ({ top: 24, bottom: 34, left: 0, right: 0 }));
vi.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => safe }));
vi.mock("react-native", () => ({
  Pressable: ({ children, onPress, disabled, testID, style, accessibilityLabel }: {
    children: React.ReactNode; onPress: () => void; disabled: boolean; testID: string;
    style: React.CSSProperties; accessibilityLabel: string;
  }) => <button data-testid={testID} data-native-style={JSON.stringify(style)} style={style}
    aria-label={accessibilityLabel} disabled={disabled} onClick={onPress}>{children}</button>,
  Text: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));
import { CaptureDoneAction } from "../CaptureDoneAction";

afterEach(() => {
  cleanup();
  Object.assign(safe, { top: 24, bottom: 34, left: 0, right: 0 });
});

function CaptureState({ wide = false, photos = 1, connected = false, overlay = "copilot", onDone = () => {} }: {
  wide?: boolean; photos?: number; connected?: boolean; overlay?: string; onDone?: () => void;
}) {
  return <div data-testid="camera-pane" style={{ position: "relative" }}>
    {connected && <div>Meta glasses connected</div>}
    <div data-testid="insights" style={{
      position: "absolute", bottom: 0, height: overlay === "copilot" ? "42%" : "100%", zIndex: 0,
    }}>Insights, device health, findings and tools</div>
    <CaptureDoneAction color="#17c4d3" onPress={onDone} disabled={photos === 0} safeAreaHandled={wide} />
  </div>;
}
function nativeStyle() {
  return JSON.parse(screen.getByTestId("capture-done").getAttribute("data-native-style")!) as {
    position: string; right: number; bottom: number; minHeight: number; minWidth: number; zIndex: number; elevation: number;
  };
}

describe("capture completion visibility regression", () => {
  it.each(["copilot", "fullscreen"])("stays above the %s insights overlay that covered the old toolbar", (overlay) => {
    render(<CaptureState connected overlay={overlay} />);
    const style = nativeStyle();
    expect(style.position).toBe("absolute");
    expect(style.zIndex).toBeGreaterThan(Number(screen.getByTestId("insights").style.zIndex));
    expect(style.elevation).toBeGreaterThan(0);
    expect(screen.getByTestId("camera-pane").lastElementChild).toBe(screen.getByTestId("capture-done"));
    expect(screen.getAllByRole("button", { name: "Done" })).toHaveLength(1);
  });

  it.each([
    [320, 568], [360, 780], [412, 915], [500, 300], [600, 960], [720, 680], [960, 600],
  ])("keeps Done inside the safe camera bounds at %sx%s, including narrow Fold panes", (width, height) => {
    const wide = width >= 600;
    safe.right = wide ? 0 : 20;
    render(<CaptureState wide={wide} connected />);
    const style = nativeStyle();
    const paneWidth = wide ? width / 2 : width;
    const paneHeight = wide ? height - safe.top - safe.bottom : height;
    expect(paneWidth - style.right - style.minWidth).toBeGreaterThanOrEqual(0);
    expect(paneHeight - style.bottom - style.minHeight).toBeGreaterThanOrEqual(0);
    expect(style.bottom).toBe(wide ? 12 : 12 + safe.bottom);
    expect(style.right).toBe(wide ? 16 : 16 + safe.right);
    expect(style.minHeight).toBeGreaterThanOrEqual(48);
  });

  it("remains mounted through Meta detection, capture, and resume inset changes", () => {
    const done = vi.fn();
    const view = render(<CaptureState photos={0} onDone={done} />);
    expect((screen.getByRole("button", { name: "Done" }) as HTMLButtonElement).disabled).toBe(true);
    view.rerender(<CaptureState photos={1} connected onDone={done} />);
    Object.assign(safe, { bottom: 48, right: 20 });
    view.rerender(<CaptureState photos={1} connected overlay="fullscreen" onDone={done} />);
    expect(nativeStyle().bottom).toBe(60);
    expect(nativeStyle().right).toBe(36);
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(done).toHaveBeenCalledTimes(1);
  });

  it("preserves the no-photo disabled gate without hiding the action", () => {
    const done = vi.fn();
    render(<CaptureState photos={0} connected onDone={done} />);
    fireEvent.click(screen.getByRole("button", { name: "Done" }));
    expect(done).not.toHaveBeenCalled();
    expect(screen.getByText("Done")).toBeTruthy();
  });
});

describe("real inspection screen integration", () => {
  const source = readFileSync(resolve(process.cwd(), "app/(app)/new-inspection.tsx"), "utf8");
  const capture = source.slice(source.indexOf("const renderDoneAction"), source.indexOf("// ─── Review step"));
  it("places completion outside both the wide toolbar and phone insights/measurement layers", () => {
    const wideStart = capture.indexOf("if (isWideScreen)");
    const phoneStart = capture.indexOf('ref={cameraRef} style={{ flex: 1 }}');
    const wide = capture.slice(wideStart, phoneStart);
    const phone = capture.slice(phoneStart);
    expect(wide.indexOf("{renderDoneAction(true)}")).toBeGreaterThan(wide.indexOf("{measureOverlay}"));
    expect(phone.indexOf("{renderDoneAction()}")).toBeGreaterThan(phone.indexOf("{showInsights ?"));
    expect(phone.indexOf("{renderDoneAction()}")).toBeGreaterThan(phone.indexOf("{measureOverlay}"));
    expect(capture).not.toContain("doneButton");
  });
  it("also keeps saved evidence review reachable while phone camera permission is pending or denied", () => {
    expect(capture.match(/\{renderDoneAction\(true\)\}/g)).toHaveLength(3);
    const permissionFallbacks = capture.slice(0, capture.indexOf("const isPhoneLandscape"));
    expect(permissionFallbacks.match(/\{renderDoneAction\(true\)\}/g)).toHaveLength(2);
  });
  it("keeps the original review navigation and photo-count gate, without DAT/session conditions", () => {
    const action = capture.slice(0, capture.indexOf("if (!permission)"));
    expect(action).toContain('onPress={() => setStep("review")}');
    expect(action).toContain("disabled={photos.length === 0}");
    expect(action).not.toMatch(/metaWearables|isLandscape|showInsights|capturing/);
  });
});
