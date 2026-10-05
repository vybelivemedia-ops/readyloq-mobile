import { describe, expect, it } from "vitest";

import { decideNativeRoute, missionControlAccessForGate } from "@/lib/gate/mission-control-routing";

describe("native Super Admin routing policy", () => {
  it("routes confirmed 403 denials to tenant or onboarding, but never treats network errors as denials", () => {
    const base = {
      foregroundCheckPending: false,
      isFetching: false,
      isError: true,
      isSuccess: false,
      isSuperAdmin: undefined,
    };
    const denied = missionControlAccessForGate({ ...base, error: { status: 403 } });
    expect(denied).toBe("non-admin");
    expect(decideNativeRoute({ access: denied, inMissionControl: true, hasCompany: true })).toBe("redirect-tenant");
    expect(decideNativeRoute({ access: denied, inMissionControl: true, hasCompany: false })).toBe("onboarding");
    expect(decideNativeRoute({ access: denied, inMissionControl: false, hasCompany: true })).toBe("tenant");
    expect(decideNativeRoute({ access: denied, inMissionControl: false, hasCompany: false })).toBe("onboarding");

    const offline = missionControlAccessForGate({ ...base, error: { status: 0 } });
    expect(offline).toBe("error");
    expect(decideNativeRoute({ access: offline, inMissionControl: false, hasCompany: false })).toBe("access-error");
    expect(missionControlAccessForGate({ ...base, isFetching: true, error: { status: 403 } })).toBe("pending");
    expect(missionControlAccessForGate({ ...base, isError: false, isSuccess: true, error: null, isSuperAdmin: true })).toBe("super-admin");
  });

  it.each([
    {
      name: "companyless confirmed Super Admin mounts the platform stack",
      input: {
        access: "super-admin" as const,
        inMissionControl: true,
        hasCompany: false,
      },
      expected: "platform-stack",
    },
    {
      name: "Super Admin launches into Mission Control before company setup",
      input: {
        access: "super-admin" as const,
        inMissionControl: false,
        hasCompany: false,
      },
      expected: "redirect-platform",
    },
    {
      name: "companyless non-admin reaches onboarding after fresh denial",
      input: {
        access: "non-admin" as const,
        inMissionControl: false,
        hasCompany: false,
      },
      expected: "onboarding",
    },
    {
      name: "deep-linked companyless non-admin is sent to onboarding",
      input: {
        access: "non-admin" as const,
        inMissionControl: true,
        hasCompany: false,
      },
      expected: "onboarding",
    },
    {
      name: "company non-admin reaches normal tenant routes",
      input: {
        access: "non-admin" as const,
        inMissionControl: false,
        hasCompany: true,
      },
      expected: "tenant",
    },
    {
      name: "company non-admin deep link is denied to tenant routes",
      input: {
        access: "non-admin" as const,
        inMissionControl: true,
        hasCompany: true,
      },
      expected: "redirect-tenant",
    },
    {
      name: "companyless account waits for the server check before setup",
      input: {
        access: "pending" as const,
        inMissionControl: false,
        hasCompany: false,
      },
      expected: "wait",
    },
    {
      name: "offline tenant company can keep using cached normal routes",
      input: {
        access: "error" as const,
        inMissionControl: false,
        hasCompany: true,
      },
      expected: "tenant",
    },
    {
      name: "companyless account fails closed when server authorization fails",
      input: {
        access: "error" as const,
        inMissionControl: false,
        hasCompany: false,
      },
      expected: "access-error",
    },
    {
      name: "deep link waits for authorization even when a tenant company is cached",
      input: {
        access: "pending" as const,
        inMissionControl: true,
        hasCompany: true,
      },
      expected: "wait",
    },
    {
      name: "offline deep link fails closed and redirects to tenant routes",
      input: {
        access: "error" as const,
        inMissionControl: true,
        hasCompany: true,
      },
      expected: "redirect-tenant",
    },
  ])("$name", ({ input, expected }) => {
    expect(decideNativeRoute(input)).toBe(expected);
  });
});