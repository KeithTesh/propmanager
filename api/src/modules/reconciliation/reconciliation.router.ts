// api/src/modules/reconciliation/reconciliation.router.ts

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { withRLS, withRLSTransaction } from '../../db';
import { authenticate } from '../../middleware/auth';
import { logger } from '../../lib/logger';
import type { ApiResponse, RLSContext } from '../../types';

export const reconciliationRouter = Router();
reconciliationRouter.use(authenticate);

function ctx(req: Request): RLSContext {
  return { companyId: req.ctx.companyId!, userId: req.ctx.userId, userRole: req.ctx.userRole };
}

// ─── GET /reconciliation/batches — list import history ───────────────────────

reconciliationRouter.get('/batches', async (req: Request, res: Response) => {
  const batches = await withRLS(ctx(req), async (db) => {
    return db`
      SELECT b.*, u.full_name AS imported_by_name
      FROM csv_import_batches b
      JOIN users u ON u.id = b.imported_by
      ORDER BY b.created_at DESC
      LIMIT 50
    `;
  });
  res.json({ success: true, data: { batches } } satisfies ApiResponse<unknown>);
});

// ─── GET /reconciliation/unmatched — list pending unmatched payments ──────────

reconciliationRouter.get('/unmatched', async (req: Request, res: Response) => {
  const unmatched = await withRLS(ctx(req), async (db) => {
    return db`
      SELECT
        u.*,
        l.id AS suggested_lease_id,
        st.full_name AS suggested_tenant_name,
        su.unit_number AS suggested_unit_number,
        sp.name AS suggested_property_name
      FROM unmatched_payments u
      LEFT JOIN leases l     ON l.id = u.suggested_lease_id
      LEFT JOIN tenants st   ON st.id = u.suggested_tenant_id
      LEFT JOIN units su     ON su.id = l.unit_id
      LEFT JOIN properties sp ON sp.id = su.property_id
      WHERE u.resolution = 'pending'
      ORDER BY u.created_at DESC
    `;
  });
  res.json({ success: true, data: { unmatched } } satisfies ApiResponse<unknown>);
});

// ─── POST /reconciliation/import — upload + parse CSV ────────────────────────
// Body: { bankName, filename, fileHash, rows: [{date, ref, amount, payer, phone}] }

const ImportRowSchema = z.object({
  transactionDate: z.string(),
  transactionRef:  z.string().optional().nullable(),
  amount:          z.number().positive(),
  payerName:       z.string().optional().nullable(),
  payerReference:  z.string().optional().nullable(),  // account number they entered
  payerPhone:      z.string().optional().nullable(),
  bankName:        z.string().optional().nullable(),
});

const ImportSchema = z.object({
  bankName:    z.string(),
  filename:    z.string(),
  fileHash:    z.string(),
  rows:        z.array(ImportRowSchema).min(1).max(5000),
  templateName: z.string().optional(),
});

