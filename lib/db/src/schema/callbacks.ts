import { pgTable, serial, integer, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { inspectionsTable } from "./inspections";

// Tracks the Finding -> Recommendation -> Follow-Up -> Outcome chain used by
// ReadyLoq Command's Callback Intelligence. This is the only persisted table for
// the intelligence module; opportunities and property risk are derived from
// existing analysis_results.findings so they remain strictly evidence-based.
export const callbacksTable = pgTable("callbacks", {
  id: serial("id").primaryKey(),
  inspectionId: integer("inspection_id").notNull().references(() => inspectionsTable.id, { onDelete: "cascade" }),
  propertyType: text("property_type").notNull(), // Multifamily | Restaurant | Commercial | Warehouse | Single Family
  pestType: text("pest_type").notNull(),
  finding: text("finding").notNull(),
  recommendation: text("recommendation"), // nullable — null means no recommendation was documented
  followUpVisit: boolean("follow_up_visit").notNull().default(false),
  outcome: text("outcome").notNull(), // activity_reduced | resolved | callback_occurred | pending
  callbackCause: text("callback_cause"), // missing_exclusion | undocumented_entry | recurring_moisture | repeated_rodent | repeated_cockroach | sanitation_gap
  conduciveCondition: text("conducive_condition"), // nullable — e.g. "Standing moisture", "Open utility penetration"
  createdAt: timestamp("created_at").notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at"),
});

export const insertCallbackSchema = createInsertSchema(callbacksTable).omit({ id: true });
export type Callback = typeof callbacksTable.$inferSelect;
export type InsertCallback = z.infer<typeof insertCallbackSchema>;
