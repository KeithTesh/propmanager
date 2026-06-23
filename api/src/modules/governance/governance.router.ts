// api/src/modules/governance/governance.router.ts
//
// Financial Governance endpoints:
//  EXPENSES   POST /governance/expenses/:id/approve
//             POST /governance/expenses/:id/reject
//             GET  /governance/expenses/pending
//  PAYMENTS   POST /governance/payments/:id/reverse
//             GET  /governance/payments/reversed
//  PERIODS    GET  /governance/periods
//             POST /governance/periods        (open a period)
//             POST /governance/periods/:id/close
//             POST /governance/periods/:id/lock
//             POST /governance/periods/:id/force-close
//             GET  /governance/periods/:id/pre-close-check
//  SETTINGS   GET  /governance/settings
//             PATCH /governance/settings

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { withRLS, RLSContext } from '../../db';
import { authenticate, requireRole } from '../../middleware/auth';
import { alertExpenseReviewed, alertPaymentReversed, alertPayrollRunCreated, alertPayrollApproved, alertPayrollPaid } from '../../lib/alerts';
import type { ApiResponse } from '../../types';

export const governanceRouter = Router();
governanceRouter.use(authenticate);

function ctx(req: Request): RLSContext {
  return { companyId: req.ctx.companyId!, userId: req.ctx.userId, userRole: req.ctx.userRole };
}

// ─── GOVERNANCE SETTINGS ──────────────────────────────────────────────────────

// GET /governance/settings — returns expense_approval_threshold
governanceRouter.get('/settings', requireRole('owner', 'finance'), async (req: Request, res: Response) => {
  const [company] = await withRLS(ctx(req), async (db) => db`
    SELECT expense_approval_threshold
    FROM companies
    WHERE id = ${ctx(req).companyId}
  `);
  res.json({ success: true, data: company } satisfies ApiResponse);
});

// PATCH /governance/settings
governanceRouter.patch('/settings', requireRole('owner'), async (req: Request, res: Response) => {
  const { expense_approval_threshold } = z.object({
    expense_approval_threshold: z.number().positive().nullable(),
  }).parse(req.body);

  const [company] = await withRLS(ctx(req), async (db) => db`
    UPDATE companies
    SET expense_approval_threshold = ${expense_approval_threshold},
        updated_at = NOW()
    WHERE id = ${ctx(req).companyId}
    RETURNING expense_approval_threshold
  `);
  res.json({ success: true, data: company } satisfies ApiResponse);
});

// ─── EXPENSE APPROVAL ─────────────────────────────────────────────────────────

// GET /governance/expenses/pending
governanceRouter.get('/expenses/pending', requireRole('owner', 'finance'), async (req: Request, res: Response) => {
  const expenses = await withRLS(ctx(req), async (db) => db`
    SELECT e.*,
      p.name AS property_name,
      u.full_name AS submitted_by_name
    FROM expenses e
    LEFT JOIN properties p ON p.id = e.property_id
    LEFT JOIN users u ON u.id = e.submitted_by
    WHERE e.company_id = ${ctx(req).companyId}
      AND e.approval_status = 'pending'
    ORDER BY e.created_at ASC
  `);
  res.json({ success: true, data: expenses } satisfies ApiResponse);
});

// POST /governance/expenses/:id/approve
governanceRouter.post('/expenses/:id/approve', requireRole('owner', 'finance'), async (req: Request, res: Response) => {
  const { notes } = z.object({ notes: z.string().optional() }).parse(req.body);

  const [expense] = await withRLS(ctx(req), async (db) => db`
    SELECT * FROM expenses
    WHERE id = ${req.params.id} AND company_id = ${ctx(req).companyId}
  `);
  if (!expense) return res.status(404).json({ success: false, error: 'Expense not found' });
  if (expense.approval_status !== 'pending') {
    return res.status(400).json({ success: false, error: `Expense is already ${expense.approval_status}` });
  }
  // Self-approval guard: submitter cannot approve their own expense (unless owner)
  if (expense.submitted_by === ctx(req).userId && ctx(req).userRole !== 'owner') {
    return res.status(403).json({ success: false, error: 'You cannot approve an expense you submitted' });
  }

  const [updated] = await withRLS(ctx(req), async (db) => db`
    UPDATE expenses SET
      approval_status = 'approved',
      approved_by     = ${ctx(req).userId},
      approved_at     = NOW(),
      approval_notes  = ${notes ?? null},
      updated_at      = NOW()
    WHERE id = ${req.params.id} AND company_id = ${ctx(req).companyId}
    RETURNING *
  `);

  // Alert submitter — non-blocking
  if (expense.submitted_by) {
    alertExpenseReviewed(ctx(req), {
      submittedById: expense.submitted_by,
      description: expense.description,
      amount: Number(expense.amount),
      status: 'approved',
    }).catch(() => {});
  }

  res.json({ success: true, data: updated } satisfies ApiResponse);
});

