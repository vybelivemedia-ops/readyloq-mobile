import { Router } from "express";
import { db } from "@workspace/db";
import {
  intelligenceRecordsTable,
  intelligenceTagsTable,
  intelligenceReviewsTable,
  intelligenceVotesTable,
  companiesTable,
  INTELLIGENCE_TAXONOMY,
  type IntelligenceRecord,
  type IntelligenceVote,
  type IntelligenceSeverity,
  type TreatmentOutcome,
} from "@workspace/db";
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  UpdateIntelligenceSettingsBody,
  ListIntelligenceRecordsQueryParams,
  CreateIntelligenceRecordBody,
  ConfirmIntelligenceRecordBody,
  VoteIntelligenceRecordBody,
  ReviewIntelligenceRecordBody,
} from "@workspace/api-zod";
import { getCompanyId } from "../lib/tenant";
import { requireRole } from "../middleware/require-auth";
import { objectPathCompanyScope } from "../lib/objectStorage";
import { generateAiPrediction, fallbackPrediction } from "../lib/intelligence-ai";

const router = Router();

const TAXONOMY_LABEL: Record<string, string> = Object.fromEntries(
  INTELLIGENCE_TAXONOMY.map((g) => [g.slug, g.label]),
);

/** Whole-number percentage; 0 when the denominator is 0 (no silent NaN). */
function pct(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 100);
}

/**
 * The client persists a *display* URL ("/api/storage/objects/...") so the browser
 * can render the image, but the tenant scope check and the AI byte-fetch both need
 * the canonical object path ("/objects/..."). Strip the public storage prefix.
 */
function toStoragePath(url: string): string {
  return url.replace(/^\/api\/storage/, "");
}

/**
 * Technicians may confirm/correct or skip a record only while it is still in the
 * technician phase: AI-suggested (pending) or peer-confirmed (confirmed, L2/L3).
 * Once a manager has approved (L4), expert-verified (L5), rejected, or it was
 * skipped, the record is locked to technician edits so manager verification and
 * `approvedForTraining` can never be silently downgraded.
 */
function isTechnicianEditable(record: IntelligenceRecord): boolean {
  return (
    (record.status === "pending" || record.status === "confirmed") &&
    record.verificationLevel < 4
  );
}

type TagRow = { tag: string; source: string };

/** Fetch tags + votes for a set of record ids, grouped by record id. */
async function fetchExtras(companyId: number, recordIds: number[]) {
  if (recordIds.length === 0) {
    return {
      tagsByRecord: new Map<number, TagRow[]>(),
      votesByRecord: new Map<number, IntelligenceVote[]>(),
    };
  }
  const [tagRows, voteRows] = await Promise.all([
    db
      .select()
      .from(intelligenceTagsTable)
      .where(
        and(
          eq(intelligenceTagsTable.companyId, companyId),
          inArray(intelligenceTagsTable.recordId, recordIds),
        ),
      ),
    db
      .select()
      .from(intelligenceVotesTable)
      .where(
        and(
          eq(intelligenceVotesTable.companyId, companyId),
          inArray(intelligenceVotesTable.recordId, recordIds),
        ),
      ),
  ]);

  const tagsByRecord = new Map<number, TagRow[]>();
  for (const t of tagRows) {
    const list = tagsByRecord.get(t.recordId) ?? [];
    list.push({ tag: t.tag, source: t.source });
    tagsByRecord.set(t.recordId, list);
  }
  const votesByRecord = new Map<number, IntelligenceVote[]>();
  for (const v of voteRows) {
    const list = votesByRecord.get(v.recordId) ?? [];
    list.push(v);
    votesByRecord.set(v.recordId, list);
  }
  return { tagsByRecord, votesByRecord };
}

