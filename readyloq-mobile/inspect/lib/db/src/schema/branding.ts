import { pgTable, serial, text, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { companiesTable } from "./companies";

export const brandingProfilesTable = pgTable("branding_profiles", {
  id: serial("id").primaryKey(),
  companyId: integer("company_id").notNull().references(() => companiesTable.id),
  name: text("name").notNull(),
  isDefault: boolean("is_default").notNull().default(false),
  isActive: boolean("is_active").notNull().default(false),

  // Company Information
  companyName: text("company_name").notNull().default("ReadyLoq"),
  tagline: text("tagline"),
  companyAddress: text("company_address"),
  companyPhone: text("company_phone"),
  companyEmail: text("company_email"),
  companyWebsite: text("company_website"),
  licenseNumber: text("license_number"),

  // Visual Branding
  logoUrl: text("logo_url"),
  appIconUrl: text("app_icon_url"),
  primaryColor: text("primary_color").default("#0ea5e9"),
  secondaryColor: text("secondary_color").default("#1e293b"),
  accentColor: text("accent_color").default("#06b6d4"),

  // Customer Report Settings
  reportFooterText: text("report_footer_text"),
  supportInfo: text("support_info"),
  signatureDisclaimer: text("signature_disclaimer"),

  // Email Branding (stored only — nothing is sent)
  emailSenderName: text("email_sender_name"),
  emailReplyTo: text("email_reply_to"),
  emailFooter: text("email_footer"),

  poweredByVisible: boolean("powered_by_visible").notNull().default(true),

  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertBrandingProfileSchema = createInsertSchema(brandingProfilesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  companyId: true,
});

export type BrandingProfile = typeof brandingProfilesTable.$inferSelect;
export type InsertBrandingProfile = z.infer<typeof insertBrandingProfileSchema>;

/**
 * Canonical ReadyLoq branding. Used to seed the non-deletable default profile
 * and to power the "Restore ReadyLoq Defaults" action. logoUrl/appIconUrl are
 * null so the app falls back to the bundled /logo.png asset.
 */
export const READYLOQ_DEFAULT_PROFILE = {
  name: "ReadyLoq Default",
  companyName: "ReadyLoq",
  tagline: "AI-Powered Inspection Intelligence",
  companyAddress: null,
  companyPhone: null,
  companyEmail: "support@readyloq.com",
  companyWebsite: "https://readyloq.com",
  licenseNumber: null,
  logoUrl: null,
  appIconUrl: null,
  primaryColor: "#0ea5e9",
  secondaryColor: "#1e293b",
  accentColor: "#06b6d4",
  reportFooterText: "Confidential Inspection Report",
  supportInfo: "support@readyloq.com",
  signatureDisclaimer:
    "This report certifies that a pest control inspection was conducted at the property on the stated date. All findings and recommendations documented herein represent conditions observed during this inspection.",
  emailSenderName: "ReadyLoq",
  emailReplyTo: null,
  emailFooter: null,
  poweredByVisible: true,
} as const;
