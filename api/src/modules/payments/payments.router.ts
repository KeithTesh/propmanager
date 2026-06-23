// api/src/modules/payments/payments.router.ts

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { randomUUID } from 'crypto';
import { withRLS, withRLSTransaction } from '../../db';
import { authenticate } from '../../middleware/auth';
import { NotFoundError } from '../../lib/errors';
import { logger } from '../../lib/logger';
import { auditPayment, auditPaymentUndo } from '../../lib/audit';
import { sendSms, paymentConfirmationMessage } from '../../lib/sms';
import type { ApiResponse, RLSContext } from '../../types';

export const paymentsRouter = Router();
paymentsRouter.use(authenticate);

function ctx(req: Request): RLSContext {
  return { companyId: req.ctx.companyId!, userId: req.ctx.userId, userRole: req.ctx.userRole };
}

const CHANNELS = ['mpesa_paybill','cash','bank_transfer','adjustment'] as const;

// ─── GET /payments ────────────────────────────────────────────────────────────

paymentsRouter.get('/', async (req: Request, res: Response) => {
  const { leaseId, billId, limit = '50' } = req.query as Record<string, string | undefined>;

  const payments = await withRLS(ctx(req), async (db) => {
    return db`
      SELECT
        p.*,
        t.full_name     AS tenant_name,
        u.unit_number,
        pr.name         AS property_name,
        mb.for_month,
        mb.bill_type,
        mb.total_amount AS bill_total
      FROM payments p
      JOIN leases l     ON l.id  = p.lease_id
      JOIN tenants t    ON t.id  = l.primary_tenant_id
      JOIN units u      ON u.id  = l.unit_id
      JOIN properties pr ON pr.id = u.property_id
      JOIN monthly_bills mb ON mb.id = p.bill_id
      WHERE p.company_id = ${req.ctx.companyId}
        AND p.undone_at IS NULL
        ${leaseId ? db`AND p.lease_id = ${leaseId}` : db``}
        ${billId  ? db`AND p.bill_id  = ${billId}`  : db``}
      ORDER BY p.created_at DESC
      LIMIT ${parseInt(limit as string)}
    `;
  });

  res.json({ success: true, data: { payments } } satisfies ApiResponse<unknown>);
});

// ─── GET /payments/summary ────────────────────────────────────────────────────
// MTD and overdue summary for the dashboard

paymentsRouter.get('/summary', async (req: Request, res: Response) => {
  // Flip any past-due open/partial bills to overdue on every summary fetch
  await withRLS(ctx(req), async (db) => {
    return db`
      UPDATE monthly_bills SET status = 'overdue', updated_at = NOW()
      WHERE company_id = ${req.ctx.companyId}
          AND status IN ('open', 'partial')
        AND bill_type IN ('rent', 'signing')
        AND due_date < CURRENT_DATE
    `;
  });

  const summary = await withRLS(ctx(req), async (db) => {
    const [row] = await db`
      SELECT
        -- Collected this month
        COALESCE(SUM(p.amount) FILTER (
          WHERE DATE_TRUNC('month', p.recorded_at) = DATE_TRUNC('month', NOW())
            AND p.undone_at IS NULL
        ), 0) AS collected_mtd,

        -- Total outstanding (open + partial + overdue) — GREATEST clamps overpaid bills to 0
        COALESCE((
          SELECT SUM(GREATEST(mb.total_due, 0))
          FROM monthly_bills mb
          WHERE mb.company_id = ${req.ctx.companyId}
          AND mb.status IN ('open','partial','overdue')
        ), 0) AS total_outstanding,

        -- Overdue count — only count bills with actual money still owed
        (
          SELECT COUNT(*)
          FROM monthly_bills mb
          WHERE mb.status IN ('open','partial','overdue')
            AND mb.total_due > 0
            AND mb.due_date < CURRENT_DATE
        ) AS overdue_count,

        -- Total paid all time
        COALESCE(SUM(p.amount) FILTER (WHERE p.undone_at IS NULL), 0) AS total_collected

      FROM payments p
    `;
    return row;
  });

  res.json({ success: true, data: { summary } } satisfies ApiResponse<unknown>);
});

// ─── GET /bills — list bills (for payments page) ──────────────────────────────

