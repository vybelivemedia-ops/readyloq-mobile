/**
 * Vitest configuration for readyloq-app unit tests.
 *
 * React Native / Expo modules use Flow type syntax that vitest/rollup cannot
 * parse.  We mock the handful of native packages that the modules under test
 * import so the test runner only ever processes plain TypeScript.
 */
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    // Only run tests whose modules are pure TypeScript; other test files in the
    // app (e.g. lib/audio/__tests__/faie.stress.test.ts) require the full React
    // Native / Jest environment and will fail under vitest's node runner.
    include: [
      "lib/meta-glasses/__tests__/**/*.test.ts",
      "lib/measurement/__tests__/**/*.test.ts",
      "lib/finding-card/__tests__/**/*.test.ts",
      "lib/delivery/__tests__/**/*.test.ts",
      "lib/local/__tests__/**/*.test.ts",
      "lib/vision/__tests__/**/*.test.ts",
      "lib/dashboard/__tests__/**/*.test.ts",
      "hooks/__tests__/useAllDevicesHealthCheck.test.ts",
      "hooks/__tests__/native-routing.test.ts",
      "hooks/__tests__/useSmartGlassesBleFrames.test.ts",
      "hooks/__tests__/useMetaGlassesSession.test.ts",
      "lib/risk-drill-down/__tests__/**/*.test.ts",
      "__tests__/\\(app\\)/inspection-summary/**/*.test.ts",
      "__tests__/\\(app\\)/frame-buffer-delete-failure.test.ts",
      "__tests__/\\(app\\)/audio-session-latency.test.ts",
      "lib/voice-context/__tests__/**/*.test.ts",
      "lib/sync-history/__tests__/**/*.test.ts",
      "lib/sync/__tests__/**/*.test.ts",
      "components/__tests__/copilot-hud-badge-visibility.test.ts",
      "components/__tests__/device-health-strip-sensor-race.test.ts",
      "components/__tests__/wifi-camera-chip-status.test.ts",
      "components/__tests__/device-health-strip-chip-visibility.test.tsx",
    ],
  },
  resolve: {
    alias: {
      // Path alias used throughout the app
      "@": path.resolve(__dirname, "."),
      // Stub expo-file-system so BurstMeasurementManager.ts can be imported
      // without hitting React Native's Flow-typed entry point.
      "expo-file-system/legacy": path.resolve(
        __dirname,
        "__mocks__/expo-file-system-legacy.ts",
      ),
      "expo-file-system": path.resolve(
        __dirname,
        "__mocks__/expo-file-system-legacy.ts",
      ),
    },
  },
});
