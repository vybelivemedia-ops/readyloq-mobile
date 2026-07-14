import { Suspense, lazy } from "react";
import { Link } from "wouter";
import { HQUIProvider } from "./lib/HQUIContext";
import { useHQState } from "./lib/useHQState";
import { useQuality } from "./lib/useQuality";
import { HUD } from "./hud/HUD";

const HQCanvas = lazy(() => import("./HQCanvas"));

function CanvasLoader() {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-background">
      <div className="text-center">
        <div className="text-5xl font-bold tracking-tighter text-primary mb-3 animate-pulse drop-shadow-[0_0_25px_rgba(34,230,255,0.5)]">
          VYBE<span className="text-foreground">LIVE</span>
        </div>
        <div className="text-[11px] font-mono uppercase tracking-[0.4em] text-muted-foreground animate-pulse">
          Loading headquarters...
        </div>
      </div>
    </div>
  );
}

function WebGLFallback() {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-background p-6">
      <div className="max-w-md text-center">
        <div className="text-4xl font-bold tracking-tighter text-primary mb-4">
          VYBE<span className="text-foreground">LIVE</span> HQ
        </div>
        <p className="text-sm text-muted-foreground mb-6">
          The 3D headquarters needs WebGL, which isn't available on this device or browser.
          You can still run everything from the classic dashboard.
        </p>
        <Link
          href="/classic"
          className="inline-block px-5 py-2.5 rounded bg-primary text-primary-foreground font-mono text-sm uppercase tracking-wider hover:bg-primary/90 transition-colors"
        >
          Open classic dashboard
        </Link>
      </div>
    </div>
  );
}

export default function HQExperience() {
  const state = useHQState();
  const quality = useQuality();

  if (!quality.webgl) {
    return (
      <div className="fixed inset-0 overflow-hidden">
        <WebGLFallback />
      </div>
    );
  }

  return (
    <HQUIProvider>
      <div className="fixed inset-0 overflow-hidden bg-background select-none">
        {state.loading && !state.ready ? (
          <CanvasLoader />
        ) : (
          <Suspense fallback={<CanvasLoader />}>
            <HQCanvas state={state} quality={quality} />
            <HUD state={state} />
          </Suspense>
        )}
      </div>
    </HQUIProvider>
  );
}