paymentsRouter.get('/bills', async (req: Request, res: Response) => {
  const { status, leaseId } = req.query as Record<string, string | undefined>;

  const bills = await withRLS(ctx(req), async (db) => {
    return db`
      SELECT
        mb.*,
        t.full_name   AS tenant_name,
        t.phone       AS tenant_phone,
        u.unit_number,
        p.name        AS property_name,
        l.monthly_rent
      FROM monthly_bills mb
      JOIN leases l     ON l.id  = mb.lease_id
      JOIN tenants t    ON t.id  = l.primary_tenant_id
      JOIN units u      ON u.id  = mb.unit_id
      JOIN properties p ON p.id  = u.property_id
      WHERE p.company_id = ${req.ctx.companyId}
                ${status   ? db`AND mb.status   = ${status}`   : db`AND mb.status IN ('open','partial','overdue')`}
        ${leaseId  ? db`AND mb.lease_id = ${leaseId}`  : db``}
      ORDER BY mb.due_date ASC, mb.created_at DESC
      LIMIT 200
    `;
  });

  res.json({ success: true, data: { bills } } satisfies ApiResponse<unknown>);
});

// ─── POST /payments ───────────────────────────────────────────────────────────

const RecordPaymentSchema = z.object({
  billId:             z.string().uuid(),
  depositAmount:      z.number().min(0).optional(), // extra amount to allocate to deposit
  amount:             z.number().positive(),
  channel:            z.enum(CHANNELS),
  mpesaReceiptNumber: z.string().optional().nullable(),
  mpesaPhone:         z.string().optional().nullable(),
  bankTransactionRef: z.string().optional().nullable(),
  bankName:           z.string().optional().nullable(),
  bankTransactionDate:z.string().optional().nullable(),
  notes:              z.string().optional().nullable(),
  recordedAt:         z.string().optional(),
});

paymentsRouter.post('/', async (req: Request, res: Response) => {
  const data      = RecordPaymentSchema.parse(req.body);
  const id        = randomUUID();
  const companyId = req.ctx.companyId!;
  const userId    = req.ctx.userId;

  await withRLSTransaction(ctx(req), async (tx) => {
    // 1. Fetch the bill — FOR UPDATE prevents race condition on simultaneous payments
    const [bill] = await tx`
      SELECT id, lease_id, total_amount, total_paid, total_due, status
      FROM monthly_bills
      WHERE id = ${data.billId} AND company_id = ${req.ctx.companyId} AND status NOT IN ('paid','waived','void')
      FOR UPDATE
    `;
    if (!bill) throw new Error('Bill not found or already fully paid');

    // 2. Validate amount doesn't exceed what's due
    const totalDue = parseFloat(bill.total_due);
    const depositAlloc = data.depositAmount ?? 0;
    const rentAlloc    = data.amount - depositAlloc;

    if (rentAlloc > totalDue + 0.01) {
      res.status(400).json({
        success: false,
        error: {
          code: 'OVERPAYMENT',
          message: `Rent portion KES ${rentAlloc.toLocaleString()} exceeds outstanding balance of KES ${totalDue.toLocaleString()}.`,
        },
      });
      return;
    }

    // 3. Insert payment
    const receiptNumber = `RCP-${Date.now().toString(36).toUpperCase()}`;
    await tx`
      INSERT INTO payments (
        id, company_id, bill_id, lease_id,
        amount, channel,  -- total amount received (rent + deposit combined if split)
        mpesa_receipt_number, mpesa_phone,
        bank_transaction_ref, bank_name, bank_transaction_date,
        notes, receipt_number,
        recorded_by, recorded_at,
        undo_expires_at
      ) VALUES (
        ${id}, ${companyId}, ${data.billId}, ${bill.lease_id},
        ${data.amount}, ${data.channel},
        ${data.mpesaReceiptNumber ?? null}, ${data.mpesaPhone ?? null},
        ${data.bankTransactionRef ?? null}, ${data.bankName ?? null},
        ${data.bankTransactionDate ?? null},
        ${data.notes ?? null}, ${receiptNumber},
        ${userId}, ${data.recordedAt ?? new Date().toISOString()},
        NOW() + INTERVAL '15 minutes'
      )
    `;

    // 4. Update bill total_paid atomically
    const newTotalPaid = parseFloat(bill.total_paid) + rentAlloc;
    const newStatus    = newTotalPaid >= parseFloat(bill.total_amount) - 0.01
      ? 'paid'
      : 'partial';

    await tx`
      UPDATE monthly_bills SET
        total_paid = total_paid + ${rentAlloc},
        status     = ${newStatus},
        updated_at = NOW()
      WHERE id = ${data.billId} AND company_id = ${req.ctx.companyId}
    `;

    // 5. If deposit portion provided, record it on the lease too
    if (depositAlloc > 0) {
      await tx`
        UPDATE leases SET
          deposit_paid_amount = deposit_paid_amount + ${depositAlloc},
          deposit_paid_at     = COALESCE(deposit_paid_at, CURRENT_DATE),
          updated_at          = NOW()
        WHERE id = ${bill.lease_id}
      `;
      logger.info({ leaseId: bill.lease_id, depositAlloc }, 'Deposit portion recorded');
    }

    logger.info({ paymentId: id, billId: data.billId, amount: data.amount, depositAlloc, newStatus }, 'Payment recorded');
    await auditPayment({
      companyId: companyId!, paymentId: id, leaseId: bill.lease_id,
      billId: data.billId, amount: data.amount, channel: data.channel,
      actorId: userId, actorRole: req.ctx.userRole,
      ipAddress: req.ip, userAgent: req.headers['user-agent'],
    });

    // Send payment confirmation SMS (fire-and-forget)
    const [tenantInfo] = await tx`
      SELECT t.full_name, t.phone, t.notify_sms, mb.for_month
      FROM monthly_bills mb
      JOIN leases l  ON l.id = mb.lease_id
      JOIN tenants t ON t.id = l.primary_tenant_id
      WHERE mb.id = ${data.billId}
    `;
    if (tenantInfo?.phone && (tenantInfo?.notify_sms)) {
      const msg = paymentConfirmationMessage({
        tenantName: tenantInfo.full_name,
        amount: data.amount,
        forMonth: tenantInfo.for_month,
        receiptNumber,
      });
      sendSms(tenantInfo.phone, msg).catch(err =>
        logger.warn({ err }, 'Payment SMS failed silently')
      );
    }
  });

  res.status(201).json({ success: true, data: { payment: { id } } } satisfies ApiResponse<unknown>);
});

