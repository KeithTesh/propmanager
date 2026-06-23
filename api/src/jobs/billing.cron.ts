// api/src/jobs/billing.cron.ts
/**
 * Billing Cron Job
 *
 * Runs at 00:01 Africa/Nairobi on 1st of every month (via node-cron).
 * Generates monthly bills for all active leases across all companies.
 *
 * Safety guarantees (from simulations):
 * - SIM-A2: UNIQUE(job_name, for_month, company_id) + Redis lock = idempotent
 * - SIM-U2: Processes companies in batches, 20 leases per transaction
 * - SIM-U4: All times in Africa/Nairobi
 * - Rec 40: Every run logged to cron_job_runs, recoverable on failure
 * - Cron chain order: bill_generation → penalty → stk_reconciliation → reminder
 */

import cron from 'node-cron';
import { format, startOfMonth } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import type postgres from 'postgres';
import { sql, systemQuery } from '../db';
import { withLock } from '../db/redis';
import { logger } from '../lib/logger';

const NAIROBI_TZ = 'Africa/Nairobi';
const BATCH_SIZE = 20;
const BATCH_PAUSE_MS = 200;  // SIM-U2: 200ms between batches to avoid pool exhaustion

// ─── SCHEDULE ─────────────────────────────────────────────────────────────────
// "0 1 1 * *" = 00:01 on 1st of every month
// cron always runs in server TZ — server TZ must be Africa/Nairobi (SIM-U4)


// ─── PURGE DELETED COMPANIES (daily 02:00) ────────────────────────────────────
// Permanently deletes companies soft-deleted more than 30 days ago

async function purgeDeletedCompanies() {
  const companies = await sql`
    SELECT id, name FROM companies
    WHERE deleted_at IS NOT NULL
      AND deleted_at < NOW() - INTERVAL '30 days'
  `;

  for (const company of companies) {
    // Hard delete — cascade deletes all related data via FK constraints
    await sql`DELETE FROM companies WHERE id = ${company.id}`;
    logger.warn({ companyId: company.id, name: company.name }, 'Company permanently purged after 30-day deletion window');
  }

  if (companies.length > 0) {
    logger.info({ count: companies.length }, 'Purged deleted companies');
  }
}

export function scheduleBillingCron(): void {
  // Monthly bill generation — 1st of month at 00:01 Nairobi
  cron.schedule('1 0 1 * *', () => {
    runBillingCron().catch(err =>
      logger.error({ err }, 'Billing cron crashed')
    );
  }, { timezone: 'Africa/Nairobi' });

  // Penalty cron — runs daily at 00:10 Nairobi (after billing)
  cron.schedule('10 0 * * *', () => {
    runPenaltyCron().catch(err =>
      logger.error({ err }, 'Penalty cron crashed')
    );
  }, { timezone: 'Africa/Nairobi' });

  // STK expiry cron — runs every 2 minutes
  cron.schedule('*/2 * * * *', () => {
    runStkExpiryCron().catch(err =>
      logger.error({ err }, 'STK expiry cron crashed')
    );
  }, { timezone: 'Africa/Nairobi' });

  // Purge deleted companies — daily at 02:00 Nairobi
  cron.schedule('0 2 * * *', () => {
    purgeDeletedCompanies().catch(err =>
      logger.error({ err }, 'Purge deleted companies cron crashed')
    );
  }, { timezone: 'Africa/Nairobi' });

  logger.info('All billing crons scheduled (Africa/Nairobi timezone)');
}

// ─── BILL GENERATION ──────────────────────────────────────────────────────────

export async function runBillingCron(overrideForMonth?: string): Promise<void> {
  const nowNairobi = toZonedTime(new Date(), NAIROBI_TZ);
  const forMonth = overrideForMonth ?? format(startOfMonth(nowNairobi), 'yyyy-MM-dd');
  const lockKey = `billing:${forMonth}`;

  const ran = await withLock(lockKey, async () => {
    logger.info({ forMonth }, 'Billing cron started');

    // Load all active companies
    const companies = await systemQuery(async (db) => db`
      SELECT id, due_day, grace_period_days FROM companies
      WHERE deleted_at IS NULL AND setup_completed = TRUE
    `);

    let totalGenerated = 0;
    let totalSkipped = 0;
    let totalFailed = 0;

    for (const company of companies) {
      try {
        const result = await runBillingForCompany(company.id, forMonth, company.due_day);
        totalGenerated += result.generated;
        totalSkipped += result.skipped;
      } catch (err) {
        totalFailed++;
        logger.error({ err, companyId: company.id, forMonth }, 'Billing failed for company');
      }
    }

    logger.info({ forMonth, totalGenerated, totalSkipped, totalFailed }, 'Billing cron completed');
    return { totalGenerated, totalSkipped, totalFailed };
  }, 10 * 60 * 1000);  // 10-minute lock

  if (ran === null) {
    logger.warn({ forMonth }, 'Billing cron skipped — already running');
  }
}

