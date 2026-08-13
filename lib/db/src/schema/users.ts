import { pgTable, serial, text, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { companiesTable } from "./companies";

// Rank order (see api-server require-auth ROLE_RANK):
// technician < sales < manager < owner. `sales` exists for Opportunity
// Intelligence: it can see the Opportunity Log but gains NO manager powers.
export type UserRole = "owner" | "manager" | "sales" | "technician";

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  clerkUserId: text("clerk_user_id").notNull().unique(),
  // Nullable: a freshly signed-in user has no company until they create one or
  // accept an invite (onboarding gate). requireCompany blocks tenant routes
  // until this is set.
  companyId: integer("company_id").references(() => companiesTable.id),
  role: text("role").$type<UserRole>().notNull().default("technician"),
  // Closed-beta access gate. Default ON so existing/owner/manager users are never
  // locked out; managers can revoke a technician's access from the Beta Center,
  // which blocks tenant data routes with { code: "beta_access_disabled" }.
  betaAccess: boolean("beta_access").notNull().default(true),
  // Updated (throttled) by requireAuth so the Beta Center can show tester activity.
  lastSeenAt: timestamp("last_seen_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  // ── Platform Admin ──────────────────────────────────────────────────────────
  // Cross-tenant super admin flag. Grants access to /api/admin/* endpoints
  // and the role-switcher utility. Granted via POST /api/admin/bootstrap.
  isSuperAdmin: boolean("is_super_admin").notNull().default(false),
  // Ephemeral role override for testing / impersonation. When set, requireRole
  // uses this value instead of `role` so the super admin can verify technician,
  // sales, manager, and owner experiences without a real account switch.
  // Super-admin-only endpoints check `isSuperAdmin` directly, bypassing this.
  roleOverride: text("role_override").$type<UserRole>(),
  // ── Push Notifications ──────────────────────────────────────────────────────
  // Expo push token registered from the device. Stored per-user; cleared when
  // the user opts out. Nullable: token not yet registered or user opted out.
  pushToken: text("push_token"),
  // Owner opt-out toggle. When false, no critical-risk push is sent even if
  // a token is on file. Default true so pushes fire immediately on registration.
  pushNotificationsEnabled: boolean("push_notifications_enabled").notNull().default(true),
  // Set when the Expo push API returns a ticket error for this user's token
  // (e.g. MessageRateExceeded, InvalidCredentials) or when the token is cleared
  // due to DeviceNotRegistered. Cleared when the owner dismisses the banner or
  // re-registers their push token. Null means no known delivery failure.
  pushLastFailedAt: timestamp("push_last_failed_at"),
});

export type User = typeof usersTable.$inferSelect;
