/**
 * Meta Ray-Ban Glasses — session persistence table
 *
 * Persists Live AI webhook sessions across API restarts so a technician's
 * active inspection isn't disrupted if the server bounces mid-inspection.
 *
 * Sessions are loaded back into the in-memory Map on API startup.
 * Events are JSON-persisted so polling resumes seamlessly on reconnect.
 */

import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { inspectionsTable } from "./inspections";
import { companiesTable } from "./companies";

export const metaGlassesSessionsTable = pgTable(
  "meta_glasses_sessions",
  {
    id: serial("id").primaryKey(),
    /** UUID that identifies the session — used as the polling bearer token. */
    sessionId: text("session_id").notNull().unique(),
    /** 6-char human-readable code the technician enters in the Meta glasses app. */
    code: text("code").notNull(),
    inspectionId: integer("inspection_id")
      .notNull()
      .references(() => inspectionsTable.id, { onDelete: "cascade" }),
    companyId: integer("company_id")
      .notNull()
      .references(() => companiesTable.id),
    /** Clerk/DB user ID of the technician who started the session. */
    userId: integer("user_id").notNull(),
    /**
     * Ring buffer of GlassesEvent objects (max 100).
     * Persisted as JSONB so sessions survive API restarts.
     */
    events: jsonb("events").$type<unknown[]>().notNull().default([]),
    /** When the session automatically expires (24 h from creation). */
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("meta_glasses_sessions_company_idx").on(t.companyId),
    index("meta_glasses_sessions_inspection_idx").on(t.inspectionId),
    index("meta_glasses_sessions_expires_idx").on(t.expiresAt),
  ],
);
