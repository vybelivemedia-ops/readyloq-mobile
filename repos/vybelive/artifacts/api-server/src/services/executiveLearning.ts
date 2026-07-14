// ─── Executive Learning Engine (Mission Control V7) ───────────────────────────
// Every completed objective yields a retrospective. Each executive accumulates a
// permanent knowledge base of lessons (lessons learned, successful/failed
// decisions, collaboration, communication, founder feedback, improvements).
// Quinn's weekly review distills recurring patterns and distributes lessons
// across the team. Learning is permanent unless reset via Developer Tools.
//
// This engine is the other half of V7: the autonomy engine reads lessons to
// inform its decisions, and the learning produced here feeds back into Quinn.

import {
  db,
  agentObjectivesTable,
  agentTasksTable,
  agentReportsTable,
  aiExecutivesTable,
  agentActivityTable,
  executiveLessonsTable,
  objectiveRetrospectivesTable,
  weeklyReviewsTable,
  type ExecutiveLessonRow,
} from "@workspace/db";
import { count, desc, eq, gte } from "drizzle-orm";
import { randomUUID } from "crypto";
import { completeWithFallback } from "./ai/AIProviderFactory.js";
import { logger } from "../lib/logger.js";

type LessonKind = ExecutiveLessonRow["kind"];

// ─── Time helpers ─────────────────────────────────────────────────────────────

// YYYY-MM-DD of the Monday (UTC) of the week containing `date`.
export function startOfWeekUTC(date: Date = new Date()): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay(); // 0 = Sun … 6 = Sat
  const diff = (day + 6) % 7; // days since Monday
  d.setUTCDate(d.getUTCDate() - diff);
  return d.toISOString().slice(0, 10);
}

// ─── Lesson access ────────────────────────────────────────────────────────────

async function recordActivity(
  executiveId: string | null,
  summary: string,
  detail: string | null,
): Promise<void> {
  await db
    .insert(agentActivityTable)
    .values({ id: randomUUID(), type: "message", executiveId, summary, detail })
    .catch(() => {});
}

export async function recordLesson(
  role: string,
  kind: LessonKind,
  content: string,
  source: ExecutiveLessonRow["source"],
  objectiveId: string | null,
): Promise<void> {
  await db
    .insert(executiveLessonsTable)
    .values({
      id: randomUUID(),
      role: role as ExecutiveLessonRow["role"],
      kind,
      content,
      source,
      objectiveId,
    })
    .catch((err: unknown) => logger.warn({ err, role, kind }, "learning: recordLesson failed"));
}

// Recent permanent lessons for a role — the autonomy engine and capability runs
// use this to let executives apply what they have learned.
export async function getLessonsForRole(
  role: string,
  limit = 8,
): Promise<ExecutiveLessonRow[]> {
  return db
    .select()
    .from(executiveLessonsTable)
    .where(eq(executiveLessonsTable.role, role as ExecutiveLessonRow["role"]))
    .orderBy(desc(executiveLessonsTable.weight), desc(executiveLessonsTable.createdAt))
    .limit(limit);
}

// ─── Objective retrospectives ─────────────────────────────────────────────────

type RetroShape = { whatWorked: string; whatFailed: string; whatToDoDifferently: string };

function deterministicRetro(
  objectiveTitle: string,
  outcome: "completed" | "failed",
  reportStatuses: string[],
  criticalFindings: string[],
): RetroShape {
  const hadCritical = reportStatuses.includes("critical") || criticalFindings.length > 0;
  const allHealthy = reportStatuses.length > 0 && reportStatuses.every((s) => s === "healthy");
  return {
    whatWorked:
      outcome === "completed"
        ? allHealthy
          ? `"${objectiveTitle}" completed cleanly with all workstream reports healthy.`
          : `"${objectiveTitle}" reached completion through coordinated executive workstreams.`
        : `Partial progress was made on "${objectiveTitle}" before it was halted.`,
    whatFailed: hadCritical
      ? `Critical issues surfaced during delivery: ${criticalFindings.slice(0, 2).join("; ") || "see critical reports"}.`
      : outcome === "failed"
        ? `"${objectiveTitle}" did not reach a successful outcome.`
        : "No critical failures were recorded.",
    whatToDoDifferently: hadCritical
      ? "Surface critical findings to the founder earlier and gate downstream work until they clear."
      : "Maintain the current coordination pattern; it produced a clean delivery.",
  };
}

