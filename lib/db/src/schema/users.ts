import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export type UserRole = "technician" | "manager";

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  clerkUserId: text("clerk_user_id").notNull().unique(),
  role: text("role").$type<UserRole>().notNull().default("technician"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type User = typeof usersTable.$inferSelect;
