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
import { db, enterpriseOutboxTable } from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import type { HardenedInspectionPayload, DispatchResult } from "../../types/enterprise-payload";
import { RETRYABLE_OUTBOX_STATUSES } from "@workspace/db";
import {
  EnterpriseBridgeProductionService,
  type ResolvedEnterpriseConfig,
} from "./enterprise-bridge-production";

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

    // ── 2. Write-ahead insert (or reuse existing row) ───────────────────────
    let outboxId: string;

    if (existing && (RETRYABLE_OUTBOX_STATUSES as string[]).includes(existing.status)) {
      // Reuse the existing row — update it back to QUEUED for this attempt.
      outboxId = existing.id;
      await db
        .update(enterpriseOutboxTable)
        .set({ status: "QUEUED" })
        .where(eq(enterpriseOutboxTable.id, outboxId));
    } else {
      // New dispatch — insert a write-ahead row before the HTTP call.
      outboxId = randomUUID();
      await db.insert(enterpriseOutboxTable).values({
        id: outboxId,
        companyId: companyIdNum,
        inspectionId: inspectionIdNum,
        payloadJson: payload as unknown as Record<string, unknown>,
        status: "QUEUED",
      });
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

    await db
      .update(enterpriseOutboxTable)
      .set({
        status: result.status,
        lastHttpStatus: httpStatus ?? null,
        lastErrorCode: errorCode ?? null,
        lastErrorMessage: errorMessage ?? null,
        lastAttemptAt: new Date(),
        retryCount: (existing?.retryCount ?? 0) + 1,
      })
      .where(eq(enterpriseOutboxTable.id, outboxId));

    return result;
  }
}
