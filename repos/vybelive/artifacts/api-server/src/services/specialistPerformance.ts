// ─── Specialist Performance Ranking (Phase 10) ────────────────────────────────
// Aggregates specialistRunsTable data into ranked lists.
// Score = successRate × avgConfidence × recencyWeight.
// Recency: runs ≤7 days old weight 1.0, ≤30 days weight 0.7, older weight 0.5.
// Used by consultSpecialist() to prefer historically reliable specialists.

import { db, specialistRunsTable } from "@workspace/db";
import { desc } from "drizzle-orm";
import { logger } from "../lib/logger.js";

export interface RankedSpecialist {
  specialistId: string;
  successRate: number;
  avgConfidence: number;
  runCount: number;
  score: number;
  lastRunAt: Date;
}

const RECENCY_7D = 7 * 24 * 60 * 60 * 1000;
const RECENCY_30D = 30 * 24 * 60 * 60 * 1000;

function recencyWeight(createdAt: Date): number {
  const age = Date.now() - createdAt.getTime();
  if (age <= RECENCY_7D) return 1.0;
  if (age <= RECENCY_30D) return 0.7;
  return 0.5;
}

export async function getRankedSpecialists(
  taskCategory?: string,
  limit = 10,
): Promise<RankedSpecialist[]> {
  try {
    const rows = await db
      .select()
      .from(specialistRunsTable)
      .orderBy(desc(specialistRunsTable.createdAt))
      .limit(500);

    if (rows.length === 0) return [];

    const bySpecialist = new Map<
      string,
      { successes: number; total: number; confidenceSum: number; weightedScore: number; lastRunAt: Date }
    >();

    for (const row of rows) {
      if (taskCategory) {
        const triggerLower = row.trigger.toLowerCase();
        const catLower = taskCategory.toLowerCase();
        if (!triggerLower.includes(catLower) && !catLower.includes(triggerLower.split(" ")[0] ?? "")) {
          continue;
        }
      }

      const existing = bySpecialist.get(row.specialistId) ?? {
        successes: 0,
        total: 0,
        confidenceSum: 0,
        weightedScore: 0,
        lastRunAt: row.createdAt,
      };

      const rw = recencyWeight(row.createdAt);
      existing.total += 1;
      if (row.success) existing.successes += 1;
      existing.confidenceSum += row.confidence;
      existing.weightedScore += rw * (row.success ? row.confidence : 0);
      if (row.createdAt > existing.lastRunAt) existing.lastRunAt = row.createdAt;
      bySpecialist.set(row.specialistId, existing);
    }

    const ranked: RankedSpecialist[] = [];
    for (const [specialistId, agg] of bySpecialist.entries()) {
      if (agg.total === 0) continue;
      const successRate = agg.successes / agg.total;
      const avgConfidence = agg.confidenceSum / agg.total;
      const score = (agg.weightedScore / agg.total) * successRate;
      ranked.push({ specialistId, successRate, avgConfidence, runCount: agg.total, score, lastRunAt: agg.lastRunAt });
    }

    ranked.sort((a, b) => b.score - a.score);
    return ranked.slice(0, limit);
  } catch (err) {
    logger.warn({ err, taskCategory }, "specialistPerformance: getRankedSpecialists failed");
    return [];
  }
}

export async function getSpecialistScore(specialistId: string): Promise<number> {
  const ranked = await getRankedSpecialists();
  return ranked.find((r) => r.specialistId === specialistId)?.score ?? 50;
}
