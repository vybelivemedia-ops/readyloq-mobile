import path from "path";
import { defineConfig } from "vitest/config";

/**
 * Vitest configuration for pure unit tests inside the readyloq-app package.
 *
 * Scope: files under lib/**\/__tests__/ that have no React Native render
 * surface (pure logic, AsyncStorage-backed stores with mocked deps, etc.)
 *
 * React Native + Expo modules that rely on the native runtime are mocked in
 * each test file via vi.mock() so the tests run in a plain Node.js process.
 */
export default defineConfig({
  resolve: {
    alias: {
      // Mirror the "@/*" path alias from tsconfig.json
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    environment: "node",
    globals: true,
    include: ["lib/**/__tests__/**/*.test.ts", "hooks/__tests__/**/*.test.ts"],
    // The audio stress test uses console-based assertions (not vitest suites)
    // and is run via npx tsx directly — exclude it from the vitest runner.
    exclude: ["lib/audio/__tests__/**"],
    testTimeout: 10000,
  },
});
