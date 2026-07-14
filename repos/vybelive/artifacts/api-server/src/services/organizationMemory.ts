// ─── Organization Memory (Mission Control V8) ─────────────────────────────────
// The company's curated memory. Every major moment across Mission Control is
// appended to one ledger (organization_events) so the Organization Timeline,
// organizational-memory lookups ("we attempted this before…"), and the Living
// Dashboard all read from a single source of truth.
//
// recordEvent() is best-effort: a ledger write must never break the primary
// flow that produced the event.

import {
  db,
  organizationEventsTable,
  aiExecutivesTable,
  type OrganizationEventRow,
} from "@workspace/db";
import { and, arrayOverlaps, desc, eq, inArray, isNotNull, ne, sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import { logger } from "../lib/logger.js";

export type OrgEventType = OrganizationEventRow["type"];
export type EventImportance = OrganizationEventRow["importance"];

export type RecordEventInput = {
  type: OrgEventType;
  title: string;
  summary?: string;
  actorExecutiveId?: string | null;
  refType?: string | null;
  refId?: string | null;
  // V9: link this event to the prior event that caused it, forming cause→effect
  // chains the Timeline can render.
  causedByEventId?: string | null;
  importance?: EventImportance;
  keywords?: string[];
  metadata?: Record<string, unknown>;
};

export async function recordEvent(input: RecordEventInput): Promise<string | null> {
  const id = randomUUID();
  try {
    await db.insert(organizationEventsTable).values({
      id,
      type: input.type,
      title: input.title,
      summary: input.summary ?? "",
      actorExecutiveId: input.actorExecutiveId ?? null,
      refType: input.refType ?? null,
      refId: input.refId ?? null,
      causedByEventId: input.causedByEventId ?? null,
      importance: input.importance ?? "normal",
      keywords: input.keywords ?? [],
      metadata: input.metadata ?? {},
    });
    return id;
  } catch (err) {
    logger.warn({ err, type: input.type }, "organizationMemory: recordEvent failed");
    return null;
  }
}

// Find the org event that points at a given source record (e.g. the
// "recommendation proposed" event for a recommendation id). Lets callers link a
// follow-on event back to the event that caused it.
export async function getEventByRef(
  refType: string,
  refId: string,
): Promise<OrganizationEventRow | null> {
  const [row] = await db
    .select()
    .from(organizationEventsTable)
    .where(and(eq(organizationEventsTable.refType, refType), eq(organizationEventsTable.refId, refId)))
    .orderBy(desc(organizationEventsTable.createdAt))
    .limit(1);
  return row ?? null;
}

export type EventLink = { id: string; type: OrgEventType; title: string };

export type TimelineEvent = {
  id: string;
  type: OrgEventType;
  title: string;
  summary: string;
  actorExecutiveId: string | null;
  actorName: string | null;
  refType: string | null;
  refId: string | null;
  causedByEventId: string | null;
  causedBy: EventLink | null;
  leadsTo: EventLink[];
  importance: EventImportance;
  keywords: string[];
  createdAt: Date;
};

type RawTimelineRow = Omit<TimelineEvent, "causedBy" | "leadsTo">;

// Attach causedBy (the cause) and leadsTo (direct effects) to a set of raw rows
// with two batched lookups — no per-row queries.
async function attachLinks(rows: RawTimelineRow[]): Promise<TimelineEvent[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const causeIds = [...new Set(rows.map((r) => r.causedByEventId).filter((v): v is string => !!v))];

  const causeRows = causeIds.length
    ? await db
        .select({
          id: organizationEventsTable.id,
          type: organizationEventsTable.type,
          title: organizationEventsTable.title,
        })
        .from(organizationEventsTable)
        .where(inArray(organizationEventsTable.id, causeIds))
    : [];
  const causeById = new Map(causeRows.map((c) => [c.id, c as EventLink]));

  const leadsRows = await db
    .select({
      id: organizationEventsTable.id,
      type: organizationEventsTable.type,
      title: organizationEventsTable.title,
      causedByEventId: organizationEventsTable.causedByEventId,
    })
    .from(organizationEventsTable)
    .where(inArray(organizationEventsTable.causedByEventId, ids))
    .orderBy(desc(organizationEventsTable.createdAt));
  const leadsByCause = new Map<string, EventLink[]>();
  for (const l of leadsRows) {
    if (!l.causedByEventId) continue;
    const list = leadsByCause.get(l.causedByEventId) ?? [];
    list.push({ id: l.id, type: l.type, title: l.title });
    leadsByCause.set(l.causedByEventId, list);
  }

  return rows.map((r) => ({
    ...r,
    causedBy: r.causedByEventId ? causeById.get(r.causedByEventId) ?? null : null,
    leadsTo: leadsByCause.get(r.id) ?? [],
  }));
}

export async function getTimeline(opts: {
  type?: OrgEventType;
  limit?: number;
}): Promise<{ events: TimelineEvent[]; total: number }> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const where = opts.type ? eq(organizationEventsTable.type, opts.type) : undefined;

  const rows = await db
    .select({
      id: organizationEventsTable.id,
      type: organizationEventsTable.type,
      title: organizationEventsTable.title,
      summary: organizationEventsTable.summary,
      actorExecutiveId: organizationEventsTable.actorExecutiveId,
      actorName: aiExecutivesTable.name,
      refType: organizationEventsTable.refType,
      refId: organizationEventsTable.refId,
      causedByEventId: organizationEventsTable.causedByEventId,
      importance: organizationEventsTable.importance,
      keywords: organizationEventsTable.keywords,
      createdAt: organizationEventsTable.createdAt,
    })
    .from(organizationEventsTable)
    .leftJoin(aiExecutivesTable, eq(organizationEventsTable.actorExecutiveId, aiExecutivesTable.id))
    .where(where)
    .orderBy(desc(organizationEventsTable.createdAt))
    .limit(limit);

  const [{ total }] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(organizationEventsTable)
    .where(where);

  const events = await attachLinks(rows);
  return { events, total: total ?? rows.length };
}

