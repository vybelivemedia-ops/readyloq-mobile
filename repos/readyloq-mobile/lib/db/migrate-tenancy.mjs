// Idempotent multi-tenancy backfill. Runs BEFORE `drizzle-kit push` so that push
// can enforce NOT NULL + FK + per-company uniques on already-populated tables.
//
// What it does (all guarded / idempotent):
//   1. Create the `companies` table (matching the drizzle schema) if missing.
//   2. Ensure reserved "platform" + "legacy" companies exist.
//   3. Add a nullable `company_id` column to users + every tenant table (if the
//      table exists) and assign existing rows to the legacy company.
//   4. Promote the lowest-id existing user to owner of the legacy company.
//   5. Seed a platform-owned ReadyLoq default branding profile (pre-login brand).
//   6. Validate that every tenant table has zero null company_id rows.
//
// Plain JS (.mjs) so it runs with `node` (no tsx needed) in post-merge. Resolves
// `pg` from lib/db/node_modules. Run from repo root: `node lib/db/migrate-tenancy.mjs`.
import pg from "pg";

const { Pool } = pg;

const TENANT_TABLES = [
  "inspections",
  "inspection_media",
  "analysis_results",
  "reports",
  "callbacks",
  "property_profiles",
  "property_notes",
  "quizzes",
  "training_scores",
  "dataset_images",
  "branding_profiles",
  // Intelligence module (all company_id NOT NULL). Note:
  // intelligence_training_exports is intentionally nullable, so it is NOT
  // enforced here.
  "intelligence_records",
  "intelligence_tags",
  "intelligence_reviews",
  "intelligence_votes",
  // Beta center tables (all company_id NOT NULL). leads is platform-level
  // (no company_id) and is intentionally excluded.
  "beta_feedback",
  "error_events",
  "beta_checklist_state",
];

const PLATFORM_DISCLAIMER =
  "This report certifies that a pest control inspection was conducted at the property on the stated date. All findings and recommendations documented herein represent conditions observed during this inspection.";

async function tableExists(client, name) {
  const { rows } = await client.query(`SELECT to_regclass($1) AS reg`, [name]);
  return rows[0].reg !== null;
}

async function columnExists(client, table, col) {
  const { rows } = await client.query(
    `SELECT 1 FROM information_schema.columns WHERE table_name = $1 AND column_name = $2`,
    [table, col],
  );
  return rows.length > 0;
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL must be set");
  }
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1. companies table. The slug unique is a uniqueIndex in the schema (not an
    //    inline constraint) so that `drizzle-kit push` can create it on the populated
    //    table without an interactive truncate prompt. We therefore do NOT declare a
    //    UNIQUE here and use NOT EXISTS inserts (idempotent without needing the index).
    await client.query(`
      CREATE TABLE IF NOT EXISTS companies (
        id serial PRIMARY KEY,
        name text NOT NULL,
        slug text NOT NULL,
        created_at timestamp NOT NULL DEFAULT now()
      );
    `);

    // 2. reserved companies (idempotent insert that does not require a unique on slug)
    await client.query(
      `INSERT INTO companies (name, slug) SELECT $1, $2 WHERE NOT EXISTS (SELECT 1 FROM companies WHERE slug = $2)`,
      ["ReadyLoq Platform", "platform"],
    );
    await client.query(
      `INSERT INTO companies (name, slug) SELECT $1, $2 WHERE NOT EXISTS (SELECT 1 FROM companies WHERE slug = $2)`,
      ["Legacy", "legacy"],
    );
    const { rows: legacyRows } = await client.query(`SELECT id FROM companies WHERE slug = 'legacy'`);
    const legacyId = legacyRows[0].id;
    const { rows: platformRows } = await client.query(`SELECT id FROM companies WHERE slug = 'platform'`);
    const platformId = platformRows[0].id;

    // 3. users.company_id (nullable). Only backfill existing users to legacy the
    //    FIRST time the column is added, so we never clobber a mid-onboarding null.
    if (await tableExists(client, "users")) {
      const usersHadCompanyId = await columnExists(client, "users", "company_id");
      await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS company_id integer`);
      if (!usersHadCompanyId) {
        await client.query(`UPDATE users SET company_id = $1 WHERE company_id IS NULL`, [legacyId]);
        // Make sure the legacy company has an owner.
        const { rows: ownerRows } = await client.query(
          `SELECT 1 FROM users WHERE company_id = $1 AND role = 'owner' LIMIT 1`,
          [legacyId],
        );
        if (ownerRows.length === 0) {
          await client.query(
            `UPDATE users SET role = 'owner' WHERE id = (SELECT MIN(id) FROM users WHERE company_id = $1)`,
            [legacyId],
          );
        }
      }
    }

    // 4. tenant tables company_id (nullable add + fill).
    for (const t of TENANT_TABLES) {
      if (!(await tableExists(client, t))) continue;
      await client.query(`ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS company_id integer`);
      await client.query(`UPDATE ${t} SET company_id = $1 WHERE company_id IS NULL`, [legacyId]);
    }

    // 5. platform default branding profile (served by the public pre-login endpoint)
    if (await tableExists(client, "branding_profiles")) {
      const { rows: pbRows } = await client.query(
        `SELECT 1 FROM branding_profiles WHERE company_id = $1 LIMIT 1`,
        [platformId],
      );
      if (pbRows.length === 0) {
        await client.query(
          `INSERT INTO branding_profiles
            (company_id, name, is_default, is_active, company_name, tagline, company_email,
             company_website, primary_color, secondary_color, accent_color, report_footer_text,
             support_info, signature_disclaimer, email_sender_name, powered_by_visible)
           VALUES ($1, 'ReadyLoq Default', true, true, 'ReadyLoq', 'AI-Powered Inspection Intelligence',
             'support@readyloq.com', 'https://readyloq.com', '#0ea5e9', '#1e293b', '#06b6d4',
             'Confidential Inspection Report', 'support@readyloq.com', $2, 'ReadyLoq', true)`,
          [platformId, PLATFORM_DISCLAIMER],
        );
      }
    }

    // 5b. Enforce NOT NULL here (raw SQL) so the non-interactive `drizzle-kit push`
    //     does not need a not-null confirmation. The per-company uniqueness is a
    //     uniqueIndex in the schema, which push creates without a truncate prompt.
    for (const t of TENANT_TABLES) {
      if (!(await tableExists(client, t))) continue;
      await client.query(`ALTER TABLE ${t} ALTER COLUMN company_id SET NOT NULL`);
    }

    // 6. validate no null company_id remains on tenant tables
    for (const t of TENANT_TABLES) {
      if (!(await tableExists(client, t))) continue;
      const { rows } = await client.query(`SELECT count(*)::int AS n FROM ${t} WHERE company_id IS NULL`);
      if (rows[0].n > 0) {
        throw new Error(`${t} still has ${rows[0].n} null company_id rows after backfill`);
      }
    }

    await client.query("COMMIT");
    console.log(`tenancy backfill complete (legacy=${legacyId}, platform=${platformId})`);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("tenancy backfill failed:", err);
  process.exit(1);
});
