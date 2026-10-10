/**
 * OutboxProcessor
 *
 * Write-ahead outbox pattern for enterprise bridge dispatches.
 *
 * Flow:
 *   1. Idempotency check — bail early if this inspection is already DELIVERED
 *      or has an active QUEUED row (prevents duplicate HTTP calls on retry).
 *   2. Insert a QUEUED outbox row BEFORE the HTTP call so a crash between
 *      insert and response leaves a retryable record in the DB.
 *   3. Dispatch via EnterpriseBridgeProductionService.dispatchToSystem.
 *   4. Update the outbox row with the final DispatchResult outcome, httpStatus,
 *      errorCode, errorMessage, and incremented retryCount.
 *
 * Retry workers should query for rows WHERE status IN ('QUEUED',
 * 'RETRYABLE_FAILURE', 'TIMEOUT') — never retry PERMANENT_FAILURE,
 * UNAUTHORIZED, or INVALID_CONFIGURATION without human intervention.
 */

import { randomUUID } from "crypto";
import { db, enterpriseOutboxTable, companyFieldIntegrationsTable } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import type { HardenedInspectionPayload, DispatchResult } from "../../types/enterprise-payload";
import { RETRYABLE_OUTBOX_STATUSES } from "@workspace/db";
import {
  EnterpriseBridgeProductionService,
  type ResolvedEnterpriseConfig,
} from "./enterprise-bridge-production";
import { logger } from "../../lib/logger";
import { appendProcessingMilestone } from "../../lib/inspection-processing-events";

const MAX_RETRY_COUNT = 8;

interface ClaimedOutboxRow {
  id: string;
  company_id: number;
  inspection_id: number;
  payload_json: HardenedInspectionPayload;
  retry_count: number;
  locked_at: string | Date;
}

const outboxEvents = {
  QUEUED: "sync.queued",
  PROCESSING: "sync.processing",
  DELIVERED: "sync.delivered",
  RETRYABLE_FAILURE: "sync.retryable_failure",
  PERMANENT_FAILURE: "sync.permanent_failure",
  UNAUTHORIZED: "sync.unauthorized",
  INVALID_CONFIGURATION: "sync.invalid_configuration",
  TIMEOUT: "sync.timeout",
} as const;

async function appendOutboxEvent(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  row: typeof enterpriseOutboxTable.$inferSelect,
) {
  const eventType = outboxEvents[row.status as keyof typeof outboxEvents];
  if (!eventType) throw new Error("Unsupported external delivery state");
  await appendProcessingMilestone(tx, {
    companyId: row.companyId, inspectionId: row.inspectionId, eventType,
    sourceType: "enterprise_outbox", sourceId: row.id, actor: "system:enterprise-outbox",
    transitionKey: `${row.retryCount}:${row.status}${row.status === "PROCESSING" ? `:${row.lockedAt?.toISOString()}` : ""}`,
  });
}

async function updateOutboxState(id: string, values: Partial<typeof enterpriseOutboxTable.$inferInsert>) {
  return db.transaction(async (tx) => {
    const [row] = await tx.update(enterpriseOutboxTable).set(values)
      .where(eq(enterpriseOutboxTable.id, id)).returning();
    if (row) await appendOutboxEvent(tx, row);
  });
}

function retryDelayMs(retryCount: number): number {
  return Math.min(15 * 60_000, 1_000 * 2 ** Math.max(0, retryCount - 1));
}

