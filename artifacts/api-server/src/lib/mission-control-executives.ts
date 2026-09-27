// These identities are ReadyLoq assistants, not human employees or accounts.
// Capabilities are server-owned; model text cannot expand them.
export const executiveRegistry = [
  { identity: "quinn", displayName: "Quinn", role: "Investigation coordinator", capability: "Coordinate company-scoped read-only investigations", diagnosticKeys: [] },
  { identity: "ada", displayName: "Ada", role: "Inspection operations specialist", capability: "Review inspection status and timing", diagnosticKeys: ["recentInspections"] },
  { identity: "mara", displayName: "Mara", role: "Reliability specialist", capability: "Review recorded application errors", diagnosticKeys: ["recentErrors"] },
  { identity: "theo", displayName: "Theo", role: "Integration specialist", capability: "Review failed external syncs", diagnosticKeys: ["recentSyncFailures"] },
  { identity: "nadia", displayName: "Nadia", role: "AI quality specialist", capability: "Review failed analysis records", diagnosticKeys: ["recentAnalysisFailures"] },
  { identity: "iris", displayName: "Iris", role: "Risk synthesis specialist", capability: "Summarize scoped findings without changing records", diagnosticKeys: ["recentInspections", "recentErrors", "recentSyncFailures", "recentAnalysisFailures"] },
  { identity: "dario", displayName: "Dario", role: "Governance specialist", capability: "Advise on escalation; no execution authority", diagnosticKeys: ["recentErrors", "recentSyncFailures"] },
] as const;

export type SpecialistIdentity = Exclude<(typeof executiveRegistry)[number]["identity"], "quinn">;

export function selectSpecialists(prompt: string): SpecialistIdentity[] {
  const text = prompt.toLowerCase();
  const selected: SpecialistIdentity[] = [];
  if (/inspect|technician|visit|field/.test(text)) selected.push("ada");
  if (/error|crash|outage|reliab/.test(text)) selected.push("mara");
  if (/sync|integrat|pestpac|fieldroutes/.test(text)) selected.push("theo");
  if (/\bai\b|analys|model|finding/.test(text)) selected.push("nadia");
  if (/audit|compliance|access|policy/.test(text)) selected.push("dario");
  // General requests still get a real specialist; cap work to two specialists per task.
  return selected.length ? selected.slice(0, 2) : ["iris"];
}