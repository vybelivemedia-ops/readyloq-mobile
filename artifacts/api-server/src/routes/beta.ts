import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import { db } from "@workspace/db";
import {
  betaFeedbackTable,
  errorEventsTable,
  betaChecklistStateTable,
  usersTable,
  inspectionsTable,
  type BetaFeedback,
  type ErrorEvent,
  type ErrorCategory,
} from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";
import { getCompanyId } from "../lib/tenant";
import { requireRole } from "../middleware/require-auth";
import { logErrorEvent } from "../lib/error-events";

const router: IRouter = Router();

// ── Canonical closed-beta checklist ────────────────────────────────────────────
// The item list is the source of truth in code; per-company completion state is
// stored in beta_checklist_state (rows created lazily on first toggle), keyed by
// the stable `key` so the content can evolve without orphaning state.
type ChecklistItem = {
  key: string;
  category: string;
  label: string;
  detail?: string;
};

const CHECKLIST: ChecklistItem[] = [
  {
    key: "device_smoke_test",
    category: "Field readiness",
    label: "Smoke-test camera, video & voice capture on real iOS and Android phones",
    detail: "These capture paths cannot be verified by automated tests — test on real devices.",
  },
  {
    key: "evidence_loss",
    category: "Reliability",
    label: "Verify inspection evidence is not lost if the app reloads mid-upload",
  },
  {
    key: "offline_behavior",
    category: "Reliability",
    label: "Confirm field behavior on poor / intermittent connectivity",
  },
  {
    key: "property_types",
    category: "Coverage",
    label: "Walk through Residential, Multi-Family, Commercial & Restaurant inspection flows",
  },
  {
    key: "invite_testers",
    category: "Onboarding",
    label: "Invite 5–10 pest-control technicians and confirm they can accept and sign in",
  },
  {
    key: "beta_access_controls",
    category: "Onboarding",
    label: "Confirm beta access can be paused and restored for a tester",
  },
  {
    key: "feedback_channel",
    category: "Feedback",
    label: "Confirm technicians can submit bug / feature / AI-accuracy feedback",
  },
  {
    key: "ai_accuracy_review",
    category: "AI quality",
    label: "Review a sample of AI analyses for accuracy and log any issues",
  },
  {
    key: "error_monitoring",
    category: "Operations",
    label: "Confirm upload / AI / report / auth failures surface in error monitoring",
  },
  {
    key: "branding",
    category: "Polish",
    label: "Set company branding (logo, colors, name) for the beta cohort",
  },
  {
    key: "engineering_gate",
    category: "Engineering",
    label: "Run typecheck + API tests green before cutting each beta build",
  },
  {
    key: "support_contact",
    category: "Support",
    label: "Share a support contact and response-time expectation with testers",
  },
];

const CHECKLIST_KEYS = new Set(CHECKLIST.map((c) => c.key));

function serializeFeedback(row: BetaFeedback) {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    description: row.description,
    severity: row.severity,
    status: row.status,
    userId: row.userId,
    inspectionId: row.inspectionId,
    analysisId: row.analysisId,
    reportId: row.reportId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function serializeErrorEvent(row: ErrorEvent) {
  return {
    id: row.id,
    category: row.category,
    message: row.message,
    context: row.context ?? null,
    userId: row.userId,
    inspectionId: row.inspectionId,
    reportId: row.reportId,
    source: row.source,
    createdAt: row.createdAt.toISOString(),
  };
}

// ── Feedback ───────────────────────────────────────────────────────────────────

const SubmitFeedbackBody = z.object({
  type: z.enum(["bug", "feature", "ai_accuracy"]),
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().min(1).max(5000),
  severity: z.enum(["low", "medium", "high"]).optional(),
  inspectionId: z.number().int().positive().optional(),
  analysisId: z.number().int().positive().optional(),
  reportId: z.number().int().positive().optional(),
});

// POST /beta/feedback — any authenticated company member (technicians included).
router.post("/feedback", async (req, res) => {
  const parsed = SubmitFeedbackBody.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid feedback" });
  }
  try {
    const companyId = getCompanyId(req);
    const [row] = await db
      .insert(betaFeedbackTable)
      .values({
        companyId,
        userId: req.user!.id,
        type: parsed.data.type,
        title: parsed.data.title,
        description: parsed.data.description,
        severity: parsed.data.severity,
        inspectionId: parsed.data.inspectionId,
        analysisId: parsed.data.analysisId,
        reportId: parsed.data.reportId,
      })
      .returning();
    return res.status(201).json(serializeFeedback(row));
  } catch {
    return res.status(500).json({ error: "Failed to submit feedback" });
  }
});

