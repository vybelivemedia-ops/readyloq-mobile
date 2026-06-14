import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { companiesTable } from "./companies";

export type UserRole = "owner" | "manager" | "technician";

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  clerkUserId: text("clerk_user_id").notNull().unique(),
  // Nullable: a freshly signed-in user has no company until they create one or
  // accept an invite (onboarding gate). requireCompany blocks tenant routes
  // until this is set.
  companyId: integer("company_id").references(() => companiesTable.id),
  role: text("role").$type<UserRole>().notNull().default("technician"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type User = typeof usersTable.$inferSelect;
