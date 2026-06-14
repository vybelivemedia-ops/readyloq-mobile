import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Sales prospects captured from the public marketing site (ReadyLoq.com).
// PLATFORM-LEVEL: leads intentionally have NO company_id. Prospects are
// pre-tenant — they don't belong to any company yet — so the multi-tenancy
// boundary does not apply here. `type` distinguishes a demo request from a
// general contact inquiry; `status` tracks sales follow-up.
export const leadsTable = pgTable("leads", {
  id: serial("id").primaryKey(),
  type: text("type").$type<"demo" | "contact">().notNull(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  phone: text("phone"),
  companyName: text("company_name"),
  role: text("role"),
  teamSize: text("team_size"),
  message: text("message"),
  status: text("status").notNull().default("new"),
  source: text("source"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertLeadSchema = createInsertSchema(leadsTable).omit({
  id: true,
  status: true,
  createdAt: true,
});

export type Lead = typeof leadsTable.$inferSelect;
export type InsertLead = z.infer<typeof insertLeadSchema>;
