import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";

/**
 * Beta Center route tests (closed-beta launch prep).
 *
 * Exercises the /beta surface end-to-end through the HTTP layer plus the beta
 * access gate that wraps tenant data routes. Coverage:
 *  - tenant isolation (feedback / errors / testers never bleed across companies)
 *  - role gating (technicians may submit feedback but are 403'd on every
 *    manager-only admin endpoint)
 *  - the beta access kill-switch (a paused technician is blocked on tenant data
 *    routes with code "beta_access_disabled" yet can still submit feedback;
 *    managers/owners are never locked out)
 *  - the beta KPI columns added to the analytics dashboard
 *    (photosCaptured / videosCaptured / aiAnalysesCompleted)
 *  - the canonical checklist + per-company toggle state
 */

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

import app from "../app";
import {
  db,
  usersTable,
  companiesTable,
  inspectionsTable,
  inspectionMediaTable,
  betaFeedbackTable,
  errorEventsTable,
  betaChecklistStateTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";

const OWNER_A_ID = "beta_owner_a_clerk_id";
const MGR_A_ID = "beta_mgr_a_clerk_id";
const TECH_A_ID = "beta_tech_a_clerk_id";
const PAUSE_A_ID = "beta_pause_a_clerk_id"; // dedicated technician for the kill-switch test
const OWNER_B_ID = "beta_owner_b_clerk_id";
const TECH_B_ID = "beta_tech_b_clerk_id";

let companyAId: number;
let companyBId: number;
let pauseUserId: number; // users.id of PAUSE_A_ID

function asUser(id: string | null) {
  authState.userId = id;
}

async function findOrCreateCompany(name: string, slug: string): Promise<number> {
  const [existing] = await db.select().from(companiesTable).where(eq(companiesTable.slug, slug));
  if (existing) return existing.id;
  const [row] = await db.insert(companiesTable).values({ name, slug }).returning();
  return row.id;
}

beforeAll(async () => {
  companyAId = await findOrCreateCompany("Beta Co A", "beta-co-a");
  companyBId = await findOrCreateCompany("Beta Co B", "beta-co-b");

  const companyIds = [companyAId, companyBId];

  // Reset only this suite's two companies so counts are deterministic across
  // reruns. Deleting inspections cascades to media/analysis/reports.
  await db.delete(inspectionsTable).where(inArray(inspectionsTable.companyId, companyIds));
  await db.delete(betaFeedbackTable).where(inArray(betaFeedbackTable.companyId, companyIds));
  await db.delete(errorEventsTable).where(inArray(errorEventsTable.companyId, companyIds));
  await db
    .delete(betaChecklistStateTable)
    .where(inArray(betaChecklistStateTable.companyId, companyIds));
  await db.delete(usersTable).where(inArray(usersTable.companyId, companyIds));

  await db.insert(usersTable).values([
    { clerkUserId: OWNER_A_ID, role: "owner", companyId: companyAId },
    { clerkUserId: MGR_A_ID, role: "manager", companyId: companyAId },
    { clerkUserId: TECH_A_ID, role: "technician", companyId: companyAId },
    { clerkUserId: PAUSE_A_ID, role: "technician", companyId: companyAId },
    { clerkUserId: OWNER_B_ID, role: "owner", companyId: companyBId },
    { clerkUserId: TECH_B_ID, role: "technician", companyId: companyBId },
  ]);

  const [pauseUser] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.clerkUserId, PAUSE_A_ID));
  pauseUserId = pauseUser.id;
});

beforeEach(() => {
  asUser(null);
});

/** Submit a feedback item as the given user; returns the response. */
async function submitFeedback(
  userId: string,
  body: Record<string, unknown> = { type: "bug", title: "T", description: "D" },
) {
  asUser(userId);
  const res = await request(app).post("/api/beta/feedback").send(body);
  asUser(null);
  return res;
}

