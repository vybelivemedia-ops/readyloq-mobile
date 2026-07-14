import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

/**
 * The giant illuminated "V" — the headquarters landmark, towering behind the
 * command center as the brand monument. Built from two extruded angled beams.
 */
function vGeometry(): THREE.ExtrudeGeometry {
  const shape = new THREE.Shape();
  // Outline of a chunky "V" in the XY plane.
  shape.moveTo(-5, 18);
  shape.lineTo(-3, 18);
  shape.lineTo(0, 2);
  shape.lineTo(3, 18);
  shape.lineTo(5, 18);
  shape.lineTo(1.4, -1);
  shape.lineTo(-1.4, -1);
  shape.closePath();
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: 2,
    bevelEnabled: true,
    bevelThickness: 0.4,
    bevelSize: 0.4,
    bevelSegments: 2,
  });
  geo.center();
  return geo;
}

export function VTower() {
  const coreRef = useRef<THREE.Mesh>(null);
  const glowMat = useRef<THREE.MeshBasicMaterial>(null);
  const geo = useMemo(() => vGeometry(), []);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (glowMat.current) {
      glowMat.current.opacity = 0.45 + Math.sin(t * 1.5) * 0.12;
    }
  });

  return (
    <group position={[0, 20, -34]}>
      {/* solid core */}
      <mesh ref={coreRef} geometry={geo} scale={1.6}>
        <meshStandardMaterial
          color="#06121f"
          emissive={new THREE.Color("#11d6ff")}
          emissiveIntensity={1.4}
          metalness={0.8}
          roughness={0.25}
        />
      </mesh>
      {/* outer glow shell */}
      <mesh geometry={geo} scale={1.66}>
        <meshBasicMaterial
          ref={glowMat}
          color="#22e6ff"
          transparent
          opacity={0.45}
          side={THREE.BackSide}
          toneMapped={false}
        />
      </mesh>
      <pointLight color="#22e6ff" intensity={3} distance={60} position={[0, 0, 6]} />
    </group>
  );
}
