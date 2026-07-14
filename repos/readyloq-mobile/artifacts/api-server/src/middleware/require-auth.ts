import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import type { Request, Response, NextFunction } from "express";
import type { User, UserRole } from "@workspace/db";
import { logErrorEvent } from "../lib/error-events";

// How stale a user's lastSeenAt may be before requireAuth refreshes it. Throttled
// so we don't write on every request — this only powers beta tester activity.
const LAST_SEEN_THROTTLE_MS = 5 * 60 * 1000;

declare global {
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

export const requireAuth = async (req: Request, res: Response, next: NextFunction) => {
  const auth = getAuth(req);
  if (!auth?.userId) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  try {
    let [user] = await db.select().from(usersTable).where(eq(usersTable.clerkUserId, auth.userId));
    if (!user) {
      [user] = await db
        .insert(usersTable)
        .values({ clerkUserId: auth.userId, role: "technician" })
        .returning()
        .then((r) => r);
    }
    req.user = user;
    // Throttled "last seen" refresh for beta tester activity (fire-and-forget;
    // never block or fail the request on this).
    const last = user.lastSeenAt ? user.lastSeenAt.getTime() : 0;
    if (Date.now() - last > LAST_SEEN_THROTTLE_MS) {
      void db
        .update(usersTable)
        .set({ lastSeenAt: new Date() })
        .where(eq(usersTable.id, user.id))
        .catch(() => {});
    }
    return next();
  } catch {
    return res.status(500).json({ error: "Auth lookup failed" });
  }
};

// Role hierarchy: an owner satisfies any manager-or-below check, a manager
// satisfies technician checks, etc. Higher rank ⇒ more authority.
// `sales` sits between technician and manager: it unlocks the Opportunity
// Intelligence routes (requireRole("sales")) while every existing
// requireRole("manager") gate still excludes it.
const ROLE_RANK: Record<UserRole, number> = {
  technician: 0,
  sales: 1,
  manager: 2,
  owner: 3,
};

export const requireRole =
  (role: UserRole) => (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    if (ROLE_RANK[req.user.role] < ROLE_RANK[role]) {
      // Persist company-scoped auth failures for the Beta Center error monitor.
      if (req.user.companyId != null) {
        void logErrorEvent("auth", {
          companyId: req.user.companyId,
          userId: req.user.id,
          message: `Forbidden: ${req.user.role} attempted a ${role}+ action`,
          context: { code: "forbidden", route: req.baseUrl },
        });
      }
      return res.status(403).json({ error: "Forbidden" });
    }
    return next();
  };

// Closed-beta access gate. Owners and managers ALWAYS pass (never lock out an
// admin). A technician whose betaAccess was revoked from the Beta Center is
// blocked from tenant data routes with { code: "beta_access_disabled" }, which
// the client uses to show a friendly "access paused" screen. Apply AFTER
// requireAuth + requireCompany. Feedback submission (/beta) is intentionally not
// gated so a paused tester can still report problems.
export const requireBetaAccess = (req: Request, res: Response, next: NextFunction) => {
  if (!req.user) return res.status(401).json({ error: "Unauthorized" });
  if (ROLE_RANK[req.user.role] >= ROLE_RANK.manager) return next();
  if (req.user.betaAccess === false) {
    if (req.user.companyId != null) {
      void logErrorEvent("auth", {
        companyId: req.user.companyId,
        userId: req.user.id,
        message: "Blocked: beta access is paused for this technician",
        context: { code: "beta_access_disabled", route: req.baseUrl },
      });
    }
    return res.status(403).json({ error: "Beta access paused", code: "beta_access_disabled" });
  }
  return next();
};

// Blocks any user who has not been onboarded into a company yet. The client
// uses the { code: "no_company" } signal to route the user to onboarding.
export const requireCompany = (req: Request, res: Response, next: NextFunction) => {
  if (!req.user) return res.status(401).json({ error: "Unauthorized" });
  if (req.user.companyId == null) {
    return res.status(403).json({ error: "No company", code: "no_company" });
  }
  return next();
};
