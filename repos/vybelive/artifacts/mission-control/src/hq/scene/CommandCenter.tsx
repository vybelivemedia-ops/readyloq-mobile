import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Text } from "@react-three/drei";
import * as THREE from "three";
import type { HQStats } from "../lib/hqTypes";

function Globe() {
  const wire = useRef<THREE.Mesh>(null);
  const dots = useRef<THREE.Points>(null);
  useFrame((_, delta) => {
    if (wire.current) wire.current.rotation.y += delta * 0.25;
    if (dots.current) dots.current.rotation.y -= delta * 0.15;
  });
  return (
    <group position={[0, 5.2, 0]}>
      <mesh ref={wire}>
        <sphereGeometry args={[1.7, 24, 16]} />
        <meshBasicMaterial color="#1ec8ff" wireframe transparent opacity={0.35} toneMapped={false} />
      </mesh>
      <mesh>
        <sphereGeometry args={[1.62, 24, 16]} />
        <meshBasicMaterial color="#031526" transparent opacity={0.55} />
      </mesh>
      <points ref={dots}>
        <sphereGeometry args={[1.72, 20, 14]} />
        <pointsMaterial size={0.06} color="#7ff0ff" toneMapped={false} />
      </points>
    </group>
  );
}

function EnergyRings() {
  const a = useRef<THREE.Mesh>(null);
  const b = useRef<THREE.Mesh>(null);
  const c = useRef<THREE.Mesh>(null);
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (a.current) a.current.rotation.z = t * 0.6;
    if (b.current) b.current.rotation.z = -t * 0.4;
    if (c.current) c.current.rotation.z = t * 0.25;
  });
  return (
    <group position={[0, 5.2, 0]} rotation={[Math.PI / 2, 0, 0]}>
      <mesh ref={a}>
        <torusGeometry args={[2.4, 0.03, 8, 64]} />
        <meshBasicMaterial color="#22e6ff" toneMapped={false} />
      </mesh>
      <mesh ref={b} rotation={[0.5, 0.3, 0]}>
        <torusGeometry args={[2.9, 0.02, 8, 64]} />
        <meshBasicMaterial color="#a855f7" toneMapped={false} transparent opacity={0.8} />
      </mesh>
      <mesh ref={c} rotation={[0.9, 0, 0]}>
        <torusGeometry args={[3.3, 0.015, 8, 64]} />
        <meshBasicMaterial color="#22e6ff" toneMapped={false} transparent opacity={0.5} />
      </mesh>
    </group>
  );
}

function StatReadout({
  position,
  value,
  label,
  color,
}: {
  position: [number, number, number];
  value: number;
  label: string;
  color: string;
}) {
  return (
    <group position={position} rotation={[0, 0, 0]}>
      <Text fontSize={0.62} color={color} anchorX="center" anchorY="middle" outlineWidth={0.01} outlineColor="#021018">
        {String(value)}
      </Text>
      <Text position={[0, -0.5, 0]} fontSize={0.22} color="#9fc8e0" anchorX="center" anchorY="middle">
        {label.toUpperCase()}
      </Text>
    </group>
  );
}

export function CommandCenter({ stats, children }: { stats: HQStats; children?: React.ReactNode }) {
  const tableGlow = useRef<THREE.MeshBasicMaterial>(null);
  useFrame((state) => {
    if (tableGlow.current) tableGlow.current.opacity = 0.5 + Math.sin(state.clock.elapsedTime * 1.4) * 0.15;
  });

  return (
    <group>
      {/* raised holographic table platform */}
      <mesh position={[0, -0.5, 0]}>
        <cylinderGeometry args={[6, 6.4, 1, 64]} />
        <meshStandardMaterial color="#05101d" metalness={0.8} roughness={0.3} />
      </mesh>
      {/* glowing rim */}
      <mesh position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[5.8, 6.2, 64]} />
        <meshBasicMaterial ref={tableGlow} color="#22e6ff" transparent opacity={0.5} side={THREE.DoubleSide} toneMapped={false} />
      </mesh>
      {/* table surface holo glow */}
      <mesh position={[0, 0.05, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[5.7, 64]} />
        <meshBasicMaterial color="#0a2a44" transparent opacity={0.45} toneMapped={false} />
      </mesh>

      <Globe />
      <EnergyRings />

      {/* live company status arranged around the table */}
      <StatReadout position={[-3.4, 2.4, 2.2]} value={stats.activeExecutives} label="Active" color="#34d399" />
      <StatReadout position={[3.4, 2.4, 2.2]} value={stats.openTasks} label="Open Tasks" color="#22e6ff" />
      <StatReadout position={[-3.4, 2.4, -2.2]} value={stats.blockedTasks} label="Blocked" color="#f59e0b" />
      <StatReadout position={[3.4, 2.4, -2.2]} value={stats.criticalTasks} label="Critical" color="#f87171" />

      <pointLight color="#22e6ff" intensity={2.4} distance={22} position={[0, 6, 0]} />

      {/* Chief of Staff stands at the head of the table */}
      {children}
    </group>
  );
}
