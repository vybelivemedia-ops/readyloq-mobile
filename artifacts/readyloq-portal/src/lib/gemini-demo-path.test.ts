import { describe, expect, it } from "vitest";
import { isPublicGeminiDemoPath } from "./gemini-demo-path";

describe("isolated public demo allowlist", () => {
  it.each(["/readyloq-portal/gemini-demo", "/readyloq-portal/gemini-demo/"])("allows exactly %s", path => {
    expect(isPublicGeminiDemoPath(path, "/readyloq-portal/")).toBe(true);
  });
  it.each(["/readyloq-portal/dashboard", "/readyloq-portal/inspections",
    "/readyloq-portal/gemini-demo/admin", "/readyloq-portal/gemini-demo-other",
    "/gemini-demo", "/readyloq-portal/login", "/readyloq-client/gemini-demo"])("does not bypass authentication for %s", path => {
    expect(isPublicGeminiDemoPath(path, "/readyloq-portal/")).toBe(false);
  });
});
