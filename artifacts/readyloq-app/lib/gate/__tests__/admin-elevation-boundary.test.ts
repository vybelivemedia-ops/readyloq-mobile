import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const testDirectory = dirname(fileURLToPath(import.meta.url));
const settingsSource = readFileSync(
  resolve(testDirectory, "../../../app/(app)/settings.tsx"),
  "utf8",
);
const apiSource = readFileSync(resolve(testDirectory, "../../api.ts"), "utf8");

describe("client Super Admin elevation boundary", () => {
  it("does not expose a bootstrap-token claim UI or client helper", () => {
    expect(settingsSource).not.toMatch(/Claim Super Admin|Bootstrap token|Claim Access|showBootstrap/);
    expect(settingsSource).not.toContain("bootstrapSuperAdmin");
    expect(apiSource).not.toContain("bootstrapSuperAdmin");
    expect(apiSource).not.toContain("/api/admin/bootstrap");
  });

  it("keeps already-authorized Super Admin controls without a grant mutation", () => {
    expect(settingsSource).toContain("isSuperAdmin");
    expect(settingsSource).toContain('router.push("/admin"');
    expect(apiSource).toContain('"/api/admin/users"');
    expect(apiSource).not.toMatch(/updates: \{[^}]*isSuperAdmin/);
  });
});