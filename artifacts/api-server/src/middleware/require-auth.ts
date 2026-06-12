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
    next();
  } catch {
    return res.status(500).json({ error: "Auth lookup failed" });
  }
};

export const requireRole =
  (role: UserRole) => (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ error: "Unauthorized" });
    if (req.user.role !== role) return res.status(403).json({ error: "Forbidden" });
    next();
  };
