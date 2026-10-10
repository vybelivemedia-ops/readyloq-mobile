import { randomUUID } from "node:crypto";
import { clerkClient } from "@clerk/express";
import { db, missionControlAuditTable, usersTable } from "@workspace/db";
import { and, count, desc, eq, sql } from "drizzle-orm";
import { Router, type IRouter } from "express";

const router: IRouter = Router();

// This is deliberately not a configurable target. Changing the operator
// requires an explicit Production configuration change; changing the target
// requires a code review and release, not an API request or an environment edit.
const TARGET_EMAIL = "vybelivemedia@gmail.com";
const BOOTSTRAP_OPERATION_ID = "readyloq:second-production-super-admin:v1";
const AUDIT_ACTION = "super_admin_bootstrap_granted";
const REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ADVISORY_LOCK_NAMESPACE = 1928109;
const ADVISORY_LOCK_ID = 22027;

type Target = {
  clerkUserId: string;
  appUserId: number;
  verifiedEmail: string;
  isSuperAdmin: boolean;
  companyId: number | null;
};

export function requireSingleAppMapping<T extends { clerkUserId: string }>(
  rows: T[],
  clerkUserId: string,
): T | null {
  if (rows.length !== 1 || rows[0]?.clerkUserId !== clerkUserId) return null;
  return rows[0];
}

async function resolveTarget(): Promise<{ status: number; error: string } | Target> {
  if (!process.env.CLERK_SECRET_KEY) {
    return { status: 503, error: "Production Clerk lookup is not configured" };
  }
  try {
    const result = await clerkClient.users.getUserList({ emailAddress: [TARGET_EMAIL], limit: 100 });
    if (result.totalCount !== result.data.length) {
      return { status: 409, error: "Clerk identity search is incomplete" };
    }
    const exact = result.data.filter((identity) => {
      const primary = identity.emailAddresses.find((address) => address.id === identity.primaryEmailAddressId);
      return primary?.emailAddress.toLowerCase() === TARGET_EMAIL && primary.verification?.status === "verified";
    });
    if (exact.length !== 1) {
      return exact.length === 0
        ? { status: 404, error: "Target has no unique verified primary Production Clerk email" }
        : { status: 409, error: "Multiple verified Production Clerk identities match the target" };
    }
    const clerkUserId = exact[0]!.id;
    // The target must sign in normally first. Never insert a user on behalf
    // of an operator, and never use a Development Clerk subject.
    const mappings = await db.select().from(usersTable)
      .where(eq(usersTable.clerkUserId, clerkUserId)).limit(2);
    if (mappings.length !== 1) {
      return { status: 409, error: mappings.length === 0
        ? "Target must sign in normally to create its Production app-user mapping"
        : "Duplicate app-user mappings for the target Clerk subject" };
    }
    const user = requireSingleAppMapping(mappings, clerkUserId);
    if (!user) return { status: 409, error: "Ambiguous target app-user mapping" };
    return {
      clerkUserId,
      appUserId: user.id,
      verifiedEmail: TARGET_EMAIL,
      isSuperAdmin: user.isSuperAdmin,
      companyId: user.companyId,
    };
  } catch {
    return { status: 503, error: "Clerk identity verification is unavailable" };
  }
}

function enabledForOperator(clerkUserId: string): boolean {
  return process.env.READYLOQ_SUPER_ADMIN_BOOTSTRAP_ENABLED === "true" &&
    Boolean(process.env.READYLOQ_SUPER_ADMIN_BOOTSTRAP_OPERATOR_CLERK_ID) &&
    clerkUserId === process.env.READYLOQ_SUPER_ADMIN_BOOTSTRAP_OPERATOR_CLERK_ID;
}

function isError(result: Awaited<ReturnType<typeof resolveTarget>>): result is { status: number; error: string } {
  return "error" in result;
}

async function bootstrapAlreadyUsed() {
  const [event] = await db.select({ id: missionControlAuditTable.id })
    .from(missionControlAuditTable)
    .where(eq(missionControlAuditTable.action, AUDIT_ACTION))
    .limit(1);
  return Boolean(event);
}

router.get("/", async (req, res): Promise<void> => {
  if (!enabledForOperator(req.user!.clerkUserId)) {
    res.status(403).json({ error: "Bootstrap operator is not explicitly authorized" });
    return;
  }
  if (await bootstrapAlreadyUsed()) {
    res.status(410).json({ error: "The one-time bootstrap has already been used" });
    return;
  }
  const [admins] = await db.select({ value: count() }).from(usersTable).where(eq(usersTable.isSuperAdmin, true));
  if (admins!.value !== 1) {
    res.status(410).json({ error: "Bootstrap is available only while exactly one Super Admin exists" });
    return;
  }
  const target = await resolveTarget();
  if (isError(target)) {
    res.status(target.status).json({ error: target.error });
    return;
  }
  if (target.isSuperAdmin) {
    res.status(409).json({ error: "Target is already a Super Admin" });
    return;
  }
  res.json({ ...target, bootstrapOperationId: BOOTSTRAP_OPERATION_ID });
});

