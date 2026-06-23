// api/src/modules/expenses/expenses.router.ts

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { withRLS } from '../../db';
import { authenticate } from '../../middleware/auth';
import { getPropertyFilter } from '../../middleware/caretaker';
import { logger } from '../../lib/logger';
import { auditExpenseCharged } from '../../lib/audit';
import type { ApiResponse, RLSContext } from '../../types';

export const expensesRouter = Router();
expensesRouter.use(authenticate);

function ctx(req: Request): RLSContext {
  return { companyId: req.ctx.companyId!, userId: req.ctx.userId, userRole: req.ctx.userRole };
}

export const EXPENSE_CATEGORIES = [
  'maintenance', 'utilities', 'staff', 'insurance',
  'cleaning', 'security', 'admin', 'legal', 'tax', 'other'
] as const;

// ─── GET /expenses ────────────────────────────────────────────────────────────

expensesRouter.get('/', async (req: Request, res: Response) => {
  const { property_id, category, from, to, limit = '50', offset = '0' } = req.query;
  const propFilter = getPropertyFilter(req);

  const expenses = await withRLS(ctx(req), async (db) => db`
    SELECT
      e.*,
      p.name        AS property_name,
      u.unit_number AS unit_number,
      ru.full_name  AS recorded_by_name
    FROM expenses e
    LEFT JOIN properties p  ON p.id = e.property_id
    LEFT JOIN units u        ON u.id = e.unit_id
    LEFT JOIN users ru       ON ru.id = e.recorded_by
    WHERE e.company_id = ${ctx(req).companyId}
      ${propFilter ? db`AND (e.property_id = ANY(${propFilter as any}) OR e.property_id IS NULL)` : db``}
      ${property_id ? db`AND e.property_id = ${property_id}` : db``}
      ${category    ? db`AND e.category    = ${category}`    : db``}
      ${from        ? db`AND e.expense_date >= ${from}::DATE` : db``}
      ${to          ? db`AND e.expense_date <= ${to}::DATE`   : db``}
    ORDER BY e.expense_date DESC, e.created_at DESC
    LIMIT ${parseInt(limit as string)}
    OFFSET ${parseInt(offset as string)}
  `);

  // Summary totals for the filtered set
  const [totals] = await withRLS(ctx(req), async (db) => db`
    SELECT
      COUNT(*)                                     AS total_count,
      COALESCE(SUM(amount), 0)                     AS total_amount,
      COALESCE(SUM(amount) FILTER (WHERE expense_date >= DATE_TRUNC('month', NOW())), 0) AS amount_mtd
    FROM expenses e
    WHERE e.company_id = ${ctx(req).companyId}
      ${propFilter ? db`AND (e.property_id = ANY(${propFilter as any}) OR e.property_id IS NULL)` : db``}
      ${property_id ? db`AND e.property_id = ${property_id}` : db``}
      ${category    ? db`AND e.category    = ${category}`    : db``}
      ${from        ? db`AND e.expense_date >= ${from}::DATE` : db``}
      ${to          ? db`AND e.expense_date <= ${to}::DATE`   : db``}
  `);

  res.json({ success: true, data: { expenses, totals } } satisfies ApiResponse<unknown>);
});

// ─── GET /expenses/summary — category breakdown ───────────────────────────────

expensesRouter.get('/summary', async (req: Request, res: Response) => {
  const { from, to } = req.query;
  const c = ctx(req);

  const fromDate = from ?? new Date(new Date().getFullYear(), 0, 1).toISOString().slice(0, 10);
  const toDate   = to   ?? new Date().toISOString().slice(0, 10);

  const breakdown = await withRLS(c, async (db) => db`
    SELECT
      category,
      COUNT(*)                  AS count,
      COALESCE(SUM(amount), 0)  AS total
    FROM expenses
    WHERE company_id   = ${c.companyId}
      AND expense_date BETWEEN ${fromDate}::DATE AND ${toDate}::DATE
    GROUP BY category
    ORDER BY total DESC
  `);

  const [{ grand_total }] = await withRLS(c, async (db) => db`
    SELECT COALESCE(SUM(amount), 0) AS grand_total
    FROM expenses
    WHERE company_id   = ${c.companyId}
      AND expense_date BETWEEN ${fromDate}::DATE AND ${toDate}::DATE
  `);

  res.json({ success: true, data: { breakdown, grand_total, fromDate, toDate } } satisfies ApiResponse<unknown>);
});

// ─── POST /expenses ───────────────────────────────────────────────────────────