function toRecordDTO(
  r: IntelligenceRecord,
  tags: TagRow[],
  votes: IntelligenceVote[],
  myUserId: number,
) {
  const confirmVotes = votes.filter((v) => v.vote === "confirm").length;
  const disputeVotes = votes.filter((v) => v.vote === "dispute").length;
  const mine = votes.find((v) => v.userId === myUserId);
  return {
    id: r.id,
    imageUrl: r.imageUrl,
    thumbnailUrl: r.thumbnailUrl,
    // Contract guarantees aiPrediction is always present; a row missing it (only
    // possible if AI + fallback both failed at insert) degrades to fallback.
    aiPrediction: r.aiPrediction ?? fallbackPrediction(),
    aiConfidence: r.aiConfidence,
    category: r.category,
    subcategory: r.subcategory,
    possiblePest: r.possiblePest,
    possibleConduciveCondition: r.possibleConduciveCondition,
    possibleEntryPoint: r.possibleEntryPoint,
    correctiveAction: r.correctiveAction,
    severity: r.severity,
    whatIsShown: r.whatIsShown,
    whyItMatters: r.whyItMatters,
    notes: r.notes,
    treatmentOutcome: r.treatmentOutcome,
    daysUntilFollowup: r.daysUntilFollowup,
    verificationLevel: r.verificationLevel,
    status: r.status,
    approvedForTraining: r.approvedForTraining,
    aiCorrected: r.aiCorrected,
    createdBy: r.createdBy,
    confirmedBy: r.confirmedBy,
    reviewedBy: r.reviewedBy,
    tags,
    confirmVotes,
    disputeVotes,
    myVote: mine?.vote ?? null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    confirmedAt: r.confirmedAt ? r.confirmedAt.toISOString() : null,
    reviewedAt: r.reviewedAt ? r.reviewedAt.toISOString() : null,
  };
}

/** Build a single-record DTO by loading its extras. */
async function loadRecordDTO(
  companyId: number,
  record: IntelligenceRecord,
  myUserId: number,
) {
  const { tagsByRecord, votesByRecord } = await fetchExtras(companyId, [
    record.id,
  ]);
  return toRecordDTO(
    record,
    tagsByRecord.get(record.id) ?? [],
    votesByRecord.get(record.id) ?? [],
    myUserId,
  );
}

/**
 * Recompute the verification level from current votes. A technician-confirmed
 * record (L2) climbs to L3 once two or more distinct technicians have cast a
 * confirm vote (multi-technician agreement). Manager-set levels (4/5) and
 * terminal states (rejected/skipped/pending) are left untouched.
 */
async function recomputeVerification(
  companyId: number,
  recordId: number,
): Promise<IntelligenceRecord> {
  const [rec] = await db
    .select()
    .from(intelligenceRecordsTable)
    .where(
      and(
        eq(intelligenceRecordsTable.companyId, companyId),
        eq(intelligenceRecordsTable.id, recordId),
      ),
    );
  if (!rec) throw new Error("record not found during recompute");
  if (rec.status !== "confirmed") return rec;

  const votes = await db
    .select()
    .from(intelligenceVotesTable)
    .where(
      and(
        eq(intelligenceVotesTable.companyId, companyId),
        eq(intelligenceVotesTable.recordId, recordId),
      ),
    );
  const confirms = votes.filter((v) => v.vote === "confirm").length;
  const level = confirms >= 2 ? 3 : 2;
  if (level === rec.verificationLevel) return rec;

  const [updated] = await db
    .update(intelligenceRecordsTable)
    .set({ verificationLevel: level, updatedAt: new Date() })
    .where(
      and(
        eq(intelligenceRecordsTable.companyId, companyId),
        eq(intelligenceRecordsTable.id, recordId),
      ),
    )
    .returning();
  return updated;
}

async function upsertVote(
  companyId: number,
  recordId: number,
  userId: number,
  vote: "confirm" | "dispute",
) {
  await db
    .insert(intelligenceVotesTable)
    .values({ companyId, recordId, userId, vote })
    .onConflictDoUpdate({
      target: [intelligenceVotesTable.recordId, intelligenceVotesTable.userId],
      set: { vote },
    });
}