// GET /beta/feedback — manager+ triage list (newest first).
router.get("/feedback", requireRole("manager"), async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const rows = await db
      .select()
      .from(betaFeedbackTable)
      .where(eq(betaFeedbackTable.companyId, companyId))
      .orderBy(desc(betaFeedbackTable.id));
    const type = typeof req.query.type === "string" ? req.query.type : null;
    const status = typeof req.query.status === "string" ? req.query.status : null;
    const filtered = rows.filter(
      (r) => (!type || r.type === type) && (!status || r.status === status),
    );
    return res.json(filtered.map(serializeFeedback));
  } catch {
    return res.status(500).json({ error: "Failed to list feedback" });
  }
});

const UpdateFeedbackBody = z.object({
  status: z.enum(["open", "triaged", "resolved"]).optional(),
  severity: z.enum(["low", "medium", "high"]).optional(),
});

// PATCH /beta/feedback/:id — manager+ status/severity update (tenant re-checked).
router.patch("/feedback/:id", requireRole("manager"), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid id" });
  const parsed = UpdateFeedbackBody.safeParse(req.body);
  if (!parsed.success || (parsed.data.status == null && parsed.data.severity == null)) {
    return res.status(400).json({ error: "Nothing to update" });
  }
  try {
    const companyId = getCompanyId(req);
    const [row] = await db
      .update(betaFeedbackTable)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(and(eq(betaFeedbackTable.id, id), eq(betaFeedbackTable.companyId, companyId)))
      .returning();
    if (!row) return res.status(404).json({ error: "Feedback not found" });
    return res.json(serializeFeedback(row));
  } catch {
    return res.status(500).json({ error: "Failed to update feedback" });
  }
});

// ── Error monitoring ────────────────────────────────────────────────────────────

const ClientErrorBody = z.object({
  category: z.enum(["upload", "ai", "report", "auth"]),
  message: z.string().trim().min(1).max(500),
  context: z.record(z.string(), z.unknown()).optional(),
  inspectionId: z.number().int().positive().optional(),
  reportId: z.number().int().positive().optional(),
});

// POST /beta/errors — client-reported failures (e.g. an upload that failed in the
// browser after the presigned URL was minted). Any company member may report.
router.post("/errors", async (req, res) => {
  const parsed = ClientErrorBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid error report" });
  try {
    const companyId = getCompanyId(req);
    await logErrorEvent(parsed.data.category, {
      companyId,
      userId: req.user!.id,
      message: parsed.data.message,
      context: parsed.data.context as Record<string, unknown> | undefined,
      inspectionId: parsed.data.inspectionId,
      reportId: parsed.data.reportId,
      source: "client",
    });
    return res.status(201).json({ ok: true });
  } catch {
    return res.status(500).json({ error: "Failed to record error" });
  }
});

// GET /beta/errors — manager+ monitor: recent events + counts by category.
router.get("/errors", requireRole("manager"), async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const rows = await db
      .select()
      .from(errorEventsTable)
      .where(eq(errorEventsTable.companyId, companyId))
      .orderBy(desc(errorEventsTable.id))
      .limit(200);
    // Record<ErrorCategory, number> keeps this exhaustive — adding a new
    // ErrorCategory value without a corresponding key here is now a
    // compile-time error instead of a silent `summary[cat] += 1` on
    // `undefined` (which serializes as `null` and corrupts the manager's
    // error-monitor totals).
    const categoryCounts: Record<ErrorCategory, number> = {
      upload: 0,
      ai: 0,
      report: 0,
      auth: 0,
      notification: 0,
      inventory: 0,
    };
    for (const r of rows) categoryCounts[r.category] += 1;
    const summary = { ...categoryCounts, total: rows.length };
    return res.json({ summary, events: rows.map(serializeErrorEvent) });
  } catch {
    return res.status(500).json({ error: "Failed to list error events" });
  }
});

// ── Checklist ────────────────────────────────────────────────────────────────────

// GET /beta/checklist — manager+ canonical checklist merged with company state.
router.get("/checklist", requireRole("manager"), async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const state = await db
      .select()
      .from(betaChecklistStateTable)
      .where(eq(betaChecklistStateTable.companyId, companyId));
    const stateMap = new Map(state.map((s) => [s.itemKey, s]));
    const items = CHECKLIST.map((item) => {
      const s = stateMap.get(item.key);
      return {
        key: item.key,
        category: item.category,
        label: item.label,
        detail: item.detail ?? null,
        done: s?.done ?? false,
        doneAt: s?.doneAt ? s.doneAt.toISOString() : null,
      };
    });
    const completed = items.filter((i) => i.done).length;
    return res.json({ items, completed, total: items.length });
  } catch {
    return res.status(500).json({ error: "Failed to load checklist" });
  }
});

