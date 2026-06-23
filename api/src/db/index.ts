// api/src/db/index.ts
/**
 * Database connection layer
 *
 * Architecture decisions:
 * - postgres (sql template tag) over pg raw for type safety and composability
 * - Two pools: primary (read/write) + read replica (reports/analytics — Rec 42)
 * - Every query runs through withRLS() which injects company/user context
 *   so Postgres RLS policies enforce tenant isolation (Rec 41)
 * - Never expose raw pool — all callers use db.query() or db.transaction()
 */

import postgres from 'postgres';
import { logger } from '../lib/logger';

// ─── CONNECTION FACTORIES ─────────────────────────────────────────────────────

function createPool(connectionString: string, options: postgres.Options<Record<string, postgres.PostgresType>> = {}) {
  return postgres(connectionString, {
    max: 20,
    idle_timeout: 20,        // release idle connections sooner (Neon suspends at 5min)
    connect_timeout: 30,     // give Neon time to wake from suspension (was 10)
    max_lifetime: 1800,      // recycle connections every 30min
    ssl: { rejectUnauthorized: false },  // always require SSL for Neon
    onnotice: (notice) => logger.debug({ notice }, 'PostgreSQL notice'),
    debug: process.env.NODE_ENV === 'development'
      ? (_connection, query, params) => logger.debug({ query, params }, 'SQL')
      : undefined,
    ...options,
  });
}

// Primary pool — all writes, reads that need freshest data
export const sql = createPool(
  process.env.DATABASE_URL ?? (() => { throw new Error('DATABASE_URL not set'); })()
);

// Read replica pool — reports, dashboards, analytics (Rec 42)
// Falls back to primary if replica not configured
export const sqlRead = process.env.DATABASE_READ_URL
  ? createPool(process.env.DATABASE_READ_URL, { max: 10 })
  : sql;

// ─── RLS CONTEXT ─────────────────────────────────────────────────────────────

export interface RLSContext {
  companyId: string;
  userId: string;
  userRole: string;
}

/**
 * Execute a query with RLS context injected as session variables.
 *
 * PostgreSQL RLS policies read:
 *   current_setting('app.current_company_id')
 *   current_setting('app.current_user_id')
 *   current_setting('app.current_user_role')
 *
 * We set these at the start of every logical "request" using
 * a single-use connection from the pool (not a long-lived session).
 *
 * SIM-U4: All DB operations use Africa/Nairobi timezone
 */
export async function withRLS<T>(
  ctx: RLSContext,
  fn: (sql: postgres.Sql) => Promise<T>
): Promise<T> {
  return sql.reserve().then(async (reserved) => {
    try {
      await reserved`
        SELECT
          set_config('app.current_company_id', ${ctx.companyId}, false),
          set_config('app.current_user_id',    ${ctx.userId ?? ''},    false),
          set_config('app.current_user_role',  ${ctx.userRole},  false),
          set_config('TimeZone', 'Africa/Nairobi', false)
      `;
      return await fn(reserved as unknown as postgres.Sql);
    } finally {
      // Always reset context before returning connection to pool.
      // Prevents company_id leaking to the next request on this connection.
      await reserved`
        SELECT
          set_config('app.current_company_id', '', false),
          set_config('app.current_user_id',    '', false),
          set_config('app.current_user_role',  '', false)
      `.catch(() => {}); // never throw in finally
      reserved.release();
    }
  });
}

/**
 * Run multiple operations in a transaction with RLS context.
 * Rolls back automatically on error.
 */
export async function withRLSTransaction<T>(
  ctx: RLSContext,
  fn: (tx: postgres.Sql) => Promise<T>
): Promise<T> {
  // sql.begin() wraps everything in BEGIN/COMMIT.
  // set_config with is_local=true is genuinely transaction-scoped here
  // because we ARE inside a transaction — context reverts on COMMIT/ROLLBACK.
  //
  // NOTE: postgres.js v3.4's TransactionSql type is defined via `Omit<Sql, ...>`,
  // and TS's Omit drops call signatures — so TransactionSql can't type-check as
  // callable, even though it is one at runtime. Cast through Sql instead.
  return sql.begin(async (rawTx) => {
    const tx = rawTx as unknown as postgres.Sql;
    await tx`
      SELECT
        set_config('app.current_company_id', ${ctx.companyId}, true),
        set_config('app.current_user_id',    ${ctx.userId ?? ''},    true),
        set_config('app.current_user_role',  ${ctx.userRole},  true),
        set_config('TimeZone', 'Africa/Nairobi', true)
    `;
    return fn(tx);
  }) as Promise<T>;
}

/**
 * System-level query (cron jobs, internal processes) — no RLS context.
 * Use only for operations that intentionally span all companies
 * e.g. billing cron, health checks, migrations
 */
export async function systemQuery<T>(
  fn: (sql: postgres.Sql) => Promise<T>
): Promise<T> {
  return sql.reserve().then(async (reserved) => {
    try {
      // Set timezone for consistency even in system queries
      await reserved`SET TimeZone = 'Africa/Nairobi'`;
      return await fn(reserved as unknown as postgres.Sql);
    } finally {
      reserved.release();
    }
  });
}

// ─── HEALTH CHECK ────────────────────────────────────────────────────────────

export async function checkDatabaseHealth(): Promise<boolean> {
  try {
    await sql`SELECT 1`;
    return true;
  } catch (err) {
    logger.error({ err }, 'Database health check failed');
    return false;
  }
}

// ─── GRACEFUL SHUTDOWN ───────────────────────────────────────────────────────

export async function closeDatabaseConnections(): Promise<void> {
  await Promise.all([
    sql.end({ timeout: 5 }),
    sqlRead !== sql ? sqlRead.end({ timeout: 5 }) : Promise.resolve(),
  ]);
  logger.info('Database connections closed');
}