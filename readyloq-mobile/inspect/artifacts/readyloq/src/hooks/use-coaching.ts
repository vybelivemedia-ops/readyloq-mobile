import { useSyncExternalStore } from "react";

const STORAGE_KEY = "readyloq-coaching";
const CHANGE_EVENT = "readyloq-coaching-change";

function getSnapshot(): boolean {
  if (typeof window === "undefined") return true;
  // Default ON — coaching is opt-out so newer technicians get guidance by default.
  return window.localStorage.getItem(STORAGE_KEY) !== "off";
}

function subscribe(callback: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, callback);
  window.addEventListener("storage", callback);
  return () => {
    window.removeEventListener(CHANGE_EVENT, callback);
    window.removeEventListener("storage", callback);
  };
}

export function setCoaching(enabled: boolean): void {
  window.localStorage.setItem(STORAGE_KEY, enabled ? "on" : "off");
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function useCoaching(): { coachingEnabled: boolean; setCoaching: typeof setCoaching } {
  const coachingEnabled = useSyncExternalStore(subscribe, getSnapshot, () => true);
  return { coachingEnabled, setCoaching };
}