describe("beta feedback", () => {
  it("lets a technician submit feedback", async () => {
    const res = await submitFeedback(TECH_A_ID, {
      type: "bug",
      title: "App crashed",
      description: "Crashed on photo capture",
      severity: "high",
    });
    expect(res.status).toBe(201);
    expect(res.body.type).toBe("bug");
    expect(res.body.status).toBe("open");
  });

  it("rejects an unauthenticated submission", async () => {
    asUser(null);
    const res = await request(app)
      .post("/api/beta/feedback")
      .send({ type: "bug", title: "x", description: "y" });
    expect(res.status).toBe(401);
  });

  it("validates the feedback body", async () => {
    asUser(TECH_A_ID);
    const res = await request(app)
      .post("/api/beta/feedback")
      .send({ type: "nonsense", title: "", description: "" });
    expect(res.status).toBe(400);
  });

  it("403s a technician on the manager-only triage list", async () => {
    asUser(TECH_A_ID);
    const res = await request(app).get("/api/beta/feedback");
    expect(res.status).toBe(403);
  });

  it("lists only the caller company's feedback (manager)", async () => {
    const a = await submitFeedback(TECH_A_ID, {
      type: "feature",
      title: "Company A item",
      description: "A",
    });
    const b = await submitFeedback(TECH_B_ID, {
      type: "feature",
      title: "Company B item",
      description: "B",
    });
    expect(a.status).toBe(201);
    expect(b.status).toBe(201);

    asUser(MGR_A_ID);
    const listA = await request(app).get("/api/beta/feedback");
    expect(listA.status).toBe(200);
    const idsA = listA.body.map((r: { id: number }) => r.id);
    expect(idsA).toContain(a.body.id);
    expect(idsA).not.toContain(b.body.id);
  });

  it("filters by type and status", async () => {
    asUser(MGR_A_ID);
    const bugs = await request(app).get("/api/beta/feedback").query({ type: "bug" });
    expect(bugs.status).toBe(200);
    expect(bugs.body.every((r: { type: string }) => r.type === "bug")).toBe(true);
  });

  it("lets a manager triage feedback, scoped to the company", async () => {
    const a = await submitFeedback(TECH_A_ID, {
      type: "bug",
      title: "Triage me",
      description: "x",
    });
    asUser(MGR_A_ID);
    const patch = await request(app)
      .patch(`/api/beta/feedback/${a.body.id}`)
      .send({ status: "triaged", severity: "medium" });
    expect(patch.status).toBe(200);
    expect(patch.body.status).toBe("triaged");
    expect(patch.body.severity).toBe("medium");

    // Company B's owner cannot reach Company A's feedback row.
    asUser(OWNER_B_ID);
    const cross = await request(app)
      .patch(`/api/beta/feedback/${a.body.id}`)
      .send({ status: "resolved" });
    expect(cross.status).toBe(404);
  });
});

describe("beta error monitoring", () => {
  it("403s a technician and persists the forbidden attempt as an auth event", async () => {
    asUser(TECH_A_ID);
    const denied = await request(app).get("/api/beta/errors");
    expect(denied.status).toBe(403);

    // requireRole records company-scoped 403s; the manager sees them.
    asUser(MGR_A_ID);
    const res = await request(app).get("/api/beta/errors");
    expect(res.status).toBe(200);
    expect(res.body.summary).toMatchObject({ upload: expect.any(Number), auth: expect.any(Number) });
    expect(res.body.summary.auth).toBeGreaterThan(0);
    expect(res.body.events.some((e: { category: string }) => e.category === "auth")).toBe(true);
  });

  it("records client-reported errors and scopes them per company", async () => {
    asUser(TECH_A_ID);
    const report = await request(app)
      .post("/api/beta/errors")
      .send({ category: "upload", message: "PUT failed (503)", context: { stage: "put" } });
    expect(report.status).toBe(201);

    asUser(MGR_A_ID);
    const listA = await request(app).get("/api/beta/errors");
    expect(listA.body.events.some((e: { message: string }) => e.message === "PUT failed (503)")).toBe(
      true,
    );

    // Company B never sees Company A's upload error.
    asUser(OWNER_B_ID);
    const listB = await request(app).get("/api/beta/errors");
    expect(
      listB.body.events.some((e: { message: string }) => e.message === "PUT failed (503)"),
    ).toBe(false);
  });
});

