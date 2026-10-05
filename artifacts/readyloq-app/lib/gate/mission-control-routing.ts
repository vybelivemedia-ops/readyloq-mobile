export type MissionControlAccess =
  | "pending"
  | "error"
  | "super-admin"
  | "non-admin";

/** A 403 is a confirmed server denial; network and other errors fail closed. */
export function missionControlAccessForGate(input: {
  foregroundCheckPending: boolean;
  isFetching: boolean;
  isError: boolean;
  error: unknown;
  isSuccess: boolean;
  isSuperAdmin?: boolean;
}): MissionControlAccess {
  if (input.foregroundCheckPending || input.isFetching) return "pending";
  if (input.isError) {
    return input.error !== null && typeof input.error === "object" &&
      "status" in input.error && input.error.status === 403
      ? "non-admin" : "error";
  }
  if (input.isSuccess) return input.isSuperAdmin ? "super-admin" : "non-admin";
  return "pending";
}

export type NativeRouteDecision =
  | "platform-stack"
  | "redirect-platform"
  | "redirect-tenant"
  | "tenant"
  | "onboarding"
  | "wait"
  | "access-error";

/**
 * Pure native route policy. Platform routes require a successful live server
 * authorization result; existing tenant workspaces remain available offline.
 */
export function decideNativeRoute(input: {
  access: MissionControlAccess;
  inMissionControl: boolean;
  hasCompany: boolean;
}): NativeRouteDecision {
  const { access, inMissionControl, hasCompany } = input;

  if (access === "super-admin") {
    return inMissionControl ? "platform-stack" : "redirect-platform";
  }

  if (access === "non-admin") {
    if (inMissionControl) return hasCompany ? "redirect-tenant" : "onboarding";
    return hasCompany ? "tenant" : "onboarding";
  }

  if (access === "pending") {
    if (inMissionControl || !hasCompany) return "wait";
    return "tenant";
  }

  if (inMissionControl && hasCompany) return "redirect-tenant";
  return hasCompany ? "tenant" : "access-error";
}