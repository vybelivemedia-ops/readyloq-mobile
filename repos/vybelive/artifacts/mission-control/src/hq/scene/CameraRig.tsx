import { useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { officePosition } from "../lib/departments";
import type { ExecRole } from "../lib/hqTypes";
import type { HQPhase } from "../lib/HQUIContext";

const HUB_POS = new THREE.Vector3(0, 13, 27);
const HUB_LOOK = new THREE.Vector3(0, 3, 0);
const BOOT_POS = new THREE.Vector3(6, 40, 78);

interface Pose {
  pos: THREE.Vector3;
  look: THREE.Vector3;
}

function officePose(role: ExecRole): Pose {
  const p = officePosition(role);
  const pos = new THREE.Vector3(p[0] * 0.5, 4.6, p[2] * 0.5);
  const look = new THREE.Vector3(p[0] * 1.02, 2.1, p[2] * 1.02);
  return { pos, look };
}

export function CameraRig({ phase, focusedRole }: { phase: HQPhase; focusedRole: ExecRole | null }) {
  const { camera, pointer } = useThree();
  const lookRef = useRef(HUB_LOOK.clone());
  const initialized = useRef(false);

  const target = useMemo<Pose>(() => {
    if (phase === "office" && focusedRole) return officePose(focusedRole);
    return { pos: HUB_POS.clone(), look: HUB_LOOK.clone() };
  }, [phase, focusedRole]);

  useFrame((_, delta) => {
    if (!initialized.current) {
      camera.position.copy(phase === "boot" ? BOOT_POS : target.pos);
      initialized.current = true;
    }
    const dt = Math.min(delta, 0.05);
    const lambda = phase === "boot" ? 1.1 : 3.0;

    // Subtle parallax in the hub only.
    const parallax = phase === "hub" ? 1 : 0;
    const px = pointer.x * 2.2 * parallax;
    const py = pointer.y * 1.2 * parallax;

    camera.position.x = THREE.MathUtils.damp(camera.position.x, target.pos.x + px, lambda, dt);
    camera.position.y = THREE.MathUtils.damp(camera.position.y, target.pos.y + py, lambda, dt);
    camera.position.z = THREE.MathUtils.damp(camera.position.z, target.pos.z, lambda, dt);

    lookRef.current.x = THREE.MathUtils.damp(lookRef.current.x, target.look.x, lambda, dt);
    lookRef.current.y = THREE.MathUtils.damp(lookRef.current.y, target.look.y, lambda, dt);
    lookRef.current.z = THREE.MathUtils.damp(lookRef.current.z, target.look.z, lambda, dt);
    camera.lookAt(lookRef.current);
  });

  return null;
}