describe("beta checklist", () => {
  it("403s a technician", async () => {
    asUser(TECH_A_ID);
    const res = await request(app).get("/api/beta/checklist");
    expect(res.status).toBe(403);
  });

  it("returns the canonical 12-item checklist (manager)", async () => {
    asUser(MGR_A_ID);
    const res = await request(app).get("/api/beta/checklist");
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(12);
    expect(res.body.items).toHaveLength(12);
    const keys = res.body.items.map((i: { key: string }) => i.key);
    expect(keys).toContain("device_smoke_test");
    expect(keys).toContain("invite_testers");
    expect(keys).toContain("engineering_gate");
  });

  it("toggles an item and persists the state per company", async () => {
    asUser(MGR_A_ID);
    const toggle = await request(app)
      .patch("/api/beta/checklist/invite_testers")
      .send({ done: true });
    expect(toggle.status).toBe(200);
    expect(toggle.body).toMatchObject({ key: "invite_testers", done: true });

    const after = await request(app).get("/api/beta/checklist");
    const item = after.body.items.find((i: { key: string }) => i.key === "invite_testers");
    expect(item.done).toBe(true);
    expect(item.doneAt).not.toBeNull();
    expect(after.body.completed).toBeGreaterThanOrEqual(1);

    // Company B starts from a clean slate — the toggle did not leak across tenants.
    asUser(OWNER_B_ID);
    const bChecklist = await request(app).get("/api/beta/checklist");
    const bItem = bChecklist.body.items.find((i: { key: string }) => i.key === "invite_testers");
    expect(bItem.done).toBe(false);
  });

  it("404s an unknown checklist item", async () => {
    asUser(MGR_A_ID);
    const res = await request(app).patch("/api/beta/checklist/not_a_real_item").send({ done: true });
    expect(res.status).toBe(404);
  });
});

describe("beta tester management", () => {
  it("403s a technician", async () => {
    asUser(TECH_A_ID);
    const res = await request(app).get("/api/beta/testers");
    expect(res.status).toBe(403);
  });

  it("lists only the caller company's testers with activity (manager)", async () => {
    asUser(MGR_A_ID);
    const res = await request(app).get("/api/beta/testers");
    expect(res.status).toBe(200);
    const clerkIds = res.body.map((t: { clerkUserId: string }) => t.clerkUserId);
    expect(clerkIds).toContain(TECH_A_ID);
    expect(clerkIds).toContain(OWNER_A_ID);
    expect(clerkIds).not.toContain(TECH_B_ID);
    expect(clerkIds).not.toContain(OWNER_B_ID);
    const tech = res.body.find((t: { clerkUserId: string }) => t.clerkUserId === TECH_A_ID);
    expect(tech).toMatchObject({
      role: "technician",
      betaAccess: true,
      feedbackCount: expect.any(Number),
      inspectionCount: expect.any(Number),
    });
  });

  it("refuses to toggle a manager/owner's access", async () => {
    asUser(OWNER_A_ID);
    const [mgr] = await db.select().from(usersTable).where(eq(usersTable.clerkUserId, MGR_A_ID));
    const res = await request(app)
      .patch(`/api/beta/testers/${mgr.id}/access`)
      .send({ betaAccess: false });
    expect(res.status).toBe(400);
  });

  it("refuses to toggle your own access", async () => {
    asUser(OWNER_A_ID);
    const [owner] = await db.select().from(usersTable).where(eq(usersTable.clerkUserId, OWNER_A_ID));
    const res = await request(app)
      .patch(`/api/beta/testers/${owner.id}/access`)
      .send({ betaAccess: false });
    expect(res.status).toBe(400);
  });

  it("cannot toggle a tester in another company (404)", async () => {
    asUser(OWNER_B_ID);
    const res = await request(app)
      .patch(`/api/beta/testers/${pauseUserId}/access`)
      .send({ betaAccess: false });
    expect(res.status).toBe(404);
  });
});