// Walk the full cause→effect chain an event belongs to: climb to the root via
// causedByEventId, then breadth-first collect every descendant. Returned in
// chronological (root → leaves) order.
export async function getEventChain(eventId: string): Promise<TimelineEvent[]> {
  const [seed] = await db
    .select()
    .from(organizationEventsTable)
    .where(eq(organizationEventsTable.id, eventId))
    .limit(1);
  if (!seed) return [];

  // Climb to root.
  let root = seed;
  const guardUp = new Set<string>([root.id]);
  while (root.causedByEventId) {
    const [parent] = await db
      .select()
      .from(organizationEventsTable)
      .where(eq(organizationEventsTable.id, root.causedByEventId))
      .limit(1);
    if (!parent || guardUp.has(parent.id)) break;
    guardUp.add(parent.id);
    root = parent;
  }

  // BFS down from root.
  const collected = new Map<string, OrganizationEventRow>([[root.id, root]]);
  let frontier = [root.id];
  while (frontier.length) {
    const children = await db
      .select()
      .from(organizationEventsTable)
      .where(inArray(organizationEventsTable.causedByEventId, frontier));
    const next: string[] = [];
    for (const c of children) {
      if (collected.has(c.id)) continue;
      collected.set(c.id, c);
      next.push(c.id);
    }
    frontier = next;
  }

  const execs = await db
    .select({ id: aiExecutivesTable.id, name: aiExecutivesTable.name })
    .from(aiExecutivesTable);
  const nameById = new Map(execs.map((e) => [e.id, e.name]));

  const raw: RawTimelineRow[] = [...collected.values()]
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .map((r) => ({
      id: r.id,
      type: r.type,
      title: r.title,
      summary: r.summary,
      actorExecutiveId: r.actorExecutiveId,
      actorName: r.actorExecutiveId ? nameById.get(r.actorExecutiveId) ?? null : null,
      refType: r.refType,
      refId: r.refId,
      causedByEventId: r.causedByEventId,
      importance: r.importance,
      keywords: r.keywords,
      createdAt: r.createdAt,
    }));
  return attachLinks(raw);
}

// Raw recent events of one type (used by pattern detection).
export async function getRecentEventsByType(
  type: OrgEventType,
  limit = 30,
): Promise<OrganizationEventRow[]> {
  return db
    .select()
    .from(organizationEventsTable)
    .where(eq(organizationEventsTable.type, type))
    .orderBy(desc(organizationEventsTable.createdAt))
    .limit(limit);
}

export async function getLinkedEventCount(): Promise<number> {
  const [row] = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(organizationEventsTable)
    .where(isNotNull(organizationEventsTable.causedByEventId));
  return row?.total ?? 0;
}

// Organizational memory: find prior events that share keywords with a new
// proposal so executives can reference past outcomes. Optionally restrict to a
// set of event types (e.g. only past objectives/milestones).
export async function getRelatedPriorEvents(
  keywords: string[],
  opts: { limit?: number; excludeId?: string } = {},
): Promise<OrganizationEventRow[]> {
  if (keywords.length === 0) return [];
  const conditions = [arrayOverlaps(organizationEventsTable.keywords, keywords)];
  if (opts.excludeId) conditions.push(ne(organizationEventsTable.id, opts.excludeId));
  return db
    .select()
    .from(organizationEventsTable)
    .where(and(...conditions))
    .orderBy(desc(organizationEventsTable.createdAt))
    .limit(opts.limit ?? 5);
}

export async function getLivingCounts(): Promise<{
  totalEvents: number;
  lastEventAt: Date | null;
}> {
  const [row] = await db
    .select({
      total: sql<number>`count(*)::int`,
      last: sql<string | null>`max(${organizationEventsTable.createdAt})`,
    })
    .from(organizationEventsTable);
  return {
    totalEvents: row?.total ?? 0,
    lastEventAt: row?.last ? new Date(row.last) : null,
  };
}
