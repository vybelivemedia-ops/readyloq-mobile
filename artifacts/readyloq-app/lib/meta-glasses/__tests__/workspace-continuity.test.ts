// @vitest-environment jsdom
import React, { useEffect } from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AppLayout from "../../../app/(app)/_layout";
import { useMetaWearablesSession } from "../../../hooks/useMetaWearablesSession";

const fixture = vi.hoisted(() => ({
  subject: "test-subject",
  profile: {
    user: { clerkUserId: "test-subject", companyId: 7, role: "technician", betaAccess: true },
    isLoading: false, isServerVerified: true, error: null as unknown,
    refetch: vi.fn(),
  },
  mission: {
    isFetching: false, isError: false, error: null, isSuccess: true,
    data: { isSuperAdmin: false }, refetch: vi.fn(),
  },
  appListeners: new Set<(state: string) => void>(),
  nativeListeners: new Map<string, Set<(status: unknown) => void>>(),
  native: {
    getStatus: vi.fn(), startSession: vi.fn(), stopSession: vi.fn(),
    removeCapture: vi.fn(), capturePhoto: vi.fn(),
  },
  getToken: vi.fn(),
  client: { removeQueries: vi.fn(), invalidateQueries: vi.fn() },
  deactivate: vi.fn(),
  mounts: 0,
  unmounts: 0,
}));

vi.mock("@clerk/expo", () => ({
  useAuth: () => ({ isLoaded: true, isSignedIn: true, userId: fixture.subject, getToken: fixture.getToken }),
  useUser: () => ({ user: null }),
}));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => fixture.client }));
vi.mock("@workspace/api-client-react", () => ({
  getGetMissionControlMeQueryKey: () => ["/api/mission-control/me"],
  setAuthTokenGetter: vi.fn(),
  useGetMissionControlMe: () => fixture.mission,
}));
vi.mock("@/hooks/useCurrentUser", () => ({
  CurrentUserProvider: ({ children }: { children: React.ReactNode }) => children,
  useCurrentUser: () => fixture.profile,
}));
vi.mock("react-native", () => ({
  Platform: { OS: "android" },
  View: ({ children, pointerEvents, accessibilityElementsHidden, style }: {
    children: React.ReactNode;
    pointerEvents?: string;
    accessibilityElementsHidden?: boolean;
    style?: { opacity?: number };
  }) => React.createElement("div", {
    "data-pointer-events": pointerEvents,
    "data-a11y-hidden": accessibilityElementsHidden,
    style: { opacity: style?.opacity },
  }, children),
  Text: ({ children }: { children: React.ReactNode }) => React.createElement("span", null, children),
  Alert: { alert: vi.fn() },
  AppState: {
    addEventListener: (_: string, fn: (state: string) => void) => {
      fixture.appListeners.add(fn);
      return { remove: () => fixture.appListeners.delete(fn) };
    },
  },
  NativeModules: { ReadyLoqMetaWearables: fixture.native },
  NativeEventEmitter: class {
    addListener(name: string, fn: (value: unknown) => void) {
      const listeners = fixture.nativeListeners.get(name) ?? new Set();
      fixture.nativeListeners.set(name, listeners);
      listeners.add(fn);
      return { remove: () => listeners.delete(fn) };
    }
  },
}));
vi.mock("expo-router", () => {
  function Inspection() {
    const meta = useMetaWearablesSession({ onCapture: () => {} });
    useEffect(() => {
      fixture.mounts++;
      return () => { fixture.unmounts++; };
    }, []);
    return React.createElement("span", null, meta.title);
  }
  const Stack = Object.assign(
    () => React.createElement(Inspection),
    { Screen: () => null },
  );
  return {
    Stack,
    Redirect: () => React.createElement("span", null, "Redirect"),
    usePathname: () => "/new-inspection",
    useRouter: () => ({ push: vi.fn() }),
  };
});
vi.mock("expo-device", () => ({ isDevice: false }));
vi.mock("expo-notifications", () => ({ setNotificationHandler: vi.fn() }));
vi.mock("@/lib/api-client", () => ({ setAuthTokenGetter: vi.fn() }));
vi.mock("@/lib/api", () => ({ registerPushToken: vi.fn(), createCompany: vi.fn() }));
vi.mock("@/hooks/useColors", () => ({ useColors: () => ({ background: "#000" }) }));
vi.mock("@/hooks/useSignOut", () => ({ useSignOut: () => vi.fn() }));
vi.mock("@/hooks/useNetworkStatus", () => ({
  useNetworkStatus: () => ({ isConnected: true, isInternetReachable: true }),
}));
vi.mock("@/lib/local/inspection-store", () => ({
  listLocalInspections: vi.fn().mockResolvedValue([]), deleteLocalInspection: vi.fn(),
}));
vi.mock("@/lib/sync/engine", () => ({
  configureSyncEngine: vi.fn(), deactivateSyncEngine: fixture.deactivate,
}));
vi.mock("@/lib/sync/background-task", () => ({
  cacheTokenForBackground: vi.fn(), clearCachedBackgroundToken: vi.fn(),
  registerBackgroundSync: vi.fn(), unregisterBackgroundSync: vi.fn(),
}));
vi.mock("@/lib/vision", () => ({ speechService: { initialize: vi.fn().mockResolvedValue(undefined) } }));
vi.mock("@/components/ui/Loader", () => ({
  FullScreenLoader: ({ label }: { label: string }) => React.createElement("span", null, label),
}));
vi.mock("@/components/ui/ErrorState", () => ({
  ErrorState: () => React.createElement("span", null, "Account error"),
}));
vi.mock("@/components/BetaPaused", () => ({ BetaPaused: () => React.createElement("span", null, "Beta paused") }));
vi.mock("@/components/Onboarding", () => ({ Onboarding: () => null }));