// ── GET /categories ──────────────────────────────────────────────────────────
// GET /intelligence-dataset/corrections/export — manager+ only.
// Returns every intelligence_record that originated from a technician finding
// correction, formatted as a training dataset for custom vision model fine-tuning.
// Supports ?format=ndjson (newline-delimited JSON) or default JSON envelope.
// Each record includes the immutable aiPrediction snapshot, the technician's
// ground-truth label, and the image URL so the data is immediately consumable
// by standard ML tooling (Label Studio, Roboflow, HuggingFace datasets, etc.).
router.get("/corrections/export", requireRole("manager"), async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const { format } = req.query;

    const rows = await db
      .select()
      .from(intelligenceRecordsTable)
      .where(eq(intelligenceRecordsTable.companyId, companyId))
      .orderBy(desc(intelligenceRecordsTable.createdAt));

    const records = rows.map((r) => ({
      id: r.id,
      imageUrl: r.imageUrl,
      // Original AI prediction snapshot (populated from finding correction flow).
      aiPrediction: r.aiPrediction ?? null,
      aiConfidence: r.aiConfidence ?? null,
      // Technician-verified ground-truth labels.
      groundTruth: {
        category: r.category ?? null,
        possiblePest: r.possiblePest ?? null,
        possibleConduciveCondition: r.possibleConduciveCondition ?? null,
        possibleEntryPoint: r.possibleEntryPoint ?? null,
        correctiveAction: r.correctiveAction ?? null,
      },
      // Was the AI prediction overridden by the technician? True = correction signal.
      aiCorrected: r.aiCorrected ?? false,
      verificationLevel: r.verificationLevel,
      status: r.status,
      approvedForTraining: r.approvedForTraining,
      createdAt: r.createdAt.toISOString(),
    }));

    const ts = Date.now();
    if (format === "ndjson") {
      res.setHeader("Content-Type", "application/x-ndjson");
      res.setHeader("Content-Disposition", `attachment; filename="readyloq-corrections-${ts}.ndjson"`);
      return res.send(records.map((r) => JSON.stringify(r)).join("\n"));
    }

    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename="readyloq-corrections-${ts}.json"`);
    return res.json({
      exportedAt: new Date().toISOString(),
      count: records.length,
      records,
    });
  } catch {
    return res.status(500).json({ error: "Failed to export corrections" });
  }
});

router.get("/categories", async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const rows = await db
      .select()
      .from(intelligenceRecordsTable)
      .where(eq(intelligenceRecordsTable.companyId, companyId));

    const catCount: Record<string, number> = {};
    const subCount: Record<string, number> = {};
    for (const r of rows) {
      if (r.category) catCount[r.category] = (catCount[r.category] ?? 0) + 1;
      if (r.subcategory)
        subCount[r.subcategory] = (subCount[r.subcategory] ?? 0) + 1;
    }

    const out = INTELLIGENCE_TAXONOMY.map((g) => ({
      slug: g.slug,
      label: g.label,
      description: g.description,
      count: catCount[g.slug] ?? 0,
      subcategories: g.subcategories.map((s) => ({
        slug: s.slug,
        label: s.label,
        count: subCount[s.slug] ?? 0,
      })),
    }));
    return res.json(out);
  } catch (err) {
    req.log.error({ err }, "Failed to list intelligence categories");
    return res.status(500).json({ error: "Failed to list categories" });
  }
});

// ── GET /settings ────────────────────────────────────────────────────────────
router.get("/settings", async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const [company] = await db
      .select()
      .from(companiesTable)
      .where(eq(companiesTable.id, companyId));
    return res.json({
      sharingEnabled: company?.intelligenceSharingEnabled ?? false,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to get intelligence settings");
    return res.status(500).json({ error: "Failed to get settings" });
  }
});

// ── PATCH /settings (manager+) ───────────────────────────────────────────────
router.patch("/settings", requireRole("manager"), async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const parsed = UpdateIntelligenceSettingsBody.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request body" });
    }
    await db
      .update(companiesTable)
      .set({ intelligenceSharingEnabled: parsed.data.sharingEnabled })
      .where(eq(companiesTable.id, companyId));
    return res.json({ sharingEnabled: parsed.data.sharingEnabled });
  } catch (err) {
    req.log.error({ err }, "Failed to update intelligence settings");
    return res.status(500).json({ error: "Failed to update settings" });
  }
});

// ── GET /analytics ───────────────────────────────────────────────────────────
router.get("/analytics", async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const [rows, [company]] = await Promise.all([
      db
        .select()
        .from(intelligenceRecordsTable)
        .where(eq(intelligenceRecordsTable.companyId, companyId)),
      db
        .select()
        .from(companiesTable)
        .where(eq(companiesTable.id, companyId)),
    ]);

    const totalRecords = rows.length;
    const approved = rows.filter((r) => r.status === "approved");
    const approvedRecords = approved.length;
    const approvedForTraining = rows.filter((r) => r.approvedForTraining).length;
    const pendingReview = rows.filter((r) => r.status === "confirmed").length;

    // Technician acted on the AI suggestion ⇒ aiCorrected is non-null.
    const acted = rows.filter((r) => r.aiCorrected !== null);
    const agreed = acted.filter((r) => r.aiCorrected === false).length;
    const corrected = acted.filter((r) => r.aiCorrected === true).length;

    // AI accuracy measured against the manager-approved ground truth.
    const aiCorrectOnApproved = approved.filter(
      (r) => r.aiPrediction?.category && r.aiPrediction.category === r.category,
    ).length;

    const reviewed = rows.filter(
      (r) => r.status === "approved" || r.status === "rejected",
    );

    const countBy = (
      list: IntelligenceRecord[],
    ): { slug: string; label: string; count: number }[] => {
      const counts: Record<string, number> = {};
      for (const r of list) {
        if (r.category) counts[r.category] = (counts[r.category] ?? 0) + 1;
      }
      return Object.entries(counts)
        .map(([slug, count]) => ({
          slug,
          label: TAXONOMY_LABEL[slug] ?? slug,
          count,
        }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 6);
    };

    const byVerificationLevel = [1, 2, 3, 4, 5].map((level) => ({
      level,
      count: rows.filter((r) => r.verificationLevel === level).length,
    }));

    // Cumulative dataset growth by calendar day (total + approved-so-far).
    const dayCreated: Record<string, number> = {};
    const dayApproved: Record<string, number> = {};
    for (const r of rows) {
      const day = r.createdAt.toISOString().slice(0, 10);
      dayCreated[day] = (dayCreated[day] ?? 0) + 1;
      if (r.status === "approved")
        dayApproved[day] = (dayApproved[day] ?? 0) + 1;
    }
    const days = Object.keys(dayCreated).sort();
    let runningTotal = 0;
    let runningApproved = 0;
    const datasetGrowth = days.map((date) => {
      runningTotal += dayCreated[date];
      runningApproved += dayApproved[date] ?? 0;
      return { date, total: runningTotal, approved: runningApproved };
    });

    const contribMap = new Map<
      number,
      { userId: number; contributions: number; approved: number }
    >();
    for (const r of rows) {
      const entry = contribMap.get(r.createdBy) ?? {
        userId: r.createdBy,
        contributions: 0,
        approved: 0,
      };
      entry.contributions += 1;
      if (r.status === "approved") entry.approved += 1;
      contribMap.set(r.createdBy, entry);
    }
    const topContributors = Array.from(contribMap.values())
      .sort((a, b) => b.contributions - a.contributions)
      .slice(0, 6);

    return res.json({
      totalRecords,
      approvedRecords,
      approvedForTraining,
      pendingReview,
      aiAccuracyRate: pct(aiCorrectOnApproved, approvedRecords),
      aiVsTechnicianAgreementRate: pct(agreed, acted.length),
      technicianCorrectionRate: pct(corrected, acted.length),
      managerApprovalRate: pct(approvedRecords, reviewed.length),
      sharingEnabled: company?.intelligenceSharingEnabled ?? false,
      mostSubmittedCategories: countBy(rows.filter((r) => r.category)),
      mostVerifiedCategories: countBy(approved),
      byVerificationLevel,
      datasetGrowth,
      topContributors,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to compute intelligence analytics");
    return res.status(500).json({ error: "Failed to compute analytics" });
  }
});

// ── GET /records ─────────────────────────────────────────────────────────────
router.get("/records", async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const myUserId = req.user!.id;
    const parsed = ListIntelligenceRecordsQueryParams.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid query parameters" });
    }
    const { category, subcategory, status, verificationLevel, mine, search } =
      parsed.data;
    const page = parsed.data.page ?? 1;
    const limit = parsed.data.limit ?? 20;

    let rows = await db
      .select()
      .from(intelligenceRecordsTable)
      .where(eq(intelligenceRecordsTable.companyId, companyId))
      .orderBy(desc(intelligenceRecordsTable.createdAt));

    if (category) rows = rows.filter((r) => r.category === category);
    if (subcategory) rows = rows.filter((r) => r.subcategory === subcategory);
    if (status) rows = rows.filter((r) => r.status === status);
    if (verificationLevel != null)
      rows = rows.filter((r) => r.verificationLevel === verificationLevel);
    if (mine) rows = rows.filter((r) => r.createdBy === myUserId);
    if (search) {
      const s = search.toLowerCase();
      rows = rows.filter((r) => {
        const haystack = [
          r.category,
          r.subcategory,
          r.possiblePest,
          r.whatIsShown,
          r.notes,
          ...(r.aiPrediction?.tags ?? []),
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return haystack.includes(s);
      });
    }

    const total = rows.length;
    const pageRows = rows.slice((page - 1) * limit, (page - 1) * limit + limit);
    const { tagsByRecord, votesByRecord } = await fetchExtras(
      companyId,
      pageRows.map((r) => r.id),
    );
    const items = pageRows.map((r) =>
      toRecordDTO(
        r,
        tagsByRecord.get(r.id) ?? [],
        votesByRecord.get(r.id) ?? [],
        myUserId,
      ),
    );
    return res.json({ items, total, page, limit });
  } catch (err) {
    req.log.error({ err }, "Failed to list intelligence records");
    return res.status(500).json({ error: "Failed to list records" });
  }
});

// ── POST /records (runs the real AI suggestion) ──────────────────────────────
router.post("/records", async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const myUserId = req.user!.id;
    const parsed = CreateIntelligenceRecordBody.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request body" });
    }
    const { imageUrl, thumbnailUrl } = parsed.data;
    const storagePath = toStoragePath(imageUrl);

    // Tenant safety: the uploaded object must live under the caller's company.
    if (objectPathCompanyScope(storagePath) !== companyId) {
      return res
        .status(400)
        .json({ error: "Image does not belong to your company" });
    }

    const prediction = await generateAiPrediction(storagePath);

    const [record] = await db
      .insert(intelligenceRecordsTable)
      .values({
        companyId,
        imageUrl,
        thumbnailUrl: thumbnailUrl ?? null,
        aiPrediction: prediction,
        aiConfidence: prediction.confidence,
        status: "pending",
        verificationLevel: 1,
        createdBy: myUserId,
      })
      .returning();

    if (prediction.tags.length > 0) {
      await db.insert(intelligenceTagsTable).values(
        prediction.tags.map((tag) => ({
          companyId,
          recordId: record.id,
          tag,
          source: "ai" as const,
        })),
      );
    }

    const dto = await loadRecordDTO(companyId, record, myUserId);
    return res.status(201).json(dto);
  } catch (err) {
    req.log.error({ err }, "Failed to create intelligence record");
    return res.status(500).json({ error: "Failed to create record" });
  }
});

// ── GET /records/:id ─────────────────────────────────────────────────────────
router.get("/records/:id", async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const myUserId = req.user!.id;
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      return res.status(404).json({ error: "Record not found" });
    }
    const [record] = await db
      .select()
      .from(intelligenceRecordsTable)
      .where(
        and(
          eq(intelligenceRecordsTable.companyId, companyId),
          eq(intelligenceRecordsTable.id, id),
        ),
      );
    if (!record) return res.status(404).json({ error: "Record not found" });
    return res.json(await loadRecordDTO(companyId, record, myUserId));
  } catch (err) {
    req.log.error({ err }, "Failed to get intelligence record");
    return res.status(500).json({ error: "Failed to get record" });
  }
});

// ── PATCH /records/:id (technician confirm/correct) ──────────────────────────
router.patch("/records/:id", async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const myUserId = req.user!.id;
    const id = Number(req.params.id);
    const parsed = ConfirmIntelligenceRecordBody.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request body" });
    }
    const [record] = await db
      .select()
      .from(intelligenceRecordsTable)
      .where(
        and(
          eq(intelligenceRecordsTable.companyId, companyId),
          eq(intelligenceRecordsTable.id, id),
        ),
      );
    if (!record) return res.status(404).json({ error: "Record not found" });

    if (!isTechnicianEditable(record)) {
      return res.status(409).json({
        error: "Record has already been reviewed and can no longer be modified",
      });
    }

    const data = parsed.data;
    const aiCat = record.aiPrediction?.category ?? null;
    const aiSub = record.aiPrediction?.subcategory ?? null;
    const aiCorrected =
      data.category !== aiCat || (data.subcategory ?? null) !== aiSub;

    const [updated] = await db
      .update(intelligenceRecordsTable)
      .set({
        category: data.category,
        subcategory: data.subcategory ?? null,
        possiblePest: data.possiblePest ?? null,
        possibleConduciveCondition: data.possibleConduciveCondition ?? null,
        possibleEntryPoint: data.possibleEntryPoint ?? null,
        correctiveAction: data.correctiveAction ?? null,
        severity: (data.severity ?? null) as IntelligenceSeverity | null,
        whatIsShown: data.whatIsShown ?? null,
        whyItMatters: data.whyItMatters ?? null,
        notes: data.notes ?? null,
        treatmentOutcome: (data.treatmentOutcome ??
          null) as TreatmentOutcome | null,
        daysUntilFollowup: data.daysUntilFollowup ?? null,
        aiCorrected,
        status: "confirmed",
        verificationLevel: 2,
        confirmedBy: myUserId,
        confirmedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(intelligenceRecordsTable.companyId, companyId),
          eq(intelligenceRecordsTable.id, id),
        ),
      )
      .returning();

    // Replace technician-sourced tags (AI tags are preserved as training signal).
    await db
      .delete(intelligenceTagsTable)
      .where(
        and(
          eq(intelligenceTagsTable.companyId, companyId),
          eq(intelligenceTagsTable.recordId, id),
          eq(intelligenceTagsTable.source, "technician"),
        ),
      );
    if (data.tags && data.tags.length > 0) {
      await db.insert(intelligenceTagsTable).values(
        data.tags.map((tag) => ({
          companyId,
          recordId: id,
          tag,
          source: "technician" as const,
        })),
      );
    }

    // The confirming technician implicitly casts a confirm vote.
    await upsertVote(companyId, id, myUserId, "confirm");
    const finalRecord = await recomputeVerification(companyId, id);

    return res.json(
      await loadRecordDTO(companyId, finalRecord ?? updated, myUserId),
    );
  } catch (err) {
    req.log.error({ err }, "Failed to confirm intelligence record");
    return res.status(500).json({ error: "Failed to confirm record" });
  }
});

// ── POST /records/:id/skip ───────────────────────────────────────────────────
router.post("/records/:id/skip", async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const myUserId = req.user!.id;
    const id = Number(req.params.id);
    const [record] = await db
      .select()
      .from(intelligenceRecordsTable)
      .where(
        and(
          eq(intelligenceRecordsTable.companyId, companyId),
          eq(intelligenceRecordsTable.id, id),
        ),
      );
    if (!record) return res.status(404).json({ error: "Record not found" });

    if (!isTechnicianEditable(record)) {
      return res.status(409).json({
        error: "Record has already been reviewed and can no longer be modified",
      });
    }

    const [updated] = await db
      .update(intelligenceRecordsTable)
      .set({ status: "skipped", updatedAt: new Date() })
      .where(
        and(
          eq(intelligenceRecordsTable.companyId, companyId),
          eq(intelligenceRecordsTable.id, id),
        ),
      )
      .returning();
    return res.json(await loadRecordDTO(companyId, updated, myUserId));
  } catch (err) {
    req.log.error({ err }, "Failed to skip intelligence record");
    return res.status(500).json({ error: "Failed to skip record" });
  }
});

// ── POST /records/:id/vote ───────────────────────────────────────────────────
router.post("/records/:id/vote", async (req, res) => {
  try {
    const companyId = getCompanyId(req);
    const myUserId = req.user!.id;
    const id = Number(req.params.id);
    const parsed = VoteIntelligenceRecordBody.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid request body" });
    }
    const [record] = await db
      .select()
      .from(intelligenceRecordsTable)
      .where(
        and(
          eq(intelligenceRecordsTable.companyId, companyId),
          eq(intelligenceRecordsTable.id, id),
        ),
      );
    if (!record) return res.status(404).json({ error: "Record not found" });

    await upsertVote(companyId, id, myUserId, parsed.data.vote);
    const finalRecord = await recomputeVerification(companyId, id);
    return res.json(await loadRecordDTO(companyId, finalRecord, myUserId));
  } catch (err) {
    req.log.error({ err }, "Failed to vote on intelligence record");
    return res.status(500).json({ error: "Failed to vote" });
  }
});

// ── POST /records/:id/review (manager+) ──────────────────────────────────────
router.post(
  "/records/:id/review",
  requireRole("manager"),
  async (req, res) => {
    try {
      const companyId = getCompanyId(req);
      const myUserId = req.user!.id;
      const id = Number(req.params.id);
      const parsed = ReviewIntelligenceRecordBody.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ error: "Invalid request body" });
      }
      const [record] = await db
        .select()
        .from(intelligenceRecordsTable)
        .where(
          and(
            eq(intelligenceRecordsTable.companyId, companyId),
            eq(intelligenceRecordsTable.id, id),
          ),
        );
      if (!record) return res.status(404).json({ error: "Record not found" });

      const data = parsed.data;

      // Optional label corrections a manager may apply on any review action.
      const labelUpdates: Partial<typeof intelligenceRecordsTable.$inferInsert> =
        {};
      if (data.category !== undefined) labelUpdates.category = data.category;
      if (data.subcategory !== undefined)
        labelUpdates.subcategory = data.subcategory;
      if (data.possiblePest !== undefined)
        labelUpdates.possiblePest = data.possiblePest;
      if (data.possibleConduciveCondition !== undefined)
        labelUpdates.possibleConduciveCondition = data.possibleConduciveCondition;
      if (data.possibleEntryPoint !== undefined)
        labelUpdates.possibleEntryPoint = data.possibleEntryPoint;
      if (data.correctiveAction !== undefined)
        labelUpdates.correctiveAction = data.correctiveAction;
      if (data.severity !== undefined) labelUpdates.severity = data.severity;
      if (data.whatIsShown !== undefined)
        labelUpdates.whatIsShown = data.whatIsShown;
      if (data.whyItMatters !== undefined)
        labelUpdates.whyItMatters = data.whyItMatters;
      if (data.notes !== undefined) labelUpdates.notes = data.notes;
      if (data.treatmentOutcome !== undefined)
        labelUpdates.treatmentOutcome = data.treatmentOutcome;
      if (data.daysUntilFollowup !== undefined)
        labelUpdates.daysUntilFollowup = data.daysUntilFollowup;

      const updates: Partial<typeof intelligenceRecordsTable.$inferInsert> = {
        ...labelUpdates,
        reviewedBy: myUserId,
        reviewedAt: new Date(),
        updatedAt: new Date(),
      };

      switch (data.action) {
        case "approve":
          updates.status = "approved";
          updates.verificationLevel = 4;
          updates.approvedForTraining = true;
          break;
        case "expert_verify":
          updates.status = "approved";
          updates.verificationLevel = 5;
          updates.approvedForTraining = true;
          break;
        case "reject":
          updates.status = "rejected";
          updates.approvedForTraining = false;
          break;
        case "edit":
          // Labels updated; workflow status left unchanged.
          break;
      }

      // Keep aiCorrected truthful if the manager changed the final category.
      const finalCategory = labelUpdates.category ?? record.category;
      if (finalCategory != null) {
        updates.aiCorrected =
          (record.aiPrediction?.category ?? null) !== finalCategory;
      }

      const [updated] = await db
        .update(intelligenceRecordsTable)
        .set(updates)
        .where(
          and(
            eq(intelligenceRecordsTable.companyId, companyId),
            eq(intelligenceRecordsTable.id, id),
          ),
        )
        .returning();

      await db.insert(intelligenceReviewsTable).values({
        companyId,
        recordId: id,
        reviewerId: myUserId,
        action: data.action,
        comment: data.comment ?? null,
      });

      return res.json(await loadRecordDTO(companyId, updated, myUserId));
    } catch (err) {
      req.log.error({ err }, "Failed to review intelligence record");
      return res.status(500).json({ error: "Failed to review record" });
    }
  },
);

export default router;
