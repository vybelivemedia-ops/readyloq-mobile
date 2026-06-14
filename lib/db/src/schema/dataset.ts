import { pgTable, serial, text, integer, jsonb, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { companiesTable } from "./companies";

export const datasetImagesTable = pgTable("dataset_images", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companiesTable.id),
  category: text("category").notNull(), // "pest_activity" | "exclusion" | "sanitation" | "moisture" | "structural"
  title: text("title").notNull(),
  description: text("description"),
  imageUrl: text("image_url").notNull(),
  thumbnailUrl: text("thumbnail_url"),
  pestType: text("pest_type").notNull(),
  severity: text("severity"),
  location: text("location"),
  tags: jsonb("tags").$type<string[]>().default([]),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertDatasetImageSchema = createInsertSchema(datasetImagesTable).omit({ id: true, createdAt: true, companyId: true });
export type DatasetImage = typeof datasetImagesTable.$inferSelect;
export type InsertDatasetImage = z.infer<typeof insertDatasetImageSchema>;
