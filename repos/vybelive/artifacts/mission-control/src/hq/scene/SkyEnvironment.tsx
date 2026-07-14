import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Stars, Text } from "@react-three/drei";
import * as THREE from "three";
import type { TimePalette } from "../lib/departments";
import type { Quality } from "../lib/useQuality";

function SkyDome({ palette }: { palette: TimePalette }) {
  const material = useMemo(() => {
    return new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        uTop: { value: new THREE.Color(palette.skyTop) },
        uHorizon: { value: new THREE.Color(palette.skyHorizon) },
      },
      vertexShader: /* glsl */ `
        varying vec3 vWorld;
        void main() {
          vWorld = position;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uTop;
        uniform vec3 uHorizon;
        varying vec3 vWorld;
        void main() {
          float h = clamp((normalize(vWorld).y + 0.1) / 0.7, 0.0, 1.0);
          vec3 col = mix(uHorizon, uTop, pow(h, 0.7));
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
  }, [palette.skyTop, palette.skyHorizon]);

  return (
    <mesh material={material} scale={300}>
      <sphereGeometry args={[1, 32, 16]} />
    </mesh>
  );
}

function CityRing({ count, glow }: { count: number; glow: number }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const { matrices, color } = useMemo(() => {
    const dummy = new THREE.Object3D();
    const matrices: THREE.Matrix4[] = [];
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.1;
      const r = 70 + Math.random() * 70;
      const h = 8 + Math.random() * 48;
      const w = 3 + Math.random() * 6;
      dummy.position.set(Math.cos(a) * r, h / 2 - 1, Math.sin(a) * r);
      dummy.scale.set(w, h, w);
      dummy.rotation.y = a;
      dummy.updateMatrix();
      matrices.push(dummy.matrix.clone());
    }
    return { matrices, color: new THREE.Color("#0a1a33") };
  }, [count]);

  return (
    <instancedMesh
      ref={meshRef}
      args={[undefined, undefined, count]}
      onUpdate={(self) => {
        matrices.forEach((m, i) => self.setMatrixAt(i, m));
        self.instanceMatrix.needsUpdate = true;
      }}
    >
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial
        color={color}
        emissive={new THREE.Color("#1ec8ff")}
        emissiveIntensity={glow * 0.35}
        metalness={0.6}
        roughness={0.4}
      />
    </instancedMesh>
  );
}

function Drones({ count }: { count: number }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const drones = useMemo(
    () =>
      Array.from({ length: count }, () => ({
        radius: 28 + Math.random() * 45,
        height: 6 + Math.random() * 34,
        speed: (Math.random() > 0.5 ? 1 : -1) * (0.05 + Math.random() * 0.12),
        offset: Math.random() * Math.PI * 2,
        size: 0.3 + Math.random() * 0.4,
      })),
    [count],
  );

  useFrame((state) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const t = state.clock.elapsedTime;
    drones.forEach((d, i) => {
      const ang = t * d.speed + d.offset;
      dummy.position.set(
        Math.cos(ang) * d.radius,
        d.height + Math.sin(t * 0.8 + d.offset) * 1.5,
        Math.sin(ang) * d.radius,
      );
      dummy.scale.setScalar(d.size);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, count]}>
      <sphereGeometry args={[1, 8, 8]} />
      <meshBasicMaterial color="#7ddcff" toneMapped={false} />
    </instancedMesh>
  );
}

function Particles({ count }: { count: number }) {
  const pointsRef = useRef<THREE.Points>(null);
  const positions = useMemo(() => {
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const r = 6 + Math.random() * 60;
      const a = Math.random() * Math.PI * 2;
      arr[i * 3] = Math.cos(a) * r;
      arr[i * 3 + 1] = Math.random() * 50;
      arr[i * 3 + 2] = Math.sin(a) * r;
    }
    return arr;
  }, [count]);

  useFrame((state, delta) => {
    if (pointsRef.current) pointsRef.current.rotation.y += delta * 0.015;
    if (pointsRef.current) {
      const m = pointsRef.current.material as THREE.PointsMaterial;
      m.opacity = 0.25 + Math.sin(state.clock.elapsedTime * 0.5) * 0.08;
    }
  });

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial
        size={0.18}
        color="#52e0ff"
        transparent
        opacity={0.3}
        sizeAttenuation
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        toneMapped={false}
      />
    </points>
  );
}

function Billboards({ headline }: { headline: string }) {
  const text = (headline || "VYBE LIVE — LIVE OPS").toUpperCase().slice(0, 64);
  const spots: Array<{ pos: [number, number, number]; rot: number }> = [
    { pos: [-46, 26, -36], rot: Math.PI * 0.18 },
    { pos: [50, 20, -30], rot: -Math.PI * 0.2 },
  ];
  return (
    <>
      {spots.map((s, i) => (
        <group key={i} position={s.pos} rotation={[0, s.rot, 0]}>
          <mesh>
            <planeGeometry args={[26, 7]} />
            <meshBasicMaterial color="#04111f" transparent opacity={0.85} side={THREE.DoubleSide} />
          </mesh>
          <mesh position={[0, 0, 0.05]}>
            <planeGeometry args={[26.6, 7.6]} />
            <meshBasicMaterial color="#0bd2ff" transparent opacity={0.12} side={THREE.DoubleSide} />
          </mesh>
          <Text
            position={[0, 0, 0.1]}
            fontSize={1.15}
            maxWidth={24}
            textAlign="center"
            color="#7ff0ff"
            anchorX="center"
            anchorY="middle"
          >
            {text}
          </Text>
        </group>
      ))}
    </>
  );
}

export function SkyEnvironment({
  palette,
  quality,
  headline,
}: {
  palette: TimePalette;
  quality: Quality;
  headline: string;
}) {
  return (
    <group>
      <fog attach="fog" args={[palette.fog, 45, 220]} />
      <SkyDome palette={palette} />
      {palette.stars && <Stars radius={180} depth={60} count={2500} factor={4} fade speed={0.6} />}

      {/* Ground plane + neon grid disc */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.01, 0]} receiveShadow>
        <circleGeometry args={[160, 64]} />
        <meshStandardMaterial color="#040810" metalness={0.7} roughness={0.35} />
      </mesh>
      <gridHelper
        args={[160, 80, palette.skyHorizon, "#0c2238"]}
        position={[0, -1, 0]}
      />

      <CityRing count={quality.buildingCount} glow={palette.cityGlow} />
      <Drones count={quality.droneCount} />
      <Particles count={quality.particleCount} />
      <Billboards headline={headline} />
    </group>
  );
}
