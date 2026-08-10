import { beforeEach, describe, expect, it, vi, afterEach } from "vitest";
import {
  syncInspectionToExternalSystem,
  type SyncPayload,
} from "./field-integration";

/**
 * Unit tests for the PestPac / FieldRoutes sync service.
 *
 * All HTTP calls are intercepted with a vi.stubGlobal fetch mock — no real
 * network requests are made and no database is needed. The tests verify:
 *   1. Happy-path full sync (note + attachments all succeed)
 *   2. Note POST failure throws, no attachment calls are made
 *   3. Attachment partial failure — note posted, 2/3 attachments succeed, no crash
 *   4. Invalid API key (401) surfaces as a clear thrown error
 *   5. Unknown external system throws exhaustive-check error
 */

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeOkResponse(body = "{}") {
  return new Response(body, { status: 200 });
}

function makeErrorResponse(status: number, body = "error body") {
  return new Response(body, { status });
}

const basePayload: SyncPayload = {
  externalSystem: "pestpac",
  accountId: "cust-123",
  apiKey: "test-key",
  apiBaseUrl: "https://mock.pestpac.test/v1",
  inspectionDate: "2026-08-10",
  reportSummary: "Termite activity detected near foundation.",
  photos: [
    { url: "https://cdn.example.com/photo1.jpg", caption: "Front door", severity: "high" },
    { url: "https://cdn.example.com/photo2.jpg", caption: "Attic", severity: "medium" },
    { url: "https://cdn.example.com/photo3.jpg", caption: "Crawlspace", severity: "low" },
  ],
  treatmentConditions: {
    pestsFound: ["Termite", "Carpenter Ant"],
    chemicalsUsed: ["Termidor SC"],
    temperature: 72,
    notes: "Recommend quarterly monitoring",
  },
};

// ─── PestPac ─────────────────────────────────────────────────────────────────

describe("syncToPestPac", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns success with all attachments posted on full sync", async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeOkResponse());
    vi.stubGlobal("fetch", fetchMock);

    const result = await syncInspectionToExternalSystem({ ...basePayload, externalSystem: "pestpac" });

    expect(result.success).toBe(true);
    expect(result.externalSystem).toBe("pestpac");
    expect(result.postedNotes).toBe(true);
    expect(result.attachmentsPosted).toBe(3);

    // 1 note POST + 3 attachment POSTs = 4 fetch calls total
    expect(fetchMock).toHaveBeenCalledTimes(4);
    const noteCall = fetchMock.mock.calls[0];
    expect(noteCall[0]).toContain("/customers/cust-123/notes");
    expect(noteCall[1].method).toBe("POST");
    expect(JSON.parse(noteCall[1].body as string)).toMatchObject({
      note: expect.stringContaining("ReadyLoq AI Report"),
      date: "2026-08-10",
    });
  });

  it("throws when the note POST fails (401 invalid API key) and makes no attachment calls", async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeErrorResponse(401, "Unauthorized"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      syncInspectionToExternalSystem({ ...basePayload, externalSystem: "pestpac" }),
    ).rejects.toThrow("PestPac note POST failed (401)");

    // Only the note call was made — no attachments attempted
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain("/notes");
  });

  it("throws when the note POST fails (500 server error) and surfaces status in message", async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeErrorResponse(500, "Internal Server Error"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      syncInspectionToExternalSystem({ ...basePayload, externalSystem: "pestpac" }),
    ).rejects.toThrow("PestPac note POST failed (500)");
  });

  it("continues uploading remaining photos when one attachment fails (partial success)", async () => {
    let callCount = 0;
    const fetchMock = vi.fn().mockImplementation(async (url: string) => {
      callCount++;
      // Call 1: note POST — succeeds
      if (callCount === 1) return makeOkResponse();
      // Call 2: first attachment — succeeds
      if (callCount === 2) return makeOkResponse();
      // Call 3: second attachment — fails (e.g. rate-limited)
      if (callCount === 3) return makeErrorResponse(429, "Too Many Requests");
      // Call 4: third attachment — succeeds
      return makeOkResponse();
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await syncInspectionToExternalSystem({ ...basePayload, externalSystem: "pestpac" });

    // The sync succeeds overall — only 2 of 3 attachments were posted
    expect(result.success).toBe(true);
    expect(result.postedNotes).toBe(true);
    expect(result.attachmentsPosted).toBe(2);
    // All 4 fetch calls were made (no early exit on attachment failure)
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("uses the default PestPac base URL when apiBaseUrl is not provided", async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeOkResponse());
    vi.stubGlobal("fetch", fetchMock);

    await syncInspectionToExternalSystem({
      ...basePayload,
      externalSystem: "pestpac",
      apiBaseUrl: null,
    });

    expect(fetchMock.mock.calls[0][0]).toContain("api.pestpac.com");
  });

  it("strips trailing slash from a custom apiBaseUrl", async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeOkResponse());
    vi.stubGlobal("fetch", fetchMock);

    await syncInspectionToExternalSystem({
      ...basePayload,
      externalSystem: "pestpac",
      apiBaseUrl: "https://staging.pestpac.test/v1/",
    });

    // The URL must not have a double slash in the path (after the protocol)
    const urlPath = (fetchMock.mock.calls[0][0] as string).replace(/^https?:\/\//, "");
    expect(urlPath).not.toContain("//");
    expect(fetchMock.mock.calls[0][0]).toContain("staging.pestpac.test/v1/customers");
  });

  it("sends the Authorization header with the API key on every call", async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeOkResponse());
    vi.stubGlobal("fetch", fetchMock);

    await syncInspectionToExternalSystem({ ...basePayload, externalSystem: "pestpac" });

    for (const [, init] of fetchMock.mock.calls) {
      expect((init as RequestInit).headers).toMatchObject({
        Authorization: "Bearer test-key",
      });
    }
  });
});

