// api/src/db/migrate.ts

import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import postgres from 'postgres';
import { logger } from '../lib/logger';

const MIGRATIONS_DIR = path.resolve(__dirname, '../../../db');

async function migrate(): Promise<void> {
  const url = process.env.DATABASE_DIRECT_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_DIRECT_URL (or DATABASE_URL) not set');

  const sql = postgres(url, {
    max: 1,
    ssl: { rejectUnauthorized: false },
    onnotice: (n) => logger.info({ notice: n.message }, 'DB notice'),
  });

  try {
    // Create migrations tracking table if it doesn't exist
    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS _migrations (
        filename    TEXT PRIMARY KEY,
        applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `);

    // Read all .sql files sorted
    const files = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    if (files.length === 0) {
      logger.warn({ dir: MIGRATIONS_DIR }, 'No migration files found');
      return;
    }

    // Find which files have already been applied
    const applied = await sql`SELECT filename FROM _migrations`;
    const appliedSet = new Set(applied.map((r: any) => r.filename));

    // If tracking table is empty but files exist, the DB was already set up
    // before we introduced tracking. Probe the DB to find what's already there.
    if (appliedSet.size === 0 && files.length > 0) {
      logger.info('_migrations table is empty — probing DB for existing schema...');

      // Check if companies table exists (created by 001_core.sql)
      const [companiesExists] = await sql`
        SELECT 1 FROM information_schema.tables
        WHERE table_name = 'companies' AND table_schema = 'public'
      `;

      if (companiesExists) {
        // Mark all files EXCEPT the last one as already applied
        // (we'll try each remaining one gracefully)
        const alreadyApplied = files.slice(0, -1); // everything except newest
        logger.info({ alreadyApplied }, 'Marking existing migrations as applied');
        for (const f of alreadyApplied) {
          await sql`
            INSERT INTO _migrations (filename) VALUES (${f})
            ON CONFLICT (filename) DO NOTHING
          `;
          appliedSet.add(f);
        }
      }
    }

    const pending = files.filter(f => !appliedSet.has(f));

    if (pending.length === 0) {
      logger.info('Nothing to migrate — all files already applied');
      return;
    }

    logger.info({ pending }, `Applying ${pending.length} pending migration(s)`);

    for (const file of pending) {
      const filepath = path.join(MIGRATIONS_DIR, file);
      const sqlContent = fs.readFileSync(filepath, 'utf8');

      logger.info({ file }, 'Running migration...');
      const start = Date.now();

      await sql.unsafe(sqlContent);
      await sql`INSERT INTO _migrations (filename) VALUES (${file}) ON CONFLICT DO NOTHING`;

      logger.info({ file, ms: Date.now() - start }, '✅ Migration complete');
    }

    logger.info('All migrations applied successfully');
  } finally {
    await sql.end();
  }
}

migrate().catch((err) => {
  logger.error({ err }, 'Migration failed');
  process.exit(1);
});