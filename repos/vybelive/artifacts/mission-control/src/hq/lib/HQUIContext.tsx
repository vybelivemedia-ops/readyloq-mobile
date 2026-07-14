import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { ExecRole } from "./hqTypes";

export type HQPhase = "boot" | "hub" | "office";

interface HQUIValue {
  phase: HQPhase;
  focusedRole: ExecRole | null;
  soundOn: boolean;
  finishBoot: () => void;
  enterOffice: (role: ExecRole) => void;
  exitOffice: () => void;
  setSound: (on: boolean) => void;
}

const HQUIContext = createContext<HQUIValue | null>(null);

export function HQUIProvider({ children }: { children: React.ReactNode }) {
  const [phase, setPhase] = useState<HQPhase>("boot");
  const [focusedRole, setFocusedRole] = useState<ExecRole | null>(null);
  const [soundOn, setSoundOn] = useState(false);

  const value = useMemo<HQUIValue>(
    () => ({
      phase,
      focusedRole,
      soundOn,
      finishBoot: () => setPhase((p) => (p === "boot" ? "hub" : p)),
      enterOffice: (role: ExecRole) => {
        setFocusedRole(role);
        setPhase("office");
      },
      exitOffice: () => {
        setFocusedRole(null);
        setPhase("hub");
      },
      setSound: (on: boolean) => setSoundOn(on),
    }),
    [phase, focusedRole, soundOn],
  );

  return <HQUIContext.Provider value={value}>{children}</HQUIContext.Provider>;
}

export function useHQUI(): HQUIValue {
  const ctx = useContext(HQUIContext);
  if (!ctx) throw new Error("useHQUI must be used within HQUIProvider");
  return ctx;
}
