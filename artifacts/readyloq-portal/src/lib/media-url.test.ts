import { describe, expect, it } from "vitest";
import { resolveMediaUrl } from "./media-url";

describe("resolveMediaUrl", () => {
  it("keeps public and device-local URLs unchanged", () => {
    const resolveApiPath = (path: string) => `https://api.example.com/api${path}`;

    expect(resolveMediaUrl("https://cdn.example.com/evidence.jpg", resolveApiPath)).toBe("https://cdn.example.com/evidence.jpg");
    expect(resolveMediaUrl("file:///cache/evidence.jpg", resolveApiPath)).toBe("file:///cache/evidence.jpg");
    expect(resolveMediaUrl("data:image/png;base64,abc", resolveApiPath)).toBe("data:image/png;base64,abc");
  });

  it("uses the portal dev proxy for API-relative storage URLs", () => {
    const devApiUrl = (path: string) => `/readyloq-portal/api${path}`;

    expect(resolveMediaUrl("/api/storage/evidence/photo.jpg", devApiUrl)).toBe(
      "/readyloq-portal/api/storage/evidence/photo.jpg",
    );
    expect(resolveMediaUrl("/objects/companies/acme/evidence/photo.jpg", devApiUrl)).toBe(
      "/readyloq-portal/api/storage/objects/companies/acme/evidence/photo.jpg",
    );
  });

  it("uses the configured API origin for API-relative storage URLs", () => {
    const productionApiUrl = (path: string) => `https://api.readyloq.example/api${path}`;

    expect(resolveMediaUrl("/api/storage/evidence/photo.jpg", productionApiUrl)).toBe(
      "https://api.readyloq.example/api/storage/evidence/photo.jpg",
    );
    expect(resolveMediaUrl("/objects/companies/acme/evidence/photo.jpg", productionApiUrl)).toBe(
      "https://api.readyloq.example/api/storage/objects/companies/acme/evidence/photo.jpg",
    );
  });
});