// POST /governance/expenses/:id/reject
governanceRouter.post('/expenses/:id/reject', requireRole('owner', 'finance'), async (req: Request, res: Response) => {
  const { reason } = z.object({ reason: z.string().min(3) }).parse(req.body);

  const [expense] = await withRLS(ctx(req), async (db) => db`
    SELECT * FROM expenses WHERE id = ${req.params.id} AND company_id = ${ctx(req).companyId}
  `);
  if (!expense) return res.status(404).json({ success: false, error: 'Expense not found' });
  if (expense.approval_status !== 'pending') {
    return res.status(400).json({ success: false, error: `Expense is already ${expense.approval_status}` });
  }

  const [updated] = await withRLS(ctx(req), async (db) => db`
    UPDATE expenses SET
      approval_status = 'rejected',
      rejected_by     = ${ctx(req).userId},
      rejected_at     = NOW(),
      approval_notes  = ${reason},
      updated_at      = NOW()
    WHERE id = ${req.params.id} AND company_id = ${ctx(req).companyId}
    RETURNING *
  `);

  if (expense.submitted_by) {
    alertExpenseReviewed(ctx(req), {
      submittedById: expense.submitted_by,
      description: expense.description,
      amount: Number(expense.amount),
      status: 'rejected',
    }).catch(() => {});
  }

  res.json({ success: true, data: updated } satisfies ApiResponse);
});

// ─── PAYMENT REVERSAL ─────────────────────────────────────────────────────────

// GET /governance/payments/reversed  — audit view of all reversals
governanceRouter.get('/payments/reversed', requireRole('owner', 'finance'), async (req: Request, res: Response) => {
  const reversed = await withRLS(ctx(req), async (db) => db`
    SELECT p.*,
      rb.full_name AS reversed_by_name,
      b.for_month,
      l.unit_id,
      u.unit_number,
      pr.name AS property_name
    FROM payments p
    LEFT JOIN users rb ON rb.id = p.reversed_by
    LEFT JOIN monthly_bills b ON b.id = p.bill_id
    LEFT JOIN leases l ON l.id = p.lease_id
    LEFT JOIN units u ON u.id = l.unit_id
    LEFT JOIN properties pr ON pr.id = u.property_id
    WHERE p.company_id = ${ctx(req).companyId}
      AND p.is_reversed = TRUE
    ORDER BY p.reversed_at DESC
    LIMIT 100
  `);
  res.json({ success: true, data: reversed } satisfies ApiResponse);
});

// POST /governance/payments/:id/reverse
governanceRouter.post('/payments/:id/reverse', requireRole('owner', 'finance'), async (req: Request, res: Response) => {
  const { reason } = z.object({ reason: z.string().min(5, 'Reason must be at least 5 characters') }).parse(req.body);

  const [payment] = await withRLS(ctx(req), async (db) => db`
    SELECT p.*, b.for_month, b.status AS bill_status
    FROM payments p
    JOIN monthly_bills b ON b.id = p.bill_id
    WHERE p.id = ${req.params.id} AND p.company_id = ${ctx(req).companyId}
  `);
  if (!payment) return res.status(404).json({ success: false, error: 'Payment not found' });
  if (payment.is_reversed) return res.status(400).json({ success: false, error: 'Payment already reversed' });
  if (payment.undone_at) return res.status(400).json({ success: false, error: 'Payment was already undone' });

  // Check period not locked for the payment's month
  const paymentMonth = payment.for_month
    ? new Date(payment.for_month).toISOString().slice(0, 7) + '-01'
    : new Date(payment.created_at).toISOString().slice(0, 7) + '-01';

  const [period] = await withRLS(ctx(req), async (db) => db`
    SELECT status FROM financial_periods
    WHERE company_id = ${ctx(req).companyId} AND period_month = ${paymentMonth}
  `);
  if (period?.status === 'locked') {
    return res.status(400).json({ success: false, error: 'Cannot reverse a payment in a locked financial period' });
  }

  await withRLS(ctx(req), async (db) => {
    return db.begin(async (sql: any) => {
      // Mark original payment reversed
      await sql`
        UPDATE payments SET
          is_reversed    = TRUE,
          reversal_reason = ${reason},
          reversed_by    = ${ctx(req).userId},
          reversed_at    = NOW(),
          updated_at     = NOW()
        WHERE id = ${req.params.id}
      `;

      // Re-open the bill so tenant owes again
      await sql`
        UPDATE monthly_bills SET
          status     = 'open',
          updated_at = NOW()
        WHERE id = ${payment.bill_id}
          AND status IN ('paid', 'partial')
      `;
    });
  });

  res.json({ success: true, data: { reversed: true, reason, payment_id: req.params.id } } satisfies ApiResponse);

  // Alert finance — non-blocking
  alertPaymentReversed(ctx(req), {
    tenantName: (payment as any).tenant_name ?? 'Unknown tenant',
    amount: Number(payment.amount),
    reason,
  }).catch(() => {});
});

