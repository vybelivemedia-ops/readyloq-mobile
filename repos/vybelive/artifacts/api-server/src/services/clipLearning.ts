/**
 * clipLearning — derives selection weights from real clip outcomes.
 *
 * Two engines, both computed on-demand from the append-only clipOutcomesTable
 * (no separately-stored profile to drift out of sync):
 *
 *   - Creator weights: built from THIS creator's own behavior — which clips
 *     they approved, published (and how many views), rejected, or deleted.
 *   - Universal weights v1: the same computation across ALL creators'
 *     outcomes, anonymized (aggregate counts only — no per-user identity is
 *     read into the result).
 *
 * Weights are multipliers centered on 1.0 (neutral) and clamped to a sane
 * band so a few outcomes can nudge, but never dominate, the honest signal.
 */

import { db, clipOutcomesTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { randomUUID } from "crypto";

const SMOOTHING = 3;
const SPREAD = 0.5;
const MIN_WEIGHT = 0.5;
const MAX_WEIGHT = 1.5;
// Views that count as roughly one extra "positive" point for a published clip.
const VIEW_NORM = 500;
// Cap on rows scanned for the universal engine (recency-bounded for v1).
const UNIVERSAL_SCAN_LIMIT = 5000;

export interface WeightEntry {
  key: string;
  weight: number;
  sampleCount: number;
}

export interface WeightSet {
  sampleCount: number;
  sources: WeightEntry[];
  formats: WeightEntry[];
  signals: WeightEntry[];
  /** Fast lookup maps (default 1.0 for unseen keys via getWeight). */
  sourceMap: Record<string, number>;
  formatMap: Record<string, number>;
  signalMap: Record<string, number>;
}

interface Tally {
  pos: number;
  neg: number;
  n: number;
}

type OutcomeRow = {
  format: string | null;
  source: string | null;
  signals: string[];
  outcome: string;
  views: number;
};

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function pointsFor(outcome: string, views: number): { pos: number; neg: number } {
  switch (outcome) {
    case "approved":
      return { pos: 1, neg: 0 };
    case "published":
      return { pos: 2 + views / VIEW_NORM, neg: 0 };
    case "rejected":
      return { pos: 0, neg: 1.5 };
    case "deleted":
      return { pos: 0, neg: 1 };
    default:
      // "generated" is a neutral baseline event.
      return { pos: 0, neg: 0 };
  }
}

function weightFromTally(t: Tally): number {
  if (t.n === 0) return 1;
  const score = (t.pos - t.neg) / (t.pos + t.neg + SMOOTHING);
  return clamp(1 + score * SPREAD, MIN_WEIGHT, MAX_WEIGHT);
}

function bump(map: Map<string, Tally>, key: string, pos: number, neg: number): void {
  const t = map.get(key) ?? { pos: 0, neg: 0, n: 0 };
  t.pos += pos;
  t.neg += neg;
  t.n += 1;
  map.set(key, t);
}

function toEntries(map: Map<string, Tally>): { entries: WeightEntry[]; lookup: Record<string, number> } {
  const entries: WeightEntry[] = [];
  const lookup: Record<string, number> = {};
  for (const [key, t] of map) {
    const weight = weightFromTally(t);
    entries.push({ key, weight, sampleCount: t.n });
    lookup[key] = weight;
  }
  entries.sort((a, b) => b.weight - a.weight);
  return { entries, lookup };
}

function buildWeightSet(rows: OutcomeRow[]): WeightSet {
  const sources = new Map<string, Tally>();
  const formats = new Map<string, Tally>();
  const signals = new Map<string, Tally>();

  for (const row of rows) {
    const { pos, neg } = pointsFor(row.outcome, row.views);
    if (row.source) bump(sources, row.source, pos, neg);
    if (row.format) bump(formats, row.format, pos, neg);
    for (const sig of row.signals) bump(signals, sig, pos, neg);
  }

  const s = toEntries(sources);
  const f = toEntries(formats);
  const g = toEntries(signals);

  return {
    sampleCount: rows.length,
    sources: s.entries,
    formats: f.entries,
    signals: g.entries,
    sourceMap: s.lookup,
    formatMap: f.lookup,
    signalMap: g.lookup,
  };
}

/** Look up a weight multiplier; unseen keys are neutral (1.0). */
export function getWeight(map: Record<string, number>, key: string | null | undefined): number {
  if (!key) return 1;
  return map[key] ?? 1;
}

/** Per-creator preference weights, derived from this creator's own outcomes. */
export async function computeCreatorWeights(userId: string): Promise<WeightSet> {
  const rows = await db
    .select({
      format: clipOutcomesTable.format,
      source: clipOutcomesTable.source,
      signals: clipOutcomesTable.signals,
      outcome: clipOutcomesTable.outcome,
      views: clipOutcomesTable.views,
    })
    .from(clipOutcomesTable)
    .where(eq(clipOutcomesTable.userId, userId));
  return buildWeightSet(rows as OutcomeRow[]);
}

/** Anonymized cross-creator weights (aggregate only — no identity retained). */
export async function computeUniversalWeights(): Promise<WeightSet> {
  const rows = await db
    .select({
      format: clipOutcomesTable.format,
      source: clipOutcomesTable.source,
      signals: clipOutcomesTable.signals,
      outcome: clipOutcomesTable.outcome,
      views: clipOutcomesTable.views,
    })
    .from(clipOutcomesTable)
    .orderBy(desc(clipOutcomesTable.createdAt))
    .limit(UNIVERSAL_SCAN_LIMIT);
  return buildWeightSet(rows as OutcomeRow[]);
}

export type ClipOutcomeKind = "generated" | "approved" | "rejected" | "published" | "deleted";

export interface RecordOutcomeInput {
  userId: string;
  clipId: string | null;
  streamId: string | null;
  format: ClipFormat | null;
  source: MarkerSource | null;
  signals: string[];
  confidence: number | null;
  outcome: ClipOutcomeKind;
  views?: number;
}

type ClipFormat = "highlight" | "reel" | "short" | "story";
type MarkerSource = "voice" | "gesture" | "manual" | "ai";

/**
 * Append an outcome event. Best-effort: learning must never break the primary
 * flow, so callers can fire-and-forget and we swallow/log at the call site.
 */
export async function recordOutcome(input: RecordOutcomeInput): Promise<void> {
  await db.insert(clipOutcomesTable).values({
    id: randomUUID(),
    userId: input.userId,
    clipId: input.clipId,
    streamId: input.streamId,
    format: input.format,
    source: input.source,
    signals: input.signals,
    confidence: input.confidence,
    outcome: input.outcome,
    views: input.views ?? 0,
  });
}