// ─── FieldRoutes ──────────────────────────────────────────────────────────────

describe("syncToFieldRoutes", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const frPayload: SyncPayload = {
    ...basePayload,
    externalSystem: "fieldroutes",
    apiBaseUrl: "https://mock.fieldroutes.test/api/v1",
  };

  it("returns success with all photos counted as attached on full sync", async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeOkResponse("{}"));
    vi.stubGlobal("fetch", fetchMock);

    const result = await syncInspectionToExternalSystem(frPayload);

    expect(result.success).toBe(true);
    expect(result.externalSystem).toBe("fieldroutes");
    expect(result.postedNotes).toBe(true);
    // FieldRoutes posts all media in one call — all 3 photos are counted
    expect(result.attachmentsPosted).toBe(3);

    // Only a single HTTP call (the service-history POST)
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/customer/cust-123/service-history");
    const body = JSON.parse(init.body as string);
    expect(body.summary).toBe("Termite activity detected near foundation.");
    expect(body.conditions.pestsFound).toEqual(["Termite", "Carpenter Ant"]);
    expect(body.mediaUrls).toHaveLength(3);
    expect(body.date).toBe("2026-08-10");
  });

  it("throws when the service-history POST fails (401 invalid API key)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeErrorResponse(401, "Unauthorized"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(syncInspectionToExternalSystem(frPayload)).rejects.toThrow(
      "FieldRoutes service-history POST failed (401)",
    );
  });

  it("throws when the service-history POST fails (503 service unavailable)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeErrorResponse(503, "Service Unavailable"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(syncInspectionToExternalSystem(frPayload)).rejects.toThrow(
      "FieldRoutes service-history POST failed (503)",
    );
  });

  it("uses the default FieldRoutes base URL when apiBaseUrl is not provided", async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeOkResponse());
    vi.stubGlobal("fetch", fetchMock);

    await syncInspectionToExternalSystem({ ...frPayload, apiBaseUrl: null });

    expect(fetchMock.mock.calls[0][0]).toContain("api.fieldroutes.com");
  });

  it("sends the Authorization header with the API key", async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeOkResponse());
    vi.stubGlobal("fetch", fetchMock);

    await syncInspectionToExternalSystem(frPayload);

    expect(fetchMock.mock.calls[0][1].headers).toMatchObject({
      Authorization: "Bearer test-key",
    });
  });
});

// ─── Dispatcher ───────────────────────────────────────────────────────────────

describe("syncInspectionToExternalSystem dispatcher", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("routes pestpac payload to the PestPac handler", async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeOkResponse());
    vi.stubGlobal("fetch", fetchMock);

    const result = await syncInspectionToExternalSystem({ ...basePayload, externalSystem: "pestpac" });
    expect(result.externalSystem).toBe("pestpac");
  });

  it("routes fieldroutes payload to the FieldRoutes handler", async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeOkResponse());
    vi.stubGlobal("fetch", fetchMock);

    const result = await syncInspectionToExternalSystem({
      ...basePayload,
      externalSystem: "fieldroutes",
      apiBaseUrl: "https://mock.fieldroutes.test/api/v1",
    });
    expect(result.externalSystem).toBe("fieldroutes");
  });

  it("throws for an unknown external system (exhaustive check)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeOkResponse());
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      syncInspectionToExternalSystem({
        ...basePayload,
        // Cast to bypass TS to simulate a future value arriving at runtime
        externalSystem: "unknown_system" as "pestpac",
      }),
    ).rejects.toThrow("Unknown external system: unknown_system");
  });
});