// ─── FINANCIAL PERIODS ────────────────────────────────────────────────────────

// GET /governance/periods
governanceRouter.get('/periods', requireRole('owner', 'finance', 'manager'), async (req: Request, res: Response) => {
  const periods = await withRLS(ctx(req), async (db) => db`
    SELECT fp.*,
      cb.full_name AS closed_by_name,
      lb.full_name AS locked_by_name
    FROM financial_periods fp
    LEFT JOIN users cb ON cb.id = fp.closed_by
    LEFT JOIN users lb ON lb.id = fp.locked_by
    WHERE fp.company_id = ${ctx(req).companyId}
    ORDER BY fp.period_month DESC
    LIMIT 24
  `);
  res.json({ success: true, data: periods } satisfies ApiResponse);
});

// POST /governance/periods  — open a new period explicitly
governanceRouter.post('/periods', requireRole('owner', 'finance'), async (req: Request, res: Response) => {
  const { period_month } = z.object({ period_month: z.string() }).parse(req.body);
  const monthDate = period_month.slice(0, 7) + '-01';

  const [existing] = await withRLS(ctx(req), async (db) => db`
    SELECT id FROM financial_periods
    WHERE company_id = ${ctx(req).companyId} AND period_month = ${monthDate}
  `);
  if (existing) return res.status(409).json({ success: false, error: 'Period already exists for this month' });

  const [period] = await withRLS(ctx(req), async (db) => db`
    INSERT INTO financial_periods (company_id, period_month, status)
    VALUES (${ctx(req).companyId}, ${monthDate}, 'open')
    RETURNING *
  `);
  res.status(201).json({ success: true, data: period } satisfies ApiResponse);
});

// GET /governance/periods/:id/pre-close-check  — run checks before closing
governanceRouter.get('/periods/:id/pre-close-check', requireRole('owner', 'finance'), async (req: Request, res: Response) => {
  const [period] = await withRLS(ctx(req), async (db) => db`
    SELECT * FROM financial_periods WHERE id = ${req.params.id} AND company_id = ${ctx(req).companyId}
  `);
  if (!period) return res.status(404).json({ success: false, error: 'Period not found' });

  const monthStart = new Date(period.period_month).toISOString().slice(0, 10); // ensure YYYY-MM-DD
  const [sy, sm] = monthStart.split('-').map(Number);
  const nextMonth = sm === 12 ? `${sy + 1}-01-01` : `${sy}-${String(sm + 1).padStart(2, '0')}-01`;
  const monthEnd = nextMonth;

  // Check 1: unmatched payments this month
  const [unmatchedRow] = await withRLS(ctx(req), async (db) => db`
    SELECT COUNT(*) AS count FROM unmatched_payments
    WHERE company_id = ${ctx(req).companyId}
      AND created_at >= ${monthStart} AND created_at < ${monthEnd}
      AND resolved_at IS NULL
  `);

  // Check 2: bills still open/overdue (not paid, not waived) this month
  const [openBillsRow] = await withRLS(ctx(req), async (db) => db`
    SELECT COUNT(*) AS count FROM monthly_bills
    WHERE company_id = ${ctx(req).companyId}
      AND for_month >= ${monthStart} AND for_month < ${monthEnd}
      AND status IN ('open', 'overdue')
  `);

  // Check 3: pending expense approvals
  const [pendingExpRow] = await withRLS(ctx(req), async (db) => db`
    SELECT COUNT(*) AS count FROM expenses
    WHERE company_id = ${ctx(req).companyId}
      AND approval_status = 'pending'
      AND expense_date >= ${monthStart} AND expense_date < ${monthEnd}
  `);

  const unmatchedCount   = Number(unmatchedRow?.count ?? 0);
  const openBillsCount   = Number(openBillsRow?.count ?? 0);
  const pendingExpCount  = Number(pendingExpRow?.count ?? 0);

  const blockers: string[] = [];
  if (unmatchedCount > 0)  blockers.push(`${unmatchedCount} unmatched payment(s)`);
  if (pendingExpCount > 0) blockers.push(`${pendingExpCount} pending expense approval(s)`);

  const warnings: string[] = [];
  if (openBillsCount > 0)  warnings.push(`${openBillsCount} unpaid bill(s) this period`);

  res.json({
    success: true,
    data: {
      period,
      can_close: blockers.length === 0,
      blockers,
      warnings,
      unmatched_payments: unmatchedCount,
      open_bills: openBillsCount,
      pending_expenses: pendingExpCount,
    },
  } satisfies ApiResponse);
});