reconciliationRouter.post('/import', async (req: Request, res: Response) => {
  const data      = ImportSchema.parse(req.body);
  const companyId = req.ctx.companyId!;
  const userId    = req.ctx.userId;
  const batchId   = randomUUID();

  // Check for duplicate file (Rec 56)
  const [existing] = await withRLS(ctx(req), async (db) => {
    return db`SELECT id FROM csv_import_batches WHERE company_id = ${companyId} AND file_hash = ${data.fileHash}`;
  });
  if (existing) {
    res.status(409).json({ success: false, error: { code: 'DUPLICATE_FILE', message: 'This file has already been imported' } });
    return;
  }

  // Create batch record
  await withRLS(ctx(req), async (db) => {
    return db`
      INSERT INTO csv_import_batches (
        id, company_id, bank_name, filename, file_hash,
        template_name, total_rows, status, imported_by
      ) VALUES (
        ${batchId}, ${companyId}, ${data.bankName}, ${data.filename},
        ${data.fileHash}, ${data.templateName ?? null},
        ${data.rows.length}, 'processing', ${userId}
      )
    `;
  });

  // Load all active leases for matching
  const leases = await withRLS(ctx(req), async (db) => {
    return db`
      SELECT
        l.id, l.snap_account_reference,
        t.full_name AS tenant_name, t.phone AS tenant_phone,
        u.unit_number
      FROM leases l
      JOIN tenants t ON t.id = l.primary_tenant_id
      JOIN units u   ON u.id = l.unit_id
      WHERE l.status IN ('active','notice')
    `;
  });

  // Build lookup maps for fast matching
  const byRef    = new Map(leases.map(l => [l.snap_account_reference?.toLowerCase(), l]));
  const byPhone  = new Map(leases.map(l => [l.tenant_phone?.replace(/\D/g,''), l]));

  let matched = 0; let unmatched = 0; let duplicates = 0;

  for (const row of data.rows) {
    // Try to match: 1) account reference, 2) phone number
    const refKey   = row.payerReference?.toLowerCase().trim();
    const phoneKey = row.payerPhone?.replace(/\D/g,'');

    const lease = (refKey && byRef.get(refKey)) || (phoneKey && byPhone.get(phoneKey)) || null;

    if (!lease) {
      // Fuzzy suggestion via pg_trgm — find closest account reference
      const [suggestion] = await withRLS(ctx(req), async (db) => {
        return db`
          SELECT
            l.id AS lease_id,
            t.id AS tenant_id,
            t.full_name,
            SIMILARITY(l.snap_account_reference, ${refKey ?? ''}) AS score
          FROM leases l
          JOIN tenants t ON t.id = l.primary_tenant_id
          WHERE SIMILARITY(l.snap_account_reference, ${refKey ?? ''}) > 0.2
            OR SIMILARITY(t.full_name, ${row.payerName ?? ''}) > 0.3
          ORDER BY GREATEST(
            SIMILARITY(l.snap_account_reference, ${refKey ?? ''}),
            SIMILARITY(t.full_name, ${row.payerName ?? ''})
          ) DESC
          LIMIT 1
        `;
      });

      await withRLS(ctx(req), async (db) => {
        return db`
          INSERT INTO unmatched_payments (
            company_id, source, csv_import_batch_id,
            amount, payer_name, payer_reference, payer_phone,
            transaction_ref, transaction_date, bank_name,
            raw_row_json,
            suggested_lease_id, suggested_tenant_id, suggestion_confidence
          ) VALUES (
            ${companyId}, 'csv_import', ${batchId},
            ${row.amount}, ${row.payerName ?? null}, ${row.payerReference ?? null},
            ${row.payerPhone ?? null}, ${row.transactionRef ?? null},
            ${row.transactionDate}, ${row.bankName ?? data.bankName},
            ${JSON.stringify(row)},
            ${suggestion?.lease_id ?? null},
            ${suggestion?.tenant_id ?? null},
            ${suggestion ? Math.round(suggestion.score * 100) : null}
          )
        `;
      });
      unmatched++;
      continue;
    }

    // Matched — find the open bill for this lease
    const [bill] = await withRLS(ctx(req), async (db) => {
      return db`
        SELECT id, total_due, total_amount, total_paid, status
        FROM monthly_bills
        WHERE lease_id = ${lease.id}
          AND status IN ('open','partial','overdue')
        ORDER BY due_date ASC
        LIMIT 1
      `;
    });

    if (!bill) {
      // No open rent bill — check if deposit is still owed
      const [leaseDeposit] = await withRLS(ctx(req), async (db) => {
        return db`
          SELECT id, deposit_amount, deposit_paid_amount
          FROM leases
          WHERE id = ${lease.id} AND company_id = ${companyId}
        `;
      });

      const depositOwed = leaseDeposit
        ? Math.max(0, parseFloat(leaseDeposit.deposit_amount ?? '0') - parseFloat(leaseDeposit.deposit_paid_amount ?? '0'))
        : 0;

      if (depositOwed > 0) {
        // Apply as deposit payment directly on the lease
        const depositAlloc = Math.min(row.amount, depositOwed);
        const receiptNumber = `RCP-${Date.now().toString(36).toUpperCase()}`;
        const paymentId = randomUUID();

        // Check for duplicate
        const transactionRef = row.transactionRef;
        if (transactionRef) {
          const [dup] = await withRLS(ctx(req), async (db) => {
            return db`SELECT id FROM payments WHERE company_id = ${companyId} AND bank_transaction_ref = ${transactionRef}`;
          });
          if (dup) { duplicates++; continue; }
        }

        await withRLSTransaction(ctx(req), async (tx) => {
          // Record payment with no bill_id (deposit only)
          await tx`
            INSERT INTO payments (
              id, company_id, lease_id,
              amount, channel, bank_transaction_ref, bank_name,
              bank_transaction_date, receipt_number, csv_import_batch_id,
              recorded_by, recorded_at, undo_expires_at
            ) VALUES (
              ${paymentId}, ${companyId}, ${lease.id},
              ${depositAlloc}, 'bank_transfer',
              ${row.transactionRef ?? null}, ${data.bankName},
              ${row.transactionDate}, ${receiptNumber}, ${batchId},
              ${userId}, NOW(), NOW() + INTERVAL '15 minutes'
            )
          `;
          // Update lease deposit_paid_amount
          await tx`
            UPDATE leases SET
              deposit_paid_amount = deposit_paid_amount + ${depositAlloc},
              deposit_paid_at     = COALESCE(deposit_paid_at, CURRENT_DATE),
              updated_at          = NOW()
            WHERE id = ${lease.id} AND company_id = ${companyId}
          `;
        });
        matched++;
        continue;
      }

      // No open bill and no deposit owed — goes to unmatched
      await withRLS(ctx(req), async (db) => {
        return db`
          INSERT INTO unmatched_payments (
            company_id, source, csv_import_batch_id,
            amount, payer_name, payer_reference, payer_phone,
            transaction_ref, transaction_date, bank_name, raw_row_json,
            suggested_lease_id, suggested_tenant_id, suggestion_confidence
          ) VALUES (
            ${companyId}, 'csv_import', ${batchId},
            ${row.amount}, ${row.payerName ?? null}, ${row.payerReference ?? null},
            ${row.payerPhone ?? null}, ${row.transactionRef ?? null},
            ${row.transactionDate}, ${data.bankName}, ${JSON.stringify(row)},
            ${lease.id}, null, 100
          )
        `;
      });
      unmatched++;
      continue;
    }

    // Check for duplicate bank ref
    const transactionRef = row.transactionRef;
    if (transactionRef) {
      const [dup] = await withRLS(ctx(req), async (db) => {
        return db`SELECT id FROM payments WHERE company_id = ${companyId} AND bank_transaction_ref = ${transactionRef}`;
      });
      if (dup) { duplicates++; continue; }
    }

    // Record the payment
    const receiptNumber = `RCP-${Date.now().toString(36).toUpperCase()}`;
    const paymentId     = randomUUID();
    const payAmt        = Math.min(row.amount, parseFloat(bill.total_due));
    const leftover      = row.amount - payAmt; // amount beyond what the bill needs

    await withRLSTransaction(ctx(req), async (tx) => {
      await tx`
        INSERT INTO payments (
          id, company_id, bill_id, lease_id,
          amount, channel, bank_transaction_ref, bank_name,
          bank_transaction_date, receipt_number, csv_import_batch_id,
          recorded_by, recorded_at, undo_expires_at
        ) VALUES (
          ${paymentId}, ${companyId}, ${bill.id}, ${lease.id},
          ${payAmt}, 'bank_transfer',
          ${row.transactionRef ?? null}, ${data.bankName},
          ${row.transactionDate}, ${receiptNumber}, ${batchId},
          ${userId}, NOW(), NOW() + INTERVAL '15 minutes'
        )
      `;

      const newPaid   = parseFloat(bill.total_paid) + payAmt;
      const newStatus = newPaid >= parseFloat(bill.total_amount) - 0.01 ? 'paid' : 'partial';

      await tx`
        UPDATE monthly_bills SET
          total_paid = total_paid + ${payAmt},
          status     = ${newStatus},
          updated_at = NOW()
        WHERE id = ${bill.id}
      `;

      // If there's leftover money, check if deposit is still owed and apply it
      if (leftover > 0.01) {
        const [leaseInfo] = await tx`
          SELECT deposit_amount, deposit_paid_amount
          FROM leases WHERE id = ${lease.id} AND company_id = ${companyId}
        `;
        const depositOwed = leaseInfo
          ? Math.max(0, parseFloat(leaseInfo.deposit_amount ?? '0') - parseFloat(leaseInfo.deposit_paid_amount ?? '0'))
          : 0;

        if (depositOwed > 0) {
          const depositAlloc = Math.min(leftover, depositOwed);
          await tx`
            UPDATE leases SET
              deposit_paid_amount = deposit_paid_amount + ${depositAlloc},
              deposit_paid_at     = COALESCE(deposit_paid_at, CURRENT_DATE),
              updated_at          = NOW()
            WHERE id = ${lease.id} AND company_id = ${companyId}
          `;
        }
      }
    });

    matched++;
  }

  // Update batch stats
  await withRLS(ctx(req), async (db) => {
    return db`
      UPDATE csv_import_batches SET
        matched_rows   = ${matched},
        unmatched_rows = ${unmatched},
        duplicate_rows = ${duplicates},
        status         = 'completed',
        completed_at   = NOW()
      WHERE id = ${batchId}
    `;
  });

  logger.info({ batchId, matched, unmatched, duplicates }, 'CSV import completed');
  res.json({ success: true, data: { batchId, matched, unmatched, duplicates, total: data.rows.length } } satisfies ApiResponse<unknown>);
});

