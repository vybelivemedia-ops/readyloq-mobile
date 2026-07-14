import { useRef, useState } from "react";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import { Text } from "@react-three/drei";
import * as THREE from "three";
import { DEPARTMENTS, officePosition } from "../lib/departments";
import type { HQExecutive } from "../lib/hqTypes";
import { AvatarRenderer } from "../avatars/AvatarRenderer";
import { statusToActivity } from "../avatars/avatarTypes";

export function DepartmentOffice({
  executive,
  focused,
  dimmed,
  onSelect,
}: {
  executive: HQExecutive;
  focused: boolean;
  dimmed: boolean;
  onSelect: () => void;
}) {
  const cfg = DEPARTMENTS[executive.role];
  const p = officePosition(executive.role);
  const a = (cfg.angle * Math.PI) / 180;
  const groupRot = a + Math.PI; // local +Z faces the hub center

  const [hovered, setHovered] = useState(false);
  const stageGlow = useRef<THREE.MeshBasicMaterial>(null);
  const alertRef = useRef<THREE.PointLight>(null);
  const accent = new THREE.Color(executive.accentColor);
  const hasAlert = executive.criticalCount > 0 || executive.blockedCount > 0;

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (stageGlow.current) {
      const base = focused ? 0.9 : hovered ? 0.7 : 0.4;
      stageGlow.current.opacity = base + Math.sin(t * 2) * 0.1;
    }
    if (alertRef.current) {
      alertRef.current.intensity = hasAlert ? 1.2 + Math.sin(t * 6) * 0.8 : 0;
    }
  });

  const activity = statusToActivity(executive.status);
  const opacity = dimmed ? 0.35 : 1;

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    onSelect();
  };
  const handleOver = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    setHovered(true);
    document.body.style.cursor = "pointer";
  };
  const handleOut = () => {
    setHovered(false);
    document.body.style.cursor = "auto";
  };

  return (
    <group position={p} rotation={[0, groupRot, 0]}>
      {/* clickable stage disc */}
      <mesh
        position={[0, 0, 0.3]}
        rotation={[-Math.PI / 2, 0, 0]}
        onClick={handleClick}
        onPointerOver={handleOver}
        onPointerOut={handleOut}
        scale={hovered || focused ? 1.06 : 1}
      >
        <cylinderGeometry args={[2.6, 2.8, 0.3, 48]} />
        <meshStandardMaterial color="#06121f" metalness={0.7} roughness={0.35} transparent opacity={opacity} />
      </mesh>
      {/* stage glow ring */}
      <mesh position={[0, 0.18, 0.3]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[2.35, 2.65, 48]} />
        <meshBasicMaterial ref={stageGlow} color={accent} transparent opacity={0.5} side={THREE.DoubleSide} toneMapped={false} />
      </mesh>

      {/* themed holo back wall (behind the avatar, away from center) */}
      <group position={[0, 0, -2.1]}>
        <mesh>
          <planeGeometry args={[4.6, 3.4]} />
          <meshBasicMaterial color={accent} transparent opacity={0.07 * opacity} side={THREE.DoubleSide} toneMapped={false} />
        </mesh>
        <mesh position={[0, 0, 0.02]}>
          <planeGeometry args={[4.6, 3.4, 6, 5]} />
          <meshBasicMaterial color={accent} wireframe transparent opacity={0.22 * opacity} toneMapped={false} />
        </mesh>
      </group>

      {/* executive avatar — feet anchored on the stage, facing the hub (+Z) */}
      <AvatarRenderer
        executive={executive}
        activity={activity}
        position={[0, 0.16, 0.3]}
        rotationY={0}
        scale={1}
        focused={focused}
      />

      {/* labels readable from the hub side */}
      <Text position={[0, 3.5, -1.6]} fontSize={0.46} color={executive.accentColor} anchorX="center" anchorY="middle" outlineWidth={0.008} outlineColor="#021018">
        {cfg.label.toUpperCase()}
      </Text>
      <Text position={[0, 3.0, -1.6]} fontSize={0.26} color="#cfe8f5" anchorX="center" anchorY="middle">
        {executive.name}
      </Text>
      <Text position={[0, 2.62, -1.6]} fontSize={0.18} color="#7fa8c0" anchorX="center" anchorY="middle">
        {executive.status.toUpperCase()}
        {executive.openCount > 0 ? `  •  ${executive.openCount} OPEN` : ""}
      </Text>

      <pointLight ref={alertRef} color="#f87171" intensity={0} distance={6} position={[0, 1.4, 0.3]} />
    </group>
  );
}
