import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/lib/gemini-inspection-demo.test.ts"],
  },
});