// POST /governance/periods/:id/close
governanceRouter.post('/periods/:id/close', requireRole('owner', 'finance'), async (req: Request, res: Response) => {
  const [period] = await withRLS(ctx(req), async (db) => db`
    SELECT * FROM financial_periods WHERE id = ${req.params.id} AND company_id = ${ctx(req).companyId}
  `);
  if (!period) return res.status(404).json({ success: false, error: 'Period not found' });
  if (period.status !== 'open' && period.status !== 'closing') {
    return res.status(400).json({ success: false, error: `Period is already ${period.status}` });
  }

  const monthStart = new Date(period.period_month).toISOString().slice(0, 10);
  const [sy2, sm2] = monthStart.split('-').map(Number);
  const nextMonth2 = sm2 === 12 ? `${sy2 + 1}-01-01` : `${sy2}-${String(sm2 + 1).padStart(2, '0')}-01`;
  const monthEnd = nextMonth2;

  // Re-run pre-close checks
  const [pendingExpRow] = await withRLS(ctx(req), async (db) => db`
    SELECT COUNT(*) AS count FROM expenses
    WHERE company_id = ${ctx(req).companyId}
      AND approval_status = 'pending'
      AND expense_date >= ${monthStart} AND expense_date < ${monthEnd}
  `);
  const [unmatchedRow] = await withRLS(ctx(req), async (db) => db`
    SELECT COUNT(*) AS count FROM unmatched_payments
    WHERE company_id = ${ctx(req).companyId}
      AND created_at >= ${monthStart} AND created_at < ${monthEnd}
      AND resolved_at IS NULL
  `);

  const blockers = [];
  if (Number(pendingExpRow?.count ?? 0) > 0) blockers.push('pending expense approvals');
  if (Number(unmatchedRow?.count ?? 0) > 0) blockers.push('unmatched payments');

  if (blockers.length > 0) {
    return res.status(400).json({
      success: false,
      error: `Cannot close period: resolve ${blockers.join(' and ')} first`,
    });
  }

  const [updated] = await withRLS(ctx(req), async (db) => db`
    UPDATE financial_periods SET
      status    = 'closed',
      closed_at = NOW(),
      closed_by = ${ctx(req).userId},
      updated_at = NOW()
    WHERE id = ${req.params.id} AND company_id = ${ctx(req).companyId}
    RETURNING *
  `);

  // Generate financial snapshot for the closed period
  try {
    const companyId = ctx(req).companyId;
    const [snap] = await withRLS(ctx(req), async (db) => db`
      SELECT
        COALESCE((
          SELECT SUM(p.amount) FROM payments p
          JOIN monthly_bills mb ON mb.id = p.bill_id
          WHERE p.company_id = ${companyId}
            AND p.undone_at IS NULL
            AND mb.for_month >= ${monthStart} AND mb.for_month < ${monthEnd}
        ), 0) AS total_revenue,
        COALESCE((
          SELECT SUM(e.amount) FROM expenses e
          WHERE e.company_id = ${companyId}
            AND (e.approval_status = 'approved' OR e.approval_status IS NULL)
            AND e.expense_date >= ${monthStart} AND e.expense_date < ${monthEnd}
        ), 0) AS total_expenses,
        COALESCE((
          SELECT SUM(pi.net_pay) FROM payroll_items pi
          JOIN payroll_runs pr ON pr.id = pi.payroll_run_id
          WHERE pr.company_id = ${companyId}
            AND pr.status = 'paid'
            AND pr.payroll_month >= ${monthStart} AND pr.payroll_month < ${monthEnd}
        ), 0) AS total_payroll,
        COALESCE((
          SELECT SUM(mb.total_due) FROM monthly_bills mb
          WHERE mb.company_id = ${companyId}
            AND mb.status IN ('open','partial','overdue')
            AND mb.for_month < ${monthEnd}
        ), 0) AS total_arrears,
        COALESCE((
          SELECT SUM(p2.amount) FROM payments p2
          WHERE p2.company_id = ${companyId}
            AND p2.undone_at IS NULL
            AND p2.recorded_at >= ${monthStart} AND p2.recorded_at < ${monthEnd}
        ), 0) AS total_payments,
        (SELECT COUNT(*) FROM leases l WHERE l.company_id = ${companyId} AND l.status = 'active') AS active_leases,
        (SELECT COUNT(*) FROM units u WHERE u.company_id = ${companyId} AND u.is_occupied = true)::numeric /
        NULLIF((SELECT COUNT(*) FROM units u2 WHERE u2.company_id = ${companyId}), 0) * 100 AS occupancy_rate
    `);

    await withRLS(ctx(req), async (db) => db`
      UPDATE financial_periods SET
        snap_total_revenue   = ${Number(snap.total_revenue)},
        snap_total_expenses  = ${Number(snap.total_expenses)},
        snap_total_payroll   = ${Number(snap.total_payroll)},
        snap_total_arrears   = ${Number(snap.total_arrears)},
        snap_total_payments  = ${Number(snap.total_payments)},
        snap_active_leases   = ${Number(snap.active_leases)},
        snap_occupancy_rate  = ${Number(snap.occupancy_rate ?? 0)},
        snap_generated_at    = NOW()
      WHERE id = ${req.params.id}
    `);
  } catch (_snapErr) {
    // Snapshot failure should not block period close
  }

  res.json({ success: true, data: updated } satisfies ApiResponse);
});