router.post("/", async (req, res): Promise<void> => {
  if (!enabledForOperator(req.user!.clerkUserId)) {
    res.status(403).json({ error: "Bootstrap operator is not explicitly authorized" });
    return;
  }
  // Only Clerk bearer sessions are accepted; HMAC admin tokens and
  // client-supplied actor identities cannot authorize this operation.
  if (!req.headers.authorization?.startsWith("Bearer ")) {
    res.status(401).json({ error: "A Production Clerk bearer session is required" });
    return;
  }
  const body = req.body as Record<string, unknown> | null;
  const reason = typeof body?.reason === "string" ? body.reason.trim() : "";
  const requestId = typeof body?.requestId === "string" ? body.requestId : "";
  const confirmation = body?.confirmation;
  if (!reason || reason.length > 1000 || !REQUEST_ID.test(requestId) ||
      !confirmation || typeof confirmation !== "object") {
    res.status(400).json({ error: "Reason, UUID requestId, and exact target confirmation are required" });
    return;
  }
  const confirmed = confirmation as Record<string, unknown>;
  if (confirmed.verifiedEmail !== TARGET_EMAIL ||
      typeof confirmed.clerkUserId !== "string" ||
      !Number.isSafeInteger(confirmed.appUserId)) {
    res.status(400).json({ error: "Confirm the verified email, Clerk subject, and app-user ID shown in the preview" });
    return;
  }
  const target = await resolveTarget();
  if (isError(target)) {
    res.status(target.status).json({ error: target.error });
    return;
  }
  if (target.clerkUserId !== confirmed.clerkUserId || target.appUserId !== confirmed.appUserId) {
    res.status(409).json({ error: "Target identity changed; resolve and confirm again" });
    return;
  }
  try {
    const result = await db.transaction(async (tx) => {
      // Cross-process serialization: one bootstrap globally, including
      // concurrent calls carrying different request IDs.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(${ADVISORY_LOCK_NAMESPACE}, ${ADVISORY_LOCK_ID})`);
      const [prior] = await tx.select().from(missionControlAuditTable)
        .where(eq(missionControlAuditTable.action, AUDIT_ACTION))
        .orderBy(desc(missionControlAuditTable.id)).limit(1);
      if (prior) {
        const details = prior.details as Record<string, unknown> | null;
        if (details?.requestId === requestId && details?.actorClerkId === req.user!.clerkUserId &&
            details?.targetClerkId === target.clerkUserId && details?.targetUserId === target.appUserId &&
            details?.verifiedTargetEmail === TARGET_EMAIL && details?.reason === reason) {
          return { status: 200, body: {
            auditId: prior.id, operationId: details.operationId, requestId,
            bootstrapOperationId: BOOTSTRAP_OPERATION_ID, replayed: true,
          } };
        }
        return { status: 410, body: { error: "The one-time bootstrap has already been used" } };
      }
      const immutable = await tx.execute(sql`
        SELECT EXISTS (
          SELECT 1 FROM pg_trigger
          WHERE tgname = 'mission_control_audit_immutable_trigger'
            AND tgrelid = 'mission_control_audit'::regclass
            AND tgenabled IN ('O', 'A')
            AND NOT tgisinternal
        ) AS enabled
      `);
      if (immutable.rows[0]?.enabled !== true) {
        return { status: 503, body: { error: "Append-only governance audit protection is unavailable" } };
      }
      const [admins] = await tx.select({ value: count() }).from(usersTable).where(eq(usersTable.isSuperAdmin, true));
      if (admins!.value !== 1) {
        return { status: 410, body: { error: "Bootstrap disabled: exactly one current Super Admin is required" } };
      }
      const [actor] = await tx.select().from(usersTable)
        .where(eq(usersTable.id, req.user!.id)).for("update");
      if (!actor || !actor.isSuperAdmin || actor.clerkUserId !== req.user!.clerkUserId ||
          actor.clerkUserId !== process.env.READYLOQ_SUPER_ADMIN_BOOTSTRAP_OPERATOR_CLERK_ID) {
        return { status: 403, body: { error: "Authorized bootstrap operator is no longer the sole Super Admin" } };
      }
      const mappings = await tx.select().from(usersTable)
        .where(eq(usersTable.clerkUserId, target.clerkUserId)).limit(2).for("update");
      const user = requireSingleAppMapping(mappings, target.clerkUserId);
      if (!user || user.id !== target.appUserId || user.id === actor.id) {
        return { status: 409, body: { error: "Target app-user mapping changed or is ambiguous" } };
      }
      if (user.isSuperAdmin) {
        return { status: 409, body: { error: "Target is already a Super Admin" } };
      }
      const [updated] = await tx.update(usersTable).set({ isSuperAdmin: true })
        .where(and(eq(usersTable.id, user.id), eq(usersTable.isSuperAdmin, false)))
        .returning({ id: usersTable.id });
      if (!updated) {
        return { status: 409, body: { error: "Target Super Admin state changed" } };
      }
      const now = new Date();
      const operationId = randomUUID();
      const [audit] = await tx.insert(missionControlAuditTable).values({
        actorId: actor.clerkUserId,
        action: AUDIT_ACTION,
        targetType: "user",
        targetId: user.clerkUserId,
        details: {
          bootstrapActor: "explicitly_authorized_sole_super_admin",
          actorClerkId: actor.clerkUserId,
          actorAppUserId: actor.id,
          targetClerkId: user.clerkUserId,
          targetUserId: user.id,
          verifiedTargetEmail: TARGET_EMAIL,
          previousIsSuperAdmin: false,
          newIsSuperAdmin: true,
          reason,
          timestamp: now.toISOString(),
          requestId,
          operationId,
          bootstrapOperationId: BOOTSTRAP_OPERATION_ID,
        },
      }).returning({ id: missionControlAuditTable.id, createdAt: missionControlAuditTable.createdAt });
      return { status: 201, body: {
        auditId: audit!.id, operationId, requestId,
        bootstrapOperationId: BOOTSTRAP_OPERATION_ID,
        targetClerkId: user.clerkUserId, targetUserId: user.id,
        previousIsSuperAdmin: false, isSuperAdmin: true, createdAt: audit!.createdAt,
        replayed: false,
      } };
    });
    res.status(result.status).json(result.body);
  } catch {
    res.status(500).json({ error: "Bootstrap transaction failed; no grant was committed" });
  }
});

export default router;