export class OutboxProcessor {
  /**
   * Idempotently queues and dispatches an inspection payload.
   *
   * @param resolvedConfig  Pre-resolved integration config (caller owns DB lookup)
   * @param payload         Fully-populated HardenedInspectionPayload
   * @returns               DispatchResult with full diagnostic fields
   */
  static async queueAndDispatch(
    resolvedConfig: ResolvedEnterpriseConfig,
    payload: HardenedInspectionPayload,
  ): Promise<DispatchResult> {
    // HardenedInspectionPayload.inspectionId is a string; the outbox FK is int.
    const inspectionIdNum = parseInt(payload.inspectionId, 10);
    const companyIdNum = parseInt(payload.companyId, 10);

    if (isNaN(inspectionIdNum) || isNaN(companyIdNum)) {
      return {
        status: "INVALID_CONFIGURATION",
        errorMessage: `Cannot parse inspectionId ('${payload.inspectionId}') or companyId ('${payload.companyId}') as integers.`,
      };
    }
    const idempotencyKey = `inspection:${companyIdNum}:${inspectionIdNum}`;

    // ── 1. Idempotency check ────────────────────────────────────────────────
    //
    // If a DELIVERED row exists for this inspection, return early — never
    // re-dispatch a successfully completed inspection.
    //
    // If a QUEUED row exists (a previous call queued it but hasn't dispatched
    // yet, or a crash left it QUEUED), reuse its ID so we don't create a
    // duplicate row.  The existing row will be updated with the new outcome.
    const existing = await db.query.enterpriseOutboxTable.findFirst({
      where: and(
        eq(enterpriseOutboxTable.inspectionId, inspectionIdNum),
        eq(enterpriseOutboxTable.companyId, companyIdNum),
      ),
      columns: { id: true, status: true, retryCount: true },
    });

    if (existing?.status === "DELIVERED") {
      return { status: "DELIVERED" };
    }
    if (existing?.status === "PROCESSING") {
      return {
        status: "RETRYABLE_FAILURE",
        errorCode: "DISPATCH_IN_PROGRESS",
        errorMessage: "This inspection is already being dispatched.",
      };
    }

    // ── 2. Write-ahead insert (or reuse existing row) ───────────────────────
    let outboxId: string;

    if (existing && (RETRYABLE_OUTBOX_STATUSES as string[]).includes(existing.status)) {
      // Reuse the existing row — update it back to QUEUED for this attempt.
      outboxId = existing.id;
      await updateOutboxState(outboxId, {
        status: "QUEUED", nextAttemptAt: new Date(), lockedAt: null, lockedBy: null,
      });
    } else {
      // New dispatch — insert a write-ahead row before the HTTP call.
      outboxId = randomUUID();
      const inserted = await db.transaction(async (tx) => {
        const rows = await tx
        .insert(enterpriseOutboxTable)
        .values({
          id: outboxId,
          companyId: companyIdNum,
          inspectionId: inspectionIdNum,
          idempotencyKey,
          payloadJson: payload as unknown as Record<string, unknown>,
          status: "QUEUED",
          nextAttemptAt: new Date(),
        })
        .onConflictDoNothing()
        .returning();
        if (rows[0]) await appendOutboxEvent(tx, rows[0]);
        return rows;
      });
      if (!inserted[0]) {
        return {
          status: "RETRYABLE_FAILURE",
          errorCode: "DISPATCH_IN_PROGRESS",
          errorMessage: "A concurrent dispatch already queued this inspection.",
        };
      }
    }

    // ── 3. Dispatch ─────────────────────────────────────────────────────────
    const result = await EnterpriseBridgeProductionService.dispatchToSystem(
      resolvedConfig,
      payload,
    );

    // ── 4. Update outbox row with the final outcome ─────────────────────────
    //
    // Store the full DispatchResult status (never collapse to a generic FAILED)
    // so retry workers can distinguish retryable from non-retryable outcomes.
    const httpStatus =
      "httpStatus" in result ? result.httpStatus : undefined;
    const errorCode =
      "errorCode" in result ? result.errorCode : undefined;
    const errorMessage =
      "errorMessage" in result ? result.errorMessage : undefined;

    await updateOutboxState(outboxId, {
        status: result.status,
        lastHttpStatus: httpStatus ?? null,
        lastErrorCode: errorCode ?? null,
        lastErrorMessage: errorMessage ?? null,
        lastAttemptAt: new Date(),
        retryCount: (existing?.retryCount ?? 0) + 1,
        nextAttemptAt:
          result.status === "RETRYABLE_FAILURE" || result.status === "TIMEOUT"
            ? new Date(Date.now() + retryDelayMs((existing?.retryCount ?? 0) + 1))
            : null,
        lockedAt: null,
        lockedBy: null,
      });

    return result;
  }

