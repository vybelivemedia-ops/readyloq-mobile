import { useState, useEffect } from "react";

export interface BatteryStatus {
  level: number;
  charging: boolean;
  supported: boolean;
  isLow: boolean;
  isCritical: boolean;
  displayPct: number;
}

const UNSUPPORTED: BatteryStatus = {
  level: 1, charging: true, supported: false,
  isLow: false, isCritical: false, displayPct: 100,
};

function fromBattery(b: any): BatteryStatus {
  const level = typeof b.level === "number" ? b.level : 1;
  return {
    level,
    charging: !!b.charging,
    supported: true,
    isLow: level < 0.2 && !b.charging,
    isCritical: level < 0.1 && !b.charging,
    displayPct: Math.round(level * 100),
  };
}

export function useBatteryStatus(): BatteryStatus {
  const [status, setStatus] = useState<BatteryStatus>(UNSUPPORTED);

  useEffect(() => {
    const nav = navigator as any;
    if (typeof nav.getBattery !== "function") return;

    let battery: any = null;

    const update = () => setStatus(fromBattery(battery));

    nav.getBattery().then((b: any) => {
      battery = b;
      update();
      b.addEventListener("levelchange", update);
      b.addEventListener("chargingchange", update);
    }).catch(() => {});

    return () => {
      if (battery) {
        battery.removeEventListener("levelchange", update);
        battery.removeEventListener("chargingchange", update);
      }
    };
  }, []);

  return status;
}

export function suggestModeFromBattery(status: BatteryStatus): "low-power" | "standard" | "enhanced" {
  if (!status.supported) return "standard";
  if (status.charging) return "enhanced";
  if (status.level >= 0.7) return "enhanced";
  if (status.level >= 0.3) return "standard";
  return "low-power";
}
