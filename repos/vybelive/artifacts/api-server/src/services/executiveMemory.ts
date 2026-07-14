// ─── Executive Memory (Mission Control V9) ────────────────────────────────────
// Each executive accumulates durable, personal professional memory — projects
// they led, mistakes to avoid, wins to repeat, frequent collaborators, founder
// corrections, preferred workflows, and risk areas they watch. Memory is mined
// deterministically from the organization timeline so it stays connected to real
// work, and it is cited by the recommendations executives propose.
//
// Accumulation is idempotent: a near-duplicate observation bumps the existing
// memory's weight (so the strongest, most-repeated lessons surface first) rather
// than creating a second row.

import {
  db,
  executiveMemoryTable,
  type ExecutiveMemoryRow,
  type OrganizationEventRow,
} from "@workspace/db";
import { and, arrayOverlaps, desc, eq, sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { logger } from "../lib/logger.js";
import { getRecentEventsByType, type OrgEventType } from "./organizationMemory.js";

export type ExecutiveMemoryKind = ExecutiveMemoryRow["kind"];

export type AccumulateMemoryInput = {
  executiveId: string;
  kind: ExecutiveMemoryKind;
  content: string;
  keywords?: string[];
  refType?: string | null;
  refId?: string | null;
};

const norm = (s: string) => s.trim().toLowerCase();

// Insert a memory or, if a same-kind near-duplicate already exists for this
// executive, bump its weight and merge keywords. Returns the row id (or null on
// best-effort failure).
export async function accumulateMemory(
  input: AccumulateMemoryInput,
): Promise<string | null> {
  try {
    const existing = await db
      .select()
      .from(executiveMemoryTable)
      .where(
        and(
          eq(executiveMemoryTable.executiveId, input.executiveId),
          eq(executiveMemoryTable.kind, input.kind),
        ),
      );
    const dup = existing.find((e) => norm(e.content) === norm(input.content));
    if (dup) {
      const mergedKeywords = [...new Set([...dup.keywords, ...(input.keywords ?? [])])];
      await db
        .update(executiveMemoryTable)
        .set({ weight: dup.weight + 1, keywords: mergedKeywords, updatedAt: new Date() })
        .where(eq(executiveMemoryTable.id, dup.id));
      return dup.id;
    }

    const id = randomUUID();
    await db.insert(executiveMemoryTable).values({
      id,
      executiveId: input.executiveId,
      kind: input.kind,
      content: input.content,
      keywords: input.keywords ?? [],
      refType: input.refType ?? null,
      refId: input.refId ?? null,
    });
    return id;
  } catch (err) {
    logger.warn({ err, kind: input.kind }, "executiveMemory: accumulate failed");
    return null;
  }
}

export async function getMemoryForExec(
  executiveId: string,
  limit = 50,
): Promise<ExecutiveMemoryRow[]> {
  return db
    .select()
    .from(executiveMemoryTable)
    .where(eq(executiveMemoryTable.executiveId, executiveId))
    .orderBy(desc(executiveMemoryTable.weight), desc(executiveMemoryTable.updatedAt))
    .limit(limit);
}

// Find an executive's memories relevant to a set of keywords — used so a
// recommendation can cite the experience behind it.
export async function citeMemoryForKeywords(
  executiveId: string,
  keywords: string[],
  limit = 3,
): Promise<ExecutiveMemoryRow[]> {
  if (keywords.length === 0) return [];
  return db
    .select()
    .from(executiveMemoryTable)
    .where(
      and(
        eq(executiveMemoryTable.executiveId, executiveId),
        arrayOverlaps(executiveMemoryTable.keywords, keywords),
      ),
    )
    .orderBy(desc(executiveMemoryTable.weight), desc(executiveMemoryTable.updatedAt))
    .limit(limit);
}

export async function getExecutiveMemoryCount(): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(executiveMemoryTable);
  return row?.total ?? 0;
}

// Map an organization event type to the kind of personal memory it produces for
// the executive who acted. Org-level event types (briefing/portfolio/etc.)
// produce no personal memory and are skipped.
function memoryKindForEvent(ev: OrganizationEventRow): ExecutiveMemoryKind | null {
  const outcome = (ev.metadata as Record<string, unknown>)?.outcome;
  switch (ev.type) {
    case "objective":
    case "milestone":
      return "project";
    case "conversation":
      return "collaborator";
    case "learning":
      return outcome === "failed" ? "mistake" : "success";
    case "founder_decision":
      return "founder_correction";
    case "approval":
      return "workflow";
    default:
      return null;
  }
}

function memoryContentForEvent(ev: OrganizationEventRow, kind: ExecutiveMemoryKind): string {
  switch (kind) {
    case "project":
      return `Led work on: ${ev.title}`;
    case "collaborator":
      return `Collaborated with the team on: ${ev.title}`;
    case "success":
      return `What worked: ${ev.title}`;
    case "mistake":
      return `Avoid repeating: ${ev.title}`;
    case "founder_correction":
      return `Founder steer: ${ev.title}`;
    case "workflow":
      return `Process note: ${ev.title}`;
    default:
      return ev.title;
  }
}

// Deterministically mine recent timeline events into per-executive memory. Used
// by the dev tool and the autonomy worker so memory grows as the org works.
export async function accumulateFromRecentWork(opts: { perType?: number } = {}): Promise<{
  created: number;
}> {
  const perType = opts.perType ?? 20;
  const types: OrgEventType[] = [
    "objective",
    "milestone",
    "conversation",
    "learning",
    "founder_decision",
    "approval",
  ];

  let created = 0;
  for (const type of types) {
    const events = await getRecentEventsByType(type, perType);
    for (const ev of events) {
      if (!ev.actorExecutiveId) continue;
      const kind = memoryKindForEvent(ev);
      if (!kind) continue;
      const id = await accumulateMemory({
        executiveId: ev.actorExecutiveId,
        kind,
        content: memoryContentForEvent(ev, kind),
        keywords: ev.keywords,
        refType: ev.refType,
        refId: ev.refId,
      });
      if (id) created += 1;
    }
  }
  logger.info({ created }, "executiveMemory: accumulated from recent work");
  return { created };
}