const CreateSchema = z.object({
  property_id:          z.string().uuid().optional().nullable(),
  unit_id:              z.string().uuid().optional().nullable(),
  maintenance_id:       z.string().uuid().optional().nullable(),
  category:             z.enum(EXPENSE_CATEGORIES),
  description:          z.string().min(1).max(500),
  amount:               z.number().positive(),
  expense_date:         z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  paid_by:              z.string().optional().nullable(),
  vendor_name:          z.string().optional().nullable(),
  receipt_url:          z.string().url().optional().nullable(),
  is_tenant_chargeable: z.boolean().default(false),
});

expensesRouter.post('/', async (req: Request, res: Response) => {
  const data = CreateSchema.parse(req.body);
  const c    = ctx(req);

  const [expense] = await withRLS(c, async (db) => db`
    INSERT INTO expenses (
      company_id, property_id, unit_id, maintenance_id,
      category, description, amount, expense_date,
      paid_by, vendor_name, receipt_url,
      is_tenant_chargeable, recorded_by
    ) VALUES (
      ${c.companyId},
      ${data.property_id ?? null}, ${data.unit_id ?? null}, ${data.maintenance_id ?? null},
      ${data.category}, ${data.description}, ${data.amount}, ${data.expense_date}::DATE,
      ${data.paid_by ?? null}, ${data.vendor_name ?? null}, ${data.receipt_url ?? null},
      ${data.is_tenant_chargeable}, ${c.userId ?? null}
    )
    RETURNING *
  `);

  logger.info({ expenseId: expense.id, amount: data.amount, category: data.category }, 'Expense recorded');
  res.status(201).json({ success: true, data: { expense } } satisfies ApiResponse<unknown>);
});

// ─── PATCH /expenses/:id ──────────────────────────────────────────────────────

const UpdateSchema = CreateSchema.partial();

expensesRouter.patch('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;
  const data    = UpdateSchema.parse(req.body);
  const c       = ctx(req);

  const fields: Record<string, unknown> = {};
  if (data.property_id   !== undefined) fields.property_id   = data.property_id;
  if (data.unit_id       !== undefined) fields.unit_id       = data.unit_id;
  if (data.category      !== undefined) fields.category      = data.category;
  if (data.description   !== undefined) fields.description   = data.description;
  if (data.amount        !== undefined) fields.amount        = data.amount;
  if (data.expense_date  !== undefined) fields.expense_date  = data.expense_date;
  if (data.paid_by       !== undefined) fields.paid_by       = data.paid_by;
  if (data.vendor_name   !== undefined) fields.vendor_name   = data.vendor_name;
  if (data.receipt_url   !== undefined) fields.receipt_url   = data.receipt_url;
  if (data.is_tenant_chargeable !== undefined) fields.is_tenant_chargeable = data.is_tenant_chargeable;

  if (Object.keys(fields).length === 0) {
    res.status(400).json({ success: false, error: { code: 'NO_FIELDS', message: 'No fields to update' } });
    return;
  }

  const [updated] = await withRLS(c, async (db) => db`
    UPDATE expenses SET
      ${db(fields)},
      updated_at = NOW()
    WHERE id = ${id}
    RETURNING *
  `);

  if (!updated) {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Expense not found' } });
    return;
  }

  res.json({ success: true, data: { expense: updated } } satisfies ApiResponse<unknown>);
});

// ─── DELETE /expenses/:id ─────────────────────────────────────────────────────

expensesRouter.delete('/:id', async (req: Request, res: Response) => {
  const { id } = req.params;

  const [deleted] = await withRLS(ctx(req), async (db) => db`
    DELETE FROM expenses WHERE id = ${id} RETURNING id
  `);

  if (!deleted) {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Expense not found' } });
    return;
  }

  res.json({ success: true, data: { message: 'Expense deleted' } } satisfies ApiResponse<unknown>);
});

// ─── POST /expenses/:id/charge-to-tenant ─────────────────────────────────────
// Adds charge to the tenant's existing RENT bill for the month (not a new bill).
// Each charge is stored as a pending_bill_item with a description so tenant
// can see exactly what they're paying for.
//
// charge_mode: 'single' → add to rent bill for the unit on the expense
// charge_mode: 'split'  → divide amount equally across all occupied units in property
// charge_mode: 'each'   → charge full amount to every occupied unit in property

const ChargeSchema = z.object({
  charge_mode:  z.enum(['single', 'split', 'each']),
  for_month:    z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  description:  z.string().optional(),
});