// POST /governance/periods/:id/force-close  (owner only — bypass blockers)
governanceRouter.post('/periods/:id/force-close', requireRole('owner'), async (req: Request, res: Response) => {
  const { notes } = z.object({ notes: z.string().min(10, 'Notes required for force close (min 10 chars)') }).parse(req.body);

  const [period] = await withRLS(ctx(req), async (db) => db`
    SELECT * FROM financial_periods WHERE id = ${req.params.id} AND company_id = ${ctx(req).companyId}
  `);
  if (!period) return res.status(404).json({ success: false, error: 'Period not found' });
  if (period.status === 'locked') return res.status(400).json({ success: false, error: 'Period is already locked' });

  const [updated] = await withRLS(ctx(req), async (db) => db`
    UPDATE financial_periods SET
      status            = 'closed',
      closed_at         = NOW(),
      closed_by         = ${ctx(req).userId},
      force_closed      = TRUE,
      force_close_notes = ${notes},
      updated_at        = NOW()
    WHERE id = ${req.params.id} AND company_id = ${ctx(req).companyId}
    RETURNING *
  `);

  // Generate snapshot (same as normal close)
  try {
    const companyId = ctx(req).companyId;
    const monthStart = period.period_month;
    const monthEnd = new Date(new Date(monthStart).setMonth(new Date(monthStart).getMonth() + 1)).toISOString().slice(0, 10);
    const [snap] = await withRLS(ctx(req), async (db) => db`
      SELECT
        COALESCE((SELECT SUM(p.amount) FROM payments p JOIN monthly_bills mb ON mb.id = p.bill_id WHERE p.company_id = ${companyId} AND p.undone_at IS NULL AND mb.for_month >= ${monthStart} AND mb.for_month < ${monthEnd}), 0) AS total_revenue,
        COALESCE((SELECT SUM(e.amount) FROM expenses e WHERE e.company_id = ${companyId} AND (e.approval_status = 'approved' OR e.approval_status IS NULL) AND e.expense_date >= ${monthStart} AND e.expense_date < ${monthEnd}), 0) AS total_expenses,
        COALESCE((SELECT SUM(pi.net_pay) FROM payroll_items pi JOIN payroll_runs pr ON pr.id = pi.payroll_run_id WHERE pr.company_id = ${companyId} AND pr.status = 'paid' AND pr.payroll_month >= ${monthStart} AND pr.payroll_month < ${monthEnd}), 0) AS total_payroll,
        COALESCE((SELECT SUM(mb.total_due) FROM monthly_bills mb WHERE mb.company_id = ${companyId} AND mb.status IN ('open','partial','overdue') AND mb.for_month < ${monthEnd}), 0) AS total_arrears,
        COALESCE((SELECT SUM(p2.amount) FROM payments p2 WHERE p2.company_id = ${companyId} AND p2.undone_at IS NULL AND p2.recorded_at >= ${monthStart} AND p2.recorded_at < ${monthEnd}), 0) AS total_payments,
        (SELECT COUNT(*) FROM leases l WHERE l.company_id = ${companyId} AND l.status = 'active') AS active_leases,
        (SELECT COUNT(*) FROM units u WHERE u.company_id = ${companyId} AND u.is_occupied = true)::numeric / NULLIF((SELECT COUNT(*) FROM units u2 WHERE u2.company_id = ${companyId}), 0) * 100 AS occupancy_rate
    `);
    await withRLS(ctx(req), async (db) => db`
      UPDATE financial_periods SET snap_total_revenue = ${Number(snap.total_revenue)}, snap_total_expenses = ${Number(snap.total_expenses)}, snap_total_payroll = ${Number(snap.total_payroll)}, snap_total_arrears = ${Number(snap.total_arrears)}, snap_total_payments = ${Number(snap.total_payments)}, snap_active_leases = ${Number(snap.active_leases)}, snap_occupancy_rate = ${Number(snap.occupancy_rate ?? 0)}, snap_generated_at = NOW() WHERE id = ${req.params.id}
    `);
  } catch (_) { /* snapshot failure never blocks close */ }

  res.json({ success: true, data: updated } satisfies ApiResponse);
});

