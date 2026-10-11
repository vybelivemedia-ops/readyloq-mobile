import { afterEach, describe, expect, it, vi } from "vitest";
import { submitLead } from "../src/lib/api";

afterEach(() => vi.unstubAllGlobals());
const signup = { type: "contact" as const, name: "Pilot signup", email: "signup@example.invalid", source: "readyloq-pilot" };
describe("pilot API response handling", () => {
  it("returns success only for a successful server response", async () => {
    const lead = { ...signup, id: 1, status: "new", createdAt: "2026-10-10T00:00:00Z" };
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(lead), { status: 201 }));
    vi.stubGlobal("fetch", fetch);
    expect(await submitLead(signup)).toEqual(lead);
    expect(fetch.mock.calls[0][0]).toBe("/api-server/leads");
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual(signup);
  });
  it.each([502, 503])("propagates delivery failure %s rather than showing inbox confirmation", async (status) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ error: "Your signup was saved, but pilot email delivery failed." }), { status },
    )));
    await expect(submitLead(signup)).rejects.toThrow("signup was saved");
  });
});
