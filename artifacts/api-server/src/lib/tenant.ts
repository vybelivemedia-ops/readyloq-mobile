import type { Request } from "express";

/**
 * The caller's company id. Only valid after `requireAuth` + `requireCompany`
 * have run on the route (together they guarantee `req.user` exists and its
 * companyId is non-null). Throwing here means a missing guard fails loudly
 * instead of silently leaking or writing cross-tenant data.
 */
export function getCompanyId(req: Request): number {
  const id = req.user?.companyId;
  if (id == null) {
    throw new Error(
      "getCompanyId() called without requireAuth+requireCompany guards on the route",
    );
  }
  return id;
}
