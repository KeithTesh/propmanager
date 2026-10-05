// api/src/modules/reconciliation/reconciliation.router.ts

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import type postgres from 'postgres';
import multer from 'multer';
import { withRLS, withRLSTransaction } from '../../db';
import { authenticate } from '../../middleware/auth';
import { logger } from '../../lib/logger';
import { NotFoundError, ValidationError } from '../../lib/errors';
import type { ApiResponse, RLSContext } from '../../types';
import { parseStatementFile, StatementFileError } from './statement-file';

export const reconciliationRouter = Router();
reconciliationRouter.use(authenticate);

const statementUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
});

function uploadStatementFile(req: Request, res: Response, next: NextFunction): void {
  statementUpload.single('file')(req, res, error => {
    if (error instanceof multer.MulterError) {
      const tooLarge = error.code === 'LIMIT_FILE_SIZE';
      res.status(tooLarge ? 413 : 400).json({
        success: false,
        error: {
          code: tooLarge ? 'FILE_TOO_LARGE' : 'INVALID_FILE_UPLOAD',
          message: tooLarge ? 'Files must be 10 MB or smaller.' : error.message,
        },
      });
      return;
    }
    if (error) {
      next(error);
      return;
    }
    next();
  });
}

function ctx(req: Request): RLSContext {
  return { companyId: req.ctx.companyId!, userId: req.ctx.userId, userRole: req.ctx.userRole };
}

