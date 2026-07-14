import { Suspense } from "react";
import { Canvas } from "@react-three/fiber";
import { EffectComposer, Bloom, Vignette } from "@react-three/postprocessing";
import { Headquarters } from "./scene/Headquarters";
import type { HQState } from "./lib/hqTypes";
import type { Quality } from "./lib/useQuality";

export default function HQCanvas({ state, quality }: { state: HQState; quality: Quality }) {
  return (
    <Canvas
      dpr={quality.dpr}
      camera={{ position: [6, 40, 78], fov: 50, near: 0.1, far: 600 }}
      gl={{ antialias: quality.tier === "high", powerPreference: "high-performance" }}
      style={{ position: "absolute", inset: 0 }}
    >
      <Suspense fallback={null}>
        <Headquarters state={state} quality={quality} />
        {quality.bloom && (
          <EffectComposer>
            <Bloom luminanceThreshold={0.25} luminanceSmoothing={0.9} intensity={0.9} mipmapBlur />
            <Vignette eskil={false} offset={0.25} darkness={0.85} />
          </EffectComposer>
        )}
      </Suspense>
    </Canvas>
  );
}
