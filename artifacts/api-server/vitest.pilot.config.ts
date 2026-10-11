import { defineConfig } from "vitest/config";

// Mocked DB/provider only: no real credentials, recipients, or persistent leads.
export default defineConfig({
  test: {
    environment: "node",
    include: [
      "src/routes/leads.test.ts",
      "src/lib/pilot-details-mailer.test.ts",
      "src/lib/mailer.pilot.test.ts",
    ],
  },
});
