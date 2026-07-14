import { TIME_PALETTES } from "../lib/departments";
import type { HQState } from "../lib/hqTypes";
import type { Quality } from "../lib/useQuality";
import { useHQUI } from "../lib/HQUIContext";
import { blip } from "../lib/sound";
import { SkyEnvironment } from "./SkyEnvironment";
import { VTower } from "./VTower";
import { CommandCenter } from "./CommandCenter";
import { DepartmentOffice } from "./DepartmentOffice";
import { TaskFlow } from "./TaskFlow";
import { CameraRig } from "./CameraRig";
import { AvatarRenderer } from "../avatars/AvatarRenderer";
import { statusToActivity } from "../avatars/avatarTypes";

export function Headquarters({ state, quality }: { state: HQState; quality: Quality }) {
  const { phase, focusedRole, enterOffice, soundOn } = useHQUI();
  const palette = TIME_PALETTES[state.timeOfDay];

  const chief = state.executives.find((e) => e.role === "chief_of_staff");
  const ringExecs = state.executives.filter((e) => e.role !== "chief_of_staff");

  return (
    <>
      <CameraRig phase={phase} focusedRole={focusedRole} />

      <ambientLight intensity={palette.ambient} />
      <hemisphereLight args={[palette.skyTop, "#02060c", 0.4]} />
      <directionalLight
        position={palette.keyPos}
        intensity={palette.keyIntensity}
        color={palette.keyColor}
      />

      <SkyEnvironment palette={palette} quality={quality} headline={state.briefing?.headline ?? ""} />
      <VTower />

      <CommandCenter stats={state.stats}>
        {chief && (
          <AvatarRenderer
            executive={chief}
            activity={statusToActivity(chief.status)}
            position={[0, 0.1, -3.2]}
            rotationY={0}
            scale={1.05}
            focused={false}
          />
        )}
      </CommandCenter>

      <TaskFlow flows={state.flows} />

      {ringExecs.map((exec) => (
        <DepartmentOffice
          key={exec.id}
          executive={exec}
          focused={focusedRole === exec.role}
          dimmed={phase === "office" && focusedRole !== exec.role}
          onSelect={() => {
            if (soundOn) blip("enter");
            enterOffice(exec.role);
          }}
        />
      ))}
    </>
  );
}