const ready = {
  registrationState: "REGISTERED", cameraPermission: "GRANTED", deviceCount: 1,
  sessionState: "IDLE", streamState: "STOPPED", canCapture: false,
};
const green = { ...ready, sessionState: "STARTED", streamState: "STREAMING", canCapture: true };
function connected() {
  act(() => fixture.nativeListeners.get("ReadyLoqMetaWearablesStatus")?.forEach(fn => fn(green)));
}
beforeEach(() => {
  vi.clearAllMocks();
  fixture.subject = "test-subject";
  fixture.profile.user = { clerkUserId: "test-subject", companyId: 7, role: "technician", betaAccess: true };
  Object.assign(fixture.profile, { isLoading: false, isServerVerified: true, error: null });
  fixture.profile.refetch.mockImplementation(() => {
    Object.assign(fixture.profile, { isLoading: true, isServerVerified: false });
  });
  fixture.mission.refetch.mockResolvedValue({});
  fixture.native.getStatus.mockResolvedValue(ready);
  fixture.native.stopSession.mockResolvedValue(ready);
  fixture.getToken.mockResolvedValue(null);
  fixture.appListeners.clear();
  fixture.nativeListeners.clear();
  fixture.mounts = fixture.unmounts = 0;
});
afterEach(async () => { cleanup(); await Promise.resolve(); });

describe("real workspace gate around post-Connect inspection ownership", () => {
  it("keeps green capture and its session owner mounted across foreground verification", async () => {
    render(React.createElement(AppLayout));
    await waitFor(() => expect(fixture.mounts).toBe(1));
    connected();
    expect(screen.getByText("Meta glasses connected")).toBeTruthy();
    act(() => fixture.appListeners.forEach(fn => fn("active")));
    await act(async () => { await Promise.resolve(); });
    expect(fixture.deactivate).toHaveBeenCalled(); // validation still revokes sync scope
    expect(fixture.unmounts).toBe(0);
    expect(fixture.native.stopSession).not.toHaveBeenCalled();
    expect(screen.getByText("Confirming your workspace…")).toBeTruthy();
    const blocked = document.querySelector<HTMLElement>('[data-pointer-events="none"]');
    expect(blocked?.style.opacity).toBe("0");
    expect(blocked?.getAttribute("data-a11y-hidden")).toBe("true");
    Object.assign(fixture.profile, { isLoading: false, isServerVerified: true });
    act(() => fixture.appListeners.forEach(fn => fn("active")));
    // Restore after the second refetch, simulating the same-tenant server result.
    Object.assign(fixture.profile, { isLoading: false, isServerVerified: true });
    await act(async () => { await Promise.resolve(); });
    await waitFor(() => expect(screen.queryByText("Confirming your workspace…")).toBeNull());
    expect(screen.getByText("Meta glasses connected")).toBeTruthy();
    expect(fixture.mounts).toBe(1);
    expect(fixture.native.stopSession).not.toHaveBeenCalled();
  });

  it("retains navigation during sync-triggered revalidation, not just foreground events", async () => {
    const view = render(React.createElement(AppLayout));
    await waitFor(() => expect(fixture.mounts).toBe(1));
    connected();
    Object.assign(fixture.profile, { isLoading: true, isServerVerified: false });
    view.rerender(React.createElement(AppLayout));
    expect(fixture.unmounts).toBe(0);
    expect(screen.getByText("Confirming your workspace…")).toBeTruthy();
    Object.assign(fixture.profile, { isLoading: false, isServerVerified: true });
    view.rerender(React.createElement(AppLayout));
    expect(fixture.mounts).toBe(1);
    expect(fixture.native.stopSession).not.toHaveBeenCalled();
  });

  it("never mounts an inspection on a cold unverified cached profile", () => {
    Object.assign(fixture.profile, { isLoading: true, isServerVerified: false });
    render(React.createElement(AppLayout));
    expect(fixture.mounts).toBe(0);
    expect(fixture.nativeListeners.size).toBe(0);
  });

  it.each(["company", "subject", "denial", "beta"] as const)(
    "removes the old inspection on %s change, even after green capture",
    async reason => {
      const view = render(React.createElement(AppLayout));
      await waitFor(() => expect(fixture.mounts).toBe(1));
      connected();
      if (reason === "company") fixture.profile.user = { ...fixture.profile.user, companyId: 9 };
      if (reason === "subject") fixture.subject = "other-subject";
      if (reason === "denial") fixture.profile.error = { status: 403 };
      if (reason === "beta") fixture.profile.user = { ...fixture.profile.user, betaAccess: false };
      view.rerender(React.createElement(AppLayout));
      await waitFor(() => expect(fixture.unmounts).toBeGreaterThan(0));
      await waitFor(() => expect(fixture.native.stopSession).toHaveBeenCalled());
    },
  );
});