async function applyBankPaymentToLease(
  tx: postgres.Sql,
  input: {
    companyId: string;
    userId: string;
    leaseId: string;
    amount: number;
    bankName: string;
    transactionDate: string;
    transactionRef: string | null;
    batchId: string | null;
  }
): Promise<{ applied: number; firstPaymentId: string | null }> {
  const [lease] = await tx`
    SELECT deposit_amount, deposit_paid_amount, deposit_waived_amount
    FROM leases
    WHERE id = ${input.leaseId} AND company_id = ${input.companyId}
    FOR UPDATE
  `;
  if (!lease) throw new NotFoundError('Lease', input.leaseId);

  const depositOwed = Math.max(
    0,
    parseFloat(lease.deposit_amount ?? '0') -
      parseFloat(lease.deposit_paid_amount ?? '0') -
      parseFloat(lease.deposit_waived_amount ?? '0')
  );
  let remaining = input.amount;
  let applied = 0;
  let firstPaymentId: string | null = null;
  let transactionRefAvailable = Boolean(input.transactionRef);

  const recordPayment = async (billId: string | null, allocation: number, note: string) => {
    if (allocation <= 0.01) return;
    const paymentId = randomUUID();
    const receiptNumber = `RCP-${Date.now().toString(36).toUpperCase()}-${paymentId.slice(0, 6).toUpperCase()}`;
    const paymentRef = transactionRefAvailable ? input.transactionRef : null;
    const paymentNotes = paymentRef ? note || null : [note, input.transactionRef ? `Statement ref: ${input.transactionRef}` : '']
      .filter(Boolean).join(' · ') || null;

    await tx`
      INSERT INTO payments (
        id, company_id, bill_id, lease_id, amount, channel,
        bank_transaction_ref, bank_name, bank_transaction_date,
        receipt_number, csv_import_batch_id, recorded_by,
        recorded_at, undo_expires_at, notes
      ) VALUES (
        ${paymentId}, ${input.companyId}, ${billId}, ${input.leaseId}, ${allocation}, 'bank_transfer',
        ${paymentRef}, ${input.bankName}, ${input.transactionDate},
        ${receiptNumber}, ${input.batchId}, ${input.userId},
        NOW(), NOW() + INTERVAL '15 minutes', ${paymentNotes}
      )
    `;
    transactionRefAvailable = false;
    firstPaymentId ??= paymentId;
    applied += allocation;
    remaining -= allocation;
  };

  if (depositOwed > 0 && remaining > 0.01) {
    const depositAllocation = Math.min(remaining, depositOwed);
    await recordPayment(null, depositAllocation, 'Bank reconciliation — deposit');
    await tx`
      UPDATE leases SET
        deposit_paid_amount = deposit_paid_amount + ${depositAllocation},
        deposit_paid_at = COALESCE(deposit_paid_at, CURRENT_DATE),
        updated_at = NOW()
      WHERE id = ${input.leaseId} AND company_id = ${input.companyId}
    `;
  }

  if (remaining > 0.01) {
    const bills = await tx`
      SELECT id, bill_type, total_amount, total_paid, total_due
      FROM monthly_bills
      WHERE lease_id = ${input.leaseId}
        AND company_id = ${input.companyId}
        AND status IN ('open', 'partial', 'overdue')
        AND total_due > 0
      ORDER BY CASE WHEN bill_type = 'signing' THEN 0 ELSE 1 END, due_date ASC, created_at ASC
      FOR UPDATE
    `;

    for (const bill of bills) {
      if (remaining <= 0.01) break;
      const allocation = Math.min(remaining, parseFloat(bill.total_due));
      await recordPayment(bill.id, allocation, `Bank reconciliation — ${bill.bill_type}`);
      const newPaid = parseFloat(bill.total_paid) + allocation;
      const newStatus = newPaid >= parseFloat(bill.total_amount) - 0.01 ? 'paid' : 'partial';
      await tx`
        UPDATE monthly_bills
        SET total_paid = total_paid + ${allocation},
            status = ${newStatus},
            updated_at = NOW()
        WHERE id = ${bill.id} AND company_id = ${input.companyId}
      `;
    }
  }

  return { applied, firstPaymentId };
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

reconciliationRouter.get('/assignment-leases', async (req: Request, res: Response) => {
  const { search } = z.object({ search: z.string().trim().min(2).max(100) }).parse(req.query);
  const pattern = `%${search}%`;
  const leases = await withRLS(ctx(req), async (db) => {
    return db`
      SELECT
        l.id, l.snap_account_reference,
        t.full_name AS tenant_name, t.phone AS tenant_phone,
        u.unit_number, p.name AS property_name
      FROM leases l
      JOIN tenants t ON t.id = l.primary_tenant_id AND t.company_id = ${req.ctx.companyId!}
      JOIN units u ON u.id = l.unit_id AND u.company_id = ${req.ctx.companyId!}
      JOIN properties p ON p.id = u.property_id AND p.company_id = ${req.ctx.companyId!}
      WHERE l.company_id = ${req.ctx.companyId!}
        AND l.status IN ('active', 'notice')
        AND (
          t.full_name ILIKE ${pattern}
          OR COALESCE(t.phone, '') ILIKE ${pattern}
          OR COALESCE(l.snap_account_reference, '') ILIKE ${pattern}
          OR u.unit_number ILIKE ${pattern}
          OR p.name ILIKE ${pattern}
        )
      ORDER BY t.full_name, p.name, u.unit_number
      LIMIT 25
    `;
  });
  res.json({ success: true, data: { leases } } satisfies ApiResponse<unknown>);
});

reconciliationRouter.get('/unmatched/history', async (req: Request, res: Response) => {
  const history = await withRLS(ctx(req), async (db) => {
    return db`
      SELECT
        u.id, u.amount, u.payer_name, u.transaction_ref, u.transaction_date,
        u.bank_name, u.resolution, u.resolved_at, u.resolution_notes,
        u.resolved_payment_id, t.full_name AS tenant_name,
        un.unit_number, p.name AS property_name
      FROM unmatched_payments u
      LEFT JOIN payments pay ON pay.id = u.resolved_payment_id
      LEFT JOIN leases l ON l.id = COALESCE(pay.lease_id, u.suggested_lease_id)
      LEFT JOIN tenants t ON t.id = l.primary_tenant_id
      LEFT JOIN units un ON un.id = l.unit_id
      LEFT JOIN properties p ON p.id = un.property_id
      WHERE u.resolution <> 'pending'
      ORDER BY u.resolved_at DESC NULLS LAST, u.created_at DESC
      LIMIT 100
    `;
  });
  res.json({ success: true, data: { history } } satisfies ApiResponse<unknown>);
});

reconciliationRouter.post('/unmatched/:id/dismiss', async (req: Request, res: Response) => {
  const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
  const [dismissed] = await withRLS(ctx(req), async (db) => {
    return db`
      UPDATE unmatched_payments
      SET resolution = 'dismissed',
          resolved_by = ${req.ctx.userId},
          resolved_at = NOW(),
          resolution_notes = 'Dismissed by user'
      WHERE id = ${id}
        AND company_id = ${req.ctx.companyId!}
        AND resolution = 'pending'
      RETURNING id
    `;
  });
  if (!dismissed) {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Pending unmatched transaction not found.' } });
    return;
  }
  res.json({ success: true, data: { dismissed: 1 } } satisfies ApiResponse<unknown>);
});

reconciliationRouter.post('/unmatched/dismiss-all', async (req: Request, res: Response) => {
  const dismissed = await withRLS(ctx(req), async (db) => {
    return db`
      UPDATE unmatched_payments
      SET resolution = 'dismissed',
          resolved_by = ${req.ctx.userId},
          resolved_at = NOW(),
          resolution_notes = 'Dismissed in bulk by user'
      WHERE company_id = ${req.ctx.companyId!}
        AND resolution = 'pending'
      RETURNING id
    `;
  });
  res.json({ success: true, data: { dismissed: dismissed.length } } satisfies ApiResponse<unknown>);
});

// ─── POST /reconciliation/import — process parsed statement rows ─────────────
// Body: { bankName, filename, fileHash, rows: [{date, ref, amount, payer, phone}] }

reconciliationRouter.post('/parse', uploadStatementFile, async (req: Request, res: Response) => {
  if (!req.file) {
    res.status(400).json({ success: false, error: { code: 'FILE_REQUIRED', message: 'Choose a CSV or Excel (.xlsx) file.' } });
    return;
  }

  try {
    const rows = await parseStatementFile(req.file.originalname, req.file.buffer);
    res.json({ success: true, data: { rows } } satisfies ApiResponse<unknown>);
  } catch (error) {
    if (error instanceof StatementFileError) {
      res.status(400).json({ success: false, error: { code: 'INVALID_STATEMENT_FILE', message: error.message } });
      return;
    }
    throw error;
  }
});

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
        l.id, l.snap_account_reference, t.id AS tenant_id,
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
    const transactionRef = row.transactionRef?.trim() || null;
    if (transactionRef) {
      const [duplicate] = await withRLS(ctx(req), async (db) => {
        return db`
          SELECT id FROM payments
          WHERE company_id = ${companyId}
            AND bank_transaction_ref = ${transactionRef}
        `;
      });
      if (duplicate) {
        duplicates++;
        continue;
      }
    }

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

    const allocation = await withRLSTransaction(ctx(req), tx => applyBankPaymentToLease(tx, {
      companyId,
      userId,
      leaseId: lease.id,
      amount: row.amount,
      bankName: row.bankName ?? data.bankName,
      transactionDate: row.transactionDate,
      transactionRef,
      batchId,
    }));
    if (allocation.applied > 0) matched++;

    const remaining = Math.max(0, row.amount - allocation.applied);
    if (remaining > 0.01) {
      await withRLS(ctx(req), async (db) => {
        return db`
          INSERT INTO unmatched_payments (
            company_id, source, csv_import_batch_id,
            amount, payer_name, payer_reference, payer_phone,
            transaction_ref, transaction_date, bank_name, raw_row_json,
            suggested_lease_id, suggested_tenant_id, suggestion_confidence
          ) VALUES (
            ${companyId}, 'csv_import', ${batchId},
            ${remaining}, ${row.payerName ?? null}, ${row.payerReference ?? null},
            ${row.payerPhone ?? null}, ${transactionRef},
            ${row.transactionDate}, ${row.bankName ?? data.bankName}, ${JSON.stringify(row)},
            ${lease.id}, ${lease.tenant_id}, 100
          )
        `;
      });
      unmatched++;
    }
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

  const assignment = await withRLSTransaction(ctx(req), async (tx) => {
    const [unmatched] = await tx`
      SELECT * FROM unmatched_payments
      WHERE id = ${unmatchedId} AND company_id = ${companyId} AND resolution = 'pending'
    `;
    if (!unmatched) throw new NotFoundError('Pending unmatched payment', unmatchedId);

    const [targetLease] = await tx`
      SELECT id, primary_tenant_id
      FROM leases
      WHERE id = ${leaseId}
        AND company_id = ${companyId}
        AND status IN ('active', 'notice')
    `;
    if (!targetLease) throw new NotFoundError('Active lease', leaseId);

    const allocation = await applyBankPaymentToLease(tx, {
      companyId,
      userId: req.ctx.userId,
      leaseId,
      amount: parseFloat(unmatched.amount),
      bankName: unmatched.bank_name ?? 'Bank transfer',
      transactionDate: unmatched.transaction_date,
      transactionRef: unmatched.transaction_ref,
      batchId: unmatched.csv_import_batch_id,
    });
    if (allocation.applied <= 0.01 || !allocation.firstPaymentId) {
      throw new ValidationError('The selected lease has no outstanding deposit or bill to apply this payment to.');
    }

    const remaining = Math.max(0, parseFloat(unmatched.amount) - allocation.applied);
    await tx`
      UPDATE unmatched_payments SET
        amount = ${remaining > 0.01 ? remaining : unmatched.amount},
        suggested_lease_id = ${leaseId},
        suggested_tenant_id = ${targetLease.primary_tenant_id},
        resolution = ${remaining > 0.01 ? 'pending' : 'assigned'},
        resolved_by = ${remaining > 0.01 ? null : req.ctx.userId},
        resolved_at = ${remaining > 0.01 ? null : new Date()},
        resolved_payment_id = ${remaining > 0.01 ? null : allocation.firstPaymentId},
        resolution_notes = ${remaining > 0.01 ? `KES ${allocation.applied} assigned; KES ${remaining} remains pending` : null}
      WHERE id = ${unmatchedId}
    `;
    return { applied: allocation.applied, remaining };
  });

  res.json({
    success: true,
    data: {
      ...assignment,
      message: assignment.remaining > 0.01
        ? `KES ${assignment.applied.toLocaleString()} applied to the selected lease; KES ${assignment.remaining.toLocaleString()} remains pending.`
        : 'Payment applied to the selected lease, deposit first, then outstanding bills.',
    },
  } satisfies ApiResponse<unknown>);
});