async function runBillingForCompany(
  companyId: string,
  forMonth: string,
  dueDay: number
): Promise<{ generated: number; skipped: number }> {
  // Record cron run start (SIM-A2: idempotent via UNIQUE constraint)
  const [runRecord] = await systemQuery(async (db) => db`
    INSERT INTO cron_job_runs (job_name, for_month, company_id, status, lock_key)
    VALUES ('bill_generation', ${forMonth}, ${companyId}, 'running', ${`billing:${forMonth}:${companyId}`})
    ON CONFLICT (job_name, for_month, company_id) DO UPDATE
      SET status = cron_job_runs.status  -- no-op update to return existing row
    RETURNING id, status, records_processed
  `);

  // If already completed, skip entirely (idempotency)
  if (runRecord.status === 'completed') {
    return { generated: 0, skipped: runRecord.records_processed };
  }

  // Load all active leases for this company
  const leases = await systemQuery(async (db) => db`
    SELECT
      l.id, l.unit_id, l.monthly_rent, l.start_date, l.status,
      l.snap_payment_method, l.snap_paybill_number, l.snap_account_reference,
      l.snap_move_in_proration_mode, l.snap_move_in_proration_cutoff,
      l.snap_move_in_proration_method, l.snap_min_proration_threshold
    FROM leases l
    WHERE l.company_id = ${companyId}
      AND l.status IN ('active', 'notice')
  `);

  // Calculate due date for this month
  const dueDate = calculateDueDate(forMonth, dueDay);

  let generated = 0;
  let skipped = 0;

  // Process in batches of 20 (SIM-U2)
  for (let i = 0; i < leases.length; i += BATCH_SIZE) {
    const batch = leases.slice(i, i + BATCH_SIZE);

    await systemQuery(async (db) => {
      return db.begin(async (rawTx) => {
        const tx = rawTx as unknown as postgres.Sql;
        for (const lease of batch) {
          // Skip if bill already exists for this month (idempotency)
          const [existing] = await tx`
            SELECT id FROM monthly_bills
            WHERE lease_id = ${lease.id}
              AND for_month = ${forMonth}
              AND bill_type = 'rent'
          `;

          if (existing) {
            skipped++;
            continue;
          }

          // Insert recurring rent bill
          await tx`
            INSERT INTO monthly_bills (
              company_id, lease_id, unit_id,
              for_month, due_date, bill_type,
              rent_amount, total_paid,
              is_prorated,
              status,
              snap_payment_method, snap_paybill_number, snap_account_reference,
              generated_by, published_at
            ) VALUES (
              ${companyId}, ${lease.id}, ${lease.unit_id},
              ${forMonth}, ${dueDate}, 'rent',
              ${lease.monthly_rent}, 0,
              false,
              'open',
              ${lease.snap_payment_method}, ${lease.snap_paybill_number}, ${lease.snap_account_reference},
              'cron', NOW()
            )
            ON CONFLICT (lease_id, for_month, bill_type) DO NOTHING
          `;

          generated++;
        }
      });
    });

    // Pause between batches (SIM-U2: avoid connection pool exhaustion)
    if (i + BATCH_SIZE < leases.length) {
      await sleep(BATCH_PAUSE_MS);
    }
  }

  // Mark cron run completed
  await systemQuery(async (db) => db`
    UPDATE cron_job_runs SET
      status = 'completed',
      completed_at = NOW(),
      records_processed = ${generated},
      records_skipped = ${skipped}
    WHERE id = ${runRecord.id}
  `);

  return { generated, skipped };
}

// ─── PENALTY CRON ─────────────────────────────────────────────────────────────

