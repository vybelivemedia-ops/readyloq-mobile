import { index, integer, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * Durable evidence-upload reservation. IDs for the company, inspection, user,
 * and media row intentionally remain plain integers: retaining this row after
 * an inspection/user is deleted is necessary for orphan reconciliation.
 */
export const inspectionUploadIntentsTable = pgTable(
  "inspection_upload_intents",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull(),
    companyId: integer("company_id").notNull(),
    inspectionId: integer("inspection_id").notNull(),
    clientKey: text("client_key").notNull(),
    mediaType: text("media_type").notNull(),
    contentType: text("content_type").notNull(),
    expectedSize: integer("expected_size").notNull(),
    checksumAlgorithm: text("checksum_algorithm"),
    checksumValue: text("checksum_value"),
    objectPath: text("object_path").notNull(),
    state: text("state").notNull().default("reserved"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    registeredMediaId: integer("registered_media_id"),
  },
  (table) => [
    uniqueIndex("inspection_upload_intents_user_company_inspection_key_unique").on(
      table.userId,
      table.companyId,
      table.inspectionId,
      table.clientKey,
    ),
    uniqueIndex("inspection_upload_intents_object_path_unique").on(table.objectPath),
    index("inspection_upload_intents_company_state_expiry_idx").on(
      table.companyId,
      table.state,
      table.expiresAt,
    ),
    index("inspection_upload_intents_inspection_idx").on(table.inspectionId),
  ],
);

export type InspectionUploadIntent = typeof inspectionUploadIntentsTable.$inferSelect;