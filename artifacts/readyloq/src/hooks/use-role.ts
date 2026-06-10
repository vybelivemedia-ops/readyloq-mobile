import { useSyncExternalStore } from "react";

export type Role = "manager" | "technician";

const STORAGE_KEY = "readyloq-role";
const CHANGE_EVENT = "readyloq-role-change";

function getSnapshot(): Role {
  if (typeof window === "undefined") return "manager";
  const v = window.localStorage.getItem(STORAGE_KEY);
  return v === "technician" ? "technician" : "manager";
}

function subscribe(callback: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(CHANGE_EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}

export function setRole(role: Role): void {
  window.localStorage.setItem(STORAGE_KEY, role);
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function useRole(): { role: Role; isManager: boolean; setRole: typeof setRole } {
  const role = useSyncExternalStore(subscribe, getSnapshot, () => "manager" as Role);
  return { role, isManager: role === "manager", setRole };
}
