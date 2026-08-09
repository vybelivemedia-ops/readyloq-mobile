import { pgTable, serial, integer, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { companiesTable } from "./companies";

// One row per company that has connected an external field-service platform.
// The api_key is stored server-side ONLY and is NEVER returned to any client.
// Mobile consumers may read system_type and account_id (non-sensitive) via
// GET /api/integrations/config to decide whether to show the "Push to dispatch"
// button, but the credential itself stays on the server.
export type FieldIntegrationSystem = "pestpac" | "fieldroutes";

export const companyFieldIntegrationsTable = pgTable(
  "company_field_integrations",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id")
      .notNull()
      .unique()
      .references(() => companiesTable.id, { onDelete: "cascade" }),
    systemType: text("system_type").$type<FieldIntegrationSystem>().notNull(),
    // The company / account identifier within the external system.
    accountId: text("account_id").notNull(),
    // API key or bearer token for the external system.
    // Never serialised into any API response.
    apiKey: text("api_key").notNull(),
    // Optional base URL override — useful for on-prem / sandbox environments.
    apiBaseUrl: text("api_base_url"),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
);

export const insertFieldIntegrationSchema = createInsertSchema(
  companyFieldIntegrationsTable,
).omit({ id: true, createdAt: true, updatedAt: true, companyId: true });

export type CompanyFieldIntegration = typeof companyFieldIntegrationsTable.$inferSelect;
export type InsertFieldIntegration = z.infer<typeof insertFieldIntegrationSchema>;
