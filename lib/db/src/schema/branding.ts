import { pgTable, serial, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const brandingTable = pgTable("branding", {
  id: serial("id").primaryKey(),
  companyName: text("company_name").notNull().default("ReadyLoq"),
  logoUrl: text("logo_url"),
  primaryColor: text("primary_color").default("#0ea5e9"),
  accentColor: text("accent_color").default("#06b6d4"),
  tagline: text("tagline"),
  supportEmail: text("support_email"),
  supportPhone: text("support_phone"),
  poweredByVisible: boolean("powered_by_visible").notNull().default(true),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertBrandingSchema = createInsertSchema(brandingTable).omit({ id: true, updatedAt: true });
export type Branding = typeof brandingTable.$inferSelect;
export type InsertBranding = z.infer<typeof insertBrandingSchema>;
