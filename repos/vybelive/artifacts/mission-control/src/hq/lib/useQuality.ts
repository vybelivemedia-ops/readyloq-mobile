import { useEffect, useState } from "react";

export interface Quality {
  tier: "high" | "low";
  bloom: boolean;
  reflections: boolean;
  droneCount: number;
  particleCount: number;
  buildingCount: number;
  dpr: [number, number];
  /** false when WebGL is unavailable; caller should render the 2D fallback. */
  webgl: boolean;
}

function detectWebGL(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return !!(
      window.WebGLRenderingContext &&
      (canvas.getContext("webgl") || canvas.getContext("experimental-webgl"))
    );
  } catch {
    return false;
  }
}

export function useQuality(): Quality {
  const [quality, setQuality] = useState<Quality>(() => {
    const webgl = typeof window !== "undefined" ? detectWebGL() : true;
    const isMobile =
      typeof window !== "undefined" &&
      (window.innerWidth < 820 || /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent));
    const lowCores =
      typeof navigator !== "undefined" && (navigator.hardwareConcurrency ?? 8) <= 4;
    const low = isMobile || lowCores;
    return low
      ? {
          tier: "low",
          bloom: false,
          reflections: false,
          droneCount: 10,
          particleCount: 220,
          buildingCount: 70,
          dpr: [1, 1.3],
          webgl,
        }
      : {
          tier: "high",
          bloom: true,
          reflections: false,
          droneCount: 30,
          particleCount: 900,
          buildingCount: 150,
          dpr: [1, 1.8],
          webgl,
        };
  });

  useEffect(() => {
    const onResize = () => {
      const isMobile = window.innerWidth < 820;
      setQuality((q) => (isMobile && q.tier === "high" ? { ...q, tier: "low", bloom: false } : q));
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  return quality;
}
