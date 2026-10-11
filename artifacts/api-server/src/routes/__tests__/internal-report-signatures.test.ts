/**
 * Internal report HTML — signature block parity with the client-portal route
 * (Task #900, following on from #875).
 *
 * GET /api/reports/:id/html is the URL company owners/managers/technicians use
 * to view a report in-browser (it's also what the persisted `report.pdfUrl`
 * resolves to after finalization — see reports.ts). Like the client-portal
 * route (GET /api/client/reports/:id/html), it calls buildServerReportHtml,
 * which embeds the inspection's signatures as base64 data URIs. Task #875
 * added coverage for the client-portal route only; this file closes the same
 * gap on the internal route so the "inspection row stops being forwarded"
 * regression can't silently ship here either:
 *
 *   1. An inspection with BOTH technicianSignature and ownerSignature set
 *      renders both signatures' base64 data URIs in the response HTML.
 *   2. An inspection with ownerNotAvailable=true (no ownerSignature) renders
 *      the "not available" notice instead of a blank/missing signature block.
 */

import { beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";

// ─── Clerk mock ────────────────────────────────────────────────────────────────

const { authState } = vi.hoisted(() => ({
  authState: { userId: null as string | null },
}));

vi.mock("@clerk/express", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@clerk/express")>();
  return {
    ...actual,
    getAuth: () => authState,
    clerkMiddleware: () => (_req: unknown, _res: unknown, next: () => void) => next(),
  };
});

// ─── Object storage stub — this route has no photos in its fixtures, but
//     app.ts wires ObjectStorageService up globally at module-load time. ──────

vi.mock("../../lib/objectStorage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../lib/objectStorage")>();
  class ObjectStorageService {
    async getObjectEntityUploadURL(companyId: number) {
      return `https://signed.example.com/companies/${companyId}/uploads/obj`;
    }
    normalizeObjectEntityPath(url: string) {
      return url;
    }
    async getObjectEntityFile(_path: string) {
      return {} as never;
    }
    async downloadObject() {
      return new Response("file-bytes");
    }
  }
  return { ...actual, ObjectStorageService };
});

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import app from "../../app";
import {
  db,
  usersTable,
  companiesTable,
  inspectionsTable,
  reportsTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";

function asUser(id: string | null) {
  authState.userId = id;
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const RUN_ID = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const OWNER_CLERK_ID = `sig_internal_report_owner_${RUN_ID}`;
const ADDRESS = `88 Manager View Rd ${RUN_ID}`;

// Deliberately distinct "signatures" (in production these are SVG markup) so
// each one's base64 encoding is unambiguous in assertions.
const TECH_SIG = `<svg data-run="${RUN_ID}">tech-signature-mark</svg>`;
const OWNER_SIG = `<svg data-run="${RUN_ID}">owner-signature-mark</svg>`;

let companyId: number;
let bothSignedReportId: number;
let ownerNotAvailableReportId: number;

beforeAll(async () => {
  const [company] = await db
    .insert(companiesTable)
    .values({ name: `Sig Internal Report Co ${RUN_ID}`, slug: `sig-internal-report-co-${RUN_ID}` })
    .returning();
  companyId = company.id;

  await db.insert(usersTable).values({
    clerkUserId: OWNER_CLERK_ID,
    role: "owner",
    companyId,
  });

  // Case 1: both technician and owner signed.
  const [bothSignedInsp] = await db
    .insert(inspectionsTable)
    .values({
      companyId,
      siteAddress: ADDRESS,
      status: "completed",
      technicianName: "Tech Both",
      clientName: "Client Both",
      technicianSignature: TECH_SIG,
      ownerSignature: OWNER_SIG,
      ownerNotAvailable: false,
      signedAt: new Date(),
    })
    .returning();

  const [bothSignedReport] = await db
    .insert(reportsTable)
    .values({
      companyId,
      inspectionId: bothSignedInsp.id,
      title: "Both Signed Internal Report",
      status: "approved",
      siteAddress: ADDRESS,
      technicianName: "Tech Both",
      inspectionDate: new Date().toISOString().slice(0, 10),
    })
    .returning();
  bothSignedReportId = bothSignedReport.id;

  // Case 2: owner not available — technician signed, owner did not.
  const [ownerNaInsp] = await db
    .insert(inspectionsTable)
    .values({
      companyId,
      siteAddress: ADDRESS,
      status: "completed",
      technicianName: "Tech NA",
      clientName: "Client NA",
      technicianSignature: TECH_SIG,
      ownerSignature: null,
      ownerNotAvailable: true,
      signedAt: new Date(),
    })
    .returning();

  const [ownerNaReport] = await db
    .insert(reportsTable)
    .values({
      companyId,
      inspectionId: ownerNaInsp.id,
      title: "Owner NA Internal Report",
      status: "approved",
      siteAddress: ADDRESS,
      technicianName: "Tech NA",
      inspectionDate: new Date().toISOString().slice(0, 10),
    })
    .returning();
  ownerNotAvailableReportId = ownerNaReport.id;
});

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe("GET /api/reports/:id/html — signature block parity with the client-portal route", () => {
  it("renders both technician and owner signature data URIs when both are on file", async () => {
    asUser(OWNER_CLERK_ID);
    const res = await request(app).get(`/api/reports/${bothSignedReportId}/html`);
    expect(res.status).toBe(200);

    const techDataUri = `data:image/svg+xml;base64,${Buffer.from(TECH_SIG).toString("base64")}`;
    const ownerDataUri = `data:image/svg+xml;base64,${Buffer.from(OWNER_SIG).toString("base64")}`;

    expect(res.text).toContain(techDataUri);
    expect(res.text).toContain(ownerDataUri);
    expect(res.text).toContain("Technician Signature");
    expect(res.text).toContain("Owner / Client Signature");
  });

  it("renders the 'not available' notice instead of a blank block when ownerNotAvailable is true", async () => {
    asUser(OWNER_CLERK_ID);
    const res = await request(app).get(`/api/reports/${ownerNotAvailableReportId}/html`);
    expect(res.status).toBe(200);

    const techDataUri = `data:image/svg+xml;base64,${Buffer.from(TECH_SIG).toString("base64")}`;
    expect(res.text).toContain(techDataUri);
    expect(res.text).toContain("Owner not available");
    // No owner signature was ever set, so its data URI must never appear.
    expect(res.text).not.toContain("owner-signature-mark");
  });

  it("sanity check: an inspection row not forwarded to the builder would silently drop this block", async () => {
    // Guards the actual regression this task is about: if the route ever stops
    // passing the inspection row into buildServerReportHtml, the "Signatures"
    // section heading itself disappears rather than merely being empty.
    asUser(OWNER_CLERK_ID);
    const res = await request(app).get(`/api/reports/${bothSignedReportId}/html`);
    expect(res.status).toBe(200);
    expect(res.text).toContain("Signatures");
  });
});
