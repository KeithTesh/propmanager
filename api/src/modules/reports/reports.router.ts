// api/src/modules/reports/reports.router.ts

import { Router, Request, Response } from 'express';
import { withRLS } from '../../db';
import { authenticate } from '../../middleware/auth';
import { generateReportPdf } from './pdf.generator';
import { generateReportXlsx } from './xlsx.generator';
import type { RLSContext } from '../../types';

export const reportsRouter = Router();
reportsRouter.use(authenticate);

function ctx(req: Request): RLSContext {
  return { companyId: req.ctx.companyId!, userId: req.ctx.userId, userRole: req.ctx.userRole };
}

// ─── helpers ──────────────────────────────────────────────────────────────────

async function getCompanyName(req: Request): Promise<string> {
  const [co] = await withRLS(ctx(req), async (db) => db`
    SELECT name FROM companies WHERE id = ${ctx(req).companyId} LIMIT 1
  `);
  return co?.name ?? 'PropManager';
}

// ─── GET /reports/income-statement ───────────────────────────────────────────

reportsRouter.get('/income-statement', async (req: Request, res: Response) => {
  const { from, to, format = 'pdf' } = req.query as Record<string, string | undefined>;
  const c = ctx(req);

  const fromDate = (from as string) ?? new Date(new Date().getFullYear(), 0, 1).toISOString().slice(0, 10);
  const toDate   = (to   as string) ?? new Date().toISOString().slice(0, 10);

  const [revenue] = await withRLS(c, async (db) => db`
    SELECT
      COALESCE(SUM(p.amount), 0)                                              AS total_revenue,
      COALESCE(SUM(p.amount) FILTER (WHERE mb.bill_type = 'rent'),       0)  AS rent_revenue,
      COALESCE(SUM(p.amount) FILTER (WHERE mb.bill_type = 'penalty'),    0)  AS penalty_revenue,
      COALESCE(SUM(p.amount) FILTER (WHERE mb.bill_type = 'signing'),    0)  AS signing_revenue,
      COALESCE(SUM(p.amount) FILTER (WHERE mb.bill_type = 'adjustment'), 0)  AS adjustment_revenue
    FROM payments p
    JOIN monthly_bills mb ON mb.id = p.bill_id AND mb.company_id = ${ctx(req).companyId}
    WHERE p.company_id = ${ctx(req).companyId} AND p.company_id = ${c.companyId}
      AND p.undone_at IS NULL
      AND (p.recorded_at AT TIME ZONE 'Africa/Nairobi')::DATE BETWEEN ${fromDate}::DATE AND ${toDate}::DATE
  `);

  const expenses = await withRLS(c, async (db) => db`
    SELECT
      category,
      COUNT(*)                 AS count,
      COALESCE(SUM(amount), 0) AS total
    FROM expenses
    WHERE company_id   = ${c.companyId}
      AND expense_date BETWEEN ${fromDate}::DATE AND ${toDate}::DATE
    GROUP BY category
    ORDER BY total DESC
  `);

  const [expTotals] = await withRLS(c, async (db) => db`
    SELECT COALESCE(SUM(amount), 0) AS total_expenses
    FROM expenses
    WHERE company_id   = ${c.companyId}
      AND expense_date BETWEEN ${fromDate}::DATE AND ${toDate}::DATE
  `);

  const monthly = await withRLS(c, async (db) => db`
    WITH rev AS (
      SELECT
        DATE_TRUNC('month', recorded_at AT TIME ZONE 'Africa/Nairobi') AS month_date,
        SUM(amount)                                                      AS revenue
      FROM payments
      WHERE company_id = ${c.companyId}
        AND undone_at IS NULL
        AND (recorded_at AT TIME ZONE 'Africa/Nairobi')::DATE BETWEEN ${fromDate}::DATE AND ${toDate}::DATE
      GROUP BY 1
    ),
    exp AS (
      SELECT
        DATE_TRUNC('month', expense_date::DATE::TIMESTAMPTZ AT TIME ZONE 'Africa/Nairobi') AS month_date,
        SUM(amount)                                                                          AS expenses
      FROM expenses
      WHERE company_id = ${c.companyId}
        AND expense_date BETWEEN ${fromDate}::DATE AND ${toDate}::DATE
      GROUP BY 1
    )
    SELECT
      TO_CHAR(r.month_date, 'Mon YYYY')  AS month,
      r.month_date,
      COALESCE(r.revenue,  0)            AS revenue,
      COALESCE(e.expenses, 0)            AS expenses
    FROM rev r
    LEFT JOIN exp e ON e.month_date = r.month_date
    ORDER BY r.month_date ASC
  `);

  const companyName = await getCompanyName(req);

  const data = {
    type: 'income-statement' as const,
    title: 'Income Statement',
    companyName,
    fromDate,
    toDate,
    revenue,
    expenses,
    expTotals,
    monthly,
    netIncome: Number(revenue.total_revenue) - Number(expTotals.total_expenses),
  };

  if (format === 'xlsx') {
    const buf = await generateReportXlsx(data);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="income-statement-${fromDate}-${toDate}.xlsx"`);
    res.send(buf);
  } else {
    const buf = await generateReportPdf(data);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="income-statement-${fromDate}-${toDate}.pdf"`);
    res.send(buf);
  }
});

// ─── GET /reports/rent-roll ───────────────────────────────────────────────────

reportsRouter.get('/rent-roll', async (req: Request, res: Response) => {
  const { property_id, format = 'pdf' } = req.query as Record<string, string | undefined>;
  const c = ctx(req);

  const rows = await withRLS(c, async (db) => db`
    SELECT
      p.name                     AS property_name,
      u.unit_number,
      u.bedrooms,
      t.full_name                AS tenant_name,
      t.phone                    AS tenant_phone,
      l.status                   AS lease_status,
      l.start_date,
      l.end_date,
      l.monthly_rent             AS rent_amount,
      l.deposit_amount,
      CASE WHEN l.deposit_paid_at IS NOT NULL THEN TRUE ELSE FALSE END AS deposit_paid,
      COALESCE((
        SELECT SUM(mb2.total_due)
        FROM monthly_bills mb2
        WHERE mb2.lease_id = l.id
          AND mb2.status IN ('open','partial','overdue')
          AND mb2.for_month <= DATE_TRUNC('month', CURRENT_DATE)
      ), 0) AS outstanding_balance
    FROM units u
    JOIN properties p ON p.id = u.property_id
    LEFT JOIN leases l ON l.unit_id = u.id AND l.status IN ('active','notice')
    LEFT JOIN tenants t ON t.id = l.primary_tenant_id
    WHERE u.company_id = ${c.companyId}
      ${property_id ? db`AND p.id = ${property_id}` : db``}
    ORDER BY p.name, u.unit_number
  `);

  const companyName = await getCompanyName(req);
  const data = { type: 'rent-roll' as const, title: 'Rent Roll', companyName, asOf: new Date().toISOString().slice(0, 10), rows };

  if (format === 'xlsx') {
    const buf = await generateReportXlsx(data);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="rent-roll-${data.asOf}.xlsx"`);
    res.send(buf);
  } else {
    const buf = await generateReportPdf(data);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="rent-roll-${data.asOf}.pdf"`);
    res.send(buf);
  }
});

// ─── GET /reports/occupancy ───────────────────────────────────────────────────

reportsRouter.get('/occupancy', async (req: Request, res: Response) => {
  const { format = 'pdf' } = req.query;
  const c = ctx(req);

  const byProperty = await withRLS(c, async (db) => db`
    SELECT
      p.id AS property_id,
      p.name AS property_name,
      COUNT(u.id)                                                             AS total_units,
      COUNT(l.id) FILTER (WHERE l.status = 'active')                         AS occupied,
      COUNT(l.id) FILTER (WHERE l.status = 'notice')                         AS on_notice,
      COUNT(u.id) - COUNT(l.id) FILTER (WHERE l.status IN ('active','notice')) AS vacant,
      COALESCE(SUM(l.monthly_rent), 0)                                        AS potential_rent,
      COALESCE(SUM(l.monthly_rent) FILTER (WHERE l.status = 'active'), 0)    AS actual_rent
    FROM properties p
    JOIN units u ON u.property_id = p.id
    LEFT JOIN leases l ON l.unit_id = u.id AND l.status IN ('active','notice')
    WHERE p.company_id = ${c.companyId}
    GROUP BY p.id, p.name
    ORDER BY p.name
  `);

  const [totals] = await withRLS(c, async (db) => db`
    SELECT
      COUNT(u.id)                                                              AS total_units,
      COUNT(l.id) FILTER (WHERE l.status = 'active')                          AS occupied,
      COUNT(l.id) FILTER (WHERE l.status = 'notice')                          AS on_notice,
      COUNT(u.id) - COUNT(l.id) FILTER (WHERE l.status IN ('active','notice')) AS vacant
    FROM units u
    JOIN properties p ON p.id = u.property_id
    LEFT JOIN leases l ON l.unit_id = u.id AND l.status IN ('active','notice')
    WHERE p.company_id = ${c.companyId}
  `);

  const companyName = await getCompanyName(req);
  const data = {
    type: 'occupancy' as const, title: 'Occupancy Report', companyName,
    asOf: new Date().toISOString().slice(0, 10), byProperty, totals,
  };

  if (format === 'xlsx') {
    const buf = await generateReportXlsx(data);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="occupancy-${data.asOf}.xlsx"`);
    res.send(buf);
  } else {
    const buf = await generateReportPdf(data);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="occupancy-${data.asOf}.pdf"`);
    res.send(buf);
  }
});

// ─── GET /reports/collection ──────────────────────────────────────────────────

reportsRouter.get('/collection', async (req: Request, res: Response) => {
  const { month, format = 'pdf' } = req.query as Record<string, string | undefined>;
  const c = ctx(req);

  const forMonth = month
    ? (month as string).slice(0, 7) + '-01'
    : `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-01`;

  const rows = await withRLS(c, async (db) => db`
    SELECT
      p.name                      AS property_name,
      u.unit_number,
      t.full_name                 AS tenant_name,
      t.phone                     AS tenant_phone,
      mb.bill_type,
      mb.total_amount,
      mb.total_paid,
      mb.total_due,
      mb.status,
      mb.due_date,
      (SELECT MAX(py.recorded_at) FROM payments py WHERE py.bill_id = mb.id AND py.undone_at IS NULL) AS last_payment_at
    FROM monthly_bills mb
    JOIN leases l     ON l.id  = mb.lease_id
    JOIN tenants t    ON t.id  = l.primary_tenant_id
    JOIN units u      ON u.id  = mb.unit_id
    JOIN properties p ON p.id  = u.property_id
    WHERE mb.company_id = ${c.companyId}
      AND TO_CHAR(mb.for_month, 'YYYY-MM') = ${forMonth.slice(0, 7)}
      AND mb.bill_type  = 'rent'
    ORDER BY p.name, mb.status DESC, t.full_name
  `);

  const [summary] = await withRLS(c, async (db) => db`
    SELECT
      COUNT(*)                                               AS total_bills,
      COUNT(*) FILTER (WHERE mb.status = 'paid')             AS paid_count,
      COUNT(*) FILTER (WHERE mb.status IN ('open','partial','overdue')) AS unpaid_count,
      COALESCE(SUM(mb.total_amount), 0)                      AS total_billed,
      COALESCE(SUM(mb.total_paid),   0)                      AS total_collected,
      COALESCE(SUM(mb.total_due),    0)                      AS total_outstanding
    FROM monthly_bills mb
    WHERE mb.company_id = ${ctx(req).companyId} AND mb.company_id = ${c.companyId}
      AND TO_CHAR(mb.for_month, 'YYYY-MM') = ${forMonth.slice(0, 7)}
      AND mb.bill_type  = 'rent'
  `);

  const companyName = await getCompanyName(req);
  const data = {
    type: 'collection' as const, title: 'Payment Collection Report',
    companyName, forMonth, rows, summary,
    collectionRate: Number(summary.total_billed) > 0
      ? Math.round((Number(summary.total_collected) / Number(summary.total_billed)) * 100)
      : 0,
  };

  if (format === 'xlsx') {
    const buf = await generateReportXlsx(data);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="collection-${forMonth.slice(0,7)}.xlsx"`);
    res.send(buf);
  } else {
    const buf = await generateReportPdf(data);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="collection-${forMonth.slice(0,7)}.pdf"`);
    res.send(buf);
  }
});