async function aiRetro(
  objectiveTitle: string,
  request: string,
  role: string | null,
  context: string,
  fallback: RetroShape,
): Promise<RetroShape> {
  try {
    const response = await completeWithFallback({
      task: "reasoning",
      modelHint: "fast",
      systemPrompt:
        "You are an executive writing a concise, honest retrospective for a completed objective. Return ONLY JSON with keys whatWorked, whatFailed, whatToDoDifferently. One or two sentences each. Be specific and actionable.",
      userContent: `OBJECTIVE: ${objectiveTitle}\nREQUEST: ${request}\nPERSPECTIVE: ${role ?? "whole executive team"}\n\nEVIDENCE:\n${context}\n\nReturn ONLY valid JSON.`,
      maxTokens: 400,
      responseFormat: "json",
      executiveId: "system",
      executiveName: "Quinn Harlow",
      executiveRole: "chief_of_staff",
      objectiveId: undefined,
    });
    if (response.fromFallback || !response.parsed) return fallback;
    const p = response.parsed;
    return {
      whatWorked: typeof p.whatWorked === "string" && p.whatWorked ? p.whatWorked : fallback.whatWorked,
      whatFailed: typeof p.whatFailed === "string" && p.whatFailed ? p.whatFailed : fallback.whatFailed,
      whatToDoDifferently:
        typeof p.whatToDoDifferently === "string" && p.whatToDoDifferently
          ? p.whatToDoDifferently
          : fallback.whatToDoDifferently,
    };
  } catch (err) {
    logger.warn({ err }, "learning: aiRetro failed; using deterministic fallback");
    return fallback;
  }
}

