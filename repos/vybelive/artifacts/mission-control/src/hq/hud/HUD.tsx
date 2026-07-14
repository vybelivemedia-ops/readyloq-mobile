import { useHQUI } from "../lib/HQUIContext";
import type { HQState } from "../lib/hqTypes";
import { BootScreen } from "./BootScreen";
import { StatusBar } from "./StatusBar";
import { Greeting } from "./Greeting";
import { OfficePanel } from "./OfficePanel";

export function HUD({ state }: { state: HQState }) {
  const { phase, focusedRole } = useHQUI();
  const focusedExec = focusedRole ? state.executives.find((e) => e.role === focusedRole) ?? null : null;

  return (
    <div className="absolute inset-0 z-20 pointer-events-none [&_button]:pointer-events-auto [&_a]:pointer-events-auto [&_input]:pointer-events-auto [&_form]:pointer-events-auto">
      {phase === "boot" && <BootScreen />}

      {phase !== "boot" && (
        <>
          <StatusBar state={state} />
          {phase === "hub" && <Greeting state={state} />}
          {phase === "office" && focusedExec && (
            <div className="pointer-events-auto">
              <OfficePanel executive={focusedExec} />
            </div>
          )}
        </>
      )}
    </div>
  );
}
