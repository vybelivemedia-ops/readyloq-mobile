import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { officePosition } from "../lib/departments";
import type { ExecRole, TaskFlowEvent } from "../lib/hqTypes";

const HUB = new THREE.Vector3(0, 3.5, 0);

function endpoint(role: ExecRole | null): THREE.Vector3 {
  if (!role) return HUB.clone();
  const p = officePosition(role);
  return new THREE.Vector3(p[0], 1.6, p[2]);
}

interface Packet {
  curve: THREE.QuadraticBezierCurve3;
  color: THREE.Color;
  speed: number;
  offset: number;
}

function Stream({ flow }: { flow: TaskFlowEvent }) {
  const head = useRef<THREE.Mesh>(null);
  const packet = useMemo<Packet>(() => {
    const start = endpoint(flow.fromRole);
    const end = endpoint(flow.toRole);
    const mid = start.clone().add(end).multiplyScalar(0.5);
    mid.y += start.distanceTo(end) * 0.35 + 2.5;
    return {
      curve: new THREE.QuadraticBezierCurve3(start, mid, end),
      color: new THREE.Color(flow.color),
      speed: 0.18 + Math.random() * 0.12,
      offset: Math.random(),
    };
  }, [flow.fromRole, flow.toRole, flow.color]);

  const positions = useMemo(() => {
    const pts = packet.curve.getPoints(40);
    const arr = new Float32Array(pts.length * 3);
    for (let i = 0; i < pts.length; i++) {
      arr[i * 3] = pts[i].x;
      arr[i * 3 + 1] = pts[i].y;
      arr[i * 3 + 2] = pts[i].z;
    }
    return arr;
  }, [packet]);

  const lineRef = useRef<THREE.Line>(null);

  useEffect(() => {
    const line = lineRef.current;
    return () => {
      line?.geometry?.dispose();
      const mat = line?.material;
      if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
      else mat?.dispose();
    };
  }, []);

  useFrame((state) => {
    const t = (state.clock.elapsedTime * packet.speed + packet.offset) % 1;
    if (head.current) {
      const p = packet.curve.getPointAt(t);
      head.current.position.copy(p);
      const s = 0.16 + Math.sin(t * Math.PI) * 0.12;
      head.current.scale.setScalar(s);
    }
  });

  return (
    <group>
      {/* @ts-expect-error R3F intrinsic <line> conflicts with SVG line typing */}
      <line ref={lineRef}>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            args={[positions, 3]}
          />
        </bufferGeometry>
        <lineBasicMaterial
          color={packet.color}
          transparent
          opacity={0.18}
          toneMapped={false}
        />
      </line>
      <mesh ref={head}>
        <sphereGeometry args={[1, 12, 12]} />
        <meshBasicMaterial color={packet.color} toneMapped={false} />
      </mesh>
    </group>
  );
}

export function TaskFlow({ flows }: { flows: TaskFlowEvent[] }) {
  const active = flows.slice(0, 12);
  return (
    <group>
      {active.map((f) => (
        <Stream key={f.id} flow={f} />
      ))}
    </group>
  );
}