// Generate and persist a retrospective for a finished objective, then mine
// permanent lessons from it. Idempotent — a second call for the same objective
// is a no-op (so the finalize hook can fire more than once safely).
export async function generateObjectiveRetrospective(objectiveId: string): Promise<boolean> {
  const existing = await db
    .select({ id: objectiveRetrospectivesTable.id })
    .from(objectiveRetrospectivesTable)
    .where(eq(objectiveRetrospectivesTable.objectiveId, objectiveId))
    .limit(1);
  if (existing.length > 0) return false; // already retrospected

  const [objective] = await db
    .select()
    .from(agentObjectivesTable)
    .where(eq(agentObjectivesTable.id, objectiveId));
  if (!objective) return false;
  if (objective.status !== "completed" && objective.status !== "failed") return false;
  const outcome = objective.status;

  const tasks = await db
    .select()
    .from(agentTasksTable)
    .where(eq(agentTasksTable.objectiveId, objectiveId));
  const reports = await db
    .select()
    .from(agentReportsTable)
    .where(eq(agentReportsTable.objectiveId, objectiveId));
  const execs = await db.select().from(aiExecutivesTable);
  const roleById = new Map(execs.map((e) => [e.id, e.role]));

  // Roles that participated via child tasks (excluding Quinn herself).
  type Role = ExecutiveLessonRow["role"];
  const participatingRoles: Role[] = [
    ...new Set(
      tasks
        .map((t) => roleById.get(t.executiveId))
        .filter((r): r is Role => Boolean(r) && r !== "chief_of_staff"),
    ),
  ];

  const reportStatuses = reports.map((r) => r.status);
  const criticalFindings = reports
    .flatMap((r) => r.findings)
    .filter((f) => f.severity !== "info")
    .map((f) => f.text);

  const evidence = [
    `Outcome: ${outcome}`,
    `Tasks: ${tasks.length} (${tasks.filter((t) => t.status === "done").length} done, ${tasks.filter((t) => t.status === "blocked").length} blocked)`,
    `Reports: ${reports.map((r) => `${roleById.get(r.executiveId) ?? "?"}=${r.status}`).join(", ") || "none"}`,
    criticalFindings.length ? `Critical findings: ${criticalFindings.slice(0, 4).join("; ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  // 1. Team-level retrospective.
  const teamFallback = deterministicRetro(objective.title, outcome, reportStatuses, criticalFindings);
  const teamRetro = await aiRetro(objective.title, objective.request, null, evidence, teamFallback);
  await db.insert(objectiveRetrospectivesTable).values({
    id: randomUUID(),
    objectiveId,
    role: null,
    whatWorked: teamRetro.whatWorked,
    whatFailed: teamRetro.whatFailed,
    whatToDoDifferently: teamRetro.whatToDoDifferently,
  });

  // 2. Per-role retrospective + permanent lessons for each participating exec.
  for (const role of participatingRoles) {
    const roleReports = reports.filter((r) => roleById.get(r.executiveId) === role);
    const roleStatuses = roleReports.map((r) => r.status);
    const roleCritical = roleReports
      .flatMap((r) => r.findings)
      .filter((f) => f.severity !== "info")
      .map((f) => f.text);
    const roleFallback = deterministicRetro(objective.title, outcome, roleStatuses, roleCritical);
    const roleEvidence = `Your reports: ${roleReports.map((r) => r.status).join(", ") || "none"}\n${roleCritical.length ? `Your critical findings: ${roleCritical.join("; ")}` : "No critical findings."}`;
    const retro = await aiRetro(objective.title, objective.request, role, roleEvidence, roleFallback);

    await db.insert(objectiveRetrospectivesTable).values({
      id: randomUUID(),
      objectiveId,
      role: role as ExecutiveLessonRow["role"],
      whatWorked: retro.whatWorked,
      whatFailed: retro.whatFailed,
      whatToDoDifferently: retro.whatToDoDifferently,
    });

    // Mine permanent lessons from the retrospective.
    await recordLesson(role, "lesson_learned", retro.whatToDoDifferently, "retrospective", objectiveId);
    const decisionKind: LessonKind =
      outcome === "completed" && !roleStatuses.includes("critical")
        ? "successful_decision"
        : "failed_decision";
    await recordLesson(role, decisionKind, retro.whatWorked, "retrospective", objectiveId);
    if (roleCritical.length > 0) {
      await recordLesson(role, "improvement", retro.whatFailed, "retrospective", objectiveId);
    }
  }

  await recordActivity(
    null,
    `Retrospective recorded for "${objective.title}"`,
    `${participatingRoles.length} executive perspective(s); permanent lessons captured.`,
  );
  logger.info(
    { objectiveId, outcome, roles: participatingRoles.length },
    "learning: objective retrospective generated",
  );
  return true;
}

// ─── Weekly learning review ───────────────────────────────────────────────────

type WeeklyDistillation = {
  recurringMistakes: string[];
  recurringSuccesses: string[];
  collaborationImprovements: string[];
  orgRecommendations: string[];
  summary: string;
};

function deterministicWeekly(lessons: ExecutiveLessonRow[]): WeeklyDistillation {
  const mistakes = lessons
    .filter((l) => l.kind === "failed_decision" || l.kind === "improvement")
    .map((l) => l.content);
  const successes = lessons
    .filter((l) => l.kind === "successful_decision")
    .map((l) => l.content);
  const collab = lessons.filter((l) => l.kind === "collaboration").map((l) => l.content);
  const uniq = (arr: string[]) => [...new Set(arr)].slice(0, 5);
  return {
    recurringMistakes: uniq(mistakes),
    recurringSuccesses: uniq(successes),
    collaborationImprovements: uniq(collab),
    orgRecommendations: uniq([
      ...(mistakes.length ? ["Address the most frequent failure pattern before taking on new scope."] : []),
      ...(successes.length ? ["Codify the successful delivery pattern as the default playbook."] : []),
    ]),
    summary: `Reviewed ${lessons.length} lesson(s): ${successes.length} success pattern(s), ${mistakes.length} improvement area(s).`,
  };
}

async function aiWeekly(
  lessons: ExecutiveLessonRow[],
  fallback: WeeklyDistillation,
): Promise<WeeklyDistillation> {
  if (lessons.length === 0) return fallback;
  try {
    const corpus = lessons
      .map((l) => `[${l.role}/${l.kind}] ${l.content}`)
      .slice(0, 60)
      .join("\n");
    const response = await completeWithFallback({
      task: "reasoning",
      modelHint: "standard",
      systemPrompt:
        "You are Quinn, Chief of Staff, running a weekly executive learning review. Distill the team's lessons. Return ONLY JSON with keys: recurringMistakes (string[]), recurringSuccesses (string[]), collaborationImprovements (string[]), orgRecommendations (string[]), summary (string). Keep each array to at most 5 crisp items.",
      userContent: `TEAM LESSONS THIS PERIOD:\n${corpus}\n\nReturn ONLY valid JSON.`,
      maxTokens: 700,
      responseFormat: "json",
      executiveId: "system",
      executiveName: "Quinn Harlow",
      executiveRole: "chief_of_staff",
    });
    if (response.fromFallback || !response.parsed) return fallback;
    const p = response.parsed;
    const arr = (v: unknown): string[] =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 5) : [];
    return {
      recurringMistakes: arr(p.recurringMistakes).length ? arr(p.recurringMistakes) : fallback.recurringMistakes,
      recurringSuccesses: arr(p.recurringSuccesses).length ? arr(p.recurringSuccesses) : fallback.recurringSuccesses,
      collaborationImprovements: arr(p.collaborationImprovements),
      orgRecommendations: arr(p.orgRecommendations).length ? arr(p.orgRecommendations) : fallback.orgRecommendations,
      summary: typeof p.summary === "string" && p.summary ? p.summary : fallback.summary,
    };
  } catch (err) {
    logger.warn({ err }, "learning: aiWeekly failed; using deterministic fallback");
    return fallback;
  }
}

// Quinn's weekly review: distill recurring patterns across the team, distribute
// the most important lessons to every executive, and persist the review.
// Idempotent per ISO week (upsert on weekOf).
export async function runWeeklyLearningReview(): Promise<{
  weekOf: string;
  distilled: WeeklyDistillation;
  distributedCount: number;
  lessonsConsidered: number;
}> {
  const weekOf = startOfWeekUTC();
  // Consider lessons from the trailing 7 days; fall back to all-time if none.
  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  let lessons = await db
    .select()
    .from(executiveLessonsTable)
    .where(gte(executiveLessonsTable.createdAt, since))
    .orderBy(desc(executiveLessonsTable.createdAt));
  if (lessons.length === 0) {
    lessons = await db
      .select()
      .from(executiveLessonsTable)
      .orderBy(desc(executiveLessonsTable.createdAt))
      .limit(60);
  }

  const distilled = await aiWeekly(lessons, deterministicWeekly(lessons));

  // Distribute org-wide recommendations to every executive role as shared
  // ("distributed") lessons so the whole team carries them forward.
  const execs = await db.select().from(aiExecutivesTable);
  const roles = [...new Set(execs.map((e) => e.role).filter((r) => r !== "chief_of_staff"))];
  let distributedCount = 0;
  for (const rec of distilled.orgRecommendations) {
    for (const role of roles) {
      await recordLesson(role, "improvement", rec, "distributed", null);
      distributedCount += 1;
    }
  }

  // Persist the review (one row per ISO week).
  await db
    .insert(weeklyReviewsTable)
    .values({
      id: randomUUID(),
      weekOf,
      recurringMistakes: distilled.recurringMistakes,
      recurringSuccesses: distilled.recurringSuccesses,
      collaborationImprovements: distilled.collaborationImprovements,
      orgRecommendations: distilled.orgRecommendations,
      distributedCount,
      summary: distilled.summary,
    })
    .onConflictDoUpdate({
      target: weeklyReviewsTable.weekOf,
      set: {
        recurringMistakes: distilled.recurringMistakes,
        recurringSuccesses: distilled.recurringSuccesses,
        collaborationImprovements: distilled.collaborationImprovements,
        orgRecommendations: distilled.orgRecommendations,
        distributedCount,
        summary: distilled.summary,
      },
    });

  await recordActivity(
    null,
    `Weekly learning review complete (week of ${weekOf})`,
    `${distilled.recurringSuccesses.length} success pattern(s), ${distilled.recurringMistakes.length} improvement area(s); ${distributedCount} lesson(s) distributed.`,
  );
  logger.info({ weekOf, distributedCount, lessons: lessons.length }, "learning: weekly review complete");
  return { weekOf, distilled, distributedCount, lessonsConsidered: lessons.length };
}

// ─── Reset (Developer Tools) ──────────────────────────────────────────────────

// Permanently wipe ALL executive learning. Learning is otherwise permanent.
export async function resetExecutiveLearning(): Promise<{
  lessons: number;
  retrospectives: number;
  weeklyReviews: number;
}> {
  return db.transaction(async (tx) => {
    const lessons = await tx.delete(executiveLessonsTable).returning({ id: executiveLessonsTable.id });
    const retrospectives = await tx
      .delete(objectiveRetrospectivesTable)
      .returning({ id: objectiveRetrospectivesTable.id });
    const weeklyReviews = await tx.delete(weeklyReviewsTable).returning({ id: weeklyReviewsTable.id });
    return {
      lessons: lessons.length,
      retrospectives: retrospectives.length,
      weeklyReviews: weeklyReviews.length,
    };
  });
}

// ─── Learning overview (for the Learning page + Diagnostics) ───────────────────

export async function getLearningTotals(): Promise<{
  lessons: number;
  retrospectives: number;
  weeklyReviews: number;
  lastReviewWeekOf: string | null;
}> {
  const [lessonCount, retroCount, reviewCount, lastReview] = await Promise.all([
    db.select({ n: count() }).from(executiveLessonsTable),
    db.select({ n: count() }).from(objectiveRetrospectivesTable),
    db.select({ n: count() }).from(weeklyReviewsTable),
    db
      .select({ weekOf: weeklyReviewsTable.weekOf })
      .from(weeklyReviewsTable)
      .orderBy(desc(weeklyReviewsTable.weekOf))
      .limit(1),
  ]);
  return {
    lessons: lessonCount[0]?.n ?? 0,
    retrospectives: retroCount[0]?.n ?? 0,
    weeklyReviews: reviewCount[0]?.n ?? 0,
    lastReviewWeekOf: lastReview[0]?.weekOf ?? null,
  };
}