expensesRouter.post('/:id/charge-to-tenant', async (req: Request, res: Response) => {
  const { id }  = req.params;
  const data     = ChargeSchema.parse(req.body);
  const c        = ctx(req);

  // 1. Load expense
  const [expense] = await withRLS(c, async (db) => db`
    SELECT e.*, p.name AS property_name
    FROM expenses e
    LEFT JOIN properties p ON p.id = e.property_id
    WHERE e.id = ${id}
  `);

  if (!expense) {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Expense not found' } });
    return;
  }

  // 2. Resolve target leases
  let targetLeases: { lease_id: string; unit_id: string }[] = [];

  if (data.charge_mode === 'single') {
    if (!expense.unit_id) {
      res.status(400).json({ success: false, error: { code: 'NO_UNIT', message: 'Set a specific unit on the expense first.' } });
      return;
    }
    const rows = await withRLS(c, async (db) => db`
      SELECT id AS lease_id, unit_id FROM leases
      WHERE unit_id = ${expense.unit_id} AND status IN ('active','notice') LIMIT 1
    `);
    targetLeases = rows as typeof targetLeases;
  } else {
    if (!expense.property_id) {
      res.status(400).json({ success: false, error: { code: 'NO_PROPERTY', message: 'Set a property on the expense first.' } });
      return;
    }
    const rows = await withRLS(c, async (db) => db`
      SELECT l.id AS lease_id, l.unit_id
      FROM leases l JOIN units u ON u.id = l.unit_id
      WHERE u.property_id = ${expense.property_id} AND l.status IN ('active','notice')
    `);
    targetLeases = rows as typeof targetLeases;
  }

  if (targetLeases.length === 0) {
    res.status(400).json({ success: false, error: { code: 'NO_ACTIVE_LEASES', message: 'No active leases found.' } });
    return;
  }

  const totalAmount   = Number(expense.amount);
  const perUnitAmount = data.charge_mode === 'split'
    ? Math.ceil(totalAmount / targetLeases.length)
    : totalAmount;

  const chargeDesc = data.description
    || `${expense.category.charAt(0).toUpperCase() + expense.category.slice(1)} — ${expense.description}`;

  let firstBillId: string | null = null;
  let charged = 0;

  for (const lease of targetLeases) {
    try {
      // Find the rent bill for this lease in the given month
      const [rentBill] = await withRLS(c, async (db) => db`
        SELECT id, status FROM monthly_bills
        WHERE lease_id = ${lease.lease_id}
          AND TO_CHAR(for_month, 'YYYY-MM') = ${data.for_month.slice(0, 7)}
          AND bill_type = 'rent'
        LIMIT 1
      `);

      if (!rentBill) {
        logger.warn({ leaseId: lease.lease_id, forMonth: data.for_month }, 'No rent bill found for month — skipping');
        continue;
      }

      // Add to the rent bill's adjustment_amount
      await withRLS(c, async (db) => db`
        UPDATE monthly_bills SET
          adjustment_amount = adjustment_amount + ${perUnitAmount},
          status = CASE WHEN status = 'paid' THEN 'open' ELSE status END,
          updated_at = NOW()
        WHERE id = ${rentBill.id}
      `);

      // Record the line item with description so tenant can see breakdown
      await withRLS(c, async (db) => db`
        INSERT INTO pending_bill_items (
          bill_id, company_id, item_type, amount, description, created_by, applied_at, apply_status
        ) VALUES (
          ${rentBill.id}, ${c.companyId}, 'adjustment', ${perUnitAmount},
          ${chargeDesc}, ${c.userId!}, NOW(), 'applied'
        )
      `);

      if (!firstBillId) firstBillId = rentBill.id;
      charged++;
    } catch (err) {
      logger.error({ err, leaseId: lease.lease_id }, 'Failed to charge tenant');
    }
  }

  if (charged === 0) {
    res.status(400).json({ success: false, error: { code: 'NO_BILLS', message: 'No rent bills found for the selected month. Generate bills first.' } });
    return;
  }

  // Mark expense as charged
  await withRLS(c, async (db) => db`
    UPDATE expenses SET charged_to_bill_id = ${firstBillId}, updated_at = NOW()
    WHERE id = ${id}
  `);

  logger.info({ expenseId: id, chargeMode: data.charge_mode, charged, perUnitAmount }, 'Expense charged');
  if (firstBillId) await auditExpenseCharged({ companyId: c.companyId, expenseId: id, billId: firstBillId, amount: perUnitAmount * charged, chargeMode: data.charge_mode, actorId: c.userId, actorRole: req.ctx.userRole });

  res.json({
    success: true,
    data: {
      charged,
      per_unit_amount: perUnitAmount,
      total_charged: perUnitAmount * charged,
      charge_mode: data.charge_mode,
      message: data.charge_mode === 'split'
        ? `KES ${perUnitAmount.toLocaleString()} added to each of ${charged} tenant(s)' rent bill (split from KES ${totalAmount.toLocaleString()})`
        : `KES ${perUnitAmount.toLocaleString()} added to ${charged} tenant(s)' rent bill`,
    }
  });
});

// Caretaker-scoped expense router (same routes, caretaker middleware applied at server level)
export const caretakerExpenseRouter = expensesRouter;