  /**
   * Claims and retries write-ahead inspection rows left behind by a process
   * crash or a transient external failure. The claim is DB-atomic and leased,
   * so multiple API processes can safely run this worker.
   */
  static async processPendingRetries(
    options: { limit?: number; workerId?: string } = {},
  ): Promise<{ claimed: number; delivered: number; failed: number }> {
    const workerId = options.workerId ?? `enterprise-outbox-${randomUUID()}`;
    const limit = Math.max(1, Math.min(options.limit ?? 10, 50));
    const claimedRows = await db.transaction(async (tx) => {
      const claimedResult = await tx.execute(sql`
      WITH candidates AS (
        SELECT id
        FROM enterprise_outbox
        WHERE (
          (
            status IN ('QUEUED', 'RETRYABLE_FAILURE', 'TIMEOUT')
            AND (next_attempt_at IS NULL OR next_attempt_at <= NOW())
            AND (locked_at IS NULL OR locked_at < NOW() - INTERVAL '10 minutes')
          )
          OR (
            status = 'PROCESSING'
            AND locked_at < NOW() - INTERVAL '10 minutes'
          )
        )
        ORDER BY created_at ASC, id ASC
        FOR UPDATE SKIP LOCKED
        LIMIT ${limit}
      )
      UPDATE enterprise_outbox AS outbox
      SET status = 'PROCESSING',
          locked_at = NOW(),
          locked_by = ${workerId}
      FROM candidates
      WHERE outbox.id = candidates.id
      RETURNING outbox.id, outbox.company_id, outbox.inspection_id,
                outbox.payload_json, outbox.retry_count, outbox.locked_at::text AS locked_at
    `);
      const rows = claimedResult.rows as unknown as ClaimedOutboxRow[];
      for (const row of rows) {
        // Select text explicitly so this does not depend on the pg/Drizzle
        // timestamp parser. Accept Date as well for other executor adapters.
        // Timestamp-without-time-zone in this column stores UTC.
        const claimedAt = row.locked_at instanceof Date ? row.locked_at
          : new Date(`${row.locked_at.replace(" ", "T")}Z`);
        await appendProcessingMilestone(tx, {
        companyId: row.company_id, inspectionId: row.inspection_id,
        eventType: "sync.processing", sourceType: "enterprise_outbox",
        sourceId: row.id, actor: "system:enterprise-outbox",
        occurredAt: claimedAt,
        transitionKey: `${row.retry_count}:PROCESSING:${claimedAt.toISOString()}`,
        });
      }
      return rows;
    });

    let delivered = 0;
    let failed = 0;
    for (const row of claimedRows) {
      try {
        const [config] = await db
          .select()
          .from(companyFieldIntegrationsTable)
          .where(
            and(
              eq(companyFieldIntegrationsTable.companyId, row.company_id),
              eq(companyFieldIntegrationsTable.enabled, true),
            ),
          )
          .limit(1);
        if (!config || (config.systemType !== "pestpac" && config.systemType !== "servsuite")) {
          throw new Error("No enabled PestPac or ServSuite configuration is available.");
        }
        if (row.retry_count >= MAX_RETRY_COUNT) {
          throw new Error("Automatic enterprise delivery retry limit exceeded.");
        }
        const result = await EnterpriseBridgeProductionService.dispatchToSystem(
          {
            targetSystem: config.systemType,
            endpointUrl:
              config.apiBaseUrl ??
              (config.systemType === "pestpac"
                ? "https://api.pestpac.com/v1"
                : "https://api.servsuite.com/v1"),
            decryptedApiKey: config.apiKey,
          },
          row.payload_json,
        );
        const retryable = result.status === "RETRYABLE_FAILURE" || result.status === "TIMEOUT";
        await updateOutboxState(row.id, {
            status: result.status,
            lastHttpStatus: "httpStatus" in result ? result.httpStatus ?? null : null,
            lastErrorCode: "errorCode" in result ? result.errorCode ?? null : null,
            lastErrorMessage: "errorMessage" in result ? result.errorMessage ?? null : null,
            lastAttemptAt: new Date(),
            retryCount: row.retry_count + 1,
            nextAttemptAt: retryable
              ? new Date(Date.now() + retryDelayMs(row.retry_count + 1))
              : null,
            lockedAt: null,
            lockedBy: null,
          });
        if (result.status === "DELIVERED") delivered++;
        else failed++;
      } catch (error) {
        failed++;
        const message = error instanceof Error ? error.message : "Enterprise retry failed.";
        const permanent = message.includes("retry limit") || message.includes("No enabled");
        await updateOutboxState(row.id, {
            status: permanent ? "PERMANENT_FAILURE" : "RETRYABLE_FAILURE",
            lastErrorCode: permanent ? "RETRY_STOPPED" : "RETRY_FAILED",
            lastErrorMessage: message,
            lastAttemptAt: new Date(),
            retryCount: row.retry_count + 1,
            nextAttemptAt: permanent
              ? null
              : new Date(Date.now() + retryDelayMs(row.retry_count + 1)),
            lockedAt: null,
            lockedBy: null,
          });
        logger.warn(
          { companyId: row.company_id, inspectionId: row.inspection_id, error: message },
          "[enterprise-outbox] retry failed",
        );
      }
    }
    return { claimed: claimedRows.length, delivered, failed };
  }
}