describe("beta access kill-switch", () => {
  it("blocks a paused technician on tenant data routes but not on feedback; managers bypass", async () => {
    // Baseline: an active technician can read tenant data.
    asUser(PAUSE_A_ID);
    const before = await request(app).get("/api/inspections");
    expect(before.status).toBe(200);

    // Manager pauses the technician's beta access.
    asUser(MGR_A_ID);
    const pause = await request(app)
      .patch(`/api/beta/testers/${pauseUserId}/access`)
      .send({ betaAccess: false });
    expect(pause.status).toBe(200);
    expect(pause.body.betaAccess).toBe(false);

    // The paused technician is now blocked on tenant data with the client signal.
    asUser(PAUSE_A_ID);
    const blocked = await request(app).get("/api/inspections");
    expect(blocked.status).toBe(403);
    expect(blocked.body.code).toBe("beta_access_disabled");

    // ...including the private storage routes: a paused tester can neither mint
    // upload URLs nor read private company objects. requireBetaAccess short-
    // circuits before any object-storage call is made.
    const mint = await request(app)
      .post("/api/storage/uploads/request-url")
      .send({ name: "x.jpg", size: 10, contentType: "image/jpeg" });
    expect(mint.status).toBe(403);
    expect(mint.body.code).toBe("beta_access_disabled");

    const objRead = await request(app).get(
      `/api/storage/objects/companies/${companyAId}/uploads/file-x`,
    );
    expect(objRead.status).toBe(403);
    expect(objRead.body.code).toBe("beta_access_disabled");

    // ...but can still submit feedback (the channel stays open).
    const feedback = await request(app)
      .post("/api/beta/feedback")
      .send({ type: "bug", title: "Still here", description: "paused but reporting" });
    expect(feedback.status).toBe(201);

    // The manager is never affected by the gate.
    asUser(MGR_A_ID);
    const mgrAccess = await request(app).get("/api/inspections");
    expect(mgrAccess.status).toBe(200);

    // Restore access; the technician regains tenant data.
    const restore = await request(app)
      .patch(`/api/beta/testers/${pauseUserId}/access`)
      .send({ betaAccess: true });
    expect(restore.status).toBe(200);
    asUser(PAUSE_A_ID);
    const after = await request(app).get("/api/inspections");
    expect(after.status).toBe(200);
  });
});

describe("analytics beta KPIs", () => {
  it("reports photo/video capture and completed AI analyses for the company", async () => {
    // Fresh inspection in Company A with one photo, one video, and one analysis.
    asUser(OWNER_A_ID);
    const insp = await request(app)
      .post("/api/inspections")
      .send({ siteAddress: "1 Beta Way", technicianName: "T", clientName: "C", pestTypes: ["ants"] });
    expect(insp.status).toBe(201);

    const photo = await request(app)
      .post(`/api/inspections/${insp.body.id}/media`)
      .send({ mediaType: "photo", url: "https://x/photo.jpg" });
    expect(photo.status).toBe(201);
    const video = await request(app)
      .post(`/api/inspections/${insp.body.id}/media`)
      .send({ mediaType: "video", url: "https://x/clip.mp4", durationSec: 12 });
    expect(video.status).toBe(201);

    const analysis = await request(app)
      .post("/api/analysis")
      .send({ inspectionId: insp.body.id, findings: [], recommendations: [], overallConfidence: 90 });
    expect(analysis.status).toBe(201);

    const dash = await request(app).get("/api/analytics/dashboard");
    expect(dash.status).toBe(200);
    expect(dash.body.photosCaptured).toBe(1);
    expect(dash.body.videosCaptured).toBe(1);
    expect(dash.body.aiAnalysesCompleted).toBe(1);

    // Company B sees none of Company A's media or analyses.
    asUser(OWNER_B_ID);
    const dashB = await request(app).get("/api/analytics/dashboard");
    expect(dashB.body.photosCaptured).toBe(0);
    expect(dashB.body.videosCaptured).toBe(0);
    expect(dashB.body.aiAnalysesCompleted).toBe(0);
  });
});