export async function runPenaltyCron(): Promise<void> {
  const nowNairobi = toZonedTime(new Date(), NAIROBI_TZ);
  const today = format(nowNairobi, 'yyyy-MM-dd');
  const lockKey = `penalty:${today}`;

  await withLock(lockKey, async () => {
    logger.info({ today }, 'Penalty cron started');

    // Find all overdue bills where penalty should now apply
    // Checks: bill is open/partial, due_date + grace + penalty_after_days <= today
    const overdueBills = await systemQuery(async (db) => db`
      SELECT
        b.id as bill_id,
        b.company_id,
        b.lease_id,
        b.total_amount,
        b.total_paid,
        b.total_due,
        b.due_date,
        b.for_month,
        c.penalty_type,
        c.penalty_value,
        c.penalty_applies_after_days,
        c.grace_period_days
      FROM monthly_bills b
      JOIN leases l ON l.id = b.lease_id
      JOIN companies c ON c.id = b.company_id
      WHERE b.status IN ('open', 'partial')
        AND b.bill_type = 'rent'
        AND c.penalty_type != 'none'
        AND (b.due_date + c.grace_period_days + c.penalty_applies_after_days)::DATE <= ${today}::DATE
        -- Don't add penalty if one already exists for this bill's month
        AND NOT EXISTS (
          SELECT 1 FROM monthly_bills pb
          WHERE pb.lease_id = b.lease_id
            AND pb.for_month = b.for_month
            AND pb.bill_type = 'penalty'
        )
    `);

    let applied = 0;
    for (const bill of overdueBills) {
      const penaltyAmount = bill.penalty_type === 'flat'
        ? bill.penalty_value
        : Math.floor(bill.total_due * (bill.penalty_value / 100));

      if (penaltyAmount <= 0) continue;

      try {
        await systemQuery(async (db) => db`
          INSERT INTO monthly_bills (
            company_id, lease_id, unit_id,
            for_month, due_date, bill_type,
            penalty_amount, total_paid,
            status,
            snap_payment_method, snap_paybill_number, snap_account_reference,
            generated_by, published_at
          )
          SELECT
            ${bill.company_id}, ${bill.lease_id}, b.unit_id,
            ${bill.for_month}, CURRENT_DATE, 'penalty',
            ${penaltyAmount}, 0,
            'open',
            b.snap_payment_method, b.snap_paybill_number, b.snap_account_reference,
            'cron', NOW()
          FROM monthly_bills b WHERE b.id = ${bill.bill_id}
          ON CONFLICT (lease_id, for_month, bill_type) DO NOTHING
        `);

        // Update original bill to overdue
        await systemQuery(async (db) => db`
          UPDATE monthly_bills SET status = 'overdue'
          WHERE id = ${bill.bill_id} AND status IN ('open', 'partial')
        `);

        applied++;
      } catch (err) {
        logger.error({ err, billId: bill.bill_id }, 'Failed to apply penalty');
      }
    }

    // Flip open/partial bills to 'overdue' when past due date
    await systemQuery(async (db) => db`
      UPDATE monthly_bills SET
        status     = 'overdue',
        updated_at = NOW()
      WHERE status IN ('open', 'partial')
        AND bill_type IN ('rent', 'signing')
        AND due_date < CURRENT_DATE
    `);

    logger.info({ today, applied }, 'Penalty cron completed');
  }, 5 * 60 * 1000);
}

// ─── STK EXPIRY CRON ─────────────────────────────────────────────────────────

export async function runStkExpiryCron(): Promise<void> {
  // Mark STK pushes as expired if they've timed out and no response received
  const expired = await systemQuery(async (db) => db`
    UPDATE stk_payments SET
      status = 'expired',
      resolved_at = NOW()
    WHERE status = 'pending'
      AND expires_at < NOW()
    RETURNING id, bill_id, company_id
  `);

  if (expired.length > 0) {
    // Release STK locks on expired bills
    for (const stk of expired) {
      await systemQuery(async (db) => db`
        UPDATE monthly_bills SET
          stk_lock_until = NULL
        WHERE id = ${stk.bill_id}
          AND stk_lock_until IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM stk_payments
            WHERE bill_id = ${stk.bill_id} AND status = 'pending'
          )
      `);
    }

    logger.info({ count: expired.length }, 'STK pushes expired');
  }
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────

function calculateDueDate(forMonth: string, dueDay: number): string {
  const monthStart = new Date(forMonth);
  const dueDate = new Date(monthStart);
  dueDate.setDate(dueDay);
  // If due day doesn't exist in month (e.g. Feb 30 → Feb 28)
  if (dueDate.getMonth() !== monthStart.getMonth()) {
    dueDate.setDate(0); // last day of month
  }
  return format(dueDate, 'yyyy-MM-dd');
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}