// ─── POST /reconciliation/assign — assign unmatched payment to a lease ────────

reconciliationRouter.post('/assign', async (req: Request, res: Response) => {
  const { unmatchedId, leaseId } = z.object({
    unmatchedId: z.string().uuid(),
    leaseId:     z.string().uuid(),
  }).parse(req.body);

  const companyId = req.ctx.companyId!;

  await withRLSTransaction(ctx(req), async (tx) => {
    const [unmatched] = await tx`
      SELECT * FROM unmatched_payments
      WHERE id = ${unmatchedId} AND company_id = ${companyId} AND resolution = 'pending'
    `;
    if (!unmatched) throw new Error('Unmatched payment not found');

    const [bill] = await tx`
      SELECT id, total_due, total_amount, total_paid, status
      FROM monthly_bills
      WHERE lease_id = ${leaseId}
        AND company_id = ${companyId}
        AND status IN ('open','partial','overdue')
      ORDER BY due_date ASC LIMIT 1
    `;

    const receiptNumber = `RCP-${Date.now().toString(36).toUpperCase()}`;
    const paymentId     = randomUUID();

    if (!bill) {
      // No open bill — check if deposit is still owed
      const [leaseInfo] = await tx`
        SELECT deposit_amount, deposit_paid_amount
        FROM leases WHERE id = ${leaseId} AND company_id = ${companyId}
      `;
      const depositOwed = leaseInfo
        ? Math.max(0, parseFloat(leaseInfo.deposit_amount ?? '0') - parseFloat(leaseInfo.deposit_paid_amount ?? '0'))
        : 0;

      if (depositOwed <= 0) throw new Error('No open bill or outstanding deposit found for this lease');

      const depositAlloc = Math.min(parseFloat(unmatched.amount), depositOwed);

      await tx`
        INSERT INTO payments (
          id, company_id, lease_id, amount, channel,
          bank_transaction_ref, bank_name, bank_transaction_date,
          receipt_number, csv_import_batch_id,
          recorded_by, recorded_at, undo_expires_at
        ) VALUES (
          ${paymentId}, ${companyId}, ${leaseId},
          ${depositAlloc}, 'bank_transfer',
          ${unmatched.transaction_ref ?? null}, ${unmatched.bank_name ?? null},
          ${unmatched.transaction_date ?? null},
          ${receiptNumber}, ${unmatched.csv_import_batch_id ?? null},
          ${req.ctx.userId}, NOW(), NOW() + INTERVAL '15 minutes'
        )
      `;

      await tx`
        UPDATE leases SET
          deposit_paid_amount = deposit_paid_amount + ${depositAlloc},
          deposit_paid_at     = COALESCE(deposit_paid_at, CURRENT_DATE),
          updated_at          = NOW()
        WHERE id = ${leaseId} AND company_id = ${companyId}
      `;

      await tx`
        UPDATE unmatched_payments SET
          resolution          = 'assigned',
          resolved_by         = ${req.ctx.userId},
          resolved_at         = NOW(),
          resolved_payment_id = ${paymentId}
        WHERE id = ${unmatchedId}
      `;

      return;
    }

    const payAmt = Math.min(parseFloat(unmatched.amount), parseFloat(bill.total_due));

    await tx`
      INSERT INTO payments (
        id, company_id, bill_id, lease_id, amount, channel,
        bank_transaction_ref, bank_name, bank_transaction_date,
        receipt_number, csv_import_batch_id,
        recorded_by, recorded_at, undo_expires_at
      ) VALUES (
        ${paymentId}, ${companyId}, ${bill.id}, ${leaseId},
        ${payAmt}, 'bank_transfer',
        ${unmatched.transaction_ref ?? null}, ${unmatched.bank_name ?? null},
        ${unmatched.transaction_date ?? null},
        ${receiptNumber}, ${unmatched.csv_import_batch_id ?? null},
        ${req.ctx.userId}, NOW(), NOW() + INTERVAL '15 minutes'
      )
    `;

    const newPaid   = parseFloat(bill.total_paid) + payAmt;
    const newStatus = newPaid >= parseFloat(bill.total_amount) - 0.01 ? 'paid' : 'partial';

    await tx`UPDATE monthly_bills SET total_paid = total_paid + ${payAmt}, status = ${newStatus}, updated_at = NOW() WHERE id = ${bill.id}`;

    // Apply any leftover to deposit if still owed
    const leftover = parseFloat(unmatched.amount) - payAmt;
    if (leftover > 0.01) {
      const [leaseInfo] = await tx`
        SELECT deposit_amount, deposit_paid_amount
        FROM leases WHERE id = ${leaseId} AND company_id = ${companyId}
      `;
      const depositOwed = leaseInfo
        ? Math.max(0, parseFloat(leaseInfo.deposit_amount ?? '0') - parseFloat(leaseInfo.deposit_paid_amount ?? '0'))
        : 0;
      if (depositOwed > 0) {
        const depositAlloc = Math.min(leftover, depositOwed);
        await tx`
          UPDATE leases SET
            deposit_paid_amount = deposit_paid_amount + ${depositAlloc},
            deposit_paid_at     = COALESCE(deposit_paid_at, CURRENT_DATE),
            updated_at          = NOW()
          WHERE id = ${leaseId} AND company_id = ${companyId}
        `;
      }
    }

    await tx`
      UPDATE unmatched_payments SET
        resolution         = 'assigned',
        resolved_by        = ${req.ctx.userId},
        resolved_at        = NOW(),
        resolved_payment_id = ${paymentId}
      WHERE id = ${unmatchedId}
    `;
  });

  res.json({ success: true, data: { message: 'Payment assigned and recorded' } } satisfies ApiResponse<unknown>);
});