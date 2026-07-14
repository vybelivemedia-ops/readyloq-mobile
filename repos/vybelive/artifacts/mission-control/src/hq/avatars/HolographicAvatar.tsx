import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { ExecutiveAvatarProps } from "./avatarTypes";

/**
 * Stylized holographic executive (V1). Built entirely from primitives so it
 * stays cheap, and animated by `activity` so it reads as alive. Implements the
 * ExecutiveAvatarProps contract: feet at local y=0, ~1.8u tall at scale 1.
 */
function makeHoloMaterial(color: THREE.Color): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: color },
      uOpacity: { value: 0.85 },
      uScan: { value: 1.0 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vNormal;
      varying vec3 vView;
      varying vec3 vPos;
      void main() {
        vNormal = normalize(normalMatrix * normal);
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vView = normalize(-mv.xyz);
        vPos = position;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uColor;
      uniform float uOpacity;
      uniform float uScan;
      varying vec3 vNormal;
      varying vec3 vView;
      varying vec3 vPos;
      void main() {
        float fres = pow(1.0 - max(dot(vNormal, vView), 0.0), 2.0);
        float scan = 0.5 + 0.5 * sin((vPos.y * 28.0) - uTime * 3.0);
        scan = mix(1.0, scan, 0.45 * uScan);
        float flicker = 0.92 + 0.08 * sin(uTime * 40.0 + vPos.y * 5.0);
        float a = (0.30 + 0.85 * fres) * scan * flicker * uOpacity;
        vec3 col = uColor * (0.7 + 1.1 * fres);
        gl_FragColor = vec4(col, a);
      }
    `,
  });
}

export function HolographicAvatar({
  executive,
  activity,
  position,
  rotationY = 0,
  scale = 1,
  focused = false,
}: ExecutiveAvatarProps) {
  const group = useRef<THREE.Group>(null);
  const armL = useRef<THREE.Group>(null);
  const armR = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  const ringRef = useRef<THREE.Mesh>(null);

  const color = useMemo(() => new THREE.Color(executive.accentColor), [executive.accentColor]);
  const material = useMemo(() => makeHoloMaterial(color), [color]);
  const phase = useMemo(() => Math.random() * Math.PI * 2, []);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    material.uniforms.uTime.value = t;

    const offline = activity === "offline";
    material.uniforms.uOpacity.value = THREE.MathUtils.lerp(
      material.uniforms.uOpacity.value,
      offline ? 0.22 : focused ? 1.0 : 0.85,
      0.1,
    );
    material.uniforms.uScan.value = offline ? 2.0 : 1.0;

    if (group.current) {
      // Gentle float; height of bob depends on how busy the exec is.
      const bobAmp = activity === "working" ? 0.05 : activity === "offline" ? 0.0 : 0.03;
      group.current.position.y = position[1] + Math.sin(t * 1.6 + phase) * bobAmp;
      // Idle sway / meeting turn.
      const sway = activity === "idle" ? Math.sin(t * 0.6 + phase) * 0.12 : 0;
      group.current.rotation.y = rotationY + sway;
    }
    if (head.current) {
      head.current.rotation.y = Math.sin(t * 0.8 + phase) * (activity === "meeting" ? 0.35 : 0.12);
      head.current.rotation.x = Math.sin(t * 0.5) * 0.04;
    }
    // Working = "typing" arms; reviewing = one arm raised; idle = subtle.
    if (armL.current && armR.current) {
      if (activity === "working") {
        armL.current.rotation.x = -0.9 + Math.sin(t * 6 + phase) * 0.25;
        armR.current.rotation.x = -0.9 + Math.sin(t * 6 + phase + 1.4) * 0.25;
      } else if (activity === "reviewing") {
        armL.current.rotation.x = -0.3;
        armR.current.rotation.x = -1.7 + Math.sin(t * 1.5) * 0.1;
      } else {
        armL.current.rotation.x = -0.15 + Math.sin(t * 1.2 + phase) * 0.05;
        armR.current.rotation.x = -0.15 + Math.sin(t * 1.2 + phase + 1) * 0.05;
      }
    }
    if (ringRef.current) {
      ringRef.current.rotation.z = t * 0.8;
    }
  });

  // Build with feet at y=0 (ground anchor). Total height ≈ 1.8u.
  return (
    <group ref={group} position={position} scale={scale}>
      {/* base projection ring on the floor */}
      <mesh ref={ringRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]} material={material}>
        <ringGeometry args={[0.45, 0.62, 48]} />
      </mesh>

      {/* legs */}
      <mesh position={[-0.16, 0.42, 0]} material={material}>
        <capsuleGeometry args={[0.1, 0.6, 4, 10]} />
      </mesh>
      <mesh position={[0.16, 0.42, 0]} material={material}>
        <capsuleGeometry args={[0.1, 0.6, 4, 10]} />
      </mesh>

      {/* torso */}
      <mesh position={[0, 1.05, 0]} material={material}>
        <capsuleGeometry args={[0.26, 0.5, 6, 14]} />
      </mesh>

      {/* shoulders */}
      <group ref={armL} position={[-0.3, 1.28, 0]}>
        <mesh position={[0, -0.28, 0]} material={material}>
          <capsuleGeometry args={[0.08, 0.5, 4, 10]} />
        </mesh>
      </group>
      <group ref={armR} position={[0.3, 1.28, 0]}>
        <mesh position={[0, -0.28, 0]} material={material}>
          <capsuleGeometry args={[0.08, 0.5, 4, 10]} />
        </mesh>
      </group>

      {/* head */}
      <group ref={head} position={[0, 1.62, 0]}>
        <mesh material={material}>
          <sphereGeometry args={[0.17, 20, 20]} />
        </mesh>
      </group>

      {/* glow light tinting the office */}
      <pointLight color={color} intensity={focused ? 2.2 : 1.1} distance={6} position={[0, 1.2, 0]} />
    </group>
  );
}
