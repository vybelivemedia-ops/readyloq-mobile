export type MissionControlAccess =
  | "pending"
  | "error"
  | "super-admin"
  | "non-admin";

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