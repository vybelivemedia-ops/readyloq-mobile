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
 *   3. Attachment partial failure — note posted, only 1/3 attachments posted after all retries exhausted
 *   4. Invalid API key (401) surfaces as a clear thrown error
 *   5. Unknown external system throws exhaustive-check error
 *   6. Retry path: first attachment attempt fails, second succeeds → attachmentsPosted reflects success
 *   7. FieldRoutes retry: first call fails, second succeeds → overall success
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

  it("throws immediately on 401 (dead credential) with exactly 1 attempt and no attachment calls", async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeErrorResponse(401, "Unauthorized"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      syncInspectionToExternalSystem({ ...basePayload, externalSystem: "pestpac" }),
    ).rejects.toThrow("PestPac note POST failed (401)");

    // 401 is a permanent auth failure — must not retry, so exactly 1 attempt
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain("/notes");
  });

  it("throws immediately on 403 (forbidden credential) with exactly 1 attempt and no attachment calls", async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeErrorResponse(403, "Forbidden"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      syncInspectionToExternalSystem({ ...basePayload, externalSystem: "pestpac" }),
    ).rejects.toThrow("PestPac note POST failed (403)");

    // 403 is a permanent auth failure — must not retry, so exactly 1 attempt
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain("/notes");
  });

  it("throws when the note POST fails (500 server error) and surfaces status in message", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue(makeErrorResponse(500, "Internal Server Error"));
    vi.stubGlobal("fetch", fetchMock);

    const assertion = expect(
      syncInspectionToExternalSystem({ ...basePayload, externalSystem: "pestpac" }),
    ).rejects.toThrow("PestPac note POST failed (500)");
    await vi.runAllTimersAsync();
    await assertion;

    vi.useRealTimers();

    // All 3 retry attempts were exhausted before throwing
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("retries the note POST on a transient failure and succeeds when the second attempt succeeds", async () => {
    vi.useFakeTimers();
    let callCount = 0;
    const fetchMock = vi.fn().mockImplementation(async () => {
      callCount++;
      // Call 1: note POST attempt 1 — transient 503
      if (callCount === 1) return makeErrorResponse(503, "Service Unavailable");
      // Call 2: note POST attempt 2 (retry) — succeeds
      if (callCount === 2) return makeOkResponse();
      // Calls 3+: attachment POSTs — all succeed
      return makeOkResponse();
    });
    vi.stubGlobal("fetch", fetchMock);

    const promise = syncInspectionToExternalSystem({ ...basePayload, externalSystem: "pestpac" });
    await vi.runAllTimersAsync();
    const result = await promise;

    vi.useRealTimers();

    expect(result.success).toBe(true);
    expect(result.postedNotes).toBe(true);
    // All 3 attachments should have posted successfully
    expect(result.attachmentsPosted).toBe(3);
    // 2 note attempts + 3 attachment calls = 5 total
    expect(fetchMock).toHaveBeenCalledTimes(5);
    // First two calls must be to the notes endpoint
    expect(fetchMock.mock.calls[0][0]).toContain("/notes");
    expect(fetchMock.mock.calls[1][0]).toContain("/notes");
  });

  it("throws and makes no attachment calls when the note POST exhausts all retry attempts", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue(makeErrorResponse(503, "Service Unavailable"));
    vi.stubGlobal("fetch", fetchMock);

    const assertion = expect(
      syncInspectionToExternalSystem({ ...basePayload, externalSystem: "pestpac" }),
    ).rejects.toThrow("PestPac note POST failed (503)");
    await vi.runAllTimersAsync();
    await assertion;

    vi.useRealTimers();

    // Exactly 3 note attempts — no attachment calls made
    expect(fetchMock).toHaveBeenCalledTimes(3);
    for (const [url] of fetchMock.mock.calls) {
      expect(url).toContain("/notes");
      expect(url).not.toContain("/attachments");
    }
  });

  it("continues uploading remaining photos when one attachment exhausts all retries (partial success)", async () => {
    vi.useFakeTimers();
    let callCount = 0;
    const fetchMock = vi.fn().mockImplementation(async () => {
      callCount++;
      // Call 1: note POST — succeeds
      if (callCount === 1) return makeOkResponse();
      // Call 2: first attachment (attempt 1) — succeeds
      if (callCount === 2) return makeOkResponse();
      // Calls 3–5: second attachment (all 3 retry attempts) — rate-limited every time
      if (callCount === 3 || callCount === 4 || callCount === 5)
        return makeErrorResponse(429, "Too Many Requests");
      // Call 6: third attachment — succeeds
      return makeOkResponse();
    });
    vi.stubGlobal("fetch", fetchMock);

    const promise = syncInspectionToExternalSystem({ ...basePayload, externalSystem: "pestpac" });
    await vi.runAllTimersAsync();
    const result = await promise;

    vi.useRealTimers();

    // The sync succeeds overall — only 2 of 3 attachments were posted (second exhausted retries)
    expect(result.success).toBe(true);
    expect(result.postedNotes).toBe(true);
    expect(result.attachmentsPosted).toBe(2);
    // 1 note + 1 successful attachment + 3 retry attempts for failed attachment + 1 final attachment = 6
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it("skips a photo and continues with remaining ones when fetch rejects (network error) on all retry attempts", async () => {
    vi.useFakeTimers();
    let callCount = 0;
    const fetchMock = vi.fn().mockImplementation(async () => {
      callCount++;
      // Call 1: note POST — succeeds
      if (callCount === 1) return makeOkResponse();
      // Calls 2–4: first attachment — fetch throws on every attempt (no network)
      if (callCount <= 4) throw new Error("Network unreachable");
      // Calls 5–6: second and third attachments — succeed
      return makeOkResponse();
    });
    vi.stubGlobal("fetch", fetchMock);

    const promise = syncInspectionToExternalSystem({ ...basePayload, externalSystem: "pestpac" });
    await vi.runAllTimersAsync();
    const result = await promise;

    vi.useRealTimers();

    // Sync still succeeds — the network-errored photo is skipped, not fatal
    expect(result.success).toBe(true);
    expect(result.postedNotes).toBe(true);
    // First photo exhausted all retries and was skipped; 2nd and 3rd succeeded
    expect(result.attachmentsPosted).toBe(2);
    // 1 note + 3 attempts for failing attachment + 2 successful attachments = 6
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });

  it("retries a failed attachment and counts it as posted when the retry succeeds", async () => {
    vi.useFakeTimers();
    let callCount = 0;
    const fetchMock = vi.fn().mockImplementation(async () => {
      callCount++;
      // Call 1: note POST — succeeds
      if (callCount === 1) return makeOkResponse();
      // Call 2: first attachment attempt 1 — fails transiently
      if (callCount === 2) return makeErrorResponse(503, "Service Unavailable");
      // Call 3: first attachment attempt 2 (retry) — succeeds
      if (callCount === 3) return makeOkResponse();
      // Calls 4–5: remaining two attachments — succeed
      return makeOkResponse();
    });
    vi.stubGlobal("fetch", fetchMock);

    const promise = syncInspectionToExternalSystem({
      ...basePayload,
      externalSystem: "pestpac",
      // Use a single photo to keep the call sequence simple
      photos: [{ url: "https://cdn.example.com/photo1.jpg", caption: "Front door", severity: "high" }],
    });
    await vi.runAllTimersAsync();
    const result = await promise;

    vi.useRealTimers();

    // Retry succeeded — the attachment must be counted as posted
    expect(result.success).toBe(true);
    expect(result.attachmentsPosted).toBe(1);
    // 1 note + 2 fetch calls for the attachment (attempt + retry) = 3
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("reports noteRetries=0 and attachmentRetries=0 when everything succeeds on the first attempt", async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeOkResponse());
    vi.stubGlobal("fetch", fetchMock);

    const result = await syncInspectionToExternalSystem({ ...basePayload, externalSystem: "pestpac" });

    expect(result.noteRetries).toBe(0);
    expect(result.attachmentRetries).toBe(0);
  });

  it("reports noteRetries=1 when the note POST succeeds on the second attempt", async () => {
    vi.useFakeTimers();
    let callCount = 0;
    const fetchMock = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) return makeErrorResponse(503, "Service Unavailable");
      return makeOkResponse();
    });
    vi.stubGlobal("fetch", fetchMock);

    const promise = syncInspectionToExternalSystem({
      ...basePayload,
      externalSystem: "pestpac",
      photos: [],
    });
    await vi.runAllTimersAsync();
    const result = await promise;

    vi.useRealTimers();

    expect(result.noteRetries).toBe(1);
    expect(result.attachmentRetries).toBe(0);
  });

  it("reports attachmentRetries=1 when one attachment requires a retry to succeed", async () => {
    vi.useFakeTimers();
    let callCount = 0;
    const fetchMock = vi.fn().mockImplementation(async () => {
      callCount++;
      // Call 1: note POST — succeeds
      if (callCount === 1) return makeOkResponse();
      // Call 2: first attachment attempt — fails transiently
      if (callCount === 2) return makeErrorResponse(503, "Service Unavailable");
      // Call 3: first attachment retry — succeeds
      return makeOkResponse();
    });
    vi.stubGlobal("fetch", fetchMock);

    const promise = syncInspectionToExternalSystem({
      ...basePayload,
      externalSystem: "pestpac",
      photos: [{ url: "https://cdn.example.com/photo1.jpg", caption: "Front door", severity: "high" }],
    });
    await vi.runAllTimersAsync();
    const result = await promise;

    vi.useRealTimers();

    expect(result.noteRetries).toBe(0);
    expect(result.attachmentRetries).toBe(1);
  });

  it("accumulates attachmentRetries across multiple photos", async () => {
    vi.useFakeTimers();
    let callCount = 0;
    const fetchMock = vi.fn().mockImplementation(async () => {
      callCount++;
      // Call 1: note POST — succeeds immediately
      if (callCount === 1) return makeOkResponse();
      // Calls 2–3: first photo — needs 1 retry (503 then 200)
      if (callCount === 2) return makeErrorResponse(503, "Service Unavailable");
      if (callCount === 3) return makeOkResponse();
      // Calls 4–5: second photo — needs 1 retry (503 then 200)
      if (callCount === 4) return makeErrorResponse(503, "Service Unavailable");
      if (callCount === 5) return makeOkResponse();
      return makeOkResponse();
    });
    vi.stubGlobal("fetch", fetchMock);

    const promise = syncInspectionToExternalSystem({
      ...basePayload,
      externalSystem: "pestpac",
      photos: [
        { url: "https://cdn.example.com/photo1.jpg", caption: "A", severity: "high" },
        { url: "https://cdn.example.com/photo2.jpg", caption: "B", severity: "medium" },
      ],
    });
    await vi.runAllTimersAsync();
    const result = await promise;

    vi.useRealTimers();

    // Each of the two photos needed 1 retry → total attachmentRetries = 2
    expect(result.noteRetries).toBe(0);
    expect(result.attachmentRetries).toBe(2);
    expect(result.attachmentsPosted).toBe(2);
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

  it("logs a warning and reports attachmentsPosted=0 / attachmentErrors=3 when every attachment returns 401 — does not throw", async () => {
    let callCount = 0;
    const fetchMock = vi.fn().mockImplementation(async () => {
      callCount++;
      // Call 1: note POST — succeeds
      if (callCount === 1) return makeOkResponse();
      // All subsequent calls: attachment POSTs — permanent 401 (fast-fail, no retry)
      return makeErrorResponse(401, "Unauthorized");
    });
    vi.stubGlobal("fetch", fetchMock);

    const warnSpy = vi.spyOn(
      (await import("../lib/logger")).logger,
      "warn",
    );

    const result = await syncInspectionToExternalSystem({
      ...basePayload,
      externalSystem: "pestpac",
    });

    // Must not throw — attachment failures are non-fatal
    expect(result.success).toBe(true);
    expect(result.postedNotes).toBe(true);

    // No attachments were posted
    expect(result.attachmentsPosted).toBe(0);

    // Every attachment failure is counted in attachmentErrors
    expect(result.attachmentErrors).toBe(3);

    // 401 is non-retryable — exactly 1 attempt per photo (1 note + 3 attachment calls)
    expect(fetchMock).toHaveBeenCalledTimes(4);

    // A warning must have been logged for each failed attachment
    const authWarnCalls = warnSpy.mock.calls.filter(
      ([, msg]) => typeof msg === "string" && msg.includes("auth error"),
    );
    expect(authWarnCalls).toHaveLength(3);

    warnSpy.mockRestore();
  });

  it("reports attachmentErrors=0 when all attachments succeed", async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeOkResponse());
    vi.stubGlobal("fetch", fetchMock);

    const result = await syncInspectionToExternalSystem({ ...basePayload, externalSystem: "pestpac" });

    expect(result.attachmentErrors).toBe(0);
  });

  it("reports attachmentErrors=1 when one attachment returns 401 and the rest succeed", async () => {
    let callCount = 0;
    const fetchMock = vi.fn().mockImplementation(async () => {
      callCount++;
      // Call 1: note POST — succeeds
      if (callCount === 1) return makeOkResponse();
      // Call 2: first attachment — permanent 401
      if (callCount === 2) return makeErrorResponse(401, "Unauthorized");
      // Remaining attachment calls — succeed
      return makeOkResponse();
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await syncInspectionToExternalSystem({
      ...basePayload,
      externalSystem: "pestpac",
    });

    expect(result.success).toBe(true);
    expect(result.attachmentsPosted).toBe(2);
    expect(result.attachmentErrors).toBe(1);
    // 401 is non-retryable: 1 note + 1 failed attachment (1 attempt) + 2 successful = 4
    expect(fetchMock).toHaveBeenCalledTimes(4);
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

  it("throws immediately on 401 (dead credential) with exactly 1 attempt", async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeErrorResponse(401, "Unauthorized"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      syncInspectionToExternalSystem(frPayload),
    ).rejects.toThrow("FieldRoutes service-history POST failed (401)");

    // 401 is a permanent auth failure — must not retry, so exactly 1 attempt
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("throws immediately on 403 (forbidden credential) with exactly 1 attempt", async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeErrorResponse(403, "Forbidden"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      syncInspectionToExternalSystem(frPayload),
    ).rejects.toThrow("FieldRoutes service-history POST failed (403)");

    // 403 is a permanent auth failure — must not retry, so exactly 1 attempt
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("throws when the service-history POST fails (503 service unavailable) after exhausting retries", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue(makeErrorResponse(503, "Service Unavailable"));
    vi.stubGlobal("fetch", fetchMock);

    const assertion = expect(
      syncInspectionToExternalSystem(frPayload),
    ).rejects.toThrow("FieldRoutes service-history POST failed (503)");
    await vi.runAllTimersAsync();
    await assertion;

    expect(fetchMock).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });

  it("retries on a transient failure and succeeds when the second attempt succeeds", async () => {
    vi.useFakeTimers();
    let callCount = 0;
    const fetchMock = vi.fn().mockImplementation(async () => {
      callCount++;
      // First attempt — transient 503
      if (callCount === 1) return makeErrorResponse(503, "Service Unavailable");
      // Second attempt — succeeds
      return makeOkResponse("{}");
    });
    vi.stubGlobal("fetch", fetchMock);

    const promise = syncInspectionToExternalSystem(frPayload);
    await vi.runAllTimersAsync();
    const result = await promise;

    vi.useRealTimers();

    expect(result.success).toBe(true);
    expect(result.externalSystem).toBe("fieldroutes");
    expect(result.attachmentsPosted).toBe(3);
    // Exactly 2 fetch calls: 1 failed + 1 successful retry
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("reports noteRetries=0 and attachmentRetries=0 on a clean FieldRoutes sync", async () => {
    const fetchMock = vi.fn().mockResolvedValue(makeOkResponse("{}"));
    vi.stubGlobal("fetch", fetchMock);

    const result = await syncInspectionToExternalSystem(frPayload);

    expect(result.noteRetries).toBe(0);
    expect(result.attachmentRetries).toBe(0);
  });

  it("reports noteRetries=1 when the FieldRoutes service-history POST succeeds on the second attempt", async () => {
    vi.useFakeTimers();
    let callCount = 0;
    const fetchMock = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) return makeErrorResponse(503, "Service Unavailable");
      return makeOkResponse("{}");
    });
    vi.stubGlobal("fetch", fetchMock);

    const promise = syncInspectionToExternalSystem(frPayload);
    await vi.runAllTimersAsync();
    const result = await promise;

    vi.useRealTimers();

    expect(result.noteRetries).toBe(1);
    expect(result.attachmentRetries).toBe(0);
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