// POST /governance/periods/:id/lock  (owner only — immutable after this)
governanceRouter.post('/periods/:id/lock', requireRole('owner'), async (req: Request, res: Response) => {
  const [period] = await withRLS(ctx(req), async (db) => db`
    SELECT * FROM financial_periods WHERE id = ${req.params.id} AND company_id = ${ctx(req).companyId}
  `);
  if (!period) return res.status(404).json({ success: false, error: 'Period not found' });
  if (period.status !== 'closed') {
    return res.status(400).json({ success: false, error: 'Period must be closed before locking' });
  }

  const [updated] = await withRLS(ctx(req), async (db) => db`
    UPDATE financial_periods SET
      status    = 'locked',
      locked_at = NOW(),
      locked_by = ${ctx(req).userId},
      updated_at = NOW()
    WHERE id = ${req.params.id} AND company_id = ${ctx(req).companyId}
    RETURNING *
  `);
  res.json({ success: true, data: updated } satisfies ApiResponse);
});

// POST /governance/periods/:id/reopen  (owner only — back to open from closed)
governanceRouter.post('/periods/:id/reopen', requireRole('owner'), async (req: Request, res: Response) => {
  const [period] = await withRLS(ctx(req), async (db) => db`
    SELECT * FROM financial_periods WHERE id = ${req.params.id} AND company_id = ${ctx(req).companyId}
  `);
  if (!period) return res.status(404).json({ success: false, error: 'Period not found' });
  if (period.status === 'locked') {
    return res.status(400).json({ success: false, error: 'Locked periods cannot be reopened' });
  }
  if (period.status === 'open') {
    return res.status(400).json({ success: false, error: 'Period is already open' });
  }

  const [updated] = await withRLS(ctx(req), async (db) => db`
    UPDATE financial_periods SET
      status     = 'open',
      closed_at  = NULL,
      closed_by  = NULL,
      updated_at = NOW()
    WHERE id = ${req.params.id} AND company_id = ${ctx(req).companyId}
    RETURNING *
  `);
  res.json({ success: true, data: updated } satisfies ApiResponse);
});