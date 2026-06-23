// api/src/db/seed.ts
/**
 * Database seeder
 *
 * Creates the initial super_admin user for a fresh installation.
 * Run once after migration on a new environment.
 *
 * Usage:
 *   npm run db:seed
 *
 * The seed data (bank templates, statutory rates, holidays) is already
 * included in 003_seed_functions.sql and runs with migrations.
 * This file only handles the admin user which requires an env variable.
 */

import 'dotenv/config';
import postgres from 'postgres';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { logger } from '../lib/logger';

async function seed(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL not set');

  const adminEmail    = process.env.SEED_ADMIN_EMAIL    ?? 'admin@propmanager.co.ke';
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? 'ChangeMe123!';
  const adminName     = process.env.SEED_ADMIN_NAME     ?? 'System Admin';

  const sql = postgres(url, {
    max: 1,
    ssl: { rejectUnauthorized: false },  // always require SSL for Neon
  });

  try {
    // Check if super_admin already exists
    const [existing] = await sql`
      SELECT id FROM users WHERE role = 'super_admin' LIMIT 1
    `;

    if (existing) {
      logger.info({ id: existing.id }, 'Super admin already exists — skipping seed');
      return;
    }

    const passwordHash = await bcrypt.hash(adminPassword, 12);
    const id = randomUUID();

    await sql`
      INSERT INTO users (id, company_id, role, email, password_hash, full_name, is_active)
      VALUES (
        ${id},
        NULL,
        'super_admin',
        ${adminEmail},
        ${passwordHash},
        ${adminName},
        TRUE
      )
    `;

    logger.info({ id, email: adminEmail }, '✅ Super admin created');
    logger.info('');
    logger.info('─────────────────────────────────────────');
    logger.info(`  Email:    ${adminEmail}`);
    logger.info(`  Password: ${adminPassword}`);
    logger.info('  ⚠️  Change this password immediately!');
    logger.info('─────────────────────────────────────────');

  } finally {
    await sql.end();
  }
}

seed().catch((err) => {
  logger.error({ err }, 'Seed failed');
  process.exit(1);
});