const ToggleChecklistBody = z.object({ done: z.boolean() });

// PATCH /beta/checklist/:itemKey — manager+ toggle a checklist item (upsert).
router.patch("/checklist/:itemKey", requireRole("manager"), async (req, res) => {
  const itemKey = String(req.params.itemKey);
  if (!CHECKLIST_KEYS.has(itemKey)) {
    return res.status(404).json({ error: "Unknown checklist item" });
  }
  const parsed = ToggleChecklistBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid body" });
  try {
    const companyId = getCompanyId(req);
    const done = parsed.data.done;
    const now = new Date();
    await db
      .insert(betaChecklistStateTable)
      .values({
        companyId,
        itemKey,
        done,
        doneAt: done ? now : null,
        doneByUserId: req.user!.id,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [betaChecklistStateTable.companyId, betaChecklistStateTable.itemKey],
        set: { done, doneAt: done ? now : null, doneByUserId: req.user!.id, updatedAt: now },
      });
    return res.json({ key: itemKey, done });
  } catch {
    return res.status(500).json({ error: "Failed to update checklist" });
  }
});

// ── Tester management ────────────────────────────────────────────────────────────

// GET /beta/testers — manager+ per-tester activity (last seen, inspections,
// feedback) plus account/beta-access status. Inspections are matched best-effort
// via the client-provided technicianId == clerkUserId.
router.get("/testers", requireRole("manager"), async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const [users, feedback, inspections] = await Promise.all([
      db.select().from(usersTable).where(eq(usersTable.companyId, companyId)),
      db
        .select({ userId: betaFeedbackTable.userId })
        .from(betaFeedbackTable)
        .where(eq(betaFeedbackTable.companyId, companyId)),
      db
        .select({ technicianId: inspectionsTable.technicianId })
        .from(inspectionsTable)
        .where(eq(inspectionsTable.companyId, companyId)),
    ]);

    const feedbackByUser = new Map<number, number>();
    for (const f of feedback) {
      if (f.userId != null) feedbackByUser.set(f.userId, (feedbackByUser.get(f.userId) ?? 0) + 1);
    }
    const inspectionsByTech = new Map<string, number>();
    for (const i of inspections) {
      if (i.technicianId)
        inspectionsByTech.set(i.technicianId, (inspectionsByTech.get(i.technicianId) ?? 0) + 1);
    }

    const ROLE_ORDER: Record<string, number> = { owner: 0, manager: 1, technician: 2 };
    const testers = users
      .map((u) => ({
        id: u.id,
        clerkUserId: u.clerkUserId,
        role: u.role,
        betaAccess: u.betaAccess,
        lastSeenAt: u.lastSeenAt ? u.lastSeenAt.toISOString() : null,
        joinedAt: u.createdAt.toISOString(),
        inspectionCount: inspectionsByTech.get(u.clerkUserId) ?? 0,
        feedbackCount: feedbackByUser.get(u.id) ?? 0,
      }))
      .sort((a, b) => (ROLE_ORDER[a.role] ?? 9) - (ROLE_ORDER[b.role] ?? 9));

    return res.json(testers);
  } catch {
    return res.status(500).json({ error: "Failed to list testers" });
  }
});

const ToggleAccessBody = z.object({ betaAccess: z.boolean() });

// PATCH /beta/testers/:userId/access — manager+ pause/restore a technician's beta
// access. Only technicians can be toggled; managers/owners always have access.
router.patch("/testers/:userId/access", requireRole("manager"), async (req, res) => {
  const userId = Number(req.params.userId);
  if (!Number.isInteger(userId)) return res.status(400).json({ error: "Invalid id" });
  const parsed = ToggleAccessBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid body" });
  if (userId === req.user!.id) {
    return res.status(400).json({ error: "You cannot change your own access" });
  }
  try {
    const companyId = getCompanyId(req);
    const [target] = await db
      .select()
      .from(usersTable)
      .where(and(eq(usersTable.id, userId), eq(usersTable.companyId, companyId)));
    if (!target) return res.status(404).json({ error: "Tester not found" });
    if (target.role !== "technician") {
      return res.status(400).json({ error: "Only technicians' access can be changed" });
    }
    const [row] = await db
      .update(usersTable)
      .set({ betaAccess: parsed.data.betaAccess })
      .where(and(eq(usersTable.id, userId), eq(usersTable.companyId, companyId)))
      .returning();
    return res.json({ id: row.id, betaAccess: row.betaAccess });
  } catch {
    return res.status(500).json({ error: "Failed to update access" });
  }
});

export default router;
