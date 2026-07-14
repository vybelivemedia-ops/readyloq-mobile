import { defineConfig } from "vitest/config";
import { deriveTestDatabaseUrl } from "./src/test/test-db";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["src/**/*.test.ts"],
    globalSetup: ["./src/test/global-setup.ts"],
    // All branding tests mutate shared global state (the single active profile),
    // so run everything in one process, sequentially, against the test DB.
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
    fileParallelism: false,
    env: {
      NODE_ENV: "test",
      DATABASE_URL: deriveTestDatabaseUrl(),
    },
    hookTimeout: 60000,
    testTimeout: 30000,
  },
});
