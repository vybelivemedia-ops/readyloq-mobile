// Exact allowlist used by the current ReadyLoq hackathon demo. No prefix,
// nested-route or general authentication bypass.
export function isPublicGeminiDemoPath(path: string, basePath: string) {
  const expected = `${basePath.replace(/\/+$/, "")}/gemini-demo`;
  return path === expected || path === `${expected}/`;
}
