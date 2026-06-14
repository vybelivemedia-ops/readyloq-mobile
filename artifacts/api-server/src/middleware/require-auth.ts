import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import { usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import type { Request, Response, NextFunction } from "express";
import type { User, UserRole } from "@workspace/db";

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
    return next();
  } catch {
    return res.status(500).json({ error: "Auth lookup failed" });
  }
};

// Role hierarchy: an owner satisfies any manager-or-below check, a manager
// satisfies technician checks, etc. Higher rank ⇒ more authority.
const ROLE_RANK: Record<UserRole, number> = {
  technician: 0,
  manager: 1,
  owner: 2,
};

export const requireRole =
  (role: UserRole) => (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    if (ROLE_RANK[req.user.role] < ROLE_RANK[role]) {
      return res.status(403).json({ error: "Forbidden" });
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