// ─── POST /payments/:id/undo ──────────────────────────────────────────────────

paymentsRouter.post('/:id/undo', async (req: Request, res: Response) => {
  const { id } = req.params;

  await withRLSTransaction(ctx(req), async (tx) => {
    const [payment] = await tx`
      SELECT id, bill_id, amount, undo_expires_at, undone_at
      FROM payments
      WHERE id = ${id} AND company_id = ${req.ctx.companyId}
    `;
    if (!payment)         throw new NotFoundError('Payment not found');
    if (payment.undone_at) throw new Error('Payment has already been undone');
    if (new Date() > new Date(payment.undo_expires_at)) {
      throw new Error('Undo window has expired (15 minutes after recording)');
    }

    // Mark payment as undone
    await tx`
      UPDATE payments SET
        undone_at  = NOW(),
        undone_by  = ${req.ctx.userId},
        updated_at = NOW()
      WHERE id = ${id}
    `;

    // Reverse the bill total_paid and recalculate status
    const [bill] = await tx`
      SELECT total_amount, total_paid, due_date FROM monthly_bills WHERE id = ${payment.bill_id} AND company_id = ${req.ctx.companyId}
    `;
    const undoToday    = new Date().toISOString().slice(0, 10);
    const isPastDue    = new Date(bill.due_date).toISOString().slice(0, 10) < undoToday;
    const newTotalPaid = Math.max(0, parseFloat(bill.total_paid) - parseFloat(payment.amount));
    const newStatus    = newTotalPaid >= parseFloat(bill.total_amount) - 0.01 ? 'paid'
      : newTotalPaid > 0 ? 'partial'
      : isPastDue ? 'overdue'
      : 'open';

    await tx`
      UPDATE monthly_bills SET
        total_paid = ${newTotalPaid},
        status     = ${newStatus},
        updated_at = NOW()
      WHERE id = ${payment.bill_id} AND company_id = ${req.ctx.companyId}
    `;

    logger.info({ paymentId: id }, 'Payment undone');
    await auditPaymentUndo({
      companyId: req.ctx.companyId!, paymentId: id,
      amount: parseFloat(payment.amount),
      actorId: req.ctx.userId, actorRole: req.ctx.userRole,
      ipAddress: req.ip,
    });
  });

  res.json({ success: true, data: { message: 'Payment undone' } } satisfies ApiResponse<